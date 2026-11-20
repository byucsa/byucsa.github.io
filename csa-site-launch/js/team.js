// Team page and the For Companies contact card read the officer list from the
// database (synced from the Officers Google Sheet). The names written into the
// page are the fallback if the database can't be reached.
import { CONFIG } from "./config.js";
import { DEMO, getClient } from "./auth.js";

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function photoUrl(photo) {
  const p = String(photo || "").trim();
  if (!p) return "";
  if (/^https:\/\//i.test(p)) return p;
  if (/^assets\/team\/[\w.\-]+$/i.test(p)) return p;
  if (/^[\w.\- ]+\.(jpe?g|png|webp)$/i.test(p)) {
    return `${CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/team-photos/${encodeURIComponent(p)}`;
  }
  return "";
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function person(o) {
  const card = el("article", { class: "person" });
  const src = photoUrl(o.photo);
  if (src) {
    const img = el("img", { class: "person__photo", src, alt: o.name, width: "96", height: "96", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(el("div", { class: "person__avatar", "aria-hidden": "true" }, initials(o.name))), { once: true });
    card.append(img);
  } else {
    card.append(el("div", { class: "person__avatar", "aria-hidden": "true" }, initials(o.name)));
  }
  card.append(el("h3", {}, o.name), el("p", {}, o.title));
  return card;
}

function joinNames(names) {
  if (names.length <= 2) return names.join(" & ");
  return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
}

function contactRole(people) {
  const titles = [...new Set(people.map((p) => p.title))];
  if (titles.length !== 1) return "CSA officers";
  if (people.length === 1) return titles[0];
  return titles[0].replace(/^VP\b/, "VPs").replace(/^Co-President$/, "Co-Presidents");
}

(async () => {
  if (DEMO) return;
  const list = document.querySelector("[data-team-list]");
  const names = document.querySelector("[data-contact-names]");
  if (!list && !names) return;
  let team;
  try {
    const sb = await getClient();
    const { data, error } = await sb.from("team").select("sort, name, title, photo, company_contact, term").order("sort");
    if (error || !data || !data.length) return;
    team = data;
  } catch { return; }

  if (list) {
    list.replaceChildren(...team.map(person));
    const term = team.find((o) => o.term)?.term;
    const termEl = document.querySelector("[data-team-term]");
    if (term && termEl) termEl.textContent = term;
  }
  if (names) {
    const contacts = team.filter((o) => o.company_contact);
    if (contacts.length) {
      names.textContent = joinNames(contacts.map((o) => o.name));
      const role = document.querySelector("[data-contact-role]");
      if (role) role.textContent = contactRole(contacts);
    }
  }
})();
