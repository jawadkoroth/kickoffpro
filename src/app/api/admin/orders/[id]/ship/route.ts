import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { logEvent } from '@/lib/log';
import { createShipmentForOrder } from '@/lib/shipping';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Verify admin
    const serverSupabase = await createServerSupabaseClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return apiError(401, 'Unauthorized');

    const supabase = createAdminClient();

    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .single();
    if (!adminUser) return apiError(401, 'Not admin');

    // 2. Get order
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (!order) return apiError(404, 'Order not found');
    if (order.order_status !== 'confirmed') return apiError(400, 'Order must be confirmed first');
    if (order.tracking_id) return apiError(400, 'Shipment already created');

    // 3. Get product info or line items
    let productName = 'Product';
    let totalWeightGrams = 500; // default safe fallback weight

    const { data: pricingRules } = await supabase
      .from('shipping_pricing_rules')
      .select('default_weight_grams')
      .limit(1)
      .maybeSingle();
    const defaultWeight = pricingRules?.default_weight_grams ?? 500;

    if (order.product_id) {
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', order.product_id)
        .single();
      productName = product?.name || 'Product';
      const itemWeight = (product && 'weight_grams' in product && typeof product.weight_grams === 'number')
        ? product.weight_grams
        : defaultWeight;
      totalWeightGrams = itemWeight * order.quantity;
    } else {
      // Load from order_items for multi-line order
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, product_name, quantity, size')
        .eq('order_id', id);
      
      if (items && items.length > 0) {
        // Build name: "Item A (M) x2, Item B (L) x1"
        productName = items
          .map((it: any) => `${it.product_name} (${it.size}) x${it.quantity}`)
          .join(', ')
          .substring(0, 80); // Cap description length for shipping APIs
        
        // Load all products to get their weight_grams
        const productIds = items.map((it: any) => it.product_id).filter(Boolean);
        const { data: products } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        
        const productMap = new Map((products ?? []).map((p: any) => [p.id, p]));
        
        totalWeightGrams = items.reduce((sum: number, it: any) => {
          const prod = productMap.get(it.product_id);
          const itemWeight = (prod && 'weight_grams' in prod && typeof prod.weight_grams === 'number')
            ? prod.weight_grams
            : defaultWeight;
          return sum + (itemWeight * (it.quantity ?? 1));
        }, 0);
      }
    }

    const shipmentReq = {
      order_number: order.order_number,
      customer: order.customer,
      address: order.shipping_address,
      product: {
        name: productName,
        quantity: order.quantity,
        weight_grams: totalWeightGrams,
      },
      payment: {
        method: (order.payment_method === 'cod' ? 'cod' : 'prepaid') as 'cod' | 'prepaid',
        cod_amount_paise: order.payment_method === 'cod' ? order.total_paise : undefined,
      },
    };

    // 4a. NEW PIPE (feature-flag gated, off by default in production)
    const newPipeResult = await createShipmentForOrder({
      clientRequestId: id,
      orderId: id,
      orderNumber: order.order_number,
      attemptNumber: 1,
      req: shipmentReq,
    }).catch((err: unknown) => {
      logEvent('shipping.ship_route.new_pipe_error', {
        order_id: id,
        order_number: order.order_number,
        error: err instanceof Error ? err.message : String(err),
      }, { source: 'api', severity: 'error' });
      return null;
    });

    if (newPipeResult !== null) {
      if (!newPipeResult.providerResponse.success) {
        return apiError(500, newPipeResult.providerResponse.error || 'Shipment creation failed');
      }
      await supabase
        .from('orders')
        .update({
          order_status: 'shipped',
          tracking_id: newPipeResult.trackingId ?? null,
          label_url: newPipeResult.labelUrl ?? null,
          label_url_original: newPipeResult.labelUrl ?? null,
        })
        .eq('id', id);

      return apiSuccess({
        tracking_id: newPipeResult.trackingId,
        label_url: newPipeResult.labelUrl,
      });
    }

    // 4b. LEGACY PATH — unchanged, runs when flag is off
    const { data: settings } = await supabase
      .from('shipping_settings')
      .select('*')
      .single();

    if (!settings) return apiError(500, 'Shipping settings not configured');

    const { DelhiveryProvider } = await import('@/lib/shipping/delhivery');
    const legacyConfig = {
      id: '',
      name: settings.provider_name ?? 'delhivery',
      environment: 'sandbox' as const,
      api_url: settings.api_url,
      api_key: settings.api_key,
      api_secret: null,
      webhook_secret: null,
      token: null,
      token_expires_at: null,
      auth_email: null,
      auth_password_encrypted: null,
      pickup_name: settings.pickup_name,
      pickup_phone: settings.pickup_phone,
      pickup_gstin: null,
      pickup_line1: settings.pickup_address_line1,
      pickup_line2: settings.pickup_address_line2,
      pickup_city: settings.pickup_city,
      pickup_state: settings.pickup_state,
      pickup_pincode: settings.pickup_pincode,
      features_cod: settings.cod_enabled ?? true,
      features_reverse: false,
      features_insurance: false,
    };
    const provider = new DelhiveryProvider(legacyConfig);
    const result = await provider.createShipment(shipmentReq);

    if (!result.success) {
      logEvent('shipping.ship_route.legacy_failed', {
        order_id: id,
        order_number: order.order_number,
        error: result.error,
      }, { source: 'api', severity: 'error' });
      return apiError(500, result.error || 'Shipment creation failed');
    }

    await supabase
      .from('orders')
      .update({
        tracking_id: result.tracking_id,
        label_url: result.label_url,
        label_url_original: result.label_url,
        shipping_provider: settings.provider_name ?? 'delhivery',
        order_status: 'shipped',
      })
      .eq('id', id);

    logEvent('shipping.ship_route.legacy_success', {
      order_id: id,
      order_number: order.order_number,
      tracking_id: result.tracking_id,
    }, { source: 'api' });

    return apiSuccess({
      tracking_id: result.tracking_id,
      label_url: result.label_url,
    });
  } catch (err) {
    logEvent('shipping.ship_route.unhandled_error', {
      order_id: 'unknown',
      error: err instanceof Error ? err.message : String(err),
    }, { source: 'api', severity: 'error' });
    return apiError(500, 'Internal server error');
  }
}
