/**
 * Centralized D2C Apparel Catalog Taxonomy.
 *
 * Designed for daily-wear Indian D2C essentials:
 *   Top-level Category -> Product-level Varieties -> Recommended Size Presets
 *
 * Single source of truth consumed by:
 *   - /admin/products/new & /admin/products/[id]/edit
 *   - /products collection filters & SEO metadata
 *   - Storefront Navbar & Footer navigation
 *   - Google Merchant XML feed
 */

export interface CategoryDefinition {
  id: string;
  slug: string;
  label: string;
  varieties: string[];
  defaultSizes: string[];
  allSizes: string[];
  googleProductCategory: string;
}

export const APPAREL_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'T-Shirts',
    slug: 't-shirts',
    label: 'T-Shirts',
    varieties: [
      'Half Sleeve',
      'Full Sleeve',
      'Oversize',
      'Muscle Fit',
      'Drop Shoulder',
      'Polo',
      'Henley',
      'Sleeveless',
    ],
    defaultSizes: ['S', 'M', 'L', 'XL'],
    allSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Shirts & Tops > T-Shirts',
  },
  {
    id: 'Track Pants',
    slug: 'track-pants',
    label: 'Track Pants',
    varieties: [
      'Straight Fit',
      'Cuffed Jogger',
      'Relaxed Wide',
      'Cargo Track',
      'Slim Tapered',
    ],
    defaultSizes: ['S', 'M', 'L', 'XL'],
    allSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Pants > Sweatpants & Joggers',
  },
  {
    id: 'Shorts',
    slug: 'shorts',
    label: 'Shorts',
    varieties: [
      '5" Active',
      '7" Everyday',
      'French Terry',
      'Cargo Short',
      'Chino Short',
    ],
    defaultSizes: ['S', 'M', 'L', 'XL'],
    allSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Shorts',
  },
  {
    id: 'Jeans',
    slug: 'jeans',
    label: 'Jeans',
    varieties: [
      'Slim Tapered',
      'Straight Fit',
      'Relaxed Fit',
      'Baggy Denim',
      'Skinny Stretch',
    ],
    defaultSizes: ['28', '30', '32', '34'],
    allSizes: ['28', '30', '32', '34', '36', '38', 'S', 'M', 'L', 'XL'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Pants > Jeans',
  },
  {
    id: 'Shirts',
    slug: 'shirts',
    label: 'Shirts',
    varieties: [
      'Oxford Casual',
      'Linen Breeze',
      'Half Sleeve Camp',
      'Overshirt',
      'Solid Formal',
    ],
    defaultSizes: ['S', 'M', 'L', 'XL'],
    allSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Shirts & Tops',
  },
  {
    id: 'Co-ords & Packs',
    slug: 'packs',
    label: 'Co-ords & Packs',
    varieties: [
      '2-Pack Essential Tees',
      '3-Pack Essential Tees',
      'Tee + Track Combo',
      'Tee + Shorts Set',
    ],
    defaultSizes: ['S', 'M', 'L', 'XL'],
    allSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    googleProductCategory: 'Apparel & Accessories > Clothing > Outfits',
  },
];

export const DEFAULT_CATEGORY_ID = 'T-Shirts';

export function getCategoryDef(input: string | null | undefined): CategoryDefinition | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  return APPAREL_CATEGORIES.find(
    (c) =>
      c.id.toLowerCase() === normalized ||
      c.slug.toLowerCase() === normalized ||
      c.label.toLowerCase() === normalized,
  );
}

export function resolveCategoryLabel(input: string | null | undefined): string {
  const def = getCategoryDef(input);
  if (def) return def.label;
  if (!input || !input.trim()) return DEFAULT_CATEGORY_ID;
  return input.trim();
}

export function getVarietiesForCategory(category: string | null | undefined): string[] {
  return getCategoryDef(category)?.varieties ?? APPAREL_CATEGORIES[0].varieties;
}

export function getSizesForCategory(category: string | null | undefined): string[] {
  return getCategoryDef(category)?.allSizes ?? ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
}

export function normalizeVideoList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      urls.push(item.trim());
    } else if (
      item &&
      typeof item === 'object' &&
      typeof (item as { url?: unknown }).url === 'string' &&
      (item as { url: string }).url.trim()
    ) {
      urls.push((item as { url: string }).url.trim());
    }
  }
  return urls;
}
