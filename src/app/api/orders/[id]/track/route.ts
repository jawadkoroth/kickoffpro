import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabaseAdmin = createAdminClient();

    // Fetch the order using admin client to get user_id and customer info for auth checks
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, user_id, order_number, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, payment_method, payment_status, order_status, customer, shipping_address, tracking_id, shipping_provider, created_at, updated_at, retry_count')
      .eq('id', id)
      .single();

    if (error || !order) {
      return apiError(404, 'Order not found');
    }

    // Retrieve current authenticated user session
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let authorized = false;

    // 1. If authenticated, verify order.user_id matches authenticated user
    if (user && order.user_id === user.id) {
      authorized = true;
    } else {
      // 2. Otherwise (guest order or different/no authenticated user), require secondary verification (email or phone)
      const searchParams = req.nextUrl.searchParams;
      const queryEmail = searchParams.get('email')?.trim().toLowerCase();
      const queryPhone = searchParams.get('phone')?.trim();

      const customerObj = order.customer as Record<string, unknown> | null;
      const orderEmail = (customerObj?.email as string | undefined)?.trim().toLowerCase();
      const orderPhone = (customerObj?.phone as string | undefined)?.trim();

      if (queryEmail && orderEmail && queryEmail === orderEmail) {
        authorized = true;
      } else if (queryPhone && orderPhone) {
        const normQuery = queryPhone.replace(/\D/g, '');
        const normOrder = orderPhone.replace(/\D/g, '');
        // Match if one phone number is at least 10 digits and ends with the other, or if they match exactly
        if (
          normQuery === normOrder ||
          (normQuery.length >= 10 && normOrder.endsWith(normQuery)) ||
          (normOrder.length >= 10 && normQuery.endsWith(normOrder))
        ) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return apiError(403, 'Forbidden');
    }

    // Multi-line aware (since phase B1). Every order has at least one
    // order_items row courtesy of the migration backfill, so a single
    // query covers both legacy single-line and new multi-line orders.
    const { data: itemRows } = await supabaseAdmin
      .from('order_items')
      .select('product_id, product_name, size, quantity, unit_price_paise, subtotal_paise, image_url')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    const items = itemRows ?? [];
    const head = items[0];

    return apiSuccess({
      order: {
        ...order,
        items,
        // Legacy display fallbacks — the existing /order/[id] UI
        // reads these for the (single-line) hero row. Multi-line
        // orders override that in the page using `items` directly.
        product_name: head?.product_name ?? '',
        size: head?.size ?? '',
        quantity: head?.quantity ?? 1,
      },
    });
  } catch (err) {
    console.error('[ORDER_TRACK_ERROR]', err);
    return apiError(500, 'Internal server error');
  }
}

