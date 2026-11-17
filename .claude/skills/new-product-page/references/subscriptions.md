# Subscriptions (monthly newsletter, memberships, anything recurring)

**Status (2026-11-13): not built.** This is phase 5 of `docs/stripe-checkout-design.md`. It needs server work in
pod_processor once, then each later subscription product is a catalog entry. Do it as its own PR, after asking the
user which product it is and how access is delivered today.

## What exists today (read this before designing anything)

The paid newsletter that exists today is **Defy Dialysis Premium**, sold through Zylvie. Confirm with the user
that this is "the monthly newsletter" before building. The current setup:

- **Access is an Encharge tag.** On a Zylvie subscription webhook, `processor/zylvie_subscription_processor.py`
  tags the buyer with `Defy Dialysis - Premium Subscribers - from beehiiv` and the legacy
  `Defy Dialysis - Premium - from beehiiv` (constants `DEFY_DIALYSIS_TAG` / `DEFY_DIALYSIS_LEGACY_TAG`). Email
  flows in Encharge deliver the content to that tag.
- **Removal is the reconciliation worker** (`python main.py --reconciliation-worker [--apply]`,
  `processor/reconciliation_processor.py`). It reads **Stripe** subscriptions for the products listed in
  `STRIPE_DEFY_DIALYSIS_PRODUCT_IDS`, using `STRIPE_API_KEY`, and removes the tag only when *all* of a person's
  subscriptions are `canceled`. `past_due`, `unpaid`, paused and `cancel_at_period_end` keep access (the rules
  table is at the top of that file).
- So **the existing Zylvie subscribers are already Stripe subscriptions in your own account**: Zylvie created
  them, and the product IDs in that env var are Stripe products (Zylvie uses short custom IDs like `q8l7agme`).

That changes the migration plan:

- **Don't touch existing subscribers.** They keep billing in Stripe as they are. Only *new* signups go through
  our checkout.
- **Before retiring Zylvie completely, find out what closing the Zylvie product or account does to those
  subscriptions.** If it cancels them in Stripe, every subscriber loses access at once. Ask the user to check
  with Zylvie; don't guess.
- **Put the new recurring price on one of the existing Defy Dialysis Stripe products** (or add the new product's
  ID to `STRIPE_DEFY_DIALYSIS_PRODUCT_IDS`). Then the reconciliation worker covers new subscribers with no new
  code: cancellations remove access exactly as they do today.

## What to build in pod_processor (one PR)

1. **Catalog:** add `Kind.SUBSCRIPTION` and the fields a subscription needs:
   - the Encharge tag(s) that grant access. Reuse the constants above for Defy Dialysis.
   - `encharge_tag` already exists on `Product` for this purpose.
   - a lookup key for the **recurring** price, e.g. `defy_dialysis_monthly`.
2. **Session** (`create_hosted_session`): for a subscription:
   - `mode="subscription"`;
   - put the metadata in `subscription_data={"metadata": {"product": slug}}` as well as the session's
     `metadata`;
   - drop `payment_intent_data` and `customer_creation`, which Stripe rejects in subscription mode because it
     always creates a customer.
   - `allow_promotion_codes` still works: coupons can be "once", "repeating" or "forever".
   - Optional: `subscription_data.trial_period_days`.
3. **Webhook:** on a paid subscription session (`checkout.session.completed` with `mode == "subscription"`),
   call `EnchargeClient.identify_and_tag(email=..., tags="<tag1>,<tag2>", first_name=..., last_name=...,
   properties={"source": "stripe_checkout", "subscription_id": session["subscription"]})`.
   - The client is on `request.app.state.encharge_client`.
   - It's an upsert, so a retried webhook is harmless and no skip check is needed.
   - If Encharge fails, return 500 so Stripe retries.
   - `is_paid()` already treats `no_payment_required` as paid, which covers free trials and 100%-off codes.
4. **Losing access:** start by relying on the reconciliation worker. It already implements the agreed rules,
   and duplicating them in a webhook risks the two disagreeing. If faster removal is wanted later, handle
   `customer.subscription.deleted` by calling the reconciliation logic for that one email, not a new rule. Add
   any new event to the Stripe webhook endpoint's event list.
5. **Self-service:** turn on Stripe's **Customer portal** (Dashboard → Settings → Billing → Customer portal) with
   cancel and update-card allowed, and use its no-code **login link** (customers enter their email and get a
   code). Put that link on the thank-you page and in the Encharge email footer. No code needed.
6. **Thank-you page:** no download. The found state says "You're subscribed" and when the first issue arrives,
   with the portal link.
   - `src/checkout.js` `verifyOrder()` currently shows "missing" when there's no `downloadUrl`. Change it to
     show the found state for any paid order, and the download button only when there's a URL.
   - The physical-products work needs the same change, so do it once.
7. **Tests:**
   - subscription session params (mode, `subscription_data.metadata`, no `payment_intent_data`);
   - the webhook tags in Encharge with the right tags;
   - a retried event tags again harmlessly;
   - an unpaid session doesn't tag;
   - an Encharge failure returns 500.
8. **Checker:** allow `Kind.SUBSCRIPTION` in `scripts/check_product.py`, with no download file needed. Check that
   the price behind the lookup key is **recurring**, so a one-time price can't be wired to a subscription by
   mistake.

## Prices and changes

- `create_stripe_price.py` makes one-time prices. Add a `--recurring month` option for subscriptions; Stripe needs
  `recurring={"interval": "month"}` on the price.
- Moving a lookup key to a new price changes the price for **new** signups only. Existing subscribers stay on
  their price until they're moved, in the Dashboard or with a subscription update. Tell the user this before any
  price change.

## Testing before launch

- Sandbox: subscribe with `4242 4242 4242 4242`. Confirm the Encharge tag appears, using a test contact and
  ideally a test Encharge workspace or tag. Then use a Stripe **test clock** (Dashboard → Billing → Test clocks)
  to move time forward and see a renewal, a failed renewal (card `4000 0000 0000 0341`) and a cancellation.
- Run the reconciliation worker in dry run (without `--apply`) and confirm it sees the new sandbox subscription.
  Use a sandbox key and test product IDs for this, never the live `STRIPE_API_KEY`.
- Live: subscribe yourself, confirm the tag and the first email, cancel through the portal, and confirm the
  reconciliation dry run would remove the tag.
