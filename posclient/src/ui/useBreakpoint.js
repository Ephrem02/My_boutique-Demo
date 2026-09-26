import { useEffect, useState } from 'react';

// Keep in sync with the breakpoint note in styles/tokens.css.
export const BREAKPOINTS = { tablet: 640, desktop: 1024, large: 1440 };

function current() {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return {
    width: w,
    isMobile: w < BREAKPOINTS.tablet,
    isTablet: w >= BREAKPOINTS.tablet && w < BREAKPOINTS.desktop,
    isDesktop: w >= BREAKPOINTS.desktop,
    isLarge: w >= BREAKPOINTS.large,
  };
}

/** Reactive breakpoint flags (mobile < 640 ≤ tablet < 1024 ≤ desktop; large ≥ 1440). */
export default function useBreakpoint() {
  const [state, setState] = useState(current);
  useEffect(() => {
    const queries = Object.values(BREAKPOINTS).map((px) => window.matchMedia(`(min-width: ${px}px)`));
    const update = () => setState(current());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return state;
}
