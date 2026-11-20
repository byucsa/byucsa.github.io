import { CONFIG } from "./config.js";
import { requireActiveMember, fetchScoutRoles } from "./auth.js";
import { fillMemberBar } from "./member.js";

const UTAH = /\b(UT|Utah|Provo|Orem|Lehi|Draper|Sandy|Salt Lake|SLC|Ogden|American Fork|Pleasant Grove|South Jordan|West Jordan|Lindon|Vineyard|Bluffdale|Murray|Cottonwood Heights|Park City|St\.? George|Logan|Springville|Spanish Fork|Saratoga Springs|Eagle Mountain)\b/i;

const body = document.getElementById("roles-body");
const empty = document.getElementById("roles-empty");
const count = document.getElementById("roles-count");
const search = document.getElementById("scout-search");
const utahToggle = document.getElementById("utah-toggle");
let roles = [];
let utahOnly = false;

const submit = document.getElementById("submit-role");
if (CONFIG.SUBMIT_ROLE_URL && !CONFIG.SUBMIT_ROLE_URL.startsWith("[")) {
  submit.href = CONFIG.SUBMIT_ROLE_URL;
  submit.target = "_blank";
  submit.rel = "noopener";
}

function isSafeUrl(url) {
  try { return ["https:", "http:"].includes(new URL(url).protocol); } catch { return false; }
}
function td(text, cls) {
  const cell = document.createElement("td");
  if (cls) cell.className = cls;
  cell.textContent = text || "";
  return cell;
}
function isUtah(r) { return UTAH.test(r.location || ""); }
// The sheet uses "N/A", "-", "Not stated" for unknowns; show those as blank.
function show(v) {
  const t = String(v ?? "").trim();
  return /^(n\/?a|-+|—|–|not stated|none|tbd|unknown)?$/i.test(t) ? "" : t;
}
function tagEl(text, cls) {
  const t = document.createElement("span");
  t.className = "tag " + cls;
  t.style.marginLeft = "8px";
  t.textContent = text;
  return t;
}
// Open roles by deadline (soonest first), then roles with no deadline, then passed deadlines.
function order(a, b) {
  const rank = (r) => { const d = daysUntil(r.deadline_date); return d < 0 ? 2 : d === Infinity ? 1 : 0; };
  return rank(a) - rank(b) || String(a.deadline_date || "").localeCompare(String(b.deadline_date || "")) ||
    String(a.company || "").localeCompare(String(b.company || ""));
}
function daysUntil(iso) {
  if (!iso) return Infinity;
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

function render() {
  const q = search.value.trim().toLowerCase();
  const rows = roles.filter((r) => {
    if (utahOnly && !isUtah(r)) return false;
    if (!q) return true;
    return [r.company, r.title, r.location, r.responsibilities, r.work_arrangement, r.eligibility, r.eligible_grad]
      .some((v) => (v || "").toLowerCase().includes(q));
  }).sort(order);
  body.textContent = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.append(td(r.company, "company"));
    const title = td(r.title, "title");
    if (show(r.responsibilities)) {
      const p = document.createElement("div");
      p.className = "resp";
      p.textContent = show(r.responsibilities);
      title.append(p);
    }
    const extra = [["Graduation dates", r.eligible_grad], ["Internship dates", r.internship_dates], ["Eligibility & notes", r.eligibility]]
      .map(([k, v]) => [k, show(v)]).filter(([, v]) => v);
    if (extra.length) {
      const more = document.createElement("details");
      more.className = "role-more";
      const sum = document.createElement("summary");
      sum.textContent = "Details";
      const dl = document.createElement("dl");
      for (const [k, v] of extra) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        dl.append(dt, dd);
      }
      more.append(sum, dl);
      title.append(more);
    }
    tr.append(title);
    const loc = td([show(r.location), show(r.work_arrangement)].filter(Boolean).join(" · ") || "Not listed");
    if (isUtah(r)) loc.append(tagEl("Utah", "tag--utah"));
    tr.append(loc);
    const days = daysUntil(r.deadline_date);
    const dl = td(show(r.deadline) || "Not listed");
    if (days < 0) { dl.append(tagEl("Passed", "tag--building")); tr.classList.add("role--passed"); }
    else if (days <= 14) dl.append(tagEl(days === 0 ? "Today" : "Soon", "tag--soon"));
    tr.append(dl);
    tr.append(td(show(r.compensation) || "Not listed"));
    const action = document.createElement("td");
    if (r.apply_url && isSafeUrl(r.apply_url)) {
      const a = document.createElement("a");
      a.className = "btn btn--outline btn--sm";
      a.href = r.apply_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Apply";
      a.setAttribute("aria-label", `Apply to ${r.title} at ${r.company}`);
      action.append(a);
    }
    tr.append(action);
    body.append(tr);
  }
  empty.hidden = rows.length > 0;
  count.textContent = `Showing ${rows.length} ${rows.length === 1 ? "role" : "roles"}. Sorted by deadline, soonest first.`;
}

function stats() {
  const set = (k, v) => { document.querySelector(`[data-stat="${k}"]`).textContent = v; };
  set("open", roles.filter((r) => daysUntil(r.deadline_date) >= 0).length); // passed deadlines don't count
  set("utah", roles.filter((r) => isUtah(r) && daysUntil(r.deadline_date) >= 0).length);
  set("soon", roles.filter((r) => { const d = daysUntil(r.deadline_date); return d >= 0 && d <= 14; }).length);
  const latest = roles.map((r) => r.synced_at).filter(Boolean).sort().pop();
  set("updated", latest
    ? new Date(latest).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Demo");
}

search.addEventListener("input", render);
utahToggle.addEventListener("click", () => {
  utahOnly = !utahOnly;
  utahToggle.setAttribute("aria-pressed", String(utahOnly));
  utahToggle.textContent = utahOnly ? "Utah only: on" : "Utah only";
  render();
});

(async () => {
  const member = await requireActiveMember("scout.html");
  fillMemberBar(member);
  try {
    roles = await fetchScoutRoles();
    stats();
    render();
  } catch (err) {
    count.textContent = "Couldn't load roles: " + err.message;
  }
})();
