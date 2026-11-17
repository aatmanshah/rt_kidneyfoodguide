---
name: new-product-page
description: Add a new product to kidneyfoodguide.com with its own Stripe checkout, the way Harvest Recipes (/fallrecipes) was built and launched. Covers PDF cookbooks and guides end to end (pod_processor catalog entry, Stripe Product/Price with a lookup key, landing and thank-you pages from templates, the paid download, Vite entries, sandbox testing, launch runbook), and carries the plan and context for physical products (the Food List Book, anything shipped) and subscriptions (the monthly Defy Dialysis newsletter, memberships). Use this whenever the user wants to sell something new on kidneyfoodguide.com, add a product, cookbook, ebook, guide, PDF, print book or newsletter page, move a product off Zylvie onto our own checkout, launch a seasonal recipe book, set up a subscription or recurring product, or asks for "a page like /fallrecipes", even if they don't mention Stripe or checkout.
---

# New product page + Stripe checkout

Every product on kidneyfoodguide.com follows one pattern, so they all behave the same and the checkout stays
safe. The pattern was built and launched for Harvest Recipes (`/fallrecipes/`) on 2026-11-13, replacing Zylvie,
which had been producing duplicate charges. The full design is in `docs/stripe-checkout-design.md` in this repo.
Read it when anything here is unclear, rather than inventing a variation.

## Step 0: which kind of product is it?

| Kind | Examples | Status | Do this |
|---|---|---|---|
| **Digital (PDF)** | cookbooks, guides, seasonal recipe books | **Built and live** | Steps 1 to 7 below, then `references/launch-runbook.md` |
| **Physical** | the Food List Book (`/book/`), any print item | Not built (phase 3) | Read `references/physical-products.md`. It needs one pod_processor PR first, then the steps below with the changes it lists |
| **Subscription** | the monthly Defy Dialysis Premium newsletter, memberships | Not built (phase 5) | Read `references/subscriptions.md` **before anything else**: existing subscribers are already Stripe subscriptions that Zylvie created, which changes the plan |

For a physical product or a subscription, tell the user the one-time server work comes first. Offer to do it
as its own PR, or to make the page now with buttons still pointing at Zylvie. Never push a physical product or
subscription through the digital flow: the buyer would pay and get nothing.

## How it works

```
buy button (data-checkout-product="<slug>")
  └▶ src/checkout.js ─ POST /public/checkout/sessions {product, attemptId} ─▶ pod_processor
                                         looks up the catalog entry and the Price by lookup key, then creates a hosted Checkout Session
  └▶ browser goes to Stripe's hosted page (cards, Apple/Google Pay, Link, promo codes)
  └▶ Stripe returns the buyer to <thank_you_path>?session_id=cs_...
  └▶ thank-you page ─ GET /public/checkout/sessions/{id} ─▶ paid? product? masked email? download URL?
  └▶ download link ─ GET /public/checkout/download/{id} ─▶ checks with Stripe again, streams the PDF
Stripe ─ POST /webhooks/stripe ─▶ verifies the signature, logs the paid order (the hook for exactly-once work:
                                   Encharge tags, fulfillment rows)
```

### Code map

| Where | File | What it does |
|---|---|---|
| pod_processor | `checkout/catalog.py` | Products by slug: name, lookup key, kind, paths, PDF. **The browser can never set a price.** |
| pod_processor | `checkout/stripe_api.py` | Stripe calls: price lookup by key (cached 5 min), session create, retrieve, webhook verify, `is_paid()` |
| pod_processor | `webhook/checkout_routes.py` | The three public routes; Origin allow-list, per-IP limits, session-id shape check |
| pod_processor | `webhook/stripe_webhook.py` | Signed webhook; ignores sessions without our `metadata.product` (Zylvie's) |
| pod_processor | `private_downloads/` | Paid PDFs, committed and un-ignored by name in `.gitignore` |
| pod_processor | `tests/checkout_test.py`, `tests/catalog_test.py` | Route, webhook and catalog tests |
| website | `src/checkout.js` | Buy-button clicks and the thank-you order check; on only when `VITE_CHECKOUT_API_URL` is set |
| website | `src/main.js` | Wires the thank-you page to `verifyOrder()` |
| website | `<path>/index.html`, `<path>/thank-you/index.html`, `vite.config.js` | The pages, and their build entries |

Repos: website at `/Users/aatman/Documents/Documents/Catalyst Forge LLC/RenalTracker/Website/rt_kidneyfoodguide`
(GitHub `aatmanshah/rt_kidneyfoodguide`), pod_processor at
`/Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor` (`aatmanshah/pod_processor`).

### Why it's built this way (decided; don't relitigate without the user)

- **Hosted Stripe Checkout, not embedded or Elements.** The user chose it as the least work. Stripe maintains
  the page's polish and accessibility, which matters for 50+ readers.
- **Server code in pod_processor**, not a server on the static site. It already had Stripe, Encharge, the
  Sheets/EasyPost fulfillment pipeline and a CORS-enabled public route.
- **Prices found by lookup key, not product or price ID.** The same code works in sandbox and live, and a price
  change is a Dashboard action (move the key) with no deploy. One price per product per key; products can share
  an amount but not a price.
- **Duplicate-charge protection:** the attempt id is the idempotency key (a double-click returns the same
  session), a session can only be paid once, and exactly-once work runs only from the signed webhook.
- **Paid files are never public.** pod_processor serves them only after Stripe confirms payment. The PDFs are
  committed to the private pod_processor repo; GitHub warns at 50 MB and refuses files over 100 MB.
- **Webhook only verifies and logs for PDFs.** The user said Encharge tags and Sheets rows aren't needed until
  email and physical products.
- **Promo codes:** `allow_promotion_codes` is on; codes are made in the Dashboard with no code change.
  Pre-applying a code from a link (`?promo=`) isn't built yet; it needs Stripe's `discounts` parameter, which
  can't be combined with the code box.
- **Separate keys:** `STRIPE_CHECKOUT_RESTRICTED_KEY` (restricted: Checkout Sessions write, Prices read) for
  checkout; `STRIPE_API_KEY` stays with the reconciliation worker; `STRIPE_CHECKOUT_TEST_KEY` (sandbox) is for
  local use only.

## Ground rules

- **Sandbox only.** This skill creates prices and test purchases only in the Stripe sandbox. Check the key
  prefix before any Stripe call (`sk_test_`/`rk_test_`); `pod_processor/.env` also holds live keys. Anything in
  live mode (prices, webhook endpoints, Railway env vars, real purchases) is in `references/launch-runbook.md`
  for the user, and you do it only if the user asks in this conversation.
- **Production checkout is already switched on.** A new page with tagged buttons goes live as soon as the
  website deploys. So pod_processor (with the catalog entry) must be merged and deployed **first**. Otherwise
  the buttons call a server that doesn't know the product, and buyers see "We couldn't open checkout". Open one
  PR per repo, and say the merge order in both.
- Branch from an up-to-date `main` in each repo. Commit and open PRs only when the user asks.

## The digital product steps (1 to 7)

These are the full steps for a PDF. The physical and subscription guides start from them and list what changes.

## 1. Gather the inputs

Ask for whatever is missing, in one message. Don't guess prices or product facts. A wrong number on a health
product page erodes trust fast.

- **Product name** as it appears on the cover (e.g. "Harvest Recipes").
- **URL path** for the landing page (e.g. `/fallrecipes/`). The **slug** (catalog key, used in buttons) is
  kebab-case, e.g. `harvest-recipes`. The **lookup key** is snake_case with a format suffix, e.g.
  `harvest_recipes_pdf`.
- **Price** in USD.
- **The paid file** (path to the PDF) and the file name the buyer should get.
- **Images**: cover, plus 1 or 2 preview pages. They go in `public/images/<short-name>/`. Previews are optional,
  so drop the "peek inside" section if there are none.
- **Content facts**: number of recipes/pages, chapters or categories with counts, 2 or 3 standout items,
  anything special (tips on every recipe, etc.). Ask the user or read them from the PDF.
- **Theme**: the default green brand, or a seasonal theme like `theme-harvest` (see step 6).
- **Zylvie URL**, if the product is moving from Zylvie. It becomes the buttons' fallback `href`.

## 2. pod_processor: catalog entry and the paid file

Add a `Product(...)` to `PRODUCTS` in `checkout/catalog.py`, following the Harvest Recipes entry:

```python
Product(
    slug="<slug>",
    name="<Product Name>",
    lookup_key="<lookup_key>",
    kind=Kind.DIGITAL,
    landing_path="/<path>/",
    thank_you_path="/<path>/thank-you/",
    encharge_tag="<Product Name> Buyer",   # not used yet; reserved for email products
    download_file="<file-in-private_downloads>.pdf",
    download_name="<What-The-Buyer-Saves>.pdf",
),
```

Copy the PDF into `pod_processor/private_downloads/` and un-ignore it by name in pod_processor's `.gitignore`.
Add a line `!private_downloads/<file>.pdf` under the existing `private_downloads/*` rule. The PDFs are committed
to the private pod_processor repo so they deploy to Railway with the code. The folder is ignored by default so a
stray file never slips in. If the file is over about 50 MB, stop and tell the user: GitHub warns at 50 MB and
rejects files over 100 MB, so a large file needs a Railway volume or object storage instead. **Never** put a
paid file in the website's `public/` folder: everything there is downloadable by anyone with the URL, which is
exactly the hole the old Zylvie setup had.

## 3. Stripe sandbox Product + Price

Run the bundled script from the pod_processor folder with its venv. It reads `STRIPE_CHECKOUT_TEST_KEY` from
`pod_processor/.env` and refuses to run with anything but a sandbox key (`sk_test_` / `rk_test_`):

```bash
cd /Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor
venv/bin/python "<skill-dir>/scripts/create_stripe_price.py" \
  --name "<Product Name>" --description "<one line, e.g. 33 kidney-friendly fall recipes (PDF)>" \
  --amount-cents 1499 --lookup-key <lookup_key> --slug <slug>
```

It is safe to re-run. If the lookup key already exists at the same amount it does nothing. If the amount
differs it stops and explains `--move-lookup-key`, which creates a new Price and moves the key to it. Stripe
prices can't be edited, and moving the key is how a price changes without a deploy.

## 4. Landing page

Copy `assets/landing-page.html` to `<path>/index.html` in the website repo and fill every `{{PLACEHOLDER}}`.
The template is the Harvest Recipes page with product specifics removed, so the section order, classes,
analytics tags and accessibility details (skip link, alt text, `fetchpriority` on the hero image, sticky
mobile CTA) stay identical across products. Keep that structure. Change the words and images, not the layout.

Buy buttons are the important part. **Every** buy button (header, hero, final CTA, sticky mobile CTA) must be:

```html
<a href="<fallback>" data-checkout-product="<slug>" class="btn-primary ...">Get the ...</a>
```

`href` is what happens if JavaScript doesn't run or the site was built without `VITE_CHECKOUT_API_URL`: the
Zylvie URL for a migrated product, or `#order` for a new one. `src/checkout.js` intercepts the click when
checkout is on. The page must load `/src/main.js` (the template does), which imports `checkout.js`.

Copy guidance for this audience is in `references/copy-guidelines.md`. Read it before writing the copy. The
readers are mostly 50+, living with CKD or caring for someone who is, and the product is food education, not
treatment.

## 5. Thank-you page

Copy `assets/thank-you.html` to `<path>/thank-you/index.html` and fill the placeholders. `src/checkout.js`
depends on these hooks, so keep them exactly:

- `data-order-checking`: the spinner shown while the order is checked
- `data-order-found` (hidden), containing a link with `data-download-link` and a `<p data-order-email hidden>`
- `data-order-missing` (hidden): no order or an unpaid order
- `data-order-error` (hidden): the check itself failed. A paying customer must never be told their order
  doesn't exist just because the network hiccuped.

The page has `noindex, nofollow`. Its `<noscript>` block must **not** link to a file (old pages linked to the
public PDF). It tells the visitor to turn on JavaScript or email support.

## 6. Build config and theme

- Add both pages to `build.rollupOptions.input` in `vite.config.js`. Vite only builds pages listed there, and a
  missing entry means a 404 in production even though `npm run dev` works.
- Theme: the default green brand needs nothing. For a seasonal look, add a `.theme-<name>` block to
  `src/input.css` modelled on `.theme-harvest`, with colours added to `@theme`, and set it on both pages'
  `<body>`. Check text contrast (4.5:1 for body text) because the readers skew older.

## 7. Check consistency, then test

Run the checker. It cross-checks both repos: catalog entry, buttons, thank-you hooks, Vite entries, the file
in `private_downloads/`, no paid file in `public/`, and the sandbox price:

```bash
cd /Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor
venv/bin/python "<skill-dir>/scripts/check_product.py" <slug>
```

Fix everything it reports. Then:

1. `venv/bin/python -m pytest -q` in pod_processor (`tests/catalog_test.py` checks catalog entries).
2. `npx vite build --outDir <scratch dir>` in the website repo, so the real `dist/` isn't overwritten.
3. A real sandbox purchase, see `references/local-testing.md`: run the API, the site and `stripe listen`, click
   a buy button, pay with `4242 4242 4242 4242`, and confirm the thank-you page shows the download, the PDF
   downloads, `stripe listen` shows a `[200]` for `checkout.session.completed`, and a made-up `session_id`
   shows "We Couldn't Find Your Order".

Report what you verified and what you didn't. If the purchase test couldn't run (no sandbox key, port
trouble), say so plainly rather than implying it passed.

## Going live

Follow `references/launch-runbook.md`: the production URLs and env vars, the merge and deploy order, the
read-only production checks, and the live purchase test. Give the user the live-mode steps; don't do them unless
asked.

## Reference files

| File | Read it when |
|---|---|
| `references/copy-guidelines.md` | Writing any page copy (audience, health-claim limits, section order) |
| `references/local-testing.md` | Running the sandbox purchase test locally (API, site, `stripe listen`) |
| `references/launch-runbook.md` | Taking a product live, or checking production |
| `references/physical-products.md` | The product ships (phase 3 plan and the existing fulfillment pipeline) |
| `references/subscriptions.md` | The product is recurring (phase 5 plan, Defy Dialysis context) |
| `assets/landing-page.html`, `assets/thank-you.html` | Building the pages |
| `scripts/create_stripe_price.py` | Making the sandbox price |
| `scripts/check_product.py` | Before you say a product is done |
