# Testing a product's checkout locally (Stripe sandbox)

Everything here uses the **sandbox** key in `pod_processor/.env` (`STRIPE_CHECKOUT_TEST_KEY`, which starts with
`sk_test_` or `rk_test_`). Never point local testing at a live key: a "test" purchase would be a real charge.
Port 5173 is often taken by the user's own dev server, so use 5174 and leave 5173 alone.

## 1. Stripe CLI webhook forwarder

The Stripe CLI is installed at `~/.local/bin/stripe`. Homebrew couldn't install it on this Mac because the
Command Line Tools are outdated. It forwards real sandbox webhooks to the local API, with no login needed when
given the sandbox key:

```bash
cd /Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor
KEY=$(venv/bin/python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["STRIPE_CHECKOUT_TEST_KEY"])')
stripe listen --api-key "$KEY" \
  --events checkout.session.completed,checkout.session.async_payment_succeeded \
  --forward-to localhost:8000/webhooks/stripe
```

Run it in the background. Its signing secret is stable per key:
`stripe listen --print-secret --api-key "$KEY"`.

## 2. pod_processor API on :8000

Set the env in the shell rather than editing `.env`, which also holds live settings:

```bash
cd /Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor
KEY=$(venv/bin/python -c 'from dotenv import dotenv_values; print(dotenv_values(".env")["STRIPE_CHECKOUT_TEST_KEY"])')
case "$KEY" in sk_test_*|rk_test_*) ;; *) echo "not a sandbox key"; exit 1;; esac
STRIPE_CHECKOUT_SECRET_KEY="$KEY" \
CHECKOUT_SITE_URL=http://localhost:5174 \
SUBSCRIBE_ALLOWED_ORIGINS=http://localhost:5174 \
STRIPE_WEBHOOK_SECRET="$(stripe listen --print-secret --api-key "$KEY")" \
venv/bin/python -m uvicorn main:app --port 8000
```

## 3. Website on :5174

```bash
cd "/Users/aatman/Documents/Documents/Catalyst Forge LLC/RenalTracker/Website/rt_kidneyfoodguide"
VITE_CHECKOUT_API_URL=http://localhost:8000 npx vite --port 5174 --strictPort
```

In the Claude desktop app, start these through `.claude/launch.json` in the CatalystForge folder and
`preview_start`, with small wrapper scripts like the commands above, so they show in the browser pane.

## 4. The purchase

1. Open `http://localhost:5174/<path>/` and click a buy button. It should land on `checkout.stripe.com` with a
   **Sandbox** badge, the right product name and price, and a promotion-code box.
   If the browser pane is hidden, Stripe's page renders slowly in the background. Typing then lands late or
   twice, which garbles the card fields. Take a screenshot after selecting **Card** and before typing, and
   again before clicking Pay. If the fields end up doubled, reopen checkout from the landing page rather than
   trying to clear them.
2. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP, and a made-up
   `@example.com` email. Untick "Save my information" so no Link account is created.
3. The thank-you page should show the download button and "Order placed with x***@example.com".
4. Fetch the download link from the page (it points at `localhost:8000/public/checkout/download/...`) and check
   it returns `application/pdf` with the full file size.
   A cross-origin `fetch()` can't read the `Content-Disposition` header (it isn't exposed to the page), so a
   `null` there is normal; `tests/checkout_test.py` checks the attachment header.
5. `stripe listen` should print `--> checkout.session.completed` then `<-- [200] POST .../webhooks/stripe`.

## 5. The things that must fail

- `/<path>/thank-you/?session_id=cs_test_madeUp1234567890` → "We Couldn't Find Your Order".
- `/<path>/thank-you/` with no query → the same.
- `POST /public/checkout/sessions` with `{"product": "<slug>", ...}` and `Origin: https://evil.example` → 403.
- An unknown slug → 404.
- An open (unpaid) session → `paid: false`, no `downloadUrl`, and the download URL returns 404. Expire the
  session afterwards (`client.v1.checkout.sessions.expire(id)`).
