/**
 * Normalizes a slug to be URL-safe and consistent.
 *
 * Converts Unicode dashes (en-dash, em-dash, horizontal bar, minus, etc.)
 * to a standard ASCII hyphen-minus (-), trims spaces, converts to lowercase,
 * replaces non-alphanumeric/non-hyphen characters with hyphens, collapses
 * multiple consecutive hyphens, and removes leading/trailing hyphens.
 */
export function normalizeSlug(slug: string): string {
  if (typeof slug !== 'string') return '';
  return slug
    .trim()
    // Convert various Unicode dashes/minus/hyphens to standard hyphen-minus (-)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    // Convert to lowercase
    .toLowerCase()
    // Replace non-alphanumeric/non-hyphen characters with hyphens
    .replace(/[^a-z0-9-]+/g, '-')
    // Replace multiple consecutive hyphens with a single hyphen
    .replace(/-+/g, '-')
    // Remove leading and trailing hyphens
    .replace(/(^-|-$)/g, '');
}

/**
 * Ensures a slug is unique in the products database by appending a counter suffix
 * if a collision is found.
 */
export async function getUniqueSlug(
  baseSlug: string,
  productId: string | null,
  supabase: any
): Promise<string> {
  const normalizedBase = normalizeSlug(baseSlug);
  let slug = normalizedBase || 'product';
  let counter = 1;

  while (true) {
    let query = supabase
      .from('products')
      .select('id')
      .eq('slug', slug);

    if (productId) {
      query = query.neq('id', productId);
    }

    const { data, error } = await query.maybeSingle();

    // If no colliding record is found, the current slug is unique.
    if (!data && !error) {
      return slug;
    }

    counter++;
    slug = `${normalizedBase || 'product'}-${counter}`;
  }
}
