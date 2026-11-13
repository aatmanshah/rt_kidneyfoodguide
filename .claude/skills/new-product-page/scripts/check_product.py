#!/usr/bin/env python3
"""
Cross-check one product across the website and pod_processor, so every product follows the same pattern.

Run from the pod_processor folder with its venv:

    venv/bin/python <skill>/scripts/check_product.py harvest-recipes [--no-stripe]

Checks:
  pod_processor  catalog entry exists, is digital, has the paths/files it needs; the paid file is in
                 private_downloads/ and not git-ignored (so it deploys)
  website        landing page exists; every buy button carries data-checkout-product=<slug>; it loads
                 /src/main.js; thank-you page has the hooks src/checkout.js needs, is noindex, and links no file;
                 both pages are in vite.config.js; no copy of the paid file sits in public/
  Stripe sandbox an active price has the lookup key (skip with --no-stripe)
Exit code 0 = all good, 1 = problems found.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

POD = Path("/Users/aatman/Documents/Documents/Coding_Projects/CatalystForge/pod_processor")
SITE = Path("/Users/aatman/Documents/Documents/Catalyst Forge LLC/RenalTracker/Website/rt_kidneyfoodguide")

problems: list[str] = []
notes: list[str] = []


def bad(msg: str) -> None:
    problems.append(msg)


def page_file(url_path: str) -> Path:
    return SITE / url_path.strip("/") / "index.html"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--no-stripe", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(POD))
    from checkout.catalog import PRODUCTS, Kind  # noqa: E402

    product = PRODUCTS.get(args.slug)
    if product is None:
        print(f"FAIL: '{args.slug}' is not in pod_processor/checkout/catalog.py (known: {', '.join(PRODUCTS)})")
        return 1

    # ---- pod_processor
    if product.kind is not Kind.DIGITAL:
        bad("kind is not DIGITAL; physical/subscription checkout isn't built yet (design doc phases 3 and 5)")
    for name in ("landing_path", "thank_you_path"):
        value = getattr(product, name)
        if not (value.startswith("/") and value.endswith("/")):
            bad(f"{name} {value!r} must start and end with '/'")
    if not product.thank_you_path.startswith(product.landing_path):
        notes.append("thank_you_path is not under landing_path (fine, but unusual)")
    if not re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)*", product.lookup_key):
        bad(f"lookup_key {product.lookup_key!r} should be snake_case")
    paid_file = None
    if product.kind is Kind.DIGITAL:
        if not product.download_file:
            bad("digital product has no download_file")
        else:
            paid_file = POD / "private_downloads" / product.download_file
            if not paid_file.is_file():
                bad(f"paid file missing: {paid_file}")
            else:
                import subprocess
                ignored = subprocess.run(["git", "-C", str(POD), "check-ignore", "-q", str(paid_file)]).returncode == 0
                if ignored:
                    bad(f"{paid_file.name} is git-ignored, so it won't deploy to Railway; add "
                        f"'!private_downloads/{paid_file.name}' to pod_processor/.gitignore")

    # ---- website: landing page
    landing = page_file(product.landing_path)
    if not landing.is_file():
        bad(f"landing page missing: {landing}")
    else:
        html = landing.read_text()
        if "{{" in html:
            bad(f"{landing.name} under {product.landing_path} still has {{{{PLACEHOLDERS}}}}")
        anchors = re.findall(r"<a\b[^>]*\bclass=\"[^\"]*\bbtn-primary\b[^\"]*\"[^>]*>", html)
        tagged = [a for a in anchors if f'data-checkout-product="{args.slug}"' in a]
        other = [a for a in anchors if "data-checkout-product=" in a and a not in tagged]
        if not tagged:
            bad(f"no buy button on {product.landing_path} has data-checkout-product=\"{args.slug}\"")
        if other:
            bad(f"{len(other)} buy button(s) on {product.landing_path} point at a different product slug")
        untagged = [a for a in anchors if "data-checkout-product=" not in a]
        if untagged:
            notes.append(f"{len(untagged)} btn-primary link(s) on {product.landing_path} are not buy buttons "
                         "(check that's intended)")
        if 'src="/src/main.js"' not in html:
            bad(f"{product.landing_path} doesn't load /src/main.js, so the buttons won't open checkout")
        if "data-final-cta" not in html or "data-mobile-cta" not in html:
            notes.append(f"{product.landing_path} is missing data-final-cta or data-mobile-cta (sticky CTA behavior)")

    # ---- website: thank-you page
    thanks = page_file(product.thank_you_path)
    if not thanks.is_file():
        bad(f"thank-you page missing: {thanks}")
    else:
        html = thanks.read_text()
        if "{{" in html:
            bad(f"thank-you page {product.thank_you_path} still has {{{{PLACEHOLDERS}}}}")
        for hook in ("data-order-checking", "data-order-found", "data-order-missing", "data-order-error",
                     "data-download-link", "data-order-email"):
            if hook not in html:
                bad(f"thank-you page is missing the {hook} hook that src/checkout.js needs")
        if "noindex" not in html:
            bad("thank-you page is not noindex")
        if 'src="/src/main.js"' not in html:
            bad("thank-you page doesn't load /src/main.js, so the order is never checked")
        linked = re.findall(r'href="(/downloads/[^"]+|[^"]+\.pdf)"', html)
        if linked:
            bad(f"thank-you page links a file directly ({', '.join(sorted(set(linked)))}); "
                "the download must come from pod_processor after the payment check")

    # ---- website: vite build inputs
    vite = (SITE / "vite.config.js").read_text()
    for page in (product.landing_path, product.thank_you_path):
        rel = page.strip("/") + "/index.html"
        if not re.search(r"resolve\(__dirname,\s*\"" + re.escape(rel) + r"\"\)", vite):
            bad(f"vite.config.js doesn't build {rel} (it would 404 in production)")

    # ---- website: no paid file in public/
    if paid_file and paid_file.is_file():
        size = paid_file.stat().st_size
        for f in (SITE / "public").rglob("*"):
            if f.is_file() and (f.name == paid_file.name or (f.suffix == paid_file.suffix and f.stat().st_size == size)):
                bad(f"a copy of the paid file is public: {f.relative_to(SITE)} (anyone can download it)")

    # ---- Stripe sandbox price
    if not args.no_stripe:
        import stripe
        from dotenv import dotenv_values
        key = (dotenv_values(POD / ".env").get("STRIPE_CHECKOUT_TEST_KEY") or "").strip()
        if not key.startswith(("sk_test_", "rk_test_")):
            notes.append("skipped Stripe check: no sandbox key in STRIPE_CHECKOUT_TEST_KEY")
        else:
            prices = stripe.StripeClient(key).v1.prices.list(
                params={"lookup_keys": [product.lookup_key], "active": True, "limit": 1}).data
            if not prices:
                bad(f"no active sandbox price with lookup key {product.lookup_key} (run create_stripe_price.py)")
            else:
                notes.append(f"sandbox price {prices[0].id}: {prices[0].unit_amount / 100:.2f} {prices[0].currency}")

    for n in notes:
        print(f"note: {n}")
    if problems:
        for p in problems:
            print(f"FAIL: {p}")
        return 1
    print(f"OK: {args.slug} is consistent across pod_processor, the website and Stripe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
