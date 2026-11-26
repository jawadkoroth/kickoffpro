import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface AuthorizableOrder {
  user_id?: string | null;
  customer?: { email?: string; phone?: string } | null;
}

/**
 * Verifies that the caller owns the order either via authenticated Supabase
 * `user_id` match or via matching email/phone (for guest receipt `/order/[id]` flows).
 */
export async function authorizeCustomerOrder(
  req: NextRequest,
  order: AuthorizableOrder,
  body?: { email?: unknown; phone?: unknown } | null,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && order.user_id && order.user_id === user.id) {
    return true;
  }

  const sp = req.nextUrl.searchParams;
  const rawEmail =
    (typeof body?.email === 'string' ? body.email : '') ||
    sp.get('email') ||
    '';
  const rawPhone =
    (typeof body?.phone === 'string' ? body.phone : '') ||
    sp.get('phone') ||
    '';

  const queryEmail = rawEmail.trim().toLowerCase();
  const orderEmail = (order.customer?.email || '').trim().toLowerCase();
  if (queryEmail && orderEmail && queryEmail === orderEmail) {
    return true;
  }

  const orderPhone = (order.customer?.phone || '').trim();
  if (rawPhone.trim() && orderPhone) {
    const normQuery = rawPhone.replace(/\D/g, '');
    const normOrder = orderPhone.replace(/\D/g, '');
    if (
      normQuery === normOrder ||
      (normQuery.length >= 10 && normOrder.endsWith(normQuery)) ||
      (normOrder.length >= 10 && normQuery.endsWith(normOrder))
    ) {
      return true;
    }
  }

  return false;
}
