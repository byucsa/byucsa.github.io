// Home page "at a glance" card: shows the next event from the CSA Luma calendar
// (synced hourly into the database). If nothing is scheduled, or the database
// can't be reached, the regular meeting text written into the page stays.
import { DEMO, getClient } from "./auth.js";

const TZ = "America/Denver";

function isSafeUrl(url) {
  try { return ["https:", "http:"].includes(new URL(url).protocol); } catch { return false; }
}

function when(ev) {
  const start = new Date(ev.starts_at);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    .format(start).replace(" AM", " am").replace(" PM", " pm");
  return `${day} · ${time}`;
}

(async () => {
  if (DEMO) return;
  const label = document.querySelector("[data-next-label]");
  const title = document.querySelector("[data-next-title]");
  const meta = document.querySelector("[data-next-meta]");
  if (!label || !title || !meta) return;
  let ev;
  try {
    const sb = await getClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await sb.from("events")
      .select("title, starts_at, ends_at, location, url")
      .or(`ends_at.gte.${nowIso},and(ends_at.is.null,starts_at.gte.${nowIso})`)
      .order("starts_at", { ascending: true })
      .limit(1);
    if (error || !data || !data.length) return;
    ev = data[0];
  } catch { return; }

  label.textContent = "Next event";
  title.textContent = ev.title;
  const place = String(ev.location || "").split(",")[0].trim();
  meta.textContent = [when(ev), place].filter(Boolean).join(" · ") + " · ";
  const link = document.createElement("a");
  if (ev.url && isSafeUrl(ev.url)) {
    link.href = ev.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Event details →";
  } else {
    link.href = "events.html";
    link.textContent = "Events calendar →";
  }
  meta.append(link);
})();
