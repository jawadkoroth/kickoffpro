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

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(
        'id, user_id, order_number, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, coupon_code, payment_method, payment_status, order_status, customer, shipping_address, tracking_id, tracking_url, shipping_provider, shipment_status, tracking_events, last_tracking_sync_at, estimated_delivery_date, delivered_at, created_at, updated_at, retry_count, tracking_event_id, cancel_reason, cancelled_by, return_type, return_reason, return_notes, return_items, estimated_refund_paise, return_status, return_requested_at, rto_at, rto_reason',
      )
      .eq('id', id)
      .single();

    if (error || !order) {
      return apiError(404, 'Order not found');
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let authorized = false;

    if (user && order.user_id === user.id) {
      authorized = true;
    } else {
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

    const { data: itemRows } = await supabaseAdmin
      .from('order_items')
      .select('id, product_id, product_name, size, quantity, unit_price_paise, subtotal_paise, image_url')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    const rawItems = (itemRows ?? []) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      size: string;
      quantity: number;
      unit_price_paise: number;
      subtotal_paise: number;
      image_url: string | null;
    }>;

    const productIds = Array.from(new Set(rawItems.map((r) => r.product_id).filter(Boolean)));
    const sizeMap = new Map<string, string[]>();
    if (productIds.length > 0) {
      const { data: prods } = await supabaseAdmin
        .from('products')
        .select('id, sizes, inventory')
        .in('id', productIds);
      for (const p of prods ?? []) {
        const row = p as {
          id: string;
          sizes?: string[] | null;
          inventory?: Array<{ size: string; stock: number }> | null;
        };
        const available =
          row.inventory && row.inventory.length > 0
            ? row.inventory.filter((inv) => inv.stock > 0).map((inv) => inv.size)
            : row.sizes && row.sizes.length > 0
              ? row.sizes
              : ['S', 'M', 'L', 'XL', 'XXL'];
        sizeMap.set(row.id, available.length > 0 ? available : ['S', 'M', 'L', 'XL', 'XXL']);
      }
    }

    const items = rawItems.map((it) => ({
      ...it,
      available_sizes: sizeMap.get(it.product_id) ?? ['S', 'M', 'L', 'XL', 'XXL'],
    }));
    const head = items[0];

    return apiSuccess({
      order: {
        ...order,
        items,
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
