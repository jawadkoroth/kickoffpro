/**
 * KickoffPro — JSON-LD structured-data builders.
 *
 * Every builder returns a plain object literal that serialises
 * cleanly to the `application/ld+json` payload. Consumers inject
 * the return value via the `<JsonLd>` component.
 *
 * Editorial stance (per the brand brief):
 *   - Use the minimum schema vocabulary that Google actually
 *     rewards. Skip `Review`, `AggregateRating`, and `FAQPage`
 *     until we have genuine content to back them.
 *   - Never emit fields with empty strings — Google treats them
 *     as fabricated data. Prefer omitting the key entirely.
 *   - Use `@id` so entities can reference each other across the
 *     page (Product → Brand → Organization).
 */

import {
  SITE_URL,
  BRAND,
  CONTACT,
  sameAsProfiles,
  canonicalUrl,
  absoluteUrl,
} from './site';

// ---------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------

function nonEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

function postalAddress() {
  const {
    addressLine1,
    addressLine2,
    locality,
    region,
    postalCode,
  } = CONTACT;
  if (!addressLine1 && !locality && !region) return undefined;
  return nonEmpty({
    '@type': 'PostalAddress',
    streetAddress: [addressLine1, addressLine2].filter(Boolean).join(', '),
    addressLocality: locality,
    addressRegion: region,
    postalCode,
    addressCountry: BRAND.country,
  });
}

// ---------------------------------------------------------------
// Organization — belongs on the home page only
// ---------------------------------------------------------------

export function organizationLd() {
  return nonEmpty({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: BRAND.name,
    legalName: BRAND.legalName,
    url: SITE_URL,
    logo: nonEmpty({
      '@type': 'ImageObject',
      '@id': `${SITE_URL}/#logo`,
      url: absoluteUrl('/og/logo.png'),
      caption: BRAND.name,
    }),
    sameAs: sameAsProfiles(),
    address: postalAddress(),
    email: CONTACT.email || undefined,
  });
}

// ---------------------------------------------------------------
// WebSite — enables the SERP sitelinks search box
// ---------------------------------------------------------------

export function webSiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: BRAND.name,
    description: BRAND.description,
    inLanguage: BRAND.locale,
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/products?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// ---------------------------------------------------------------
// Breadcrumb — every non-home page
// ---------------------------------------------------------------

export interface BreadcrumbItem {
  name: string;
  /** Path relative to site root. Always use the canonical variant. */
  path: string;
}

export function breadcrumbLd(trail: BreadcrumbItem[]) {
  if (trail.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

// ---------------------------------------------------------------
// Product — per product page + per Merchant Center entry
// ---------------------------------------------------------------

export interface ProductLdInput {
  name: string;
  slug: string;
  description: string;
  /** Price in rupees (paise ÷ 100). Pass as a string for decimal safety. */
  price: string;
  /** Optional compare-at price (original before sale), rupees. */
  priceCompareAt?: string;
  currency: string;
  images: string[];
  /** "InStock" | "OutOfStock" | "PreOrder" etc (Schema.org ItemAvailability). */
  availability: 'InStock' | 'OutOfStock' | 'PreOrder';
  /** Deep link to the product page. */
  url: string;
  /** Optional stable SKU — Merchant Center requires one of sku/gtin/mpn. */
  sku?: string;
  /** Optional GTIN if the brand uses them. */
  gtin?: string;
  /** Sizes offered — surfaced as variant annotations later; informational now. */
  sizes?: string[];
}

export function productLd(p: ProductLdInput) {
  const offer = nonEmpty({
    '@type': 'Offer',
    url: p.url,
    priceCurrency: p.currency,
    price: p.price,
    availability: `https://schema.org/${p.availability}`,
    itemCondition: 'https://schema.org/NewCondition',
    priceSpecification: p.priceCompareAt
      ? nonEmpty({
          '@type': 'UnitPriceSpecification',
          price: p.price,
          priceCurrency: p.currency,
        })
      : undefined,
    seller: { '@id': `${SITE_URL}/#organization` },
  });

  return nonEmpty({
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${p.url}#product`,
    name: p.name,
    description: p.description,
    image: p.images,
    sku: p.sku,
    gtin: p.gtin,
    brand: {
      '@type': 'Brand',
      name: BRAND.name,
    },
    offers: offer,
  });
}

// ---------------------------------------------------------------
// CollectionPage — /products, future /shop/shirts, etc.
// ---------------------------------------------------------------

export interface CollectionLdInput {
  name: string;
  description: string;
  url: string;
  /** At most ~12 featured items. Schema.org limits aren't strict, but
   *  Google prefers compact payloads. */
  items?: Array<{ name: string; url: string }>;
}

export function collectionLd(c: CollectionLdInput) {
  return nonEmpty({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${c.url}#collection`,
    name: c.name,
    description: c.description,
    url: c.url,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    mainEntity: c.items
      ? {
          '@type': 'ItemList',
          itemListElement: c.items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: item.name,
            url: item.url,
          })),
        }
      : undefined,
  });
}

// ---------------------------------------------------------------
// Article — for /journal/[slug] in Phase 4
// ---------------------------------------------------------------

export interface ArticleLdInput {
  headline: string;
  description: string;
  url: string;
  image: string;
  datePublished: string;
  dateModified?: string;
  authorName?: string;
}

export function articleLd(a: ArticleLdInput) {
  return nonEmpty({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.headline,
    description: a.description,
    image: [a.image],
    datePublished: a.datePublished,
    dateModified: a.dateModified || a.datePublished,
    author: {
      '@type': 'Organization',
      name: a.authorName || BRAND.name,
    },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
  });
}
