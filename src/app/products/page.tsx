import type { Metadata } from 'next';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import ProductCard, { type ProductCardData } from '@/components/ProductCard';
import SortSelect, { type SortValue } from '@/components/SortSelect';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbLd, collectionLd } from '@/lib/seo/jsonLd';
import { BRAND, absoluteUrl, canonicalUrl } from '@/lib/seo/site';
import {
  APPAREL_CATEGORIES,
  getCategoryDef,
  getVarietiesForCategory,
  resolveCategoryLabel,
} from '@/lib/catalog/categories';
import styles from './page.module.css';
import DatabaseErrorPanel from '@/components/DatabaseErrorPanel';
import { handleSupabaseQueryResult } from '@/lib/supabase/query-helper';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Apparel & Daily Essentials Catalog',
  description:
    'Browse our collection of daily-wear essentials: heavyweight & basic t-shirts, track pants, shorts, jeans, and casual shirts.',
  alternates: { canonical: canonicalUrl('/products') },
  openGraph: {
    type: 'website',
    url: canonicalUrl('/products'),
    title: `Apparel & Daily Essentials — ${BRAND.name}`,
    description:
      'Shop everyday essentials across T-Shirts, Track Pants, Shorts, Jeans, and Shirts.',
  },
};

const VALID_SORTS: SortValue[] = ['latest', 'price-asc', 'price-desc'];

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: unknown;
  is_active: boolean;
  created_at: string;
  category: string | null;
  variety?: string | null;
  homepage_feature_image: string | null;
  homepage_feature_enabled: boolean;
}

interface InventoryRow {
  product_id: string;
  stock: number;
}

interface PageParams {
  sort?: string;
  category?: string;
  variety?: string;
  q?: string;
  sale?: string;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const sort: SortValue = VALID_SORTS.includes(params.sort as SortValue)
    ? (params.sort as SortValue)
    : 'latest';
  const rawCategory = params.category;
  const resolvedCategoryDef = getCategoryDef(rawCategory);
  const categoryFilterValue = resolvedCategoryDef?.id ?? rawCategory;
  const varietyFilter = params.variety?.trim() || '';
  const q = params.q;
  const sale = params.sale === 'true';

  const supabase = await createServerSupabaseClient();

  let productsQuery = supabase
    .from('products')
    .select(
      'id, slug, name, price_paise, sale_price_paise, images, is_active, created_at, category, variety, homepage_feature_image, homepage_feature_enabled',
    )
    .eq('is_active', true);

  if (sale || (categoryFilterValue && categoryFilterValue.toLowerCase() === 'sale')) {
    productsQuery = productsQuery.or('sale_price_paise.not.is.null,category.ilike.%sale%');
  } else if (categoryFilterValue) {
    productsQuery = productsQuery.ilike('category', `%${categoryFilterValue}%`);
  }

  if (varietyFilter) {
    productsQuery = productsQuery.ilike('variety', `%${varietyFilter}%`);
  }

  if (q) {
    productsQuery = productsQuery.or(
      `name.ilike.%${q}%,slug.ilike.%${q}%,category.ilike.%${q}%,variety.ilike.%${q}%`,
    );
  }

  if (sort === 'latest') {
    productsQuery = productsQuery.order('created_at', { ascending: false });
  }

  const response = await productsQuery;
  const result = handleSupabaseQueryResult(response, 'products_catalog.products_fetch');

  if (result.error) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CATALOG ERROR</p>
            <h1 className={styles.title}>Error Loading Products</h1>
          </div>
        </header>
        <DatabaseErrorPanel error={result.error} title="Failed to load product catalog" />
      </div>
    );
  }

  let products = (result.data ?? []) as ProductRow[];

  const effectivePrice = (p: ProductRow) => p.sale_price_paise ?? p.price_paise;

  if (sort === 'price-asc') {
    products = products.slice().sort((a, b) => effectivePrice(a) - effectivePrice(b));
  } else if (sort === 'price-desc') {
    products = products.slice().sort((a, b) => effectivePrice(b) - effectivePrice(a));
  }

  const ids = products.map((p) => p.id);
  const stockByProduct = new Map<string, number>();

  if (ids.length > 0) {
    const { data: inventoryRows } = await supabase
      .from('inventory')
      .select('product_id, stock')
      .in('product_id', ids);

    for (const row of (inventoryRows ?? []) as InventoryRow[]) {
      stockByProduct.set(
        row.product_id,
        (stockByProduct.get(row.product_id) ?? 0) + (row.stock ?? 0),
      );
    }
  }

  const cards: ProductCardData[] = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_paise: p.price_paise,
    sale_price_paise: p.sale_price_paise,
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    totalStock: stockByProduct.get(p.id) ?? 0,
    category: resolveCategoryLabel(p.category),
    variety: p.variety ?? null,
    homepage_feature_image: p.homepage_feature_image,
    homepage_feature_enabled: p.homepage_feature_enabled,
  }));

  const collectionUrl = canonicalUrl('/products');
  const featuredForSchema = cards.slice(0, 12).map((c) => ({
    name: c.name,
    url: absoluteUrl(`/product/${c.slug}`),
  }));

  const isSale = sale || (rawCategory && rawCategory.toLowerCase() === 'sale');
  const categoryTitle = resolvedCategoryDef?.label ?? rawCategory ?? '';

  const displayEyebrow = isSale
    ? 'SALE & OFFERS'
    : categoryTitle
      ? `${categoryTitle.toUpperCase()} COLLECTION`
      : q
        ? `SEARCH RESULTS FOR "${q.toUpperCase()}"`
        : 'DAILY ESSENTIALS';

  const displayTitle = isSale
    ? 'Sale & Deals'
    : categoryTitle
      ? varietyFilter
        ? `${categoryTitle} — ${varietyFilter}`
        : categoryTitle
      : q
        ? 'Search results'
        : 'All Essentials';

  // Surface sub-variety pills when a specific category is active (or T-Shirts default)
  const visibleVarieties = resolvedCategoryDef
    ? resolvedCategoryDef.varieties
    : getVarietiesForCategory('T-Shirts');

  return (
    <div className={styles.page}>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Catalog', path: '/products' },
        ])}
      />
      <JsonLd
        data={collectionLd({
          name: displayTitle,
          description: `Shop ${displayTitle} with fast shipping across India.`,
          url: collectionUrl,
          items: featuredForSchema,
        })}
      />
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{displayEyebrow}</p>
          <h1 className={styles.title}>{displayTitle}</h1>
        </div>
        {cards.length > 0 && <SortSelect current={sort} />}
      </header>

      {/* Top-Level Category Pills */}
      <section className={styles.quickAccess}>
        <div className={styles.quickAccessList}>
          <Link
            href="/products"
            className={`${styles.quickAccessBtn} ${!rawCategory && !isSale ? styles.quickAccessBtnActive : ''}`}
          >
            All
          </Link>
          {APPAREL_CATEGORIES.map((cat) => {
            const isActive =
              resolvedCategoryDef?.slug === cat.slug ||
              rawCategory?.toLowerCase() === cat.id.toLowerCase();
            return (
              <Link
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className={`${styles.quickAccessBtn} ${isActive ? styles.quickAccessBtnActive : ''}`}
              >
                {cat.label}
              </Link>
            );
          })}
          <Link
            href="/products?sale=true"
            className={`${styles.quickAccessBtn} ${isSale ? styles.quickAccessBtnActive : ''}`}
          >
            Sale
          </Link>
        </div>

        {/* Product Variety / Fit Sub-Pills */}
        {(resolvedCategoryDef || varietyFilter) && (
          <div className={styles.quickAccessList} style={{ marginTop: 10 }}>
            {visibleVarieties.map((v) => {
              const isActive = varietyFilter.toLowerCase() === v.toLowerCase();
              const baseCat = resolvedCategoryDef?.slug || rawCategory || 't-shirts';
              const href = isActive
                ? `/products?category=${baseCat}`
                : `/products?category=${baseCat}&variety=${encodeURIComponent(v)}`;
              return (
                <Link
                  key={v}
                  href={href}
                  className={`${styles.quickAccessBtn} ${isActive ? styles.quickAccessBtnActive : ''}`}
                  style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                >
                  {v}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {cards.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No products found</p>
          <p className={styles.emptyBody}>
            We couldn&apos;t find any styles matching your filters. Try another variety or check back soon!
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {cards.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
