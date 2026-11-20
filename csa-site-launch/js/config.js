// Site configuration.
//
// Leave SUPABASE_URL and SUPABASE_ANON_KEY empty to run in DEMO MODE:
// the member login accepts any @byu.edu email and shows sample data.
// Fill both in (Supabase dashboard > Project Settings > API) to go live.
// The anon key is designed to be public; access is enforced by the
// database's row-level security, not by keeping this key secret.
export const CONFIG = {
  SUPABASE_URL: "https://wxopmnhfsjuparcidzmr.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_PojFPGIZeq6PuEN6IdcOQg_xirrI8Ro",

  // Only these email domains can create member accounts.
  ALLOWED_EMAIL_DOMAINS: ["byu.edu"],

  // Where students join and pay dues.
  JOIN_URL: "https://clubs.byu.edu/link/club/18295873486205992",

  // Form where members can submit an internship Scout missed.
  SUBMIT_ROLE_URL: "[submit-role-form-link]",

  // Luma event calendar. Paste both from Luma (luma.com/home/calendars > your calendar):
  //   LUMA_EMBED_URL: Settings > Embed, the iframe's src (looks like https://luma.com/embed/calendar/cal-.../events)
  //   LUMA_CALENDAR_URL: the calendar's public page, used for "Subscribe to calendar"
  // Leave empty to show the placeholder event cards in index.html.
  LUMA_EMBED_URL: "",
  LUMA_CALENDAR_URL: "",

  // Shown on the pending screen.
  APPROVAL_TIME: "1–2 days",
};
