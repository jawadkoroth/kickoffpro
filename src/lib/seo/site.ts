/**
 * NOIR — central site configuration for SEO / metadata / JSON-LD.
 *
 * Every value that might change per-environment (production domain,
 * social handles, legal entity) is env-driven so brand lock-in can
 * happen without code changes.
 *
 * Read this module from server components and route handlers only.
 * It intentionally exposes nothing sensitive, so importing from a
 * client component would work — but as a matter of hygiene keep
 * SEO concerns on the server.
 */

const DEFAULT_URL = 'https://kickoffpro.vercel.app';

function normaliseUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_URL;
  try {
    const u = new URL(raw);
    // Drop trailing slash so path concatenation is predictable.
    return `${u.protocol}//${u.host}`;
  } catch {
    return DEFAULT_URL;
  }
}

/**
 * Production origin (scheme + host, no trailing slash). Consumed by
 * `metadataBase`, sitemap, robots, canonical URLs, OG image URLs,
 * and the Merchant Center feed.
 */
export const SITE_URL = normaliseUrl(
  process.env.NEXT_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL,
);

/**
 * Brand identity strings. Kept centrally so tone adjustments don't
 * require a scavenger hunt.
 *
 * Guidance from the brand brief: no DTC vocabulary, no "shop" CTAs,
 * no keyword stuffing. Every string here lands in SERPs / OG cards /
 * knowledge panels.
 */
export const BRAND = {
  name: 'KickoffPro',
  legalName: process.env.NOIR_LEGAL_NAME || 'KickoffPro',
  /** Appended after page-specific titles. Keep short. */
  titleSuffix: 'KickoffPro',
  /** Fallback description for pages that don't supply their own. */
  description:
    'Affordable Football Jerseys For Every Fan. High quality club, national, and retro jerseys starting at ₹250.',
  /**
   * Country of operation. Used by Merchant Center feed defaults and
   * Organization schema `addressCountry`.
   */
  country: 'IN',
  /** Primary currency — paise prices are rendered in this currency. */
  currency: 'INR',
  /** Primary language of the site. Used in `<html lang>` and metadata. */
  locale: 'en_IN',
} as const;

/**
 * Legal/contact surface for the footer + Organization schema.
 * All values are optional; the footer and schema will degrade
 * gracefully when unset (fields simply omitted from JSON-LD rather
 * than emitting empty strings).
 */
export const CONTACT = {
  email: process.env.NOIR_CONTACT_EMAIL || '',
  addressLine1: process.env.NOIR_ADDRESS_LINE_1 || '',
  addressLine2: process.env.NOIR_ADDRESS_LINE_2 || '',
  locality: process.env.NOIR_ADDRESS_LOCALITY || '',
  region: process.env.NOIR_ADDRESS_REGION || '',
  postalCode: process.env.NOIR_ADDRESS_POSTAL_CODE || '',
  gstin: process.env.NOIR_GSTIN || '',
} as const;

/**
 * Social profiles surfaced via Organization `sameAs`. Populate via
 * env in prod; leave blank in local dev.
 *
 * `sameAs` is a strong signal to Google for knowledge-panel
 * unification. Only add profiles the brand actually controls.
 */
export const SOCIAL = {
  instagram: process.env.NOIR_SOCIAL_INSTAGRAM || '',
  youtube: process.env.NOIR_SOCIAL_YOUTUBE || '',
  twitter: process.env.NOIR_SOCIAL_TWITTER || '',
  pinterest: process.env.NOIR_SOCIAL_PINTEREST || '',
} as const;

/**
 * Build a fully-qualified URL from a path. Always prefer this over
 * string concatenation so the trailing-slash policy stays consistent.
 */
export function absoluteUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${suffix}`;
}

/**
 * Canonical URL helper. Strips query and hash — filtered/sorted
 * variants of a listing page must always canonical back to the base.
 */
export function canonicalUrl(path: string): string {
  const absolute = absoluteUrl(path);
  try {
    const u = new URL(absolute);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '') || SITE_URL;
  } catch {
    return absolute;
  }
}

/**
 * Collect every non-empty `sameAs` URL into an array, dropping
 * blanks. JSON-LD consumers tolerate missing `sameAs`; they do not
 * tolerate `sameAs: ['', '', '']`.
 */
export function sameAsProfiles(): string[] {
  return Object.values(SOCIAL).filter((u): u is string => Boolean(u));
}
