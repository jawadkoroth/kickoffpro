'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Global scroll-to-top on every route change.
 *
 * Mounted once in the root layout so every client-side navigation
 * resets the viewport to the top. This fixes the issue where pages
 * like country collection pages open in the middle of the page.
 */
export default function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
