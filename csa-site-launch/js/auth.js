// Member authentication and data access.
// Live mode uses Supabase (email + password accounts). Access to member
// content is decided in the database by public.my_membership(), which checks
// the signed-in email against the BYU Clubs roster: paid, active, unexpired.
// Demo mode (no Supabase config) simulates all of this in the browser.
import { CONFIG } from "./config.js";
import { DEMO_RESOURCES, DEMO_SCOUT } from "./demo-data.js";

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;
const DEMO_KEY = "csa-demo-session";
const SAFE_NEXT = new Set(["resources.html", "scout.html"]);

// ---------- storage helpers (storage can throw in some browsers) ----------
const memoryStore = {};
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); }
  catch { value === null ? delete memoryStore[key] : (memoryStore[key] = value); }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return memoryStore[key] ?? null; }
}

// ---------- Supabase client (loaded only in live mode) ----------
let clientPromise = null;
export function getClient() {
  if (DEMO) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(
      ({ createClient }) =>
        createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
    );
  }
  return clientPromise;
}

// ---------- helpers ----------
export function isAllowedEmail(email) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  return CONFIG.ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

export function safeNext(value, fallback = "resources.html") {
  return SAFE_NEXT.has(value) ? value : fallback;
}

export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function friendlyError(error) {
  const msg = (error && error.message) || String(error || "Something went wrong.");
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Try again or reset your password.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first. Check your BYU inbox for the confirmation link.";
  if (/already registered|already been registered/i.test(msg)) return "An account with this email already exists. Sign in instead.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/password.*(short|at least)/i.test(msg)) return "Use a password with at least 8 characters.";
  return msg;
}

// ---------- demo mode ----------
function demoSession() {
  const raw = load(DEMO_KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function demoMembership(email) {
  const e = email.toLowerCase();
  if (e.startsWith("pending")) return { status: "pending", full_name: null, expires_on: null };
  if (e.startsWith("expired")) return { status: "expired", full_name: "Demo Member", expires_on: "2026-08-31" };
  return { status: "active", full_name: "Demo Member", expires_on: "2027-04-30" };
}

// ---------- public API ----------
export async function getSession() {
  if (DEMO) return demoSession();
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  return data.session ? { email: data.session.user.email } : null;
}

export async function signIn(email, password) {
  email = String(email).trim().toLowerCase();
  if (!isAllowedEmail(email)) throw new Error("Use your @byu.edu email.");
  if (DEMO) {
    if (!password) throw new Error("Enter your password.");
    store(DEMO_KEY, JSON.stringify({ email }));
    return { email };
  }
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  return { email: data.user.email };
}

export async function signUp(email, password) {
  email = String(email).trim().toLowerCase();
  if (!isAllowedEmail(email)) throw new Error("Use the @byu.edu email you joined clubs.byu.edu with.");
  if (String(password).length < 8) throw new Error("Use a password with at least 8 characters.");
  if (DEMO) return { needsConfirmation: true };
  const sb = await getClient();
  const redirect = new URL("login.html?confirmed=1", window.location.href).href;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
  if (error) throw new Error(friendlyError(error));
  // Supabase returns a user with no identities when the email is already registered.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error("An account with this email already exists. Sign in instead.");
  }
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  if (DEMO) { store(DEMO_KEY, null); return; }
  const sb = await getClient();
  await sb.auth.signOut();
}

export async function sendPasswordReset(email) {
  email = String(email).trim().toLowerCase();
  if (!isAllowedEmail(email)) throw new Error("Enter your @byu.edu email first.");
  if (DEMO) return;
  const sb = await getClient();
  const redirect = new URL("login.html?reset=1", window.location.href).href;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
  if (error) throw new Error(friendlyError(error));
}

export async function updatePassword(password) {
  if (String(password).length < 8) throw new Error("Use a password with at least 8 characters.");
  if (DEMO) return;
  const sb = await getClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

export async function onPasswordRecovery(callback) {
  if (DEMO) return;
  const sb = await getClient();
  sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") callback(); });
}

// Returns { status: 'active' | 'pending' | 'expired' | 'signed_out', full_name, expires_on }
export async function getMembership() {
  const session = await getSession();
  if (!session) return { status: "signed_out" };
  if (DEMO) return demoMembership(session.email);
  const sb = await getClient();
  const { data, error } = await sb.rpc("my_membership");
  if (error) throw new Error(friendlyError(error));
  const row = Array.isArray(data) ? data[0] : data;
  return row || { status: "pending" };
}

// Use on member pages. Redirects anyone who isn't an active member.
export async function requireActiveMember(pageName) {
  const membership = await getMembership();
  if (membership.status === "signed_out") {
    window.location.replace(`login.html?next=${encodeURIComponent(pageName)}`);
    return new Promise(() => {});
  }
  if (membership.status !== "active") {
    window.location.replace("pending.html");
    return new Promise(() => {});
  }
  const session = await getSession();
  return { ...membership, email: session.email };
}

export async function fetchResources() {
  if (DEMO) return DEMO_RESOURCES;
  const sb = await getClient();
  const { data, error } = await sb
    .from("resources")
    .select("section, title, description, url, file_path, status, sort")
    .order("sort", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

// Files live in the private "resources" storage bucket. Supabase only hands out a
// link (valid for 5 minutes) when the signed-in person is an active member.
export async function getResourceFileUrl(path) {
  if (DEMO) throw new Error("Files open here once the site is live.");
  const sb = await getClient();
  const { data, error } = await sb.storage.from("resources").createSignedUrl(path, 300);
  if (error || !data) throw new Error("This file isn't available right now. Try again, or tell an officer.");
  return data.signedUrl;
}

// Names and descriptions of every resource, for the locked preview. No links or files.
export async function fetchCatalogue() {
  if (DEMO) return DEMO_RESOURCES.map(({ section, title, description, status, sort }) => ({ section, title, description, status, sort }));
  const sb = await getClient();
  const { data, error } = await sb.rpc("resource_catalogue");
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

export async function fetchScoutRoles() {
  if (DEMO) return DEMO_SCOUT;
  const sb = await getClient();
  const { data, error } = await sb
    .from("scout_roles")
    .select("*")
    .order("deadline_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(friendlyError(error));
  return data;
}

// Lightweight check for the header (no network): is someone signed in?
export function hasStoredSession() {
  if (DEMO) return Boolean(demoSession());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) return true;
    }
  } catch { /* storage unavailable */ }
  return false;
}
