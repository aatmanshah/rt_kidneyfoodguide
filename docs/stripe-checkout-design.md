# Design: our own checkout on Stripe (replacing Zylvie)

**Date:** 2026-11-13
**Status:** Phase 1 demo built in Stripe test mode (Harvest Recipes). Not live.
**Follows:** [stripe-checkout-spike.md](stripe-checkout-spike.md). That doc's core recommendation (Stripe
Checkout, webhook-driven fulfillment, real verification on the thank-you page) is kept, with two changes:

- **Hosted Checkout, not embedded.** The buyer goes to Stripe's own checkout page and comes back. It is the same
  Stripe-built form either way, but hosted needs no checkout page, no Stripe.js and no publishable key on this
  site. That makes it less work and fewer moving parts. Embedded can still be added later by changing one
  parameter on the server, if keeping buyers on our domain turns out to matter for conversion.
- **The server part lives in pod_processor**, not in a new Express server on this site. The next section says why.

## Where the server code lives

The spike assumed this site would grow a small Express server. pod_processor (FastAPI, already on Railway) is a
better home:

- It already does everything that happens **after** a sale: the Zylvie webhook writes the order row to Google
  Sheets, writes a pending fulfillment row for physical books, and the EasyPost worker buys labels. A Stripe
  webhook can feed the same processor, so physical-book fulfillment needs no new code.
- It already has the Encharge client and the `stripe` SDK installed.
- It already serves this site's browser requests (`POST /public/waitlist`) with an Origin allow-list and CORS.
- The site stays a static Vite build on `serve`. No second server to run or deploy.

The cost is one cross-origin call from the site, which the existing CORS setup already handles.

## How a purchase works

```
kidneyfoodguide.com (static)                pod_processor (FastAPI)                     Stripe
-----------------------------               ----------------------------------          ------------------
/fallrecipes/  "Get the Recipes" click
      fetch() asks for a session      ---->  POST /public/checkout/sessions
                                             - looks the product up in the server catalog
                                             - finds the Price by lookup_key        ---->  create Checkout Session
      browser goes to session.url     <----  { url }                                <----  (hosted page)
      buyer pays on checkout.stripe.com (cards, Apple Pay, Google Pay, Link, coupons)
      Stripe redirects to /fallrecipes/thank-you/?session_id=cs_...  ("back" returns to /fallrecipes/)
/fallrecipes/thank-you/               ---->  GET /public/checkout/sessions/{id}      ---->  retrieve session
      shows "Download" only if paid   <----  { paid, productName, email (masked), downloadUrl }
      Download button                 ---->  GET /public/checkout/download/{id}  (checks paid again, streams PDF)

                                             POST /webhooks/stripe   <------------------  checkout.session.completed
                                             - verifies the Stripe signature, logs the paid order
                                             - (later) exactly-once work: Encharge tag for email
                                               products, fulfillment row for physical books
```

### Why this stops duplicate charges and double fulfillment

- **One session per click.** The product page sends a random attempt id. The server uses it as Stripe's
  idempotency key, so a double-click or a retried request returns the **same** session, not a second one.
- **One Checkout Session can only be paid once.** Stripe enforces that.
- **The download is checked with Stripe on every request.** The server only gives out the file after Stripe
  says that exact session was paid. Reaching the thank-you page is not enough.
- **Future exactly-once work runs only from the signed webhook.** That means Encharge tags for email products
  and fulfillment rows for the physical book. When it is added, it must skip sessions it has already handled,
  because Stripe retries webhooks.

### Paid PDF is no longer public

Today the PDF is at `/downloads/harvest-recipes-RenalTracker.pdf` in this site's `public/` folder, so anyone
with the URL gets it free. The thank-you page's "order check" only checks that the URL has a query string.
In the new flow pod_processor serves the PDF only for a paid session. The file must be **removed from
`public/downloads/`** when this goes live (the Zylvie flow links to it until then).

## Product catalog

The product list lives on the server (`pod_processor/checkout/catalog.py`), so the browser can only ask for a
product by slug and never sets prices:

| slug | Stripe Price lookup_key | kind | delivery |
|---|---|---|---|
| `harvest-recipes` | `harvest_recipes_pdf` | digital | PDF download from the thank-you page + Stripe receipt |
| `food-list-book` (phase 3) | `food_list_book_print` | physical | Sheets fulfillment row -> EasyPost worker |

The catalog entry has an `encharge_tag` field, but nothing uses it yet. It is for the email/subscription
products later.

Prices are found by **lookup_key**, not hard-coded `price_...` ids. The same code then works in test and live
mode, and a price change in the Stripe Dashboard (move the lookup key to the new price) needs no deploy.

Adding a product = one catalog entry, one Stripe Product/Price with a lookup key, one landing page whose buy
buttons carry `data-checkout-product="<slug>"`, and a thank-you page (or one shared thank-you page; see open questions).

## Phases

1. **Harvest Recipes (digital), test mode.** Built today: catalog, the 3 public routes, the webhook, the buy
   buttons, the real thank-you check. *This is the demo.*
2. **Harvest Recipes live.**
   - Live Product/Price with lookup key `harvest_recipes_pdf`.
   - Dashboard webhook endpoint -> `https://<pod_processor>/webhooks/stripe` for `checkout.session.completed`
     and `checkout.session.async_payment_succeeded`.
   - Env vars on Railway (below).
   - Turn on Stripe's email receipts. Decide how buyers get the link again later; today it is only the
     thank-you page (see open question 2).
   - Switch the 4 CTAs on `/fallrecipes/`, remove the public PDF, and change the campaign email's P.S. link from
     Zylvie to `/fallrecipes/`.
   - Keep the Zylvie product live but unlinked for about 2 weeks as a fallback.
3. **Food List Book (physical).** Add `shipping_address_collection` (US) and a shipping rate on the session.
   In the webhook, turn the Stripe session into the same order row a Zylvie sale writes, skip sessions already
   in the sheet, and write the pending fulfillment row. The EasyPost worker then runs unchanged. Run one live end-to-end order (a real label) before switching the CTAs on `/book/`.
4. **More product pages.** New pages copy the `/fallrecipes/` pattern. Bundles are just more `line_items`.
   Coupons are Stripe promotion codes (`allow_promotion_codes` is already on).
5. **Subscriptions (Defy Dialysis), last.** These are the riskiest to move: there are existing Zylvie
   subscribers, and the reconciliation worker depends on them. Needs `mode=subscription`, the Stripe customer
   portal, and a plan to move existing subscribers. Separate design.

## Env vars (pod_processor)

| Var | Purpose |
|---|---|
| `STRIPE_CHECKOUT_SECRET_KEY` | Secret key for checkout (`sk_test_...` locally). Kept separate from the existing `STRIPE_API_KEY`, which the reconciliation worker uses with the live account. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` signing secret of the webhook endpoint |
| `CHECKOUT_SITE_URL` | `https://kidneyfoodguide.com` (`http://localhost:5173` locally); used for return URLs |
| `CHECKOUT_DOWNLOADS_DIR` | Folder that holds the paid PDFs. Default `private_downloads/`: each PDF is committed to the private repo, un-ignored by name. Only set this if the files move to a volume. |
| `SUBSCRIBE_ALLOWED_ORIGINS` | Existing; the checkout routes reuse the same Origin allow-list and CORS |

Website build: `VITE_CHECKOUT_API_URL` (the pod_processor base URL). No Stripe key is needed on the site.

## Open questions

1. **Where should the paid PDFs live on Railway?** *Decided (2026-11-13):* commit them to the private
   pod_processor repo (`private_downloads/`, un-ignored per file), so they deploy with the code. Storage cost is
   effectively zero; the cost is about 40 MB per book in git history. Revisit with a Railway volume or private
   object storage (S3/R2) if a file nears GitHub's 100 MB limit or the books add up to several hundred MB.
2. **How long should a download link work?** The demo allows any paid session id. That id is a long random
   string, but it ends up in the buyer's browser history and email. A signed, expiring link plus "re-send my
   link" is better before launch.
3. **Taxes.** Should Stripe Tax (`automatic_tax`) be on? Digital goods are taxable in some US states. This is a
   business decision, not code.
4. **One shared `/checkout/thank-you/` page vs. one per product.** The demo keeps `/fallrecipes/thank-you/`. A
   shared page reads the product from the session and scales better past 3 or 4 products.
5. **Sheets vs. a database.** Stripe is the source of truth for payments, and Sheets keeps working for
   fulfillment. A database becomes worth it at subscriptions (phase 5), not before.
