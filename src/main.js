// Progressive enhancement only — the page is fully usable without this file.

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
