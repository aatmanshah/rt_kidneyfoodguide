# Spike: Replacing Zylvie checkout with direct Stripe integration

**Date:** 2026-09-25
**Status:** Spike / not yet started
**Trigger:** Zylvie (current host for product pages, checkout, coupons, testimonials,
bundles) is producing duplicate Stripe transactions for the same order, causing
customer complaints and churn.

## The core problem

Duplicate charges are almost always caused by:

1. Missing **idempotency keys** when creating a Checkout Session / PaymentIntent
   (a double-click or retried request creates two separate charges instead of
   reusing one), or
2. Fulfillment logic trusting the client-side "success" redirect instead of a
   server-verified **webhook** (`checkout.session.completed` /
   `payment_intent.succeeded`), which is also what causes duplicate fulfillment
   on retries.

Zylvie owns that code, not us — we can't fix it from our side. Building checkout
ourselves means we control both of those directly, which is the actual fix, not
just a UI change.

## Current site architecture (relevant constraint)

`kidneyfoodguide.com` is a **100% static site** today: Vite build output served by
`serve -l $PORT dist` on Railway, zero backend, zero server-side code.

Any real Stripe integration — hosted or custom — needs *some* server component,
because creating a Checkout Session/PaymentIntent requires the Stripe **secret**
key, which can never be exposed client-side. This server requirement is the real
scope driver, more than which Stripe UI option we pick.

Practical path: evolve `serve -l $PORT dist` into a small Express app that serves
the static `dist/` files *and* exposes a few `/api/*` routes, on the same Railway
service. Small, natural step from what's already running — not a rearchitecture.

## Options considered

| | **A. Payment Links** | **B. Stripe Checkout** (hosted or embedded) | **C. Stripe Elements / Payment Element** (fully custom UI) |
|---|---|---|---|
| What it is | Dashboard-created, no-code checkout URL | Stripe-built checkout page — redirect to stripe.com, or rendered inline via iframe on our own domain | We build the entire payment form ourselves, styled to match the site |
| Backend needed | None to *create* the checkout | Small: create-session + webhook endpoints | Small-medium: create-intent + webhook + more state handling |
| Frontend work | Swap CTA `href` to the link | Swap CTA to a `fetch()` call | Build/style a full checkout form: loading states, errors, SCA handling |
| Fixes duplicate charges? | Only partially — no server control over fulfillment idempotency | Yes, if built with webhook-driven fulfillment + idempotency keys | Yes, same as B |
| Coupons | Dashboard-only, limited | Native (`allow_promotion_codes: true`) — basically free | We build the promo-code UI + validation ourselves |
| Bundles (multi-item) | Awkward — one link per fixed bundle | Native (`line_items` array) | We build it |
| Stays on our domain | No | Redirect: no · Embedded: yes (iframe) | Yes |
| Accessibility/polish | Stripe-maintained, excellent | Stripe-maintained, excellent | On us to build and maintain to that bar |
| Ongoing maintenance | ~none | Low — Stripe ships new payment methods/compliance automatically | Higher — we own the UI forever |
| PCI scope | SAQ A (simplest) | SAQ A | SAQ A (same as B, as long as raw card data never touches our servers) |

Note: PCI compliance scope is **identical** between B and C — both tokenize card
data client-side via Stripe.js. "Custom" doesn't mean more compliance burden,
just more UI we're responsible for building and maintaining.

## Effort estimates

Assumes we already have direct Stripe API access (likely — Zylvie's charges are
landing in "our" Stripe account per what was described, so probably no new
account/KYC setup needed).

- **Stripe Checkout (hosted or embedded), one product:** **~1-2 days.**
  Backend: create-session endpoint, webhook handler (signature verification,
  idempotent event processing), a session-verification endpoint for the success
  page. Frontend: swap the "Order Your Copy" buttons; rebuild the success page
  to check the real `session_id` server-side (replacing the soft
  query-string-presence heuristic currently used for the Zylvie handoff on
  `/fallrecipes/thank-you/`). Dashboard: create a Product/Price (~10 min).

- **Stripe Elements (Payment Element), one product:** **~3-5 days.** Same
  backend as above, plus a fully custom, accessible, mobile-tested payment
  form. Given the site's audience (50+, often less technical), matching
  Stripe's own hosted-page polish takes real effort — main reason not to
  default here.

- **Payment Links:** **~half a day** for the link itself, but we'd still want
  the webhook + verification backend to actually solve duplicate charges — so
  not meaningfully cheaper than Checkout once that's accounted for, and we
  lose native coupon/bundle support.

- **Each additional product after the first:** cheap — mostly a new Price ID +
  a marketing page reusing the existing pattern (`/book`, `/fallrecipes`
  already establish this). A day or less each.

- **Testimonials:** unrelated to Stripe — just page content, already managed
  by hand in git. No new infra needed.

## Recommendation

**Start with Stripe Checkout, embedded mode**, for the Food List and Harvest
Recipes books:

- Lowest effort of the options that actually fixes the duplicate-charge problem
- Stripe-maintained polish/accessibility (important for this audience)
- Native coupon support (a stated requirement)
- Stays visually on our domain via the iframe, no redirect to a stranger's site

This means: one Checkout Session per attempt, webhook-driven fulfillment, and a
real server-side check on the success page
(`stripe.checkout.sessions.retrieve(session_id).payment_status === 'paid'`)
replacing the current "any query string present" heuristic built for the
Zylvie handoff.

Elements/fully-custom UI is worth revisiting only if a concrete need shows up
that hosted Checkout genuinely can't express (e.g., a real multi-item cart
flow) — not a good starting point.

## Open questions before starting implementation

1. Do we have direct access to the Stripe account/API keys already (via
   Zylvie's Stripe-Connect setup or otherwise), or does a new Stripe account
   need setting up/verifying first? Affects calendar time, not engineering
   effort.
2. One Railway service (Express serving both static files and `/api/*`) or a
   separate API service? Leaning toward one service for simplicity — same
   deploy, no CORS.
3. Do we need our own order-tracking DB, or is Stripe's own dashboard/API
   sufficient as the source of truth for now? Affects whether a database gets
   added at this stage or deferred.
4. Confirm scope: just the two existing books to start
   (`/book`, `/fallrecipes`), Zylvie continues to host everything else during
   the transition?

## Next step (not started)

Sketch the concrete implementation plan for the Checkout path: exact routes,
which webhook events to handle, request/response shapes, and how the existing
`/fallrecipes/thank-you/` page changes to use real verification instead of the
soft gate.
