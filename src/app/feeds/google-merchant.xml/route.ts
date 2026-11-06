import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BRAND, SITE_URL, absoluteUrl } from '@/lib/seo/site';
import { getPublicUrl } from '@/lib/media';

/**
 * Google Merchant Center & Meta Catalog — RSS 2.0 Product Feed.
 *
 * Serves at /feeds/google-merchant.xml.
 *
 * Requirements:
 *   1. Exports all active clothing items with variant attributes:
 *      - `g:item_group_id`: Groups all size variants belonging to the same parent product.
 *      - `g:size`: Specific size variant (S, M, L, XL, etc.).
 *      - `g:color`: Color detected or assigned per apparel item.
 *      - `g:availability`: Live per-variant stock level ('in_stock' vs 'out_of_stock').
 *      - `g:price`: Formatted currency price (e.g. "1299.00 INR") plus `g:sale_price` if discounted.
 *   2. Caching headers: `s-maxage=1800, stale-while-revalidate=3600` for edge caching
 *      so crawler bots sync hourly without hammering the database.
 */

export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_paise: number;
  sale_price_paise: number | null;
  images: unknown;
  sizes: unknown;
  category: string | null;
  is_active: boolean;
  updated_at: string | null;
}

interface InventoryRow {
  product_id: string;
  size: string;
  stock: number;
}

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);
}

function cdata(s: string): string {
  // CDATA cannot contain `]]>`. Split any occurrence across two CDATA sections.
  const safe = s.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function normaliseImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => {
      const publicUrl = getPublicUrl(x);
      return publicUrl.startsWith('/') ? absoluteUrl(publicUrl) : publicUrl;
    })
    .filter((u) => u.startsWith('http://') || u.startsWith('https://'));
}

function stripHtml(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rupees(paise: number): string {
  // Google / Meta expects "<amount> <currency>" e.g. "1299.00 INR".
  return `${(paise / 100).toFixed(2)} ${BRAND.currency}`;
}

/**
 * Intelligent color extractor for sports apparel and football jerseys.
 * Extracts dominant team or fabric color from name, description, and category.
 */
function extractColor(name: string, description: string | null, category: string | null): string {
  const text = `${name} ${description || ''} ${category || ''}`.toLowerCase();

  // National teams & known color schemes
  if (text.includes('brazil')) return 'Yellow / Green';
  if (text.includes('portugal')) return 'Red / Green';
  if (text.includes('argentina')) return 'White / Sky Blue';
  if (text.includes('spain')) return 'Red / Gold';
  if (text.includes('india')) return 'Blue / Orange';
  if (text.includes('germany')) return 'White / Black';
  if (text.includes('france')) return 'Navy / Gold';
  if (text.includes('italy')) return 'Azzurro Blue';
  if (text.includes('england')) return 'White / Navy';
  if (text.includes('netherlands') || text.includes('holland')) return 'Orange';
  if (text.includes('japan')) return 'Blue / White';

  // Standard clothing colors
  if (text.includes('black')) return 'Black';
  if (text.includes('white')) return 'White';
  if (text.includes('red')) return 'Red';
  if (text.includes('blue')) return 'Blue';
  if (text.includes('navy')) return 'Navy';
  if (text.includes('yellow')) return 'Yellow';
  if (text.includes('green')) return 'Green';
  if (text.includes('gold')) return 'Gold';
  if (text.includes('grey') || text.includes('gray')) return 'Grey';
  if (text.includes('pink')) return 'Pink';
  if (text.includes('purple')) return 'Purple';
  if (text.includes('orange')) return 'Orange';

  return 'Multi-color';
}

/**
 * Emits an RSS item for a specific clothing size variant.
 */
function buildVariantItem(
  row: FeedRow,
  size: string,
  stock: number,
  images: string[],
  color: string,
  description: string,
): string {
  const variantId = `${row.id}_${size}`;
  const variantUrl = `${SITE_URL}/product/${row.slug}?size=${encodeURIComponent(size)}`;
  const availability = stock > 0 ? 'in_stock' : 'out_of_stock';
  const price = rupees(row.price_paise);
  const salePrice =
    row.sale_price_paise && row.sale_price_paise < row.price_paise
      ? rupees(row.sale_price_paise)
      : null;

  const parts: string[] = [];
  parts.push('<item>');
  parts.push(`<g:id>${xmlEscape(variantId)}</g:id>`);
  parts.push(`<g:item_group_id>${xmlEscape(row.id)}</g:item_group_id>`);
  parts.push(`<title>${cdata(`${row.name} - ${size}`)}</title>`);
  parts.push(`<description>${cdata(description)}</description>`);
  parts.push(`<link>${xmlEscape(variantUrl)}</link>`);

  if (images[0]) {
    parts.push(`<g:image_link>${xmlEscape(images[0])}</g:image_link>`);
  }
  for (const img of images.slice(1, 11)) {
    parts.push(`<g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`);
  }

  parts.push(`<g:availability>${availability}</g:availability>`);
  parts.push(`<g:price>${xmlEscape(price)}</g:price>`);
  if (salePrice) {
    parts.push(`<g:sale_price>${xmlEscape(salePrice)}</g:sale_price>`);
  }
  parts.push('<g:condition>new</g:condition>');
  parts.push(`<g:brand>${cdata(BRAND.name)}</g:brand>`);
  parts.push('<g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Activewear &gt; Jerseys</g:google_product_category>');
  parts.push(`<g:product_type>${cdata(row.category ? `Sportswear &gt; ${row.category}` : 'Sportswear &gt; Football Jerseys')}</g:product_type>`);
  parts.push('<g:identifier_exists>no</g:identifier_exists>');
  parts.push('<g:gender>unisex</g:gender>');
  parts.push('<g:age_group>adult</g:age_group>');
  parts.push(`<g:color>${cdata(color)}</g:color>`);
  parts.push(`<g:size>${xmlEscape(size)}</g:size>`);
  parts.push('<g:size_system>IN</g:size_system>');
  parts.push('</item>');

  return parts.join('');
}

/**
 * Fallback item for products without explicit size variations.
 */
function buildSingleItem(
  row: FeedRow,
  stock: number,
  images: string[],
  color: string,
  description: string,
): string {
  const url = `${SITE_URL}/product/${row.slug}`;
  const availability = stock > 0 ? 'in_stock' : 'out_of_stock';
  const price = rupees(row.price_paise);
  const salePrice =
    row.sale_price_paise && row.sale_price_paise < row.price_paise
      ? rupees(row.sale_price_paise)
      : null;

  const parts: string[] = [];
  parts.push('<item>');
  parts.push(`<g:id>${xmlEscape(row.id)}</g:id>`);
  parts.push(`<g:item_group_id>${xmlEscape(row.id)}</g:item_group_id>`);
  parts.push(`<title>${cdata(row.name)}</title>`);
  parts.push(`<description>${cdata(description)}</description>`);
  parts.push(`<link>${xmlEscape(url)}</link>`);

  if (images[0]) {
    parts.push(`<g:image_link>${xmlEscape(images[0])}</g:image_link>`);
  }
  for (const img of images.slice(1, 11)) {
    parts.push(`<g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`);
  }

  parts.push(`<g:availability>${availability}</g:availability>`);
  parts.push(`<g:price>${xmlEscape(price)}</g:price>`);
  if (salePrice) {
    parts.push(`<g:sale_price>${xmlEscape(salePrice)}</g:sale_price>`);
  }
  parts.push('<g:condition>new</g:condition>');
  parts.push(`<g:brand>${cdata(BRAND.name)}</g:brand>`);
  parts.push('<g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Activewear &gt; Jerseys</g:google_product_category>');
  parts.push(`<g:product_type>${cdata(row.category ? `Sportswear &gt; ${row.category}` : 'Sportswear &gt; Football Jerseys')}</g:product_type>`);
  parts.push('<g:identifier_exists>no</g:identifier_exists>');
  parts.push('<g:gender>unisex</g:gender>');
  parts.push('<g:age_group>adult</g:age_group>');
  parts.push(`<g:color>${cdata(color)}</g:color>`);
  parts.push('<g:size>Free Size</g:size>');
  parts.push('<g:size_system>IN</g:size_system>');
  parts.push('</item>');

  return parts.join('');
}

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient();

  // 1. Fetch all active and unarchived products
  const { data: productRows, error: productsError } = await supabase
    .from('products')
    .select(
      'id, slug, name, description, price_paise, sale_price_paise, images, sizes, category, is_active, updated_at',
    )
    .eq('is_active', true)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (productsError) {
    console.error('[GOOGLE_MERCHANT_FEED_ERROR]', productsError);
    return new Response('Feed error', { status: 500 });
  }

  const products = (productRows ?? []) as FeedRow[];
  const productIds = products.map((p) => p.id);

  // 2. Fetch live inventory levels per product and size variant
  const stockByProductSize = new Map<string, number>();
  const totalStockByProduct = new Map<string, number>();

  if (productIds.length > 0) {
    const { data: invRows } = await supabase
      .from('inventory')
      .select('product_id, size, stock')
      .in('product_id', productIds);

    for (const row of (invRows ?? []) as InventoryRow[]) {
      const stock = typeof row.stock === 'number' ? row.stock : 0;
      const key = `${row.product_id}:::${(row.size || '').trim().toUpperCase()}`;
      stockByProductSize.set(key, stock);

      totalStockByProduct.set(
        row.product_id,
        (totalStockByProduct.get(row.product_id) ?? 0) + stock,
      );
    }
  }

  // 3. Build XML Feed Items
  const itemsXml: string[] = [];

  for (const product of products) {
    const images = normaliseImages(product.images);
    const color = extractColor(product.name, product.description, product.category);
    const description =
      stripHtml(product.description) ||
      `${product.name} — ${BRAND.description}`;

    const sizes = Array.isArray(product.sizes)
      ? product.sizes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];

    if (sizes.length > 0) {
      // Export each size variant with g:item_group_id, g:size, g:color, g:availability, and g:price
      for (const size of sizes) {
        const sizeKey = `${product.id}:::${size.trim().toUpperCase()}`;
        const variantStock = stockByProductSize.get(sizeKey) ?? 0;
        itemsXml.push(
          buildVariantItem(product, size, variantStock, images, color, description),
        );
      }
    } else {
      // Fallback single item for products without sizes
      const totalStock = totalStockByProduct.get(product.id) ?? 0;
      itemsXml.push(
        buildSingleItem(product, totalStock, images, color, description),
      );
    }
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">' +
    '<channel>' +
    `<title>${cdata(BRAND.name)}</title>` +
    `<link>${xmlEscape(SITE_URL)}</link>` +
    `<description>${cdata(BRAND.description)}</description>` +
    itemsXml.join('') +
    '</channel>' +
    '</rss>';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      'CDN-Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      'Vary': 'Accept-Encoding',
    },
  });
}
