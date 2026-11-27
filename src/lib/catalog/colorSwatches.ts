/**
 * Shared helpers for product colorway grouping & dual-tone swatches.
 */

export interface ColorSwatchItem {
  id: string;
  slug: string;
  name: string;
  color_name: string | null;
  color_hex: string | null;
  color_secondary_hex: string | null;
  primary_image?: string | null;
  in_stock: boolean;
}

export interface CompactColorDot {
  slug: string;
  color_name: string | null;
  color_hex: string;
  color_secondary_hex: string | null;
  in_stock?: boolean;
}

/**
 * Normalizes a human model/style name into a canonical slug key
 * (e.g. "Classic Ringer Tee  240 GSM" -> "classic-ringer-tee-240-gsm").
 */
export function normalizeStyleGroup(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validates and normalizes `#RRGGBB` hex colors, returning null if empty/invalid.
 */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9A-F]{6}$/.test(s)) return s;
  if (/^#[0-9A-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return null;
}

/**
 * Returns the CSS background for solid or dual-tone/ringer diagonal gradient swatches.
 */
export function getSwatchBackground(
  primaryHex: string | null | undefined,
  secondaryHex?: string | null,
): string {
  const p = normalizeHexColor(primaryHex) ?? '#111827';
  const s = normalizeHexColor(secondaryHex);
  if (s && s !== p) {
    return `linear-gradient(135deg, ${p} 25%, ${s} 75%)`;
  }
  return p;
}

/**
 * Groups active catalog rows by `style_group` to attach compact mini color dots
 * to every product belonging to a multi-color style group.
 */
export function buildStyleGroupDotMap(
  rows: Array<{
    slug: string;
    style_group?: string | null;
    color_name?: string | null;
    color_hex?: string | null;
    color_secondary_hex?: string | null;
    in_stock?: boolean;
  }>,
): Map<string, CompactColorDot[]> {
  const byGroup = new Map<string, CompactColorDot[]>();

  for (const row of rows) {
    const group = row.style_group?.trim();
    const hex = normalizeHexColor(row.color_hex);
    if (!group || !hex) continue;
    const list = byGroup.get(group) ?? [];
    list.push({
      slug: row.slug,
      color_name: row.color_name ?? null,
      color_hex: hex,
      color_secondary_hex: normalizeHexColor(row.color_secondary_hex),
      in_stock: row.in_stock ?? true,
    });
    byGroup.set(group, list);
  }

  // Only keep style groups that have 2+ colorways
  for (const [group, list] of byGroup.entries()) {
    if (list.length < 2) {
      byGroup.delete(group);
    }
  }
  return byGroup;
}
