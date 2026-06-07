import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import ProductCard, { type ProductCardData } from '@/components/ProductCard';
import SortSelect, { type SortValue } from '@/components/SortSelect';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbLd, collectionLd } from '@/lib/seo/jsonLd';
import { BRAND, absoluteUrl, canonicalUrl } from '@/lib/seo/site';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Football Jerseys Catalog',
  description:
    'Browse our full catalogue of affordable club, national team, and retro football jerseys priced between ₹250 and ₹350.',
  alternates: { canonical: canonicalUrl('/products') },
  openGraph: {
    type: 'website',
    url: canonicalUrl('/products'),
    title: `Football Jerseys Catalog — ${BRAND.name}`,
    description:
      'Browse our full catalogue of affordable club, national team, and retro football jerseys.',
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
}

interface InventoryRow {
  product_id: string;
  stock: number;
}

interface PageParams {
  sort?: string;
  category?: string;
  q?: string;
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
  const category = params.category;
  const q = params.q;

  const supabase = await createServerSupabaseClient();

  let productsQuery = supabase
    .from('products')
    .select('id, slug, name, price_paise, sale_price_paise, images, is_active, created_at, category')
    .eq('is_active', true);

  if (category) {
    if (category.toLowerCase() === 'sale') {
      productsQuery = productsQuery.not('sale_price_paise', 'is', null);
    } else {
      productsQuery = productsQuery.ilike('category', `%${category}%`);
    }
  }

  if (q) {
    productsQuery = productsQuery.or(`name.ilike.%${q}%,slug.ilike.%${q}%,category.ilike.%${q}%`);
  }

  if (sort === 'latest') {
    productsQuery = productsQuery.order('created_at', { ascending: false });
  }

  const { data: productRows } = await productsQuery;
  let products = (productRows ?? []) as ProductRow[];

  const effectivePrice = (p: ProductRow) => p.sale_price_paise ?? p.price_paise;

  if (sort === 'price-asc') {
    products = products.slice().sort((a, b) => effectivePrice(a) - effectivePrice(b));
  } else if (sort === 'price-desc') {
    products = products.slice().sort((a, b) => effectivePrice(b) - effectivePrice(a));
  }

  const ids = products.map(p => p.id);
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

  const cards: ProductCardData[] = products.map(p => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_paise: p.price_paise,
    sale_price_paise: p.sale_price_paise,
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    totalStock: stockByProduct.get(p.id) ?? 0,
    category: p.category || 'Football Jersey'
  }));

  const collectionUrl = canonicalUrl('/products');
  const featuredForSchema = cards.slice(0, 12).map((c) => ({
    name: c.name,
    url: absoluteUrl(`/product/${c.slug}`),
  }));

  const displayEyebrow = category 
    ? `${category.toUpperCase()} COLLECTION` 
    : (q ? `SEARCH RESULTS FOR "${q.toUpperCase()}"` : 'FOOTBALL JERSEYS');

  const displayTitle = category 
    ? `${category.charAt(0).toUpperCase() + category.slice(1)} Jerseys` 
    : (q ? `Search results` : 'All Jerseys');

  return (
    <div className={styles.page}>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Jerseys', path: '/products' },
        ])}
      />
      <JsonLd
        data={collectionLd({
          name: displayTitle,
          description: `Buy high quality ${displayTitle} starting from ₹250. Fast shipping in India.`,
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

      {cards.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No jerseys found</p>
          <p className={styles.emptyBody}>
            We couldn't find any jerseys matching your filters. Check back soon for restocks!
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {cards.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
