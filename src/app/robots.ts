import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site';

/**
 * KickoffPro — robots.txt policy.
 *
 * Baseline: allow generic crawlers across the public surface;
 * explicitly disallow transactional, authenticated, admin, and
 * machine endpoints.
 *
 * We do NOT selectively disallow search-result-style URLs (`?q=`,
 * `?sort=`) because canonical tags in the page metadata already
 * point those variants back to the unfiltered collection — the
 * cleaner consolidation signal. Disallowing them *and* canonicalising
 * would be conflicting guidance.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          '/auth/',
          '/cart',
          '/checkout',
          '/feeds/',
          '/order/',
          '/orders',
          '/orders/',
          '/profile',
          '/profile/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
