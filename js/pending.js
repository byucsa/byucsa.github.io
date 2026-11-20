import { CONFIG } from "./config.js";
import { getMembership, getSession, signOut, formatDate } from "./auth.js";

const states = ["loading", "pending", "expired", "error"];
function showState(name) {
  states.forEach((s) => { document.getElementById("state-" + s).hidden = s !== name; });
}

document.querySelectorAll("[data-approval-time]").forEach((el) => { el.textContent = CONFIG.APPROVAL_TIME; });
document.querySelectorAll("[data-signout]").forEach((b) =>
  b.addEventListener("click", async () => { await signOut(); window.location.replace("index.html"); }));
document.querySelectorAll("[data-recheck]").forEach((b) => b.addEventListener("click", check));

async function check() {
  showState("loading");
  try {
    const session = await getSession();
    if (!session) { window.location.replace("login.html"); return; }
    document.querySelectorAll("[data-email]").forEach((el) => { el.textContent = session.email; });
    const m = await getMembership();
    if (m.status === "active") { window.location.replace("resources.html"); return; }
    if (m.status === "expired") {
      document.querySelector("[data-expired-on]").textContent =
        m.expires_on ? `expired on ${formatDate(m.expires_on)}` : "is no longer active";
      showState("expired");
      return;
    }
    showState("pending");
  } catch (err) {
    document.querySelector("[data-error]").textContent = err.message;
    showState("error");
  }
}
check();
