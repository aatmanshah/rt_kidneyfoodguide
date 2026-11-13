// Our own Stripe Checkout (replacing Zylvie). See docs/stripe-checkout-design.md.
//
// Buy buttons: any link with data-checkout-product="<slug>". A click asks pod_processor for a Stripe Checkout
// Session and sends the buyer to Stripe's hosted checkout page. The link's own href (Zylvie today) is the
// fallback when this script doesn't run or VITE_CHECKOUT_API_URL isn't set at build time.
//
// Thank-you pages: with ?session_id=cs_... in the URL, the page asks pod_processor whether that session was
// actually paid and only then shows the download button (served by pod_processor, not a public file).
//
// Nothing here fulfills an order. That only happens in pod_processor's signed Stripe webhook.

const API = (import.meta.env.VITE_CHECKOUT_API_URL || "").trim().replace(/\/+$/, "");

export const checkoutEnabled = Boolean(API);

// One id per page load: a double-click or a retry sends the same id, and the server turns it into Stripe's
// idempotency key, so the buyer gets the same checkout session instead of a second one.
const attemptId =
  (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

let starting = false;

function showButtonError(button, message) {
  let note = button.parentElement.querySelector("[data-checkout-error]");
  if (!note) {
    note = document.createElement("p");
    note.dataset.checkoutError = "";
    note.setAttribute("role", "alert");
    note.className = "mt-3 text-sm font-medium text-red-700";
    button.insertAdjacentElement("afterend", note);
  }
  note.textContent = message;
}

async function startCheckout(event) {
  const button = event.currentTarget;
  event.preventDefault();
  if (starting) return; // a double-click: the first request is already on its way
  starting = true;

  const label = button.textContent;
  button.setAttribute("aria-busy", "true");
  button.classList.add("opacity-70", "pointer-events-none");
  button.textContent = "Opening secure checkout…";

  try {
    const response = await fetch(`${API}/public/checkout/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: button.dataset.checkoutProduct, attemptId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.detail || `HTTP ${response.status}`);
    window.location.assign(data.url); // leave `starting` set: the page is navigating away
  } catch (err) {
    console.error("Checkout could not start:", err);
    starting = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("opacity-70", "pointer-events-none");
    button.textContent = label;
    showButtonError(
      button,
      "We couldn't open checkout just now. Please try again in a moment, or email support@renaltracker.com.",
    );
  }
}

if (checkoutEnabled) {
  for (const button of document.querySelectorAll("[data-checkout-product]")) {
    button.addEventListener("click", startCheckout);
  }
}

// Returning to the product page with the browser's back button can restore it from cache with a busy button.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  starting = false;
  for (const button of document.querySelectorAll("[data-checkout-product][aria-busy]")) {
    button.removeAttribute("aria-busy");
    button.classList.remove("opacity-70", "pointer-events-none");
  }
});

// Thank-you page check. Returns true if it handled the page (a Stripe session id was present).
export async function verifyOrder({ checking, found, missing, error }) {
  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  if (!checkoutEnabled || !sessionId) return false;

  const show = (el) => {
    checking.hidden = true;
    el.hidden = false;
  };

  try {
    const response = await fetch(`${API}/public/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (response.status === 404) return show(missing), true;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const order = await response.json();
    if (!order.paid || !order.downloadUrl) return show(missing), true;

    for (const link of found.querySelectorAll("[data-download-link]")) {
      link.href = order.downloadUrl;
    }
    const emailNote = found.querySelector("[data-order-email]");
    if (emailNote && order.email) {
      emailNote.textContent = `Order placed with ${order.email}.`;
      emailNote.hidden = false;
    }
    show(found);
  } catch (err) {
    console.error("Order check failed:", err);
    show(error || missing);
  }
  return true;
}
