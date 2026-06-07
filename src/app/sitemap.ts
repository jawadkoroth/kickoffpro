import type { MetadataRoute } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { SITE_URL } from '@/lib/seo/site';
import { publishedArticles } from '@/app/journal/_articles';

/**
 * KickoffPro — root sitemap.
 *
 * Emits:
 *   - static surface routes (home, shop, about, journal, legal)
 *   - every active product page, via Supabase
 *
 * Excluded by design:
 *   - /cart, /checkout, /auth/*, /profile/*, /orders/*, /order/*
 *     — transactional / authenticated; indexing them leaks UX and
 *       generates thin-page signals.
 *   - /admin/*             — not public
 *   - /api/*, /feeds/*     — machine endpoints
 *
 * Regenerated on every build AND re-evaluated at runtime because
 * this is a server function — Next revalidates the sitemap per the
 * revalidate hint. We keep TTL modest (1h) so a newly added
 * product surfaces quickly without hammering the DB.
 *
 * Note: lastmod is best-effort. We use `products.updated_at` where
 * available; static pages fall back to build time. Google tolerates
 * imperfect lastmod; lying about it (always-now) is penalised.
 */

export const revalidate = 3600;

type ChangeFreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

interface ProductSitemapRow {
  slug: string;
  updated_at: string | null;
}

const BUILD_TIME = new Date();

const STATIC_ROUTES: Array<{
  path: string;
  priority: number;
  changeFrequency: ChangeFreq;
}> = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/products', priority: 0.9, changeFrequency: 'daily' },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/journal', priority: 0.7, changeFrequency: 'weekly' },
    { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/legal/returns', priority: 0.4, changeFrequency: 'yearly' },
    { path: '/legal/shipping', priority: 0.4, changeFrequency: 'yearly' },
  ];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path === '/' ? '' : r.path}`,
    lastModified: BUILD_TIME,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('products')
      .select('slug, updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(2000);

    const rows = (data ?? []) as ProductSitemapRow[];
    productEntries = rows
      .filter((r) => typeof r.slug === 'string' && r.slug.length > 0)
      .map((r) => ({
        url: `${SITE_URL}/product/${r.slug}`,
        lastModified: r.updated_at ? new Date(r.updated_at) : BUILD_TIME,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }));
  } catch {
    // Database unreachable at build time: fall back to static entries
    // only. The next scheduled revalidate will include products. This
    // degradation is strictly better than a broken sitemap.
    productEntries = [];
  }

  // Journal articles — file-backed, no DB hit. Empty-array safe.
  const journalEntries: MetadataRoute.Sitemap = publishedArticles().map(
    (a) => ({
      url: `${SITE_URL}/journal/${a.slug}`,
      lastModified: new Date(a.updatedAt || a.publishedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }),
  );

  return [...staticEntries, ...productEntries, ...journalEntries];
}
