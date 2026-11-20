-- CSA member site: Supabase schema
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- How access works
--   * Anyone with an @byu.edu email can create an account (email confirmation required).
--   * Member content is readable only when public.my_membership() says 'active':
--     the signed-in email (or its NetID) is on the latest BYU Clubs roster,
--     dues are paid, membership is active, and the expiration date hasn't passed.
--   * The roster and Scout tables are replaced by the Google Apps Script sync,
--     which uses the service_role key. Browsers never write to these tables.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.roster (
  email       text primary key,              -- stored lowercase
  netid       text,
  full_name   text,
  dues_paid   boolean not null default false,
  active      boolean not null default false,
  expires_on  date,
  synced_at   timestamptz not null default now()
);
create index if not exists roster_netid_idx on public.roster (lower(netid));

-- Permanent access, independent of the roster and dues (for example, the people
-- who run the site). The roster sync never touches this table. Edit it in the
-- Supabase Table Editor. Match is on BYU NetID, so it works for netid@byu.edu.
create table if not exists public.access_overrides (
  netid      text primary key,               -- stored lowercase, e.g. 'jdoe12'
  full_name  text,
  note       text,
  added_at   timestamptz not null default now()
);

create table if not exists public.resources (
  id           bigint generated always as identity primary key,
  section      text not null,
  title        text not null,
  description  text,
  url          text,                          -- an outside link (e.g. the case agent); leave null while building
  file_path    text,                          -- OR a file uploaded to the private "resources" storage bucket
  status       text not null default 'building',
  sort         int  not null default 100,
  created_at   timestamptz not null default now()
);

-- Older databases: add the file column if the table already existed.
alter table public.resources add column if not exists file_path text;

create table if not exists public.scout_roles (
  posting_id        text primary key,
  company           text not null,
  title             text not null,
  location          text,
  work_arrangement  text,
  eligible_grad     text,
  deadline          text,                     -- as written in the sheet, e.g. "Jan 15" or "Rolling"
  deadline_date     date,                     -- parsed for sorting; null when rolling/unknown
  compensation      text,
  responsibilities  text,
  apply_url         text,
  internship_dates  text,
  eligibility       text,
  synced_at         timestamptz not null default now()
);

alter table public.roster      enable row level security;
alter table public.resources   enable row level security;
alter table public.scout_roles enable row level security;
alter table public.access_overrides enable row level security;

-- The roster is never readable from the browser (no policies = no access).
revoke all on public.roster from anon, authenticated;
revoke all on public.access_overrides from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Membership logic
-- ---------------------------------------------------------------------------
-- Status for any email: 'active' | 'expired' | 'pending' (not on roster).
-- Dates are compared in Mountain Time so access ends at local midnight.
create or replace function public.membership_for_email(p_email text)
returns table (status text, full_name text, expires_on date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_today date := (now() at time zone 'America/Denver')::date;
  r public.roster;
  v_override_name text;
begin
  if v_email = '' then
    return query select 'signed_out'::text, null::text, null::date;
    return;
  end if;

  -- Permanent access list: always active, no expiration.
  if v_email like '%@byu.edu' then
    select o.full_name into v_override_name
    from public.access_overrides o
    where lower(o.netid) = split_part(v_email, '@', 1);
    if found then
      return query select 'active'::text, v_override_name, null::date;
      return;
    end if;
  end if;

  -- Match on email first; fall back to NetID (netid@byu.edu) so aliases still work.
  select x.* into r
  from public.roster x
  where lower(x.email) = v_email
     or (x.netid is not null
         and v_email like '%@byu.edu'
         and lower(x.netid) = split_part(v_email, '@', 1))
  order by (x.dues_paid and x.active) desc, x.expires_on desc nulls last
  limit 1;

  if not found then
    return query select 'pending'::text, null::text, null::date;
  elsif r.dues_paid and r.active and (r.expires_on is null or r.expires_on >= v_today) then
    return query select 'active'::text, r.full_name, r.expires_on;
  elsif not r.dues_paid and (r.expires_on is null or r.expires_on >= v_today) then
    -- Joined on clubs.byu.edu but dues not paid yet: treat as pending, not expired.
    return query select 'pending'::text, r.full_name, null::date;
  else
    return query select 'expired'::text, r.full_name, r.expires_on;
  end if;
end;
$$;

-- Called by the website for the signed-in user.
create or replace function public.my_membership()
returns table (status text, full_name text, expires_on date)
language sql stable security definer set search_path = public
as $$
  select * from public.membership_for_email(auth.jwt() ->> 'email');
$$;

create or replace function public.is_active_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select status = 'active' from public.my_membership()), false);
$$;

revoke all on function public.membership_for_email(text) from public, anon, authenticated;
revoke all on function public.my_membership()            from public, anon;
revoke all on function public.is_active_member()         from public, anon;
grant execute on function public.my_membership()    to authenticated;
grant execute on function public.is_active_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: only active members can read member content
-- ---------------------------------------------------------------------------
drop policy if exists "Active members can read resources" on public.resources;
create policy "Active members can read resources"
  on public.resources for select to authenticated
  using (public.is_active_member());

drop policy if exists "Active members can read scout roles" on public.scout_roles;
create policy "Active members can read scout roles"
  on public.scout_roles for select to authenticated
  using (public.is_active_member());

revoke insert, update, delete on public.resources, public.scout_roles from anon, authenticated;
grant select on public.resources, public.scout_roles to authenticated;

-- ---------------------------------------------------------------------------
-- Leadership team (public): synced hourly from the "Officers" Google Sheet
-- ---------------------------------------------------------------------------
create table if not exists public.team (
  sort             int  not null,
  name             text not null,
  title            text not null,
  photo            text,              -- file in the team-photos bucket, an https link, or assets/team/...
  company_contact  boolean not null default false,  -- shown on the For Companies contact card
  term             text,              -- e.g. 2026–27, shown in the Team page heading
  synced_at        timestamptz not null default now()
);
alter table public.team enable row level security;
drop policy if exists "Anyone can read the team" on public.team;
create policy "Anyone can read the team" on public.team for select to anon, authenticated using (true);
revoke insert, update, delete on public.team from anon, authenticated;
grant select on public.team to anon, authenticated;

create or replace function public.sync_team(rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'sync_team: no officers in the sheet; keeping the current team';
  end if;
  delete from public.team where true;
  insert into public.team (sort, name, title, photo, company_contact, term)
  select coalesce((x->>'sort')::int, 100), trim(x->>'name'), trim(x->>'title'),
         nullif(trim(coalesce(x->>'photo', '')), ''),
         coalesce((x->>'company_contact')::boolean, false),
         nullif(trim(coalesce(x->>'term', '')), '')
  from jsonb_array_elements(rows) x
  where coalesce(trim(x->>'name'), '') <> '' and coalesce(trim(x->>'title'), '') <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.sync_team(jsonb) from public, anon, authenticated;
grant execute on function public.sync_team(jsonb) to service_role;

-- Public catalogue: names and descriptions only (never links or files), so
-- non-members can see what membership unlocks. Powers the locked preview.
create or replace function public.resource_catalogue()
returns table (section text, title text, description text, status text, sort int)
language sql stable security definer set search_path = public
as $$
  select r.section, r.title, r.description, r.status, r.sort
  from public.resources r
  order by r.sort, r.id;
$$;
revoke all on function public.resource_catalogue() from public;
grant execute on function public.resource_catalogue() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private file storage for member resources
-- ---------------------------------------------------------------------------
-- Officers upload files in Supabase > Storage > resources. The bucket is private:
-- there is no public link to any file. The site asks for a link that works for
-- 5 minutes, and only an active member's request is allowed to get one.
insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do update set public = false;

-- Officer headshots: a public bucket (these photos are on the public Team page).
insert into storage.buckets (id, name, public)
values ('team-photos', 'team-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Active members can open resource files" on storage.objects;
create policy "Active members can open resource files"
  on storage.objects for select to authenticated
  using (bucket_id = 'resources' and public.is_active_member());

-- ---------------------------------------------------------------------------
-- Sync functions (called only by the Apps Script with the service_role key)
-- ---------------------------------------------------------------------------
-- Replace the roster with the latest BYU Clubs export.
-- rows: [{email, netid, full_name, dues_paid, active, expires_on}]
create or replace function public.sync_roster(rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'sync_roster: no rows supplied';
  end if;

  delete from public.roster where true;

  insert into public.roster (email, netid, full_name, dues_paid, active, expires_on, synced_at)
  select distinct on (lower(trim(x->>'email')))
         lower(trim(x->>'email')),
         nullif(lower(trim(x->>'netid')), ''),
         nullif(trim(x->>'full_name'), ''),
         coalesce((x->>'dues_paid')::boolean, false),
         coalesce((x->>'active')::boolean, true),
         nullif(x->>'expires_on', '')::date,
         now()
  from jsonb_array_elements(rows) x
  where coalesce(trim(x->>'email'), '') <> ''
  order by lower(trim(x->>'email')), nullif(x->>'expires_on', '')::date desc nulls last;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Replace Internship Scout postings with the current sheet.
create or replace function public.sync_scout_roles(rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'sync_scout_roles: rows must be an array';
  end if;

  delete from public.scout_roles where true;

  insert into public.scout_roles (posting_id, company, title, location, work_arrangement,
    eligible_grad, deadline, deadline_date, compensation, responsibilities, apply_url,
    internship_dates, eligibility, synced_at)
  select distinct on (x->>'posting_id')
         x->>'posting_id', x->>'company', x->>'title', x->>'location', x->>'work_arrangement',
         x->>'eligible_grad', x->>'deadline', nullif(x->>'deadline_date', '')::date,
         x->>'compensation', x->>'responsibilities', x->>'apply_url',
         x->>'internship_dates', x->>'eligibility', now()
  from jsonb_array_elements(rows) x
  where coalesce(x->>'posting_id', '') <> ''
    and coalesce(x->>'company', '') <> ''
    and coalesce(x->>'title', '') <> '';

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Every confirmed account and its membership status, for officer alerts and welcome emails.
create or replace function public.member_signup_states()
returns table (email text, status text, created_at timestamptz)
language sql stable security definer set search_path = public, auth
as $$
  select lower(u.email)::text, m.status, u.created_at
  from auth.users u
  cross join lateral public.membership_for_email(u.email) m
  where u.email_confirmed_at is not null;
$$;

-- Current roster size, used by the sync's safety check.
create or replace function public.roster_count()
returns int
language sql stable security definer set search_path = public
as $$ select count(*)::int from public.roster; $$;

revoke all on function public.sync_roster(jsonb)        from public, anon, authenticated;
revoke all on function public.sync_scout_roles(jsonb)   from public, anon, authenticated;
revoke all on function public.member_signup_states()    from public, anon, authenticated;
revoke all on function public.roster_count()            from public, anon, authenticated;
grant execute on function public.sync_roster(jsonb)      to service_role;
grant execute on function public.sync_scout_roles(jsonb) to service_role;
grant execute on function public.member_signup_states()  to service_role;
grant execute on function public.roster_count()          to service_role;

-- ---------------------------------------------------------------------------
-- Starter resources (edit in Table Editor > resources; add a url to make one live)
-- ---------------------------------------------------------------------------
insert into public.resources (section, title, description, url, status, sort)
select * from (values
  ('Case practice',      'Casing Preparation Agent',      'Strategy application prep, case-interview drills, and 19 full cases with an AI interviewer and scorecards.', 'https://claude.ai/artifact/V6MPwjmsgZ2AuoUGFXAxhs', 'live', 5),
  ('Recruiting prep',    'Strategy resume template',      'One page, written for strategy recruiters, with annotated examples.', null, 'building', 10),
  ('Recruiting prep',    'Strategy case interview guide', 'Frameworks, practice cases, and how in-house cases differ from consulting ones.', null, 'building', 20),
  ('Recruiting prep',    'Behavioral question bank',      'Common questions with sample answers from members who got offers.', null, 'building', 30),
  ('Recruiting prep',    'Outreach templates',            'Email and LinkedIn messages for cold outreach, follow-ups, and thank-you notes.', null, 'building', 40),
  ('Skills library',     'Market sizing practice set',    'Worked problems with model answers, easiest to hardest.', null, 'building', 50),
  ('Skills library',     'Excel modeling templates',      'Market entry, pricing, and build-vs-buy models from our workshops.', null, 'building', 60),
  ('Skills library',     'Executive slide templates',     'Recommendation decks with the answer first, CSA-branded.', null, 'building', 70),
  ('Events and network', 'Speaker slides', 'Posted when speakers allow it, with notes from each session.', null, 'after each event', 80),
  ('Events and network', 'Utah strategy team directory',  'Which local companies have strategy and corp dev teams, and who to contact.', null, 'building', 90),
  ('Events and network', 'Member placement directory',    'Where members have interned, and who is open to a 15-minute call.', null, 'building', 100)
) as v(section, title, description, url, status, sort)
where not exists (select 1 from public.resources);

-- Permanent access: Caleb Schaack and Shawn Egan (VPs of Corporate Outreach, site admins).
-- Add or remove people in the Table Editor (match is on BYU NetID).
insert into public.access_overrides (netid, full_name, note) values
  ('cschaack', 'Caleb Schaack', 'Site admin, permanent access'),
  ('egans',    'Shawn Egan',    'Site admin, permanent access')
on conflict (netid) do nothing;


-- Starter team (replaced by the Officers sheet once the sync is running).
insert into public.team (sort, name, title, photo, company_contact, term)
select * from (values
  (10, 'Annie Tanner',      'Co-President',              null, false, '2026–27'),
  (20, 'Tyler Rollins',     'Co-President',              null, false, '2026–27'),
  (30, 'Caleb Schaack',     'VP of Corporate Outreach',  'assets/team/caleb-schaack.jpg', true, '2026–27'),
  (40, 'Shawn Egan',        'VP of Corporate Outreach',  'assets/team/shawn-egan.jpg',    true, '2026–27'),
  (50, 'Gretchen Westover', 'VP of Events',              null, false, '2026–27'),
  (60, 'Duncan Sanford',    'VP of Communications',      null, false, '2026–27'),
  (70, 'Sarahí Armijos',    'VP of Student Development', null, false, '2026–27'),
  (80, 'Trevor Adair',      'VP of Student Development', null, false, '2026–27')
) as v(sort, name, title, photo, company_contact, term)
where not exists (select 1 from public.team);
