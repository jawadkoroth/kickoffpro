import { z } from 'zod';

export const customerSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit phone number'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
});

export const addressSchema = z.object({
  line1: z.string().min(5, 'Address is required').max(200),
  line2: z.string().max(200).optional().or(z.literal('')),
  city: z.string().min(2, 'City is required').max(100),
  state: z.string().min(2, 'State is required').max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
});

/**
 * Single line in a multi-line order.
 *
 * Per-line `quantity` is capped at 5 to mirror the previous
 * single-line schema's hard cap and to keep stock-decrement spikes
 * bounded; the cart can hold many distinct lines but no one line
 * may request more than 5 units of the same (product, size).
 */
export const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  size: z.string().min(1, 'Select a size'),
  quantity: z.number().int().min(1).max(5),
});

export const createOrderSchema = z.object({
  /**
   * One or more cart lines. The server fetches every product in a
   * single query, validates each line against live inventory inside
   * `create_order_atomic_v2`, and persists one `order_items` row
   * per line. A "Buy Now" flow simply submits an array of length 1.
   *
   * The hard cap of 20 lines is a defensive bound — real carts are
   * far smaller, and a runaway client building a 1000-line payload
   * should be rate-limited *and* schema-rejected.
   */
  items: z.array(orderItemSchema).min(1, 'Cart is empty').max(20),
  customer: customerSchema,
  shipping_address: addressSchema,
  payment_method: z.enum(['cod', 'online']),
  coupon_code: z.string().optional().or(z.literal('')),
  /**
   * Client-generated UUID v4, scoped to a single submit attempt.
   * The server uses it to make order creation idempotent: a retry
   * with the same id returns the previously-created order instead
   * of creating a duplicate or double-decrementing inventory.
   */
  client_request_id: z.string().uuid(),
  /** Optional attribution and CAPI deduplication fields */
  tracking_event_id: z.string().optional(),
  fbp: z.string().optional(),
  fbc: z.string().optional(),
  gclid: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1, 'Enter a coupon code'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
