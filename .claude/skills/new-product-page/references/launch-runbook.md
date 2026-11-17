# Launching a product in production

This is what took Harvest Recipes live on 2026-11-13 (pod_processor PRs #20, #21; website PRs #16, #17). The
one-time setup is already done, so for most new products only the "every product" steps apply. Live mode
charges real money: give the user these steps to do, and do any of them yourself only when the user asks in
this conversation.

## Production facts

| Thing | Value |
|---|---|
| pod_processor URL | `https://podprocessor-production.up.railway.app` |
| Website | `https://kidneyfoodguide.com` (canonical), also `https://www.kidneyfoodguide.com` |
| Stripe webhook endpoint | `https://podprocessor-production.up.railway.app/webhooks/stripe` |
| Webhook events | `checkout.session.completed`, `checkout.session.async_payment_succeeded` |
| Deploys | Both services deploy from `main` on Railway after a merge |

## Env vars (already set in production)

pod_processor:

| Variable | Value |
|---|---|
| `STRIPE_CHECKOUT_RESTRICTED_KEY` | `rk_live_...` restricted key with **Checkout Sessions: Write** and **Prices: Read** only. It's separate from `STRIPE_API_KEY`, which the reconciliation worker uses. |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_...` signing secret shown on the live webhook endpoint's page (Reveal). Stripe generates it; each endpoint, and sandbox vs live, has its own. |
| `CHECKOUT_SITE_URL` | `https://kidneyfoodguide.com`, with no trailing slash |
| `SUBSCRIBE_ALLOWED_ORIGINS` | `https://kidneyfoodguide.com,https://www.kidneyfoodguide.com` (shared with the waitlist) |
| `CHECKOUT_DOWNLOADS_DIR` | unset; PDFs are committed in `private_downloads/` |

Website (Railway build variable): `VITE_CHECKOUT_API_URL=https://podprocessor-production.up.railway.app`. This is
the on/off switch for every buy button. Without it, buttons use their fallback `href` (Zylvie).

New product kinds may add variables, e.g. a fulfillment flag for physical products. The kind's reference file
lists them.

## Every new product

1. **Stripe live mode:** create the Product (or reuse an existing one, e.g. an existing Defy Dialysis product for
   a subscription), and a Price with the **same lookup key** as the catalog entry. In the Dashboard the lookup
   key is on the *price*, in its edit screen. Check the price is the right type (one-time for books, recurring
   for subscriptions), in USD, and active. The checkout key can only *read* prices, so it can't create them.
2. **Merge the pod_processor PR** (catalog entry and committed PDF) and wait for the deploy.
3. **Merge the website PR** (landing page, thank-you page, Vite entries). It's live the moment it deploys,
   because the switch is already on.
4. **Check production** without creating anything:
   ```bash
   B=https://podprocessor-production.up.railway.app
   curl -s -w " %{http_code}\n" -H "Origin: https://kidneyfoodguide.com" "$B/public/checkout/sessions/cs_live_madeUpForAHealthCheck000"
   curl -s -w " %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{}' "$B/webhooks/stripe"
   curl -s "$B/openapi.json" | python3 -c "import json,sys; print([p for p in json.load(sys.stdin)['paths'] if 'checkout' in p])"
   ```
   Expect `404 Order not found` (the key works and the origin is allowed; 503 means the key is unset, 403 means
   the origin isn't allowed) and `400 Invalid signature` (the webhook secret is set).
5. **The user clicks a live buy button.** Stripe's page must show the product at the real price with no Sandbox
   badge. If the page says "We couldn't open checkout", the lookup key or the price is wrong. Read the
   pod_processor logs on Railway for `No active Stripe Price with lookup_key`.
6. **One real purchase, then a refund.** Confirm:
   - the thank-you page shows the result (download, shipping line or subscription confirmation);
   - the webhook endpoint in the Dashboard shows a delivered 200;
   - for physical products, exactly one fulfillment row; for subscriptions, the Encharge tag.

## Moving a product off Zylvie

- Keep the Zylvie product live but unlinked for about 2 weeks for old links.
- Repoint email links (the Encharge campaigns in `pod_processor/email-campaigns/`) from the Zylvie URL to the
  landing page.
- For PDFs, once Zylvie is retired: delete any copy in the website's `public/downloads/`, and point the
  thank-you page's fallback download link at `#`. Harvest Recipes still has both as of 2026-11-13, and the
  checker reports them until then.
- For subscriptions, read `subscriptions.md` first: existing subscribers are Stripe subscriptions that Zylvie
  created.

## Stripe account settings (one-time; confirm each with the user)

- **Email receipts** on for successful payments. This is the only email a PDF buyer gets.
- **Bank debits (ACH) off** for one-time products (recommended at launch; check it was done). A bank payment takes days to settle, and until then the
  thank-you page shows "We Couldn't Find Your Order".
- **Branding:** business name and logo show on Stripe's checkout page.
- **Stripe Tax:** off unless the user decides otherwise.
