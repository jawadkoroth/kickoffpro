/**
 * KickoffPro — server-authoritative shipping + COD pricing.
 *
 * Pure, deterministic function: given a subtotal, payment method,
 * and the current shipping settings, return the shipping charge,
 * COD fee, and all-inclusive total. This is the single source of
 * truth consumed by:
 *
 *   - `/api/shipping/quote` (checkout UI estimate)
 *   - `/api/orders` (final amount persisted to DB and charged)
 *
 * No network, no DB, no client state. Callers pass an already-
 * loaded `shippingSettings` row.
 */

import { FEATURE_FLAGS, PREPAID_DISCOUNT_PAISE } from '@/lib/featureFlags';

export type PaymentMethod = 'cod' | 'online';

export interface ShippingSettingsInput {
  free_shipping_threshold_paise?: number | null;
  default_shipping_charge_paise?: number | null;
  cod_enabled?: boolean | null;
  cod_fee_paise?: number | null;
}

export interface CalcShippingInput {
  subtotalPaise: number;
  paymentMethod: PaymentMethod;
  shippingSettings: ShippingSettingsInput | null | undefined;
}

export interface CalcShippingResult {
  shippingPaise: number;
  codFeePaise: number;
  prepaidDiscountPaise: number;
  totalPaise: number;
  /**
   * True unless COD was requested but `cod_enabled` is false in
   * settings. Callers surface this as a validation error; the
   * quote still returns a sensible online-flow total for display.
   */
  codAllowed: boolean;
}

function toNonNegInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Compute shipping + COD fee + total.
 *
 * Rules (spec-locked):
 *   - subtotal ≥ free_shipping_threshold  → shipping = 0
 *   - otherwise                           → shipping = default_shipping_charge
 *   - payment_method = 'cod' AND cod_enabled → add cod_fee
 *   - payment_method = 'cod' AND NOT cod_enabled → codAllowed = false,
 *     but we still compute a sane total (shipping only) so the UI
 *     can flip to online without showing NaN.
 *   - total = subtotal + shipping + cod_fee
 *
 * Any missing or malformed field is coerced to 0 / safe default.
 */
export function calcShipping({
  subtotalPaise,
  paymentMethod,
  shippingSettings,
}: CalcShippingInput): CalcShippingResult {
  const subtotal = toNonNegInt(subtotalPaise);

  const settings = shippingSettings ?? {};
  const threshold = toNonNegInt(settings.free_shipping_threshold_paise);
  const defaultCharge = toNonNegInt(settings.default_shipping_charge_paise);
  const codEnabled = settings.cod_enabled !== false; // default true
  const codFee = toNonNegInt(settings.cod_fee_paise);

  // Threshold of 0 means "never free" — we require strict >= comparison
  // with a positive threshold, otherwise shipping always applies.
  const qualifiesForFreeShipping = threshold > 0 && subtotal >= threshold;
  const shippingPaise = qualifiesForFreeShipping ? 0 : defaultCharge;

  const isCod = paymentMethod === 'cod';
  const codAllowed = !isCod || codEnabled;
  const codFeePaise = isCod && codEnabled && FEATURE_FLAGS.COD_FEE ? codFee : 0;

  const grossBeforePrepaid = subtotal + shippingPaise + codFeePaise;

  // Safeguard #4: Clamp prepaid discount so final total never goes negative
  // and stays >= 100 paise (Razorpay ₹1 minimum) whenever subtotal > 0.
  let prepaidDiscountPaise = 0;
  if (!isCod && FEATURE_FLAGS.PREPAID_DISCOUNT && PREPAID_DISCOUNT_PAISE > 0 && grossBeforePrepaid > 100) {
    prepaidDiscountPaise = Math.min(PREPAID_DISCOUNT_PAISE, grossBeforePrepaid - 100);
  }

  const totalPaise = Math.max(0, grossBeforePrepaid - prepaidDiscountPaise);

  return {
    shippingPaise,
    codFeePaise,
    prepaidDiscountPaise,
    totalPaise,
    codAllowed,
  };
}
