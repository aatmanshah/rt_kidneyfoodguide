// RenalTracker waitlist form. No framework, no analytics, no third-party scripts, no cookies, no stored ids.
//
// Dormant by default: the form is revealed only when the site is built with BOTH VITE_WAITLIST_URL and
// VITE_WAITLIST_TOKEN (see .env.example). Otherwise the "Waitlist opening soon" fallback in index.html stays
// visible and nothing is ever submitted.
//
// Sends ONE request: POST <VITE_WAITLIST_URL> with { email, source, website } and an
// "Authorization: Bearer <VITE_WAITLIST_TOKEN>" header. No health data.
//
// THE TOKEN IS NOT A STRONG SECRET. Vite inlines VITE_* values into this JavaScript bundle, so it is visible in
// the page source and the browser's network tab to anyone who opens the page. It only stops casual scripts and
// curl callers who have never loaded the page. To rotate it, change VITE_WAITLIST_TOKEN here and
// WAITLIST_API_TOKEN on the API, and redeploy both. The server's per-IP limit is the real backstop.
// Never put a real secret in a VITE_* variable, and never commit a real value.

const ENDPOINT = (import.meta.env.VITE_WAITLIST_URL || "").trim();
const TOKEN = (import.meta.env.VITE_WAITLIST_TOKEN || "").trim();

const SOURCE = "renaltracker_landing";
const TIMEOUT_MS = 15000;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MESSAGES = {
  email: "Please enter a valid email address.",
  rejected: "That email address could not be added. Please check it and try again.",
  limited: "Too many attempts. Please wait a minute and try again.",
  retry: "We could not add you to the list just now. Please try again in a minute.",
  generic: "Something went wrong on our side. Please try again in a few minutes.",
  offline: "We could not reach the server. Please check your connection and try again.",
  success: "You are on the list. We will email you when RenalTracker opens.",
};

const DONE_LABEL = "You are on the list";

function init() {
  const form = document.querySelector("[data-waitlist-form]");
  const fallback = document.querySelector("[data-waitlist-fallback]");
  if (!form || !ENDPOINT || !TOKEN) return;

  const cta = document.querySelector("[data-waitlist-cta]");
  const status = form.querySelector("[data-waitlist-status]");
  const submit = form.querySelector("[data-waitlist-submit]");
  const email = form.elements.email;
  const honeypot = form.elements.website;

  if (fallback) fallback.hidden = true;
  form.hidden = false;
  if (cta) cta.textContent = "Join the waitlist";

  function show(message, kind) {
    status.textContent = message; // textContent, never innerHTML
    status.className = "mt-4 min-h-[1.5rem] text-center text-base font-medium " + (kind === "ok" ? "text-brand-100" : "text-red-300");
  }

  function setInvalid(invalid) {
    if (invalid) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  email.addEventListener("input", () => setInvalid(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    // Stray spaces ("jane @gmail.com") are never part of an address; the server also tidies common typos.
    const value = email.value.replace(/\s+/g, "");
    setInvalid(false);

    if (!EMAIL_SHAPE.test(value) || value.length > 254) {
      setInvalid(true);
      show(MESSAGES.email, "error");
      email.focus();
      return;
    }

    submit.disabled = true;
    show("Sending...", "ok");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
        body: JSON.stringify({
          email: value,
          source: SOURCE,
          website: honeypot ? honeypot.value : "",
        }),
        credentials: "omit",
        signal: controller.signal,
      });

      if (response.ok) {
        form.reset();
        show(MESSAGES.success, "ok");
        // Keep the button disabled: the signup is done, and a second click would only repeat it.
        submit.textContent = DONE_LABEL;
        return;
      }
      if (response.status === 422) {
        setInvalid(true);
        show(MESSAGES.rejected, "error");
      } else if (response.status === 429) {
        show(MESSAGES.limited, "error");
      } else if (response.status === 502 || response.status === 503) {
        show(MESSAGES.retry, "error"); // the email service did not accept it: nothing was saved, so try again
      } else {
        // Includes 401/403 (a token or origin problem on our side): say nothing specific to the visitor.
        show(MESSAGES.generic, "error");
      }
    } catch (err) {
      show(err && err.name === "AbortError" ? MESSAGES.generic : MESSAGES.offline, "error");
    } finally {
      clearTimeout(timer);
      if (submit.textContent !== DONE_LABEL) submit.disabled = false;
    }
  });
}

init();
