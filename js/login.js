import { CONFIG } from "./config.js";
import {
  DEMO, signIn, signUp, sendPasswordReset, updatePassword, onPasswordRecovery,
  getSession, getMembership, safeNext,
} from "./auth.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const next = safeNext(params.get("next"));
const message = $("message");
const tabs = { signin: $("tab-signin"), signup: $("tab-signup") };
const forms = { signin: $("form-signin"), signup: $("form-signup"), reset: $("form-reset") };

document.querySelectorAll("[data-approval-time]").forEach((el) => { el.textContent = CONFIG.APPROVAL_TIME; });

function show(text, kind = "info") {
  message.hidden = !text;
  message.textContent = text || "";
  message.className = "notice" + (kind === "error" ? " notice--error" : kind === "success" ? " notice--success" : "");
}

function setTab(name) {
  for (const key of ["signin", "signup"]) {
    const on = key === name;
    tabs[key].setAttribute("aria-selected", String(on));
    forms[key].hidden = !on;
  }
  forms.reset.hidden = true;
  $("tabs").hidden = false;
  show("");
}
tabs.signin.addEventListener("click", () => setTab("signin"));
tabs.signup.addEventListener("click", () => setTab("signup"));
// Arrow keys move between tabs.
$("tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const target = tabs.signin.getAttribute("aria-selected") === "true" ? "signup" : "signin";
  setTab(target);
  tabs[target].focus();
});

async function busy(form, fn) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await fn(); } catch (err) { show(err.message, "error"); } finally { button.disabled = false; }
}

async function routeByMembership() {
  const m = await getMembership();
  window.location.replace(m.status === "active" ? next : "pending.html");
}

forms.signin.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(forms.signin, async () => {
    await signIn(forms.signin.email.value, forms.signin.password.value);
    await routeByMembership();
  });
});

forms.signup.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(forms.signup, async () => {
    const email = forms.signup.email.value;
    const { needsConfirmation } = await signUp(email, forms.signup.password.value);
    if (needsConfirmation) {
      setTab("signin");
      forms.signin.email.value = email.trim();
      show(DEMO
        ? "Demo mode: account created. Sign in with any password. (Emails starting with \"pending\" or \"expired\" preview those screens.)"
        : "Almost done. Check your BYU inbox for a confirmation link, then sign in.", "success");
    } else {
      await routeByMembership();
    }
  });
});

$("forgot").addEventListener("click", () => {
  const email = forms.signin.email.value;
  if (!email) { show("Enter your BYU email above, then click Forgot password.", "error"); forms.signin.email.focus(); return; }
  sendPasswordReset(email)
    .then(() => show(DEMO ? "Demo mode: a reset link would be emailed." : "If that email has an account, a reset link is on its way.", "success"))
    .catch((err) => show(err.message, "error"));
});

function showReset() {
  $("tabs").hidden = true;
  forms.signin.hidden = true;
  forms.signup.hidden = true;
  forms.reset.hidden = false;
  $("auth-title").textContent = "Set a new password";
  $("auth-sub").textContent = "Choose a new password for your member account.";
  show("");
}
onPasswordRecovery(showReset);

forms.reset.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(forms.reset, async () => {
    await updatePassword(forms.reset.password.value);
    show("Password updated.", "success");
    await routeByMembership();
  });
});

// Arriving from an email link or already signed in.
(async () => {
  if (params.get("tab") === "signup") setTab("signup");
  if (params.get("reset")) { showReset(); return; }
  try {
    const session = await getSession();
    if (session) {
      if (params.get("confirmed")) show("Email confirmed. Checking your membership…", "success");
      await routeByMembership();
    } else if (params.get("confirmed")) {
      show("Email confirmed. Sign in to continue.", "success");
    }
  } catch (err) {
    show(err.message, "error");
  }
})();
