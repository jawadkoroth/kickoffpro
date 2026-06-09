import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import ProductDetailClient, {
  type ProductDetail,
  type InventoryItem,
} from './ProductDetailClient';
import { JsonLd } from '@/components/seo/JsonLd';
import { productLd, breadcrumbLd } from '@/lib/seo/jsonLd';
import { BRAND, absoluteUrl, canonicalUrl } from '@/lib/seo/site';

export const dynamic = 'force-dynamic';

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_paise: number;
  sale_price_paise: number | null;
  images: unknown;
  sizes: unknown;
  is_active: boolean;
}

interface InventoryRow {
  size: string;
  stock: number;
}

interface ProductMetaRow {
  name: string;
  description: string | null;
  images: unknown;
  price_paise: number;
  sale_price_paise: number | null;
  is_active: boolean;
}

/**
 * Trim a product description to the 160-character meta-description
 * sweet-spot without chopping mid-word. Falls back to the brand
 * boilerplate when the product has no description yet.
 */
function metaDescriptionFor(name: string, raw: string | null): string {
  const source = (raw || '').replace(/\s+/g, ' ').trim();
  if (!source) return `${name} — ${BRAND.description}`;
  if (source.length <= 160) return source;
  const cut = source.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function firstImageOrNull(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const first = raw.find((x): x is string => typeof x === 'string' && x.length > 0);
  return first ?? null;
}

async function fetchProductAndHeal(slug: string, supabase: any) {
  // 1. Try to fetch matching product directly
  let { data: product } = await supabase
    .from('products')
    .select('id, name, slug, description, price_paise, sale_price_paise, images, sizes, is_active')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  // 2. Self-healing fallback for Argentina jersey slug mismatch (en-dash vs hyphen)
  if (!product && slug === 'Argentina-Premium-Dot-Knit-Jersey-2026') {
    const adminSupabase = createAdminClient();
    const { data: updated } = await adminSupabase
      .from('products')
      .update({ slug: 'Argentina-Premium-Dot-Knit-Jersey-2026' })
      .eq('slug', 'Argentina-Premium-Dot-Knit-Jersey–2026')
      .select('id, name, slug, description, price_paise, sale_price_paise, images, sizes, is_active')
      .maybeSingle();

    if (updated) {
      console.log('[SELF-HEALING] Successfully normalized Argentina jersey slug from en-dash to hyphen.');
      product = updated;
    }
  }

  return product;
}

/**
 * Generate route-level metadata per product. Runs on the server
 * during request handling (or at build for static pages); the
 * Supabase call is cheap and already covered by the `(id, slug)`
 * index.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createAdminClient();
  const data = await fetchProductAndHeal(slug, supabase);

  const productUrl = canonicalUrl(`/product/${slug}`);

  if (!data) {
    return {
      title: 'Product not found',
      description: BRAND.description,
      alternates: { canonical: productUrl },
      robots: { index: false, follow: true },
    };
  }

  const description = metaDescriptionFor(data.name, data.description);
  const primaryImage = firstImageOrNull(data.images);
  const ogImage = primaryImage ? absoluteUrl(primaryImage) : undefined;

  return {
    title: data.name,
    description,
    alternates: { canonical: productUrl },
    openGraph: {
      type: 'website',
      url: productUrl,
      title: data.name,
      description,
      images: ogImage ? [{ url: ogImage, alt: data.name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: data.name,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/**
 * Server-rendered product detail.
 *
 * Fetches the single product by slug. There is no fallback to "first
 * product" and no `useEffect` round-trip — invalid or inactive slugs
 * trigger Next's `notFound()` which renders the framework 404 page.
 *
 * Total stock is computed by aggregating `inventory.stock` across all
 * sizes — never read from a non-existent `products.stock` column.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const productRow = await fetchProductAndHeal(slug, supabase);

  if (!productRow) {
    notFound();
  }

  const { data: inventoryRows } = await supabase
    .from('inventory')
    .select('size, stock')
    .eq('product_id', productRow.id);

  const inventory: InventoryItem[] = (inventoryRows ?? []) as InventoryRow[];
  const totalStock = inventory.reduce((sum, row) => sum + (row.stock ?? 0), 0);

  // Coerce JSONB defensively so the client never has to.
  const product: ProductDetail = {
    id: productRow.id,
    name: productRow.name,
    slug: productRow.slug,
    description: productRow.description ?? '',
    price_paise: productRow.price_paise,
    sale_price_paise: productRow.sale_price_paise ?? null,
    images: Array.isArray(productRow.images) ? (productRow.images as string[]) : [],
    sizes: Array.isArray(productRow.sizes) ? (productRow.sizes as string[]) : [],
  };

  const productUrl = canonicalUrl(`/product/${slug}`);
  const imageUrls = product.images
    .filter((x) => typeof x === 'string' && x.length > 0)
    .map((x) => absoluteUrl(x));
  const priceRupees = (product.price_paise / 100).toFixed(2);
  const salePriceRupees = product.sale_price_paise
    ? (product.sale_price_paise / 100).toFixed(2)
    : undefined;
  const effectivePrice = salePriceRupees ?? priceRupees;
  const availability: 'InStock' | 'OutOfStock' =
    totalStock > 0 ? 'InStock' : 'OutOfStock';

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'All Products', path: '/products' },
          { name: product.name, path: `/product/${slug}` },
        ])}
      />
      <JsonLd
        data={productLd({
          name: product.name,
          slug,
          description: product.description || `${product.name} — ${BRAND.description}`,
          price: effectivePrice,
          priceCompareAt: salePriceRupees ? priceRupees : undefined,
          currency: BRAND.currency,
          images: imageUrls,
          availability,
          url: productUrl,
          sku: product.id,
          sizes: product.sizes,
        })}
      />
      <ProductDetailClient
        product={product}
        inventory={inventory}
        totalStock={totalStock}
      />
    </>
  );
}
