import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeSlug } from '@/lib/slug';
import { normalizeVideoList } from '@/lib/catalog/categories';
import { normalizeQualityHighlights } from '@/lib/catalog/qualityTemplates';
import ProductDetailClient, {
  type ProductDetail,
  type InventoryItem,
  type PdpBestOffer,
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
  videos?: unknown;
  sizes: unknown;
  category?: string | null;
  variety?: string | null;
  is_active: boolean;
  gsm?: string | null;
  fabric?: string | null;
  fit?: string | null;
  model_info?: string | null;
  quality_highlights?: unknown;
}

interface InventoryRow {
  size: string;
  stock: number;
  low_stock_alert?: boolean | null;
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createAdminClient();
  const normalized = normalizeSlug(slug);
  const { data } = await supabase
    .from('products')
    .select('name, description, images, price_paise, sale_price_paise, is_active')
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle<ProductMetaRow>();

  const productUrl = canonicalUrl(`/product/${normalized}`);

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
  const normalized = normalizeSlug(slug);

  const { data: productRow } = await supabase
    .from('products')
    .select('*')
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle<ProductRow>();

  if (!productRow) {
    console.log('[DIAGNOSTIC] notFound() triggered.', {
      incomingSlug: slug,
      normalizedSlug: normalized,
      productRow,
      reason: 'No active product matched the normalized slug in the database query'
    });
    notFound();
  }

  if (slug !== productRow.slug) {
    permanentRedirect(`/product/${productRow.slug}`);
  }

  const nowIso = new Date().toISOString();
  const [invRes, couponsRes, settingsRes] = await Promise.all([
    supabase
      .from('inventory')
      .select('size, stock, low_stock_alert')
      .eq('product_id', productRow.id),
    supabase
      .from('coupons')
      .select(
        'code, discount_type, discount_percent, discount_paise, min_cart_paise, max_discount_paise, starts_at, expires_at, new_users_only',
      )
      .eq('is_active', true),
    supabase
      .from('shipping_settings')
      .select(
        'promo_banner_enabled, promo_reward_type, promo_goal_threshold_paise, reward_percentage, buy_x_quantity, get_y_quantity',
      )
      .limit(1)
      .maybeSingle(),
  ]);

  const inventoryRows = invRes.data;
  const inventory: InventoryItem[] = ((inventoryRows ?? []) as InventoryRow[]).map((r) => ({
    size: r.size,
    stock: r.stock ?? 0,
    low_stock_alert: Boolean(r.low_stock_alert),
  }));
  const totalStock = inventory.reduce((sum, row) => sum + (row.stock ?? 0), 0);

  const unitPrice = productRow.sale_price_paise ?? productRow.price_paise;
  const activeCoupons = ((couponsRes.data ?? []) as Array<{
    code: string;
    discount_type?: string | null;
    discount_percent: number;
    discount_paise?: number | null;
    min_cart_paise?: number | null;
    max_discount_paise?: number | null;
    starts_at?: string | null;
    expires_at?: string | null;
    new_users_only?: boolean | null;
  }>).filter((c) => {
    if (c.new_users_only) return false;
    if (c.discount_type === 'bxgy') return false;
    if (c.starts_at && c.starts_at > nowIso) return false;
    if (c.expires_at && c.expires_at <= nowIso) return false;
    return true;
  });

  // Evaluate immediately-applicable coupons on a single unit of this product
  let bestOffer: PdpBestOffer | null = null;
  for (const c of activeCoupons) {
    const minCart = c.min_cart_paise ?? 0;
    if (minCart > 0 && unitPrice < minCart) continue;
    let savings = 0;
    if (c.discount_type === 'flat' && c.discount_paise && c.discount_paise > 0) {
      savings = Math.min(c.discount_paise, unitPrice);
    } else {
      savings = Math.round((unitPrice * (c.discount_percent || 0)) / 100);
    }
    if (c.max_discount_paise && c.max_discount_paise > 0) {
      savings = Math.min(savings, c.max_discount_paise);
    }
    savings = Math.min(savings, unitPrice);
    if (savings > 0 && (!bestOffer || savings > bestOffer.savingsPaise)) {
      const bestPrice = Math.max(0, unitPrice - savings);
      bestOffer = {
        badge: 'BEST PRICE',
        bestPricePaise: bestPrice,
        savingsPaise: savings,
        headline: `Get it for ₹${Math.round(bestPrice / 100).toLocaleString('en-IN')} with ${c.code}`,
        subline:
          c.discount_type === 'flat' && c.discount_paise
            ? `Save ₹${Math.round(savings / 100).toLocaleString('en-IN')} instantly with coupon ${c.code}`
            : `Save ${c.discount_percent}% (₹${Math.round(savings / 100).toLocaleString('en-IN')}) with code ${c.code}`,
        couponCode: c.code,
        discountType: c.discount_type === 'flat' ? 'flat' : 'percent',
        discountPercent: c.discount_percent || 0,
        discountPaiseFlat: c.discount_paise ?? null,
        maxDiscountPaise: c.max_discount_paise ?? null,
        minCartPaise: c.min_cart_paise ?? null,
      };
    }
  }

  // Evaluate Magic Cart Auto Offer when enabled and not manual_coupon_only
  const shipSet = settingsRes.data as {
    promo_banner_enabled?: boolean | null;
    promo_reward_type?: string | null;
    promo_goal_threshold_paise?: number | null;
    reward_percentage?: number | null;
    buy_x_quantity?: number | null;
    get_y_quantity?: number | null;
  } | null;

  if (
    shipSet &&
    shipSet.promo_banner_enabled !== false &&
    shipSet.promo_reward_type !== 'manual_coupon_only'
  ) {
    if (shipSet.promo_reward_type === 'threshold_percentage' && (shipSet.reward_percentage ?? 0) > 0) {
      const pct = Number(shipSet.reward_percentage) || 0;
      const thresh = shipSet.promo_goal_threshold_paise ?? 0;
      if (thresh === 0 || unitPrice >= thresh) {
        const autoSavings = Math.round((unitPrice * pct) / 100);
        if (autoSavings > (bestOffer?.savingsPaise ?? 0)) {
          const bestPrice = Math.max(0, unitPrice - autoSavings);
          bestOffer = {
            badge: 'AUTO OFFER',
            bestPricePaise: bestPrice,
            savingsPaise: autoSavings,
            headline: `Get it for ₹${Math.round(bestPrice / 100).toLocaleString('en-IN')} (${pct}% OFF auto-applied)`,
            subline: `Automatic ${pct}% cart discount applied at checkout`,
            couponCode: null,
          };
        }
      } else if (!bestOffer) {
        bestOffer = {
          badge: 'OFFER',
          bestPricePaise: unitPrice,
          savingsPaise: 0,
          headline: `Get ${pct}% OFF automatically on orders ₹${Math.round(thresh / 100).toLocaleString('en-IN')}+`,
          subline: 'Auto-applies in Cart Drawer once threshold is reached',
          couponCode: null,
        };
      }
    } else if (shipSet.promo_reward_type === 'buy_x_get_cheapest_free' && !bestOffer) {
      const bx = shipSet.buy_x_quantity ?? 2;
      const gy = shipSet.get_y_quantity ?? 1;
      bestOffer = {
        badge: 'MULTI-BUY OFFER',
        bestPricePaise: unitPrice,
        savingsPaise: 0,
        headline: `Buy ${bx} Get ${gy} Lowest-Priced Item Free`,
        subline: `Add ${bx + gy} items to cart for instant bundle savings`,
        couponCode: null,
      };
    }
  }

  // Fallback hint for threshold-gated coupons if no immediate discount matched
  if (!bestOffer && activeCoupons.length > 0) {
    const sorted = [...activeCoupons].sort(
      (a, b) => (a.min_cart_paise ?? 0) - (b.min_cart_paise ?? 0),
    );
    const nextC = sorted[0];
    if (nextC) {
      const offerText =
        nextC.discount_type === 'flat' && nextC.discount_paise
          ? `₹${Math.round(nextC.discount_paise / 100).toLocaleString('en-IN')} OFF`
          : `${nextC.discount_percent}% OFF`;
      bestOffer = {
        badge: 'COUPON OFFER',
        bestPricePaise: unitPrice,
        savingsPaise: 0,
        headline: `Use code ${nextC.code} for ${offerText}${nextC.min_cart_paise ? ` on ₹${Math.round(nextC.min_cart_paise / 100).toLocaleString('en-IN')}+` : ''}`,
        subline: 'Apply in Cart Drawer or Checkout',
        couponCode: null,
      };
    }
  }

  // Coerce JSONB defensively so the client never has to.
  const product: ProductDetail = {
    id: productRow.id,
    name: productRow.name,
    slug: productRow.slug,
    description: productRow.description ?? '',
    price_paise: productRow.price_paise,
    sale_price_paise: productRow.sale_price_paise ?? null,
    images: Array.isArray(productRow.images) ? (productRow.images as string[]) : [],
    videos: normalizeVideoList(productRow.videos),
    sizes: Array.isArray(productRow.sizes) ? (productRow.sizes as string[]) : [],
    category: productRow.category ?? null,
    variety: productRow.variety ?? null,
    gsm: productRow.gsm ?? null,
    fabric: productRow.fabric ?? null,
    fit: productRow.fit ?? null,
    model_info: productRow.model_info ?? null,
    quality_highlights: normalizeQualityHighlights(productRow.quality_highlights),
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
        bestOffer={bestOffer}
      />
    </>
  );
}
