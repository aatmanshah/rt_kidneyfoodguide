# Physical products (the Food List Book and anything shipped)

**Status (2026-11-13): not built.** This is phase 3 of `docs/stripe-checkout-design.md`. Physical products need
real server work in pod_processor *once*, then every later physical product is just a catalog entry like a PDF.
Build it as its own PR in pod_processor before making any physical product page. Don't route a physical product
through the digital flow: the buyer would pay and nothing would ship.

## What already exists (reuse it, don't rebuild it)

Zylvie physical orders already work end to end today, and the Stripe version should feed the same pipeline:

```
Zylvie sale webhook ─▶ ZylvieSaleProcessor ─▶ Google Sheet "orders" row
                                           └▶ "fulfillment" row, Delivery Status = NOT_STARTED
fulfillment worker (python main.py --fulfillment-worker) ─▶ reads NOT_STARTED rows ─▶ EasyPost label
                                           └▶ writes tracking (USPS hyperlink), label URL, postage, status
```

- `processor/zylvie_sale_processor.py`: `ZylvieSaleProcessor._build_fulfillment_dict()` builds a fulfillment row
  from an orders-row dict. Reuse that method so the columns stay identical.
- `processor/fulfillment_processor.py` and `workers/fulfillment_worker.py`: EasyPost labels. The parcel size is
  hard-coded (`PARCEL` in the worker: 9×6×1 in, 8 oz). A second physical product with a different size needs
  that to move into the catalog.
- The worker runs on a schedule outside this repo (check Railway for the cron). It does **not** email buyers
  their tracking number; it only writes it to the sheet.

**Known bug to avoid:** `ZylvieSaleProcessor._contains_physical_product()` decides "physical" by searching
*every* field, including the buyer's email, for words like "book". `book.lover@gmail.com` buying a PDF would get
a shipping row. For Stripe orders, decide from the catalog's `kind`, never by calling `process_sale()`.

## What to build in pod_processor (one PR)

1. **Catalog** (`checkout/catalog.py`): add `Kind.PHYSICAL` handling and the shipping fields a product needs:
   allowed countries (`["US"]` today), a Stripe shipping rate ID or `None` for free shipping (the `/book/`
   page promises free shipping), and parcel size and weight.
2. **Session** (`checkout/stripe_api.py`, `create_hosted_session`): for physical products it already adds
   `shipping_address_collection` and `phone_number_collection`. Add `shipping_options` when the product has a
   shipping rate. Free shipping needs no option; Stripe just collects the address.
3. **Webhook** (`webhook/stripe_webhook.py`): for a paid physical session, do the following, exactly once per
   session:
   - Re-fetch the session with `expand=["line_items", "payment_intent.latest_charge"]`, because the event body
     has no line items or card details.
   - Convert it to the **same orders-row dict a Zylvie sale makes** (`models/columns.py` `CSVColumns`).
     Mapping that worked:
     - `Order Number` = the session id (`cs_...`, also the de-duplication key)
     - `Receipt Number` = the PaymentIntent id (`pi_...`)
     - `Total Amount` = `amount_total / 100`
     - `Status` = `stripe:<payment_status>`, which tells Stripe rows apart from Zylvie rows
     - name, email, phone from `customer_details`
     - address from `collected_information.shipping_details.address`, falling back to
       `customer_details.address`
     - `Payment Method` = `"<brand> ****<last4>"` from `payment_intent.latest_charge.payment_method_details.card`
     - `Product 1 ID / Title / Price / Quantity` from the catalog entry and `line_items.data[0]`
     - `Date` and `Formatted Date and Time` from `created`, in UTC
   - **Skip if already recorded.** Read the orders sheet header, find the `Order Number` column, and look for
     the session id in the last ~500 rows (`GoogleSheetsClient.read_last_n_rows`). Stripe retries webhooks and
     sends both `completed` and `async_payment_succeeded`, so without this check one order gets two shipments.
   - Append the orders row (`append_row_by_dict`), then the fulfillment row (`_build_fulfillment_dict(...)` with
     `DeliveryStatus.NOT_STARTED`) to `GOOGLE_FULFILLMENT_WORKSHEET_NAME`.
   - Any failure returns 500 so Stripe retries. The skip check makes the retry safe.
   - Use a flag such as `CHECKOUT_FULFILLMENT_ENABLED` (default off) so local and sandbox purchases log instead
     of writing to the real sheet. Tests point at `TEST_GOOGLE_SHEET_ID` through `conftest.py`.
4. **Thank-you route:** `GET /public/checkout/sessions/{id}` already returns `paid`. For physical products, return
   the shipping city and state (never the full address) instead of a download URL, so the page can say "Shipping
   to Springfield, IL".
5. **Tests:** session params with shipping; webhook writes one orders row and one fulfillment row; a repeated
   event writes nothing; a digital product writes no fulfillment row; a Sheets failure returns 500.
6. **Checker:** update `scripts/check_product.py` so `Kind.PHYSICAL` is allowed. It shouldn't require a
   `download_file`, and the thank-you page needs no `data-download-link`.

Known gap: two deliveries of the same event processed at the same instant could both pass the skip check. It's
rare. A database with a unique key on the session id closes it, so do that if it ever shows up in the sheet.

## The website side of a physical product

- Landing page: same template. Change the delivery notes ("Free shipping · Ships within 1 business day") and the
  FAQ (shipping time, tracking, US only). The Food List Book page already exists at `/book/`, so tag its 4 buy
  buttons (`data-checkout-product="food-list-book"`, fallback href
  `https://zylvie.com/renaltracker/p/renaldietfoodlist`) rather than rebuilding it.
- Thank-you page: copy `assets/thank-you.html`, but the found state says "Your order is confirmed" with the
  shipping city and no download button. Keep all four `data-order-*` hooks. `src/checkout.js` needs a small
  change to fill in the shipping line when `downloadUrl` is null.
- The `/book/` page has no thank-you page yet. Add `book/thank-you/index.html` plus its Vite entry.

## Testing before launch

- Sandbox: everything in `local-testing.md`, plus confirm the Stripe page asks for a shipping address and a
  phone number. With the flag on and `TEST_GOOGLE_SHEET_ID`, confirm exactly one orders row and one
  `NOT_STARTED` fulfillment row. Replay the same webhook event (`stripe events resend <evt_id>`) and confirm
  nothing new is written.
- Run the fulfillment worker against the test sheet with `EASYPOST_TEST_API_KEY` and confirm a test label.
- Live: one real order to your own address, with a real label, before switching the `/book/` buttons. Then refund
  it and void the label in EasyPost.
