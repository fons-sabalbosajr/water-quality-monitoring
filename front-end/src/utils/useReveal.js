import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';

/**
 * Lightweight scroll-reveal built on anime.js.
 *
 * Design constraints, because animation is the easiest way to leak memory and
 * burn CPU in a long-lived dashboard:
 *
 *  - **One-shot.** Each element animates once, then is unobserved. Nothing
 *    stays subscribed to scroll, and there is no persistent RAF loop.
 *  - **Transform + opacity only.** These are compositor-only properties, so a
 *    reveal never triggers layout or paint of the surrounding page.
 *  - **Fully torn down.** The IntersectionObserver is disconnected and every
 *    in-flight animation is cancelled on unmount, so navigating away mid-reveal
 *    cannot leave a timer or a detached element reference behind.
 *  - **Respects `prefers-reduced-motion`.** Elements are made visible
 *    immediately with no animation at all — not merely a faster one.
 *
 * Usage: attach the returned ref to a container; every descendant matching
 * `selector` is revealed as it scrolls into view.
 */
export const useReveal = ({
  selector = '[data-reveal]',
  distance = 18,
  duration = 520,
  delayStep = 60,
  threshold = 0.12,
  enabled = true,
} = {}) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return undefined;

    const targets = Array.from(container.querySelectorAll(selector));
    if (!targets.length) return undefined;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // No animation at all when reduced motion is requested — just show it.
    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => {
        el.style.opacity = '';
        el.style.transform = '';
      });
      return undefined;
    }

    // Set the "before" state directly rather than in CSS, so the content stays
    // visible if this hook never runs (JS disabled, or an early error).
    targets.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = `translateY(${distance}px)`;
      el.style.willChange = 'opacity, transform';
    });

    const running = new Set();

    const reveal = (batch) => {
      const animation = animate(batch, {
        opacity: [0, 1],
        translateY: [distance, 0],
        duration,
        delay: stagger(delayStep),
        ease: 'out(3)',
        onComplete: () => {
          running.delete(animation);
          // Drop the compositor hint once the element has settled; leaving
          // will-change on hundreds of nodes keeps layers alive on the GPU.
          batch.forEach((el) => {
            el.style.willChange = '';
          });
        },
      });
      running.add(animation);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target);
        if (!visible.length) return;
        // Unobserve first: this is a one-shot reveal, and leaving elements
        // observed keeps the callback firing for the life of the page.
        visible.forEach((el) => observer.unobserve(el));
        reveal(visible);
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );

    targets.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      running.forEach((animation) => {
        try {
          animation.pause();
        } catch {
          // anime.js version differences — a failed pause must not break unmount.
        }
      });
      running.clear();
      // Leave the DOM in its final visible state so a remount is not blank.
      targets.forEach((el) => {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.willChange = '';
      });
    };
  }, [selector, distance, duration, delayStep, threshold, enabled]);

  return containerRef;
};

export default useReveal;
