#!/usr/bin/env python3
"""
Create (or confirm) a product's Stripe Product + Price in the SANDBOX, found later by its lookup key.

Run from the pod_processor folder with its venv (it has the stripe and python-dotenv packages):

    venv/bin/python <skill>/scripts/create_stripe_price.py \
        --name "Harvest Recipes" --description "33 kidney-friendly fall recipes (PDF)" \
        --amount-cents 1499 --lookup-key harvest_recipes_pdf --slug harvest-recipes

Reads STRIPE_CHECKOUT_TEST_KEY from ./.env and refuses anything that is not a sandbox key, so it can never
create or change a live price. Safe to re-run:
  - lookup key exists at the same amount  -> prints it, changes nothing
  - lookup key exists at another amount    -> stops; re-run with --move-lookup-key to create a new Price on the
                                              same Product and move the key to it (Stripe prices can't be edited)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import stripe
from dotenv import dotenv_values


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--amount-cents", type=int, required=True)
    ap.add_argument("--lookup-key", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--currency", default="usd")
    ap.add_argument("--move-lookup-key", action="store_true")
    ap.add_argument("--env-file", default=".env")
    args = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)*", args.lookup_key):
        sys.exit(f"lookup key should be snake_case, e.g. harvest_recipes_pdf (got {args.lookup_key!r})")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args.slug):
        sys.exit(f"slug should be kebab-case, e.g. harvest-recipes (got {args.slug!r})")
    if args.amount_cents < 50:
        sys.exit("amount is in cents: $14.99 is 1499")

    env_path = Path(args.env_file)
    if not env_path.is_file():
        sys.exit(f"{env_path.resolve()} not found; run this from the pod_processor folder")
    key = (dotenv_values(env_path).get("STRIPE_CHECKOUT_TEST_KEY") or "").strip()
    if not key.startswith(("sk_test_", "rk_test_")):
        sys.exit("STRIPE_CHECKOUT_TEST_KEY is missing or not a sandbox key (sk_test_/rk_test_). Refusing to run.")

    client = stripe.StripeClient(key)
    existing = client.v1.prices.list(
        params={"lookup_keys": [args.lookup_key], "expand": ["data.product"], "limit": 1}
    ).data

    if existing:
        price = existing[0]
        product = price.product
        if price.unit_amount == args.amount_cents and price.currency == args.currency:
            print(f"OK: lookup key {args.lookup_key} already on {price.id} "
                  f"({price.unit_amount / 100:.2f} {price.currency}, product {product.id} '{product.name}')")
            return 0
        if not args.move_lookup_key:
            print(f"STOP: lookup key {args.lookup_key} is on {price.id} at {price.unit_amount / 100:.2f} "
                  f"{price.currency}, not {args.amount_cents / 100:.2f} {args.currency}.\n"
                  f"Re-run with --move-lookup-key to create the new price and move the key to it.")
            return 2
        new_price = client.v1.prices.create(params={
            "product": product.id, "unit_amount": args.amount_cents, "currency": args.currency,
            "lookup_key": args.lookup_key, "transfer_lookup_key": True,
        })
        client.v1.prices.update(price.id, params={"active": False})
        print(f"MOVED: {args.lookup_key} -> {new_price.id} ({args.amount_cents / 100:.2f} {args.currency}); "
              f"old price {price.id} archived")
        return 0

    product = client.v1.products.create(params={
        "name": args.name, "description": args.description, "metadata": {"catalog_slug": args.slug},
    })
    price = client.v1.prices.create(params={
        "product": product.id, "unit_amount": args.amount_cents, "currency": args.currency,
        "lookup_key": args.lookup_key,
    })
    print(f"CREATED (sandbox): product {product.id} '{args.name}', price {price.id} "
          f"{args.amount_cents / 100:.2f} {args.currency}, lookup key {args.lookup_key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
