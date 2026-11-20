// Runs on every page: footer year, and swaps the header button to
// "Sign out" when someone is already signed in.
import { hasStoredSession, signOut, DEMO } from "./auth.js";
import { CONFIG } from "./config.js";

document.querySelectorAll("[data-year]").forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

if (hasStoredSession()) {
  const link = document.querySelector("[data-member-link]");
  const label = document.querySelector("[data-member-label]");
  if (link && label) {
    link.href = "index.html";
    label.textContent = "Sign out";
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await signOut(); } finally { window.location.replace("index.html"); }
    });
  }
  document.querySelectorAll("[data-guest-only]").forEach((el) => { el.hidden = true; });
}

if (DEMO && document.body.dataset.memberPage !== undefined) {
  const banner = document.createElement("div");
  banner.className = "demo-banner";
  banner.textContent = "Demo mode: sample data. Connect Supabase in js/config.js to go live.";
  document.body.prepend(banner);
}

// Luma calendar: swap placeholder events for the live embed once configured.
function isLuma(url) {
  try { const u = new URL(url); return u.protocol === "https:" && /(^|\.)(luma\.com|lu\.ma)$/.test(u.hostname); }
  catch { return false; }
}
if (isLuma(CONFIG.LUMA_CALENDAR_URL)) {
  document.querySelectorAll("[data-calendar-link]").forEach((a) => {
    a.href = CONFIG.LUMA_CALENDAR_URL;
    a.target = "_blank";
    a.rel = "noopener";
  });
}
const list = document.querySelector("[data-events-list]");
if (list && isLuma(CONFIG.LUMA_EMBED_URL)) {
  const frame = document.createElement("iframe");
  frame.src = CONFIG.LUMA_EMBED_URL;
  frame.title = "CSA upcoming events on Luma";
  frame.loading = "lazy";
  frame.className = "luma-embed";
  frame.setAttribute("allowfullscreen", "");
  list.replaceWith(frame);
}

// Arriving from another page with a #section link: scroll again once fonts and
// images have loaded, so late layout shifts don't leave the section out of place.
if (window.location.hash.length > 1) {
  const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (target) {
    const land = () => target.scrollIntoView({ block: "start", behavior: "instant" });
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(land);
    window.addEventListener("load", land, { once: true });
  }
}
