import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { evaluateCoupon } from '@/lib/coupons/evaluateCoupon';
import { enforceRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/coupons/validate
 *
 * Server-side coupon evaluation. Optional `subtotalPaise` lets
 * the caller include a min-cart check at preflight time; if
 * omitted, that gate is deferred to /api/orders.
 *
 * Returns:
 *   - 200 success → { code, discount_percent, ...metadata }
 *   - 4xx error   → reason in `error` and (where applicable) the
 *     min_cart_paise threshold so the cart can render
 *     "spend ₹X more to unlock".
 */
export async function POST(req: NextRequest) {
  try {
    // Coupon code validation is the most enumerable surface in the
    // app — without a limit, an attacker can guess codes by brute
    // force. 30/min per IP is generous for real users (a checkout
    // form types one code at a time) and tight for bots.
    const limited = await enforceRateLimit(req, {
      bucket: 'coupons.validate',
      max: 30,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const { code, subtotalPaise } = body as {
      code?: string;
      subtotalPaise?: number;
    };

    if (!code || typeof code !== 'string') {
      return apiError(400, 'Coupon code is required');
    }

    // Identify caller via cookie-bound SSR client (admin client
    // would always be anonymous and reject new_users_only).
    const ssr = await createServerSupabaseClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();

    const admin = createAdminClient();

    const result = await evaluateCoupon(admin, {
      code,
      subtotalPaise:
        typeof subtotalPaise === 'number' && subtotalPaise >= 0
          ? subtotalPaise
          : null,
      userId: user?.id ?? null,
    });

    if (!result.ok) {
      return apiError(
        result.reason === 'not_found' || result.reason === 'inactive'
          ? 404
          : result.reason === 'new_users_only_guest' || result.reason === 'auth_required'
            ? 401
            : 403,
        result.message,
        result.minCartPaise !== undefined
          ? { minCartPaise: result.minCartPaise }
          : undefined,
      );
    }

    return apiSuccess({
      code: result.coupon.code,
      discount_percent: result.coupon.discount_percent,
      effective_percent: result.effectivePercent,
      discount_paise: result.discountPaise,
      new_users_only: !!result.coupon.new_users_only,
      min_cart_paise: result.coupon.min_cart_paise ?? null,
      max_discount_paise: result.coupon.max_discount_paise ?? null,
      expires_at: result.coupon.expires_at ?? null,
    });
  } catch (err) {
    console.error('[COUPON_VALIDATE_ERROR]', err);
    return apiError(500, 'Internal server error');
  }
}
