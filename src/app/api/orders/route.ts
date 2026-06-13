import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { createOrderSchema } from '@/lib/validators';
import { generateOrderNumber } from '@/lib/order-id';
import { getRazorpay } from '@/lib/razorpay';
import { logEvent } from '@/lib/log';
import { withRequest } from '@/lib/observability/context';
import { calcShipping } from '@/lib/shipping/calcShipping';
import { evaluateCoupon } from '@/lib/coupons/evaluateCoupon';
import { enqueue } from '@/lib/jobs/queue';
import { notifyAdminsBestEffort } from '@/lib/push/webPush';
import { enforceRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/orders
 *
 * Multi-line, idempotent, atomic order creation.
 *
 *  - Body shape (since phase B2): `items: [{ product_id, size, quantity }, ...]`.
 *    A "Buy Now" flow submits an array of length 1; a cart checkout
 *    submits one entry per cart line. The hard line-count cap is
 *    enforced by the schema (20).
 *  - The client supplies `client_request_id` (UUID v4) per submit
 *    attempt. A retry with the same id returns the existing order
 *    instead of creating a duplicate or double-decrementing stock.
 *  - The decrement + insert pair runs inside `create_order_atomic_v2`,
 *    a PL/pgSQL function that holds them in one transaction. Each
 *    line is validated and decremented in turn; if any line is short
 *    on stock the function raises STOCK_UNAVAILABLE and the whole
 *    transaction rolls back automatically — no leaked inventory, no
 *    partially-fulfilled orders.
 *  - For online payment the Razorpay order is created AFTER the DB
 *    row exists. If Razorpay fails we mark the order cancelled and
 *    call `restore_order_stock(p_order_id)` which loops every
 *    `order_items` row; the order row stays for support traceability.
 */
export async function POST(req: NextRequest) {
  return withRequest(req, () => handlePOST(req));
}

interface ProductRow {
  id: string;
  name: string;
  price_paise: number;
  sale_price_paise: number | null;
  is_active: boolean;
  images: unknown;
}

interface BuiltLineItem {
  product_id: string;
  size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
  product_name: string;
  image_url: string | null;
}

/**
 * Resolve the first usable image URL from a product row's `images`
 * JSONB column. Defensive against malformed shapes — never throws.
 */
function firstImageUrl(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0 && typeof images[0] === 'string') {
    return images[0] as string;
  }
  return null;
}

/**
 * Apply sale-price-wins logic per line. Sale price is honoured only
 * when strictly lower than the regular price (a 0 or null sale is
 * ignored). Coupon discounts stack on top of the unit price; coupons
 * apply to the SUMMED subtotal, not per line.
 */
function unitPriceFor(p: ProductRow): number {
  const sale = p.sale_price_paise;
  if (sale != null && sale < p.price_paise) return sale;
  return p.price_paise;
}

async function handlePOST(req: NextRequest) {
  try {
    // Order creation is expensive (Razorpay round trip + atomic
    // decrement). Cap per-IP throughput to absorb a runaway client
    // or scripted abuse. Real users place orders one at a time;
    // 20/min leaves ample headroom for retries on flaky networks.
    const limited = await enforceRateLimit(req, {
      bucket: 'orders.create',
      max: 20,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const body = await req.json();

    // 1. Validate input. Shape now requires `items: [...]`.
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      logEvent('order.validation_failed', {
        errors: parsed.error.flatten().fieldErrors,
      });
      return apiError(
        400,
        'Validation failed',
        parsed.error.flatten().fieldErrors,
      );
    }

    const {
      items,
      customer,
      shipping_address,
      payment_method,
      coupon_code,
      client_request_id,
    } = parsed.data;

    const supabase = createAdminClient();

    // Resolve the SSR-bound auth session (cookies). Logged-in users
    // get their `auth.uid()` recorded on the order so /orders can
    // filter by ownership; guests stay NULL and continue to work
    // unchanged. We use a separate cookie-bound client for this
    // read — the admin client has no session and would always
    // return null user.
    let userId: string | null = null;
    try {
      const ssr = await createServerSupabaseClient();
      const {
        data: { user },
      } = await ssr.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }

    // 2. Reject duplicate (product_id, size) lines from the client.
    //
    //    Two lines with the same key would each try to decrement the
    //    same inventory row inside the RPC — the second would race
    //    against the first's UPDATE within the same transaction. The
    //    cart UI already deduplicates by merging quantity, so a
    //    duplicate here is an integrity error worth a clean 400
    //    rather than a confusing STOCK_UNAVAILABLE.
    {
      const seen = new Set<string>();
      for (const it of items) {
        const key = `${it.product_id}::${it.size}`;
        if (seen.has(key)) {
          logEvent('order.duplicate_line', { product_id: it.product_id, size: it.size });
          return apiError(400, 'Duplicate line items in cart');
        }
        seen.add(key);
      }
    }

    // 3. Fetch every product in one query. Order independent of
    //    `items` array order — we'll re-key by id below.
    const productIds = Array.from(new Set(items.map((i) => i.product_id)));
    const { data: productsRaw, error: productsError } = await supabase
      .from('products')
      .select('id, name, price_paise, sale_price_paise, is_active, images')
      .in('id', productIds);

    if (productsError) {
      logEvent('order.products_lookup_failed', { error: productsError.message });
      return apiError(500, 'Could not load products');
    }

    const productsById = new Map<string, ProductRow>();
    for (const row of (productsRaw ?? []) as ProductRow[]) {
      productsById.set(row.id, row);
    }

    // 4. Build the per-line item list. Reject the whole order if any
    //    referenced product is missing or inactive. Server is the
    //    sole authority on price — never trust a client-supplied
    //    unit price.
    const lineItems: BuiltLineItem[] = [];
    for (const it of items) {
      const product = productsById.get(it.product_id);
      if (!product || !product.is_active) {
        logEvent('order.product_unavailable', { product_id: it.product_id });
        return apiError(404, 'Product not found or unavailable');
      }
      const unit = unitPriceFor(product);
      lineItems.push({
        product_id: product.id,
        size: it.size,
        quantity: it.quantity,
        unit_price_paise: unit,
        subtotal_paise: unit * it.quantity,
        product_name: product.name,
        image_url: firstImageUrl(product.images),
      });
    }

    // 5. Sum subtotal across all lines. Coupon evaluation operates
    //    on the summed subtotal (matches the cart UI's display).
    const subtotal = lineItems.reduce((s, li) => s + li.subtotal_paise, 0);

    // 6. Resolve coupon via the shared evaluator. On any rejection
    //    we silently drop the discount rather than failing the whole
    //    order — the validate route is the front door for user-facing
    //    copy, and an order in flight should never error out because
    //    a coupon's per_user_limit just tipped over by a stale tab.
    let appliedCoupon = '';
    let discount = 0;
    if (coupon_code && coupon_code.trim()) {
      const evalResult = await evaluateCoupon(supabase, {
        code: coupon_code,
        subtotalPaise: subtotal,
        userId,
      });
      if (evalResult.ok) {
        appliedCoupon = evalResult.coupon.code;
        discount = evalResult.discountPaise;
      } else {
        logEvent('order.coupon_rejected', {
          code: coupon_code.toUpperCase().trim(),
          reason: evalResult.reason,
        });
        const status = (evalResult.reason === 'auth_required' || evalResult.reason === 'new_users_only_guest') ? 401 : 409;
        return apiError(status, evalResult.message, { reason: evalResult.reason });
      }
    }

    const postDiscountSubtotal = subtotal - discount;

    // 7. Server-authoritative shipping + COD fee. Settings are loaded
    //    fresh per request so admin changes take effect immediately.
    //    `calcShipping` is deterministic: given the same inputs, the
    //    checkout UI quote and this final computation produce the
    //    identical total.
    const { data: shippingSettings } = await supabase
      .from('shipping_settings')
      .select(
        'free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise',
      )
      .limit(1)
      .maybeSingle();

    const quote = calcShipping({
      subtotalPaise: postDiscountSubtotal,
      paymentMethod: payment_method,
      shippingSettings: shippingSettings ?? null,
    });

    if (!quote.codAllowed) {
      logEvent('order.cod_disabled_rejected', {});
      return apiError(400, 'Cash on Delivery is currently unavailable. Please use online payment.');
    }

    const shippingPaise = quote.shippingPaise;
    const codFeePaise = quote.codFeePaise;
    const total = postDiscountSubtotal + shippingPaise + codFeePaise;

    // 8. Atomic create-or-replay via the multi-line SQL function.
    const orderNumber = generateOrderNumber();
    const rpcItemsPayload = lineItems.map((li) => ({
      product_id: li.product_id,
      size: li.size,
      quantity: li.quantity,
      unit_price_paise: li.unit_price_paise,
      subtotal_paise: li.subtotal_paise,
      product_name: li.product_name,
      image_url: li.image_url,
    }));

    const { data: rpcRows, error: rpcError } = await supabase.rpc(
      'create_order_atomic_v2',
      {
        p_client_request_id: client_request_id,
        p_order_number: orderNumber,
        p_items: rpcItemsPayload,
        p_subtotal_paise: subtotal,
        p_discount_paise: discount,
        p_total_paise: total,
        p_coupon_code: appliedCoupon,
        p_payment_method: payment_method,
        p_customer: customer,
        p_shipping_address: shipping_address,
        p_user_id: userId,
        p_shipping_paise: shippingPaise,
        p_cod_fee_paise: codFeePaise,
      },
    );

    if (rpcError) {
      const code = (rpcError as { code?: string }).code || '';
      const msg = rpcError.message || '';

      // Stock unavailable: P0001 (raised by v2 on any line).
      if (code === 'P0001' || msg.includes('STOCK_UNAVAILABLE')) {
        logEvent('order.stock_unavailable', {
          line_count: lineItems.length,
        });
        return apiError(409, 'Some items in your cart are no longer available. Please review your cart.');
      }

      // Coupon validation errors mapped from database custom errors (P0002, P0003, P0006-P0012)
      if (code === 'P0006' || msg.includes('COUPON_NOT_FOUND')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'not_found' });
        return apiError(409, 'Invalid or expired coupon code', { reason: 'not_found' });
      }
      if (code === 'P0007' || msg.includes('COUPON_INACTIVE')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'inactive' });
        return apiError(409, 'Invalid or expired coupon code', { reason: 'inactive' });
      }
      if (code === 'P0008' || msg.includes('COUPON_NOT_STARTED')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'not_started' });
        return apiError(409, 'This coupon is not active yet.', { reason: 'not_started' });
      }
      if (code === 'P0009' || msg.includes('COUPON_EXPIRED')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'expired' });
        return apiError(409, 'This coupon has expired.', { reason: 'expired' });
      }
      if (code === 'P0010' || msg.includes('COUPON_NEW_USERS_ONLY_GUEST')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'new_users_only_guest' });
        return apiError(401, 'This coupon is only valid for new accounts. Please sign in to apply it.', { reason: 'new_users_only_guest' });
      }
      if (code === 'P0011' || msg.includes('COUPON_NEW_USERS_ONLY_REPEAT')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'new_users_only_repeat' });
        return apiError(409, 'This coupon is only valid on your first order.', { reason: 'new_users_only_repeat' });
      }
      if (code === 'P0012' || msg.includes('COUPON_AUTH_REQUIRED')) {
        logEvent('order.coupon_rejected_db', { code: appliedCoupon, reason: 'auth_required' });
        return apiError(401, 'Please sign in to use this coupon.', { reason: 'auth_required' });
      }
      if (code === 'P0002' || msg.includes('COUPON_PER_USER_LIMIT')) {
        logEvent('order.coupon_per_user_limit_race', { code: appliedCoupon });
        return apiError(409, 'You have already used this coupon the maximum number of times.', { reason: 'per_user_limit' });
      }
      if (code === 'P0003' || msg.includes('COUPON_USAGE_LIMIT')) {
        logEvent('order.coupon_usage_limit_race', { code: appliedCoupon });
        return apiError(409, 'This coupon has reached its usage limit.', { reason: 'usage_limit' });
      }

      // Empty / invalid items array (defensive — schema already gates).
      if (code === 'P0004' || code === 'P0005') {
        logEvent('order.rpc_invalid_items', { error: msg });
        return apiError(400, 'Invalid cart contents');
      }

      logEvent('order.rpc_unexpected_error', { error: msg, code });
      return apiError(500, 'Order creation failed');
    }

    interface RpcRow {
      order_id: string;
      order_number: string;
      was_existing: boolean;
    }
    const rpcRow = ((rpcRows as RpcRow[] | null) ?? [])[0];
    if (!rpcRow) {
      logEvent('order.rpc_empty_result', {});
      return apiError(500, 'Order creation failed');
    }
    const orderId = rpcRow.order_id;
    const finalOrderNumber = rpcRow.order_number;
    const wasExisting = rpcRow.was_existing;

    logEvent('order.created', {
      order_id: orderId,
      order_number: finalOrderNumber,
      total_paise: total,
      line_count: lineItems.length,
      payment_method,
      was_existing: wasExisting,
    });

    // 9. Lifecycle email + admin push, durably enqueued. Email
    //    payload carries BOTH the new `items: [...]` array AND
    //    legacy fields populated from the FIRST line so the current
    //    template (B4 will rewrite it to use items[]) renders
    //    something sensible for multi-line orders in the interim.
    const firstLine = lineItems[0];
    const emailItems = lineItems.map((li) => ({
      name: li.product_name,
      size: li.size,
      quantity: li.quantity,
      unit_price_paise: li.unit_price_paise,
      subtotal_paise: li.subtotal_paise,
      image_url: li.image_url,
    }));

    if (!wasExisting && payment_method === 'cod') {
      try {
        await enqueue({
          kind: 'email.order_created',
          idempotencyKey: `email.order_created.${orderId}`,
          payload: {
            order: {
              id: orderId,
              order_number: finalOrderNumber,
              customer,
              product_name: firstLine.product_name,
              size: firstLine.size,
              quantity: firstLine.quantity,
              subtotal_paise: subtotal,
              discount_paise: discount,
              shipping_paise: shippingPaise,
              cod_fee_paise: codFeePaise,
              total_paise: total,
              payment_method,
              shipping_address,
              image_url: firstLine.image_url,
              items: emailItems,
            },
          },
        }, supabase);
      } catch (err) {
        logEvent('order.email_enqueue_failed', {
          order_id: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Admin push goes DIRECT, not through the job queue. Queued
      // pushes were landing 5–15 minutes late because GitHub Actions
      // schedule events skew badly under load. Push is fast (<2s),
      // idempotent on `tag` (the SW collapses duplicates with
      // `renotify:true`), and best-effort by design — there is no
      // benefit to deferring it. The helper enforces a hard 3s budget
      // and never throws, so the order response is never blocked.
      const lineSummary =
        lineItems.length === 1
          ? `${firstLine.product_name} · ${firstLine.size} × ${firstLine.quantity}`
          : `${lineItems.length} items`;
      await notifyAdminsBestEffort(supabase, {
        title: `New order ${finalOrderNumber}`,
        body: `${lineSummary} — ₹${(total / 100).toLocaleString('en-IN')}`,
        tag: `order-${orderId}`,
        url: `/admin/orders/${orderId}`,
      });
    }

    // 10. COD short-circuits here; online proceeds to Razorpay handoff.
    if (payment_method === 'cod') {
      return apiSuccess({
        order_id: orderId,
        order_number: finalOrderNumber,
        total_paise: total,
        idempotent_replay: wasExisting,
      });
    }

    // 11. Online: create the Razorpay order. On failure we cancel
    //     the freshly-created order row and restore stock. On replay
    //     (was_existing=true) we look up the existing razorpay_order_id
    //     and return it instead of double-creating.
    if (wasExisting) {
      const { data: existing } = await supabase
        .from('orders')
        .select('razorpay_order_id, total_paise')
        .eq('id', orderId)
        .single();
      if (existing?.razorpay_order_id) {
        return apiSuccess({
          order_id: orderId,
          order_number: finalOrderNumber,
          razorpay_order_id: existing.razorpay_order_id,
          amount: existing.total_paise ?? total,
          key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
          customer,
          idempotent_replay: true,
        });
      }
      // Replay landed before Razorpay was created — fall through and
      // create one now. The existing DB row will receive the id.
    }

    let razorpayOrderId = '';
    try {
      const rzpClient = getRazorpay();
      const rzpOrder = await rzpClient.orders.create({
        amount: total,
        currency: 'INR',
        receipt: finalOrderNumber.slice(0, 40),
        notes: {
          order_id: orderId,
          order_number: finalOrderNumber,
        },
      });
      razorpayOrderId = String(rzpOrder.id);
      await supabase
        .from('orders')
        .update({ razorpay_order_id: razorpayOrderId })
        .eq('id', orderId);
    } catch (err) {
      logEvent('order.razorpay_create_failed', {
        order_id: orderId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Roll the order back: cancel + restore stock on every line.
      // We only restore stock when this is a fresh creation; on
      // replay the order's existing state is already correct.
      if (!wasExisting) {
        await supabase
          .from('orders')
          .update({ order_status: 'cancelled', cancel_reason: 'razorpay_create_failed' })
          .eq('id', orderId);
        await supabase.rpc('restore_order_stock', { p_order_id: orderId });
      }

      return apiError(502, 'Payment gateway unavailable. Please try again or use COD.');
    }

    return apiSuccess({
      order_id: orderId,
      order_number: finalOrderNumber,
      razorpay_order_id: razorpayOrderId,
      amount: total,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      customer,
      idempotent_replay: wasExisting,
    });
  } catch (err) {
    logEvent('order.unhandled_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError(500, 'Internal server error');
  }
}
