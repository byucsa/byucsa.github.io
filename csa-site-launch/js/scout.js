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
let sort = { key: "deadline", dir: 1 };
const PAGE = 20;
let limit = PAGE;

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
// ---------- Sorting ----------
const SORTS = {
  deadline: { label: "Deadline", desc: "Deadline (soonest first)", flip: "Deadline (latest first)" },
  company: { label: "Company", desc: "Company (A–Z)", flip: "Company (Z–A)" },
  title: { label: "Role", desc: "Role (A–Z)", flip: "Role (Z–A)" },
  location: { label: "Location", desc: "State (A–Z)", flip: "State (Z–A)" },
  pay: { label: "Pay", desc: "Pay (highest first)", flip: "Pay (lowest first)" },
};
const text = (v) => show(v).toLowerCase();
// Rough yearly pay so hourly, monthly, and salary listings compare. Unknown pay sorts last.
function payValue(r) {
  const t = show(r.compensation).toLowerCase().replace(/,/g, "");
  const m = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?/);
  if (!m) return null;
  let n = parseFloat(m[1]) * (m[2] ? 1000 : 1);
  if (/hour|\/hr|\bhr\b|hourly/.test(t)) n *= 2080;
  else if (/week|\/wk/.test(t)) n *= 52;
  else if (/month|\/mo/.test(t)) n *= 12;
  else if (n < 200) n *= 2080; // a bare small number is almost always hourly
  return n;
}
// Location sorts by state first (then city), without changing what's shown.
const STATES = { alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA", colorado:"CO", connecticut:"CT", delaware:"DE", "district of columbia":"DC", florida:"FL", georgia:"GA", hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA", kansas:"KS", kentucky:"KY", louisiana:"LA", maine:"ME", maryland:"MD", massachusetts:"MA", michigan:"MI", minnesota:"MN", mississippi:"MS", missouri:"MO", montana:"MT", nebraska:"NE", nevada:"NV", "new hampshire":"NH", "new jersey":"NJ", "new mexico":"NM", "new york":"NY", "north carolina":"NC", "north dakota":"ND", ohio:"OH", oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI", "south carolina":"SC", "south dakota":"SD", tennessee:"TN", texas:"TX", utah:"UT", vermont:"VT", virginia:"VA", washington:"WA", "west virginia":"WV", wisconsin:"WI", wyoming:"WY" };
const ABBR = new Set(Object.values(STATES));
function stateOf(r) {
  const loc = show(r.location);
  if (!loc || /^(n\/?a|not stated|tbd)\b/i.test(loc)) return "";
  if (/^(remote|united states|u\.?s\.?\b|nationwide)/i.test(loc)) return "ZZ"; // remote / nationwide after the states
  for (const m of loc.matchAll(/,\s*([A-Z]{2})\b/g)) if (ABBR.has(m[1])) return m[1];
  const low = loc.toLowerCase();
  const name = Object.keys(STATES).sort((x, y) => y.length - x.length).find((n) => low.includes(n));
  if (name) return STATES[name];
  if (/remote|united states|\bu\.?s\.?\b|nationwide/i.test(loc)) return "ZZ"; // remote / multi-state after the states
  return "";
}
function locationKey(r) {
  const st = stateOf(r);
  return st ? st + " " + show(r.location).toLowerCase() : "";
}

function byText(a, b, key) {
  const x = text(a[key]), y = text(b[key]);
  if (!x !== !y) return x ? -1 : 1; // blanks last
  return x.localeCompare(y);
}
// For the deadline sort: open roles first, then no deadline, then passed deadlines.
function rank(r) { const d = daysUntil(r.deadline_date); return d < 0 ? 2 : d === Infinity ? 1 : 0; }
function order(a, b) {
  const { key, dir } = sort;
  let c = 0;
  if (key === "deadline") {
    c = rank(a) - rank(b) || dir * String(a.deadline_date || "").localeCompare(String(b.deadline_date || ""));
  } else if (key === "pay") {
    const x = payValue(a), y = payValue(b);
    c = (x === null) - (y === null) || (x !== null && y !== null ? dir * (y - x) : 0);
  } else {
    const x = key === "location" ? locationKey(a) : text(a[key]);
    const y = key === "location" ? locationKey(b) : text(b[key]);
    c = (!x) - (!y) || dir * x.localeCompare(y);
  }
  return c || byText(a, b, "company") || byText(a, b, "title");
}
function sortLabel() { return (sort.dir === 1 ? SORTS[sort.key].desc : SORTS[sort.key].flip).toLowerCase(); }

// Clickable column headers + a "Sort by" menu (for phones), kept in sync.
const ths = [...document.querySelectorAll("table.roles thead th")];
const colKeys = ["company", "title", "location", "deadline", "pay"];
ths.forEach((th, i) => {
  const key = colKeys[i];
  if (!key) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "th-sort";
  btn.dataset.key = key;
  btn.innerHTML = `<span></span><span class="th-sort__arrow" aria-hidden="true"></span>`;
  btn.firstChild.textContent = th.textContent;
  th.textContent = "";
  th.append(btn);
  btn.addEventListener("click", () => setSort(key, sort.key === key ? -sort.dir : 1));
});
const menu = document.createElement("select");
menu.id = "scout-sort";
menu.className = "sort-menu";
menu.setAttribute("aria-label", "Sort roles");
for (const [k, v] of Object.entries(SORTS)) {
  for (const d of [1, -1]) {
    const o = document.createElement("option");
    o.value = k + ":" + d;
    o.textContent = "Sort: " + (d === 1 ? v.desc : v.flip);
    menu.append(o);
  }
}
utahToggle.after(menu);
menu.addEventListener("change", () => { const [k, d] = menu.value.split(":"); setSort(k, Number(d)); });

// "Show more" footer under the table.
const moreBar = document.createElement("div");
moreBar.className = "more-bar";
const moreText = document.createElement("span");
const moreBtn = document.createElement("button");
moreBtn.type = "button";
moreBtn.className = "btn btn--outline btn--sm";
const allBtn = document.createElement("button");
allBtn.type = "button";
allBtn.className = "linkish";
allBtn.textContent = "Show all";
moreBar.append(moreText, moreBtn, allBtn);
empty.after(moreBar);
moreBtn.addEventListener("click", () => { limit += PAGE; render(); });
allBtn.addEventListener("click", () => { limit = Infinity; render(); });

function setSort(key, dir) {
  sort = { key, dir };
  limit = PAGE;
  menu.value = key + ":" + dir;
  ths.forEach((th, i) => {
    const k = colKeys[i];
    if (!k) return;
    const on = k === sort.key;
    th.setAttribute("aria-sort", on ? (sort.dir === 1 ? (k === "pay" ? "descending" : "ascending") : (k === "pay" ? "ascending" : "descending")) : "none");
    th.querySelector(".th-sort__arrow").textContent = on ? (th.getAttribute("aria-sort") === "ascending" ? "▲" : "▼") : "↕";
  });
  try { localStorage.setItem("csa-scout-sort", key + ":" + dir); } catch {}
  if (roles.length) render();
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
  for (const r of rows.slice(0, limit)) {
    const tr = document.createElement("tr");
    tr.append(td(r.company, "company"));
    const title = td(r.title, "title");
    // Rows stay compact: responsibilities and the rest open under "Details".
    const extra = [["What you'd do", r.responsibilities], ["Graduation dates", r.eligible_grad], ["Internship dates", r.internship_dates], ["Eligibility & notes", r.eligibility]]
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
  const shown = Math.min(limit, rows.length);
  count.textContent = `${rows.length} ${rows.length === 1 ? "role" : "roles"}, sorted by ${sortLabel()}.`;
  moreText.textContent = rows.length ? `Showing ${shown} of ${rows.length}` : "";
  moreBtn.hidden = shown >= rows.length;
  moreBtn.textContent = `Show ${Math.min(PAGE, rows.length - shown)} more`;
  allBtn.hidden = rows.length - shown <= PAGE;
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

search.addEventListener("input", () => { limit = PAGE; render(); });
utahToggle.addEventListener("click", () => {
  utahOnly = !utahOnly;
  limit = PAGE;
  utahToggle.setAttribute("aria-pressed", String(utahOnly));
  utahToggle.textContent = utahOnly ? "Utah only: on" : "Utah only";
  render();
});

{
  let saved = null;
  try { saved = localStorage.getItem("csa-scout-sort"); } catch {}
  const [k, d] = String(saved || "").split(":");
  setSort(SORTS[k] ? k : "deadline", Number(d) === -1 ? -1 : 1);
}

(async () => {
  const member = await requireActiveMember("scout.html");
  fillMemberBar(member);
  try {
    // Roles whose deadline has passed are hidden. Roles with no listed deadline stay.
    roles = (await fetchScoutRoles()).filter((r) => daysUntil(r.deadline_date) >= 0);
    stats();
    render();
  } catch (err) {
    count.textContent = "Couldn't load roles: " + err.message;
  }
})();
