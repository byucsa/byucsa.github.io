import { signOut, formatDate } from "./auth.js";

export function fillMemberBar(member) {
  document.querySelectorAll("[data-member-name]").forEach((el) => {
    el.textContent = member.full_name || member.email;
  });
  document.querySelectorAll("[data-member-expires]").forEach((el) => {
    el.textContent = member.expires_on ? formatDate(member.expires_on) : "the current term";
  });
  document.querySelectorAll("[data-signout]").forEach((b) =>
    b.addEventListener("click", async () => { await signOut(); window.location.replace("index.html"); }));
}
