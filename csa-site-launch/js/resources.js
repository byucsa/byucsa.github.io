import { CONFIG } from "./config.js";
import { getMembership, getSession, fetchResources, getResourceFileUrl, fetchCatalogue } from "./auth.js";
import { fillMemberBar } from "./member.js";

const $ = (id) => document.getElementById(id);
const list = $("resource-list");

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function isSafeUrl(url) {
  try { return ["https:", "http:"].includes(new URL(url).protocol); } catch { return false; }
}

function card(item) {
  const file = item.file_path ? String(item.file_path).replace(/^\/+/, "") : "";
  const link = !file && item.url && isSafeUrl(item.url);
  const live = Boolean(file || link);
  let node;
  if (file) {
    node = el("a", { class: "card res-card", href: "#", role: "button" });
    node.addEventListener("click", (e) => openFile(e, node, file));
  } else if (link) {
    node = el("a", { class: "card res-card", href: item.url, target: "_blank", rel: "noopener" });
  } else {
    node = el("div", { class: "card res-card" });
  }
  const status = (item.status || (live ? "live" : "building")).toLowerCase();
  node.append(el("span", { class: "tag " + (status === "live" ? "tag--live" : "tag--building") }, status));
  node.append(el("h3", {}, item.title));
  if (item.description) node.append(el("p", {}, item.description));
  return node;
}

// Ask for a short-lived link only when a member clicks, then open it.
async function openFile(e, node, path) {
  e.preventDefault();
  if (node.dataset.busy) return;
  node.dataset.busy = "1";
  const win = window.open("", "_blank"); // opened during the click so popup blockers allow it
  const old = node.querySelector(".res-file-msg");
  if (old) old.remove();
  try {
    const url = await getResourceFileUrl(path);
    if (win) { win.opener = null; win.location.href = url; } else { window.location.href = url; }
  } catch (err) {
    if (win) win.close();
    node.append(el("p", { class: "res-file-msg notice notice--error" }, err.message));
  } finally {
    delete node.dataset.busy;
  }
}

function render(items) {
  list.textContent = "";
  const sections = new Map();
  for (const item of items) {
    const key = item.section || "Resources";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(item);
  }
  for (const [name, group] of sections) {
    const section = el("section", { class: "res-section" });
    section.append(el("h2", {}, name));
    const grid = el("div", { class: "flex-wrap" });
    group.forEach((i) => grid.append(card(i)));
    section.append(grid);
    list.append(section);
  }
}

// The locked preview comes from the database, so adding or removing a resource
// in Supabase updates it too. The catalogue written into the page is the fallback.
async function renderLockedCatalogue() {
  const box = $("locked-catalogue");
  if (!box) return;
  let items;
  try { items = await fetchCatalogue(); } catch { return; }
  items = items.filter((i) => i.section !== "Case practice"); // the case agent is featured above
  if (!items.length) return;
  const lockIcon = box.querySelector(".locked-card__lock");
  const sections = new Map();
  for (const item of items) {
    const key = item.section || "Resources";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(item);
  }
  const frag = document.createDocumentFragment();
  for (const [name, group] of sections) {
    const section = el("section", { class: "res-section" });
    section.append(el("h2", {}, name));
    const grid = el("div", { class: "flex-wrap" });
    for (const item of group) {
      const status = (item.status || "building").toLowerCase();
      const c = el("div", { class: "card res-card res-card--locked" });
      if (lockIcon) c.append(lockIcon.cloneNode(true));
      c.append(el("span", { class: "tag " + (status === "live" ? "tag--live" : "tag--building") }, status));
      c.append(el("h3", {}, item.title));
      if (item.description) c.append(el("p", {}, item.description));
      grid.append(c);
    }
    section.append(grid);
    frag.append(section);
  }
  box.replaceChildren(frag);
}

// Non-members see what's inside, locked, with the right next step for their status.
function showLocked(status, email) {
  const title = $("lock-title");
  const text = $("lock-text");
  const primary = $("lock-primary");
  const secondary = $("lock-secondary");
  secondary.href = CONFIG.JOIN_URL;
  if (status === "pending") {
    title.textContent = "Your membership is pending";
    text.textContent = `You're signed in as ${email}. We're confirming your dues with BYU Clubs, which usually takes ${CONFIG.APPROVAL_TIME}. Haven't paid yet? Pay dues on clubs.byu.edu.`;
    primary.lastChild.textContent = " Check status";
    primary.href = "pending.html";
    secondary.textContent = "Pay dues on clubs.byu.edu";
  } else if (status === "expired") {
    title.textContent = "Your membership has expired";
    text.textContent = "Renew your dues on clubs.byu.edu and your account unlocks again at the next roster update, with the same email and password.";
    primary.lastChild.textContent = " Check status";
    primary.href = "pending.html";
    secondary.textContent = "Renew on clubs.byu.edu";
  }
  $("locked-view").hidden = false;
  renderLockedCatalogue();
}

(async () => {
  let membership;
  try {
    membership = await getMembership();
  } catch {
    membership = { status: "signed_out" };
  }
  $("res-loading").hidden = true;

  if (membership.status !== "active") {
    const session = membership.status === "signed_out" ? null : await getSession();
    showLocked(membership.status, session && session.email);
    return;
  }

  const session = await getSession();
  fillMemberBar({ ...membership, email: session.email });
  $("member-bar").hidden = false;
  $("member-view").hidden = false;
  try {
    const items = await fetchResources();
    // The case agent is featured beside Scout; its link comes from the database, never the page code.
    const agent = items.find((i) => i.section === "Case practice" && i.url && isSafeUrl(i.url));
    if (agent) {
      const featured = $("case-agent-card");
      featured.href = agent.url;
      featured.hidden = false;
    }
    render(items.filter((i) => i !== agent));
  } catch (err) {
    list.textContent = "";
    list.append(el("p", { class: "notice notice--error" }, "Couldn't load resources: " + err.message));
  }
})();
