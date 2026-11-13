---
name: new-product-page
description: Create a new product landing page on kidneyfoodguide.com together with its Stripe checkout (pod_processor catalog entry, sandbox Stripe Product/Price with a lookup key, buy buttons, a thank-you page that checks the order with Stripe, a paid download served by pod_processor, Vite build entries). Use this whenever the user wants to sell something new on kidneyfoodguide.com, add a product, cookbook, ebook, guide or PDF page, move a product off Zylvie onto our own checkout, launch a seasonal recipe book, or asks for "a page like /fallrecipes" for another product, even if they don't mention Stripe or checkout.
---

# New product page + Stripe checkout

Every product on kidneyfoodguide.com follows one pattern so they all behave the same and the checkout stays
safe. The pattern was built for Harvest Recipes (`/fallrecipes/`). The design and its reasons are in
`docs/stripe-checkout-design.md` in this repo. Read that doc if anything below is unclear, rather than inventing
a variation.

Two repos are involved:

| Repo | Path | What you change there |
|---|---|---|
| Website (static Vite site) | `/Users/aatman/Documents/Documents/Catalyst Forge LLC/RenalTracker/Website/rt_kidneyfoodguide` | landing page, thank-you page, `vite.config.js`, optional theme CSS |
| pod_processor (FastAPI) | `/Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor` | `checkout/catalog.py` entry, paid file in `private_downloads/` |

How a sale works: a buy button (`data-checkout-product="<slug>"`) → `POST /public/checkout/sessions` →
Stripe's **hosted** checkout page → back to `<thank_you_path>?session_id=...` → the page asks pod_processor
whether that session was paid → if so, the download link points at pod_processor, which checks with Stripe
again before streaming the file. `src/checkout.js` already does all the browser work. A new product needs no
new JavaScript.

## What is in scope

- **Digital products** (PDF cookbooks, guides): fully supported. This is what the skill is for.
- **Physical products** (the Food List Book): not built yet. That is phase 3 of the design: shipping
  address collection plus a fulfillment row from the webhook. If asked for one, say so, and offer to build
  the page with its buy button still pointing at Zylvie, or to do phase 3 as its own task. Don't fake it with
  the digital flow; the buyer would pay and get nothing shipped.
- **Subscriptions / email products**: not built (phase 5). Same answer.
- **Live mode**: this skill works in the Stripe **sandbox** only. Creating live prices, live webhook endpoints
  and Railway env vars charges real money and changes production, so list those steps for the user (see
  "Go-live checklist") and do them only if the user explicitly asks in this conversation.

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

## Go-live checklist (for the user; do these only on explicit request)

- In Stripe **live** mode: create the Product + Price with the **same lookup key**.
- Live webhook endpoint already exists after the first product, so nothing new is needed per product. Confirm it
  sends `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- Deploy pod_processor with the new catalog entry and the committed PDF.
- Deploy the website. If migrating from Zylvie, keep the Zylvie product live but unlinked for about 2 weeks,
  then point any email links at the new landing page.
