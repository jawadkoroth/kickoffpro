/**
 * Centralized D2C conversion feature flags.
 *
 * Every NEXT_PUBLIC_ENABLE_* env var is referenced statically so Next.js
 * inlines it cleanly into both server and client bundles.
 *
 * Defaults to `true` unless explicitly set to `'false'` or `'0'`, allowing
 * any individual feature to be toggled off in Vercel / .env without code rollbacks.
 */

function flag(raw: string | undefined, defaultValue = true): boolean {
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  return defaultValue;
}

function nonNegInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export const FEATURE_FLAGS = {
  // Cart Drawer
  CART_PACK_BAR: flag(process.env.NEXT_PUBLIC_ENABLE_CART_PACK_BAR, true),
  CART_UPSELLS: flag(process.env.NEXT_PUBLIC_ENABLE_CART_UPSELLS, true),
  CART_COUPONS: flag(process.env.NEXT_PUBLIC_ENABLE_CART_COUPONS, true),

  // Checkout & RTO Protection
  PREPAID_DISCOUNT: flag(process.env.NEXT_PUBLIC_ENABLE_PREPAID_DISCOUNT, true),
  COD_FEE: flag(process.env.NEXT_PUBLIC_ENABLE_COD_FEE, true),
  PINCODE_ETA: flag(process.env.NEXT_PUBLIC_ENABLE_PINCODE_ETA, true),
  PAYMENT_RECOVERY: flag(process.env.NEXT_PUBLIC_ENABLE_PAYMENT_RECOVERY, true),
  CHECKOUT_TRUST: flag(process.env.NEXT_PUBLIC_ENABLE_CHECKOUT_TRUST, true),

  // Product Detail Page
  FABRIC_SPECS: flag(process.env.NEXT_PUBLIC_ENABLE_FABRIC_SPECS, true),

  // Post-Purchase & Recovery
  POST_PURCHASE_UPSELL: flag(process.env.NEXT_PUBLIC_ENABLE_POST_PURCHASE_UPSELL, true),
  ABANDONED_CAPTURE: flag(process.env.NEXT_PUBLIC_ENABLE_ABANDONED_CAPTURE, true),
} as const;

/** Instant discount in paise for Prepaid / UPI orders (default: ₹50 = 5000 paise) */
export const PREPAID_DISCOUNT_PAISE = nonNegInt(
  process.env.NEXT_PUBLIC_PREPAID_DISCOUNT_PAISE,
  5000,
);
