import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

/**
 * POST /api/checkout/abandon
 *
 * Captures draft cart & contact details into `abandoned_checkouts` when a
 * shopper enters their phone/email on /checkout without completing payment.
 * Safe to call repeatedly per session (upserts on `session_key`).
 */
export async function POST(req: NextRequest) {
  if (!FEATURE_FLAGS.ABANDONED_CAPTURE) {
    return apiSuccess({ captured: false, reason: 'feature_disabled' });
  }

  try {
    const body = await req.json().catch(() => null);
    const sessionKey = typeof body?.session_key === 'string' ? body.session_key.trim() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
    const customerName = typeof body?.customer_name === 'string' ? body.customer_name.trim() : null;
    const items = Array.isArray(body?.items) ? body.items : [];
    const subtotalPaise = Number.isFinite(Number(body?.subtotal_paise))
      ? Math.max(0, Math.floor(Number(body.subtotal_paise)))
      : 0;

    if (!sessionKey || (!phone && !email) || items.length === 0) {
      return apiError(400, 'Invalid abandoned checkout payload');
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('abandoned_checkouts')
      .upsert(
        {
          session_key: sessionKey,
          phone: phone || null,
          email: email || null,
          customer_name: customerName || null,
          items,
          subtotal_paise: subtotalPaise,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_key' },
      );

    if (error) {
      // Never break checkout UX if migration 041 hasn't been applied yet
      console.warn('[ABANDON_CAPTURE_WARN]', error.message);
      return apiSuccess({ captured: false });
    }

    return apiSuccess({ captured: true });
  } catch (err) {
    console.warn('[ABANDON_CAPTURE_ERROR]', err);
    return apiSuccess({ captured: false });
  }
}
