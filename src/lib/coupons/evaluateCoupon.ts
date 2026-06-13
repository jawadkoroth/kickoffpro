import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * KickoffPro — server-authoritative coupon evaluation.
 *
 * Single source of truth used by:
 *   - /api/coupons/validate  (preflight: tells the cart UI whether
 *                             the code is currently usable, without
 *                             knowing the cart subtotal yet)
 *   - /api/orders            (final: re-runs the full check against
 *                             the actual subtotal at order time)
 *
 * Rejection reasons are stable strings so callers can render
 * branded copy without parsing free-form messages.
 */

export type CouponRejectReason =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'min_cart'
  | 'new_users_only_guest'
  | 'new_users_only_repeat'
  | 'per_user_limit'
  | 'usage_limit'
  | 'auth_required';

export interface CouponRow {
  id: string;
  code: string;
  discount_percent: number;
  is_active: boolean;
  new_users_only?: boolean | null;
  min_cart_paise?: number | null;
  max_discount_paise?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
  per_user_limit?: number | null;
  usage_limit?: number | null;
}

export interface EvaluateInput {
  code: string;
  /**
   * Post-sale-price, pre-discount subtotal in paise. Pass `null`
   * during preflight (validate route) when the cart hasn't been
   * priced yet — `min_cart_paise` is then deferred to order time.
   */
  subtotalPaise: number | null;
  /** Authenticated user id, or null for guest. */
  userId: string | null;
  /** Reference time, defaults to now(). */
  now?: Date;
}

export interface EvaluateOk {
  ok: true;
  coupon: CouponRow;
  /** Effective discount in paise (capped by max_discount_paise). */
  discountPaise: number;
  /** Effective discount percent applied to the subtotal. */
  effectivePercent: number;
}

export interface EvaluateRejected {
  ok: false;
  reason: CouponRejectReason;
  message: string;
  /**
   * `min_cart` rejection includes the threshold so the UI can
   * render "spend ₹X more to unlock".
   */
  minCartPaise?: number;
}

const REJECT_COPY: Record<CouponRejectReason, string> = {
  not_found: 'Invalid or expired coupon code',
  inactive: 'Invalid or expired coupon code',
  not_started: 'This coupon is not active yet.',
  expired: 'This coupon has expired.',
  min_cart: 'Add more to your cart to use this coupon.',
  new_users_only_guest:
    'This coupon is only valid for new accounts. Please sign in to apply it.',
  new_users_only_repeat: 'This coupon is only valid on your first order.',
  per_user_limit: 'You have already used this coupon the maximum number of times.',
  usage_limit: 'This coupon has reached its usage limit.',
  auth_required: 'Please sign in to use this coupon.',
};

function reject(reason: CouponRejectReason, extra: Partial<EvaluateRejected> = {}): EvaluateRejected {
  return { ok: false, reason, message: REJECT_COPY[reason], ...extra };
}

/**
 * Run every gate against a coupon row. The DB load is the
 * caller's responsibility so we can mock easily in tests and so
 * the SQL stays close to the route that needs it.
 */
export async function evaluateCoupon(
  supabase: SupabaseClient,
  input: EvaluateInput,
): Promise<EvaluateOk | EvaluateRejected> {
  const code = input.code.toUpperCase().trim();
  if (!code) return reject('not_found');

  const now = input.now ?? new Date();

  const { data, error } = await supabase
    .from('coupons')
    .select(
      'id, code, discount_percent, is_active, new_users_only, min_cart_paise, max_discount_paise, starts_at, expires_at, per_user_limit, usage_limit',
    )
    .eq('code', code)
    .maybeSingle();

  if (error) {
    console.error('[COUPON_EVAL_LOAD]', error);
    return reject('not_found');
  }
  if (!data) return reject('not_found');

  const coupon = data as CouponRow;

  if (!coupon.is_active) return reject('inactive');

  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return reject('not_started');
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return reject('expired');
  }

  // min_cart: only enforce when we know the subtotal. Validate
  // route may pass null at preflight time.
  if (
    coupon.min_cart_paise &&
    coupon.min_cart_paise > 0 &&
    input.subtotalPaise !== null &&
    input.subtotalPaise < coupon.min_cart_paise
  ) {
    return reject('min_cart', { minCartPaise: coupon.min_cart_paise });
  }

  // new_users_only: a user_id with any non-cancelled order
  // counts as a returning customer.
  if (coupon.new_users_only) {
    if (!input.userId) return reject('new_users_only_guest');
    const { count: priorOrders, error: priorErr } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .neq('order_status', 'cancelled');
    if (priorErr) {
      console.error('[COUPON_EVAL_PRIOR]', priorErr);
      // Fail closed for new_users_only — cheaper than letting an
      // ineligible user slip through silently.
      return reject('new_users_only_repeat');
    }
    if ((priorOrders ?? 0) > 0) return reject('new_users_only_repeat');
  }

  // per_user_limit: count this user's prior non-cancelled orders
  // that already used this coupon code.
  if (coupon.per_user_limit && coupon.per_user_limit > 0) {
    if (!input.userId) return reject('auth_required');
    
    const { count: usedByUser, error: puErr } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .eq('coupon_code', coupon.code)
      .neq('order_status', 'cancelled');
    if (puErr) {
      console.error('[COUPON_EVAL_PER_USER]', puErr);
      return reject('per_user_limit');
    }
    if ((usedByUser ?? 0) >= coupon.per_user_limit) return reject('per_user_limit');
  }

  // usage_limit: global cap.
  if (coupon.usage_limit && coupon.usage_limit > 0) {
    const { count: globalUsed, error: gErr } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_code', coupon.code)
      .neq('order_status', 'cancelled');
    if (gErr) {
      console.error('[COUPON_EVAL_GLOBAL]', gErr);
      return reject('usage_limit');
    }
    if ((globalUsed ?? 0) >= coupon.usage_limit) return reject('usage_limit');
  }

  // Compute effective discount. We only apply the cap when we
  // actually have a subtotal to project against.
  let discountPaise = 0;
  let effectivePercent = coupon.discount_percent;
  if (input.subtotalPaise !== null) {
    discountPaise = Math.round(
      (input.subtotalPaise * coupon.discount_percent) / 100,
    );
    if (
      coupon.max_discount_paise &&
      coupon.max_discount_paise > 0 &&
      discountPaise > coupon.max_discount_paise
    ) {
      discountPaise = coupon.max_discount_paise;
      // Recompute the effective percent so callers can display a
      // honest "you saved X% (capped)" line if they want.
      effectivePercent =
        input.subtotalPaise > 0
          ? Math.round((discountPaise / input.subtotalPaise) * 100)
          : 0;
    }
  }

  return { ok: true, coupon, discountPaise, effectivePercent };
}
