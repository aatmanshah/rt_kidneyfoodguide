// Progressive enhancement only — the page is fully usable without this file.

// Seasonal Harvest Recipes promo: shown September through December, based on
// the visitor's own local clock (there's no server request here to read a
// locale/timezone from, so `Date` already does the right thing per visitor).
// Marked `hidden` in the HTML by default so it stays hidden if this script
// fails to load or run.
const seasonalPromo = document.querySelector("[data-seasonal='fall']");

if (seasonalPromo) {
  const month = new Date().getMonth(); // 0 = Jan ... 11 = Dec
  const isFallSeason = month >= 8 && month <= 11; // September through December
  seasonalPromo.hidden = !isFallSeason;
}

import { verifyOrder } from "./checkout.js";

// Fall Recipes "thank you" page.
//
// With our own Stripe checkout (src/checkout.js, on when VITE_CHECKOUT_API_URL is set) and a ?session_id= in
// the URL, the order is checked for real against Stripe through pod_processor, and the download link is one
// pod_processor only serves for a paid order.
//
// Otherwise (Zylvie checkout, still the default) this is the old soft check: it only looks at whether the
// page was reached with a query string at all, which a checkout redirect almost always includes and a bare,
// unlinked visit wouldn't. It stops casual link-sharing, not a determined visitor reading this source.
const orderChecking = document.querySelector("[data-order-checking]");
const orderFound = document.querySelector("[data-order-found]");
const orderMissing = document.querySelector("[data-order-missing]");
const orderError = document.querySelector("[data-order-error]");

if (orderChecking && orderFound && orderMissing) {
  verifyOrder({ checking: orderChecking, found: orderFound, missing: orderMissing, error: orderError }).then(
    (handled) => {
      if (handled) return;
      // Pages built for our own checkout have no real download link to fall back to ("#").
      const downloadLink = orderFound.querySelector("[data-download-link]");
      const hasFallbackFile = !downloadLink || downloadLink.getAttribute("href") !== "#";
      const looksLikeCheckoutRedirect = hasFallbackFile && window.location.search.length > 1;
      setTimeout(() => {
        orderChecking.hidden = true;
        if (looksLikeCheckoutRedirect) {
          orderFound.hidden = false;
        } else {
          orderMissing.hidden = false;
        }
      }, 700);
    },
  );
}

// Fade-in-on-scroll for elements marked with the `.reveal` class.
//
// Deliberately not IntersectionObserver-based: a fast scrollbar drag, the
// `End` key, or an in-page search (Ctrl+F) can move an element from below
// the viewport to above it between two observation samples, so it never
// registers as "intersecting" and stays invisible forever. Checking the
// bounding rect directly on scroll has no such gap.
const revealTargets = document.querySelectorAll(".reveal");

if (revealTargets.length) {
  let ticking = false;

  const revealInView = () => {
    for (const el of revealTargets) {
      if (!el.classList.contains("is-visible") && el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.classList.add("is-visible");
      }
    }
    ticking = false;
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(revealInView);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  revealInView();
}

// Sticky mobile CTA bar: hide once the user reaches the in-page final CTA
// so it doesn't cover the real button.
const mobileCta = document.querySelector("[data-mobile-cta]");
const finalCta = document.querySelector("[data-final-cta]");

if (mobileCta && finalCta) {
  let ctaTicking = false;

  const updateMobileCta = () => {
    const rect = finalCta.getBoundingClientRect();
    const finalCtaInView = rect.top < window.innerHeight && rect.bottom > 0;
    mobileCta.classList.toggle("translate-y-full", finalCtaInView);
    ctaTicking = false;
  };

  const onCtaScroll = () => {
    if (!ctaTicking) {
      ctaTicking = true;
      requestAnimationFrame(updateMobileCta);
    }
  };

  window.addEventListener("scroll", onCtaScroll, { passive: true });
  window.addEventListener("resize", onCtaScroll);
  updateMobileCta();
}
