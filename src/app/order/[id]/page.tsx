'use client';

import { useState, useEffect, useRef, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useCart } from '@/lib/cart';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { getPublicUrl } from '@/lib/media';
import { trackPurchase, clearCheckoutEventId } from '@/lib/tracking/client';
import styles from './page.module.css';

interface OrderLine {
  product_id: string;
  product_name: string;
  size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
  image_url: string | null;
}

interface Order {
  id: string;
  order_number: string;
  product_name: string;
  size: string;
  items: OrderLine[];
  subtotal_paise?: number | null;
  total_paise: number;
  discount_paise: number;
  shipping_paise?: number | null;
  cod_fee_paise?: number | null;
  payment_method: string;
  payment_status: string;
  order_status: string;
  customer: { name: string; phone: string; email?: string };
  shipping_address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  tracking_id: string | null;
  shipping_provider: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
  cancel_reason?: string | null;
  tracking_event_id?: string | null;
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const { addItem } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [upsellProduct, setUpsellProduct] = useState<{
    id: string;
    name: string;
    slug: string;
    price_paise: number;
    sale_price_paise: number | null;
    images: string[];
    sizes: string[];
    inventory?: { size: string; stock: number }[];
  } | null>(null);
  const [upsellSize, setUpsellSize] = useState('M');
  const hasTrackedPurchaseRef = useRef(false);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  // Fetch post-purchase upsell candidate when flag is enabled
  useEffect(() => {
    if (!FEATURE_FLAGS.POST_PURCHASE_UPSELL || !order) return;
    const isSuccess =
      order.payment_status.toLowerCase() === 'paid' ||
      order.payment_method.toLowerCase() === 'cod';
    if (!isSuccess || upsellProduct) return;

    fetch('/api/products')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.success || !Array.isArray(data.products)) return;
        const orderedIds = new Set((order.items ?? []).map((it) => it.product_id));
        const candidates = data.products.filter(
          (p: { id: string; inventory?: { size: string; stock: number }[] }) =>
            !orderedIds.has(p.id) &&
            (!p.inventory || p.inventory.length === 0 || p.inventory.some((i) => i.stock > 0)),
        );
        const picked = candidates[0] || data.products[0];
        if (picked) {
          setUpsellProduct(picked);
          const firstAvail = picked.inventory?.find((i: { stock: number }) => i.stock > 0)?.size;
          if (firstAvail) setUpsellSize(firstAvail);
        }
      })
      .catch(() => {});
  }, [order, upsellProduct]);

  async function fetchOrder() {
    try {
      let email = null;
      let phone = null;
      if (typeof window !== 'undefined') {
        const searchParams = new URLSearchParams(window.location.search);
        email = searchParams.get('email');
        phone = searchParams.get('phone');
        if (!email) {
          email = window.sessionStorage.getItem('kickoffpro_checkout_email');
        }
        if (!phone) {
          phone = window.sessionStorage.getItem('kickoffpro_checkout_phone');
        }
      }

      let url = `/api/orders/${id}/track`;
      const queryParts: string[] = [];
      if (email) queryParts.push(`email=${encodeURIComponent(email)}`);
      if (phone) queryParts.push(`phone=${encodeURIComponent(phone)}`);
      if (queryParts.length > 0) {
        url += `?${queryParts.join('&')}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.order) {
        const ord = data.order as Order;
        setOrder(ord);

        // Fire client-side Purchase pixel with matching event_id for deduplication
        const isSuccessOrder =
          ord.payment_status.toLowerCase() === 'paid' ||
          ord.payment_method.toLowerCase() === 'cod';

        if (isSuccessOrder && !hasTrackedPurchaseRef.current) {
          hasTrackedPurchaseRef.current = true;
          const searchParams = new URLSearchParams(window.location.search);
          const eventId =
            searchParams.get('event_id') ||
            ord.tracking_event_id ||
            window.sessionStorage.getItem('kickoffpro_checkout_event_id') ||
            `order-${ord.id}`;

          trackPurchase({
            orderId: ord.id,
            orderNumber: ord.order_number,
            items: (ord.items ?? []).map((it) => ({
              id: it.product_id,
              name: it.product_name,
              size: it.size,
              price: it.unit_price_paise / 100,
              quantity: it.quantity,
            })),
            value: ord.total_paise / 100,
            eventId,
            customer: ord.customer,
          });

          clearCheckoutEventId();
        }
      }
    } catch (err) {
      console.error('Failed to fetch order:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatPrice = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN');
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function getHumanPaymentStatus(method: string, status: string): string {
    if (status.toLowerCase() === 'paid') return 'Paid';
    if (status.toLowerCase() === 'failed') return 'Failed';
    if (status.toLowerCase() === 'refunded') return 'Refunded';
    if (method.toLowerCase() === 'cod') return 'COD';
    return 'Pending';
  }

  async function handleRetryPayment() {
    if (retrying || !order) return;
    setRetrying(true);

    try {
      const res = await fetch('/api/payments/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.error || 'Failed to retry payment');
        setRetrying(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.body.appendChild(script);
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RazorpayClass = (window as any).Razorpay;

      const rzp = new RazorpayClass({
        key: data.key_id,
        amount: data.amount,
        currency: 'INR',
        name: 'KickoffPro',
        order_id: data.razorpay_order_id,
        prefill: {
          name: data.customer?.name,
          contact: data.customer?.phone,
          email: data.customer?.email || '',
        },
        theme: { color: '#071B3A' },
        handler: async function (response: { razorpay_payment_id: string; razorpay_signature: string }) {
          await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order_id: order.id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          fetchOrder();
          setRetrying(false);
        },
        modal: {
          ondismiss: function () {
            setRetrying(false);
          },
        },
      });

      rzp.open();
    } catch {
      alert('Failed to initialize payment');
      setRetrying(false);
    }
  }

  if (loading || !order) {
    return (
      <div className={styles.page}>
        <div className={styles.centerContent}>
          {loading ? 'Loading order details...' : 'Order not found'}
        </div>
      </div>
    );
  }

  const isCancelled = order.order_status === 'cancelled';
  const isSuccess = !isCancelled && (order.payment_method === 'cod' || order.payment_status === 'paid');
  const isFailedPayment = order.payment_method === 'online' && order.payment_status === 'failed' && order.order_status !== 'cancelled';
  const isPendingPayment = order.payment_method === 'online' && order.payment_status === 'pending' && order.order_status !== 'cancelled';
  const canRetry = (isPendingPayment || isFailedPayment) && order.retry_count < 3;

  const statusSteps = [
    { key: 'pending', label: 'Placed', done: true, time: order.created_at },
    { key: 'confirmed', label: 'Confirmed', done: ['confirmed', 'shipped', 'delivered'].includes(order.order_status), time: order.order_status !== 'pending' ? order.updated_at : null },
    { key: 'shipped', label: 'Shipped', done: ['shipped', 'delivered'].includes(order.order_status), time: order.order_status === 'shipped' || order.order_status === 'delivered' ? order.updated_at : null },
    { key: 'delivered', label: 'Delivered', done: order.order_status === 'delivered', time: order.order_status === 'delivered' ? order.updated_at : null },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* HERO */}
        <div className={styles.hero}>
          <div className={styles.heroGlow} />
          {isSuccess && (
            <>
              <div className={styles.successIcon}>✓</div>
              <h1 className={styles.heroTitle}>Order Placed!</h1>
              <p className={styles.heroSubtitle}>Your jersey order is being processed. Thank you for shopping with KickoffPro!</p>
            </>
          )}

          {isFailedPayment && (
            <>
              <div className={styles.cancelledIcon}>✕</div>
              <h1 className={styles.heroTitle} style={{ color: 'var(--error, #EF4444)' }}>Payment Failed</h1>
              <p className={styles.heroSubtitle}>Your online payment attempt could not be processed. Please retry your payment to complete the order.</p>
              {canRetry ? (
                <div style={{ marginBottom: '16px' }}>
                  <button
                    className={styles.btnPrimary}
                    onClick={handleRetryPayment}
                    disabled={retrying}
                    style={{ margin: '0 auto' }}
                  >
                    {retrying ? 'Retrying...' : 'RETRY PAYMENT'}
                  </button>
                  <p className="text-xs" style={{ marginTop: '8px', opacity: 0.8 }}>
                    Attempt {order.retry_count} of 3
                  </p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--error, #EF4444)', fontWeight: 500, marginBottom: '16px' }}>
                  Maximum payment retry attempts reached. Please place a new order.
                </p>
              )}
            </>
          )}

          {isPendingPayment && (
            <>
              <div className={styles.warningIcon}>⚠</div>
              <h1 className={styles.heroTitle}>Payment Pending</h1>
              <p className={styles.heroSubtitle}>Please complete your online payment to confirm your order.</p>
              {canRetry && (
                <div style={{ marginBottom: '16px' }}>
                  <button
                    className={styles.btnPrimary}
                    onClick={handleRetryPayment}
                    disabled={retrying}
                    style={{ margin: '0 auto' }}
                  >
                    {retrying ? 'Retrying...' : 'RETRY PAYMENT'}
                  </button>
                  <p className="text-xs" style={{ marginTop: '8px', opacity: 0.8 }}>
                    Attempt {order.retry_count} of 3
                  </p>
                </div>
              )}
            </>
          )}

          {isCancelled && (
            <>
              <div className={styles.cancelledIcon}>✕</div>
              <h1 className={styles.heroTitle}>Order Cancelled</h1>
              <p className={styles.heroSubtitle}>This order has been cancelled.</p>
            </>
          )}

          <div className={styles.orderCard}>
            <p className={styles.orderCardLabel}>Order Number</p>
            <p className={styles.orderCardNumber}>{order.order_number}</p>
          </div>
        </div>

        {/* CANCELLED BANNER */}
        {isCancelled && order.cancel_reason && (
          <div className={styles.cancelledBanner}>
            <p className={styles.cancelledLabel}>Reason for cancellation</p>
            <p className={styles.cancelledReason}>{order.cancel_reason}</p>
          </div>
        )}

        {/* TIMELINE */}
        {!isCancelled && (
          <section className={styles.timelineSection}>
            <p className={styles.sectionTitle}>Order Timeline</p>
            <div className={styles.timelineGrid}>
              {statusSteps.map((step) => {
                const isCurrent = order.order_status === step.key || 
                  (step.key === 'pending' && order.order_status === 'pending') || 
                  (step.key === 'confirmed' && order.order_status === 'confirmed') || 
                  (step.key === 'shipped' && order.order_status === 'shipped') || 
                  (step.key === 'delivered' && order.order_status === 'delivered');
                  
                const isCompleted = step.done;
                
                let dotClass = styles.timelineDot;
                if (isCompleted) {
                  dotClass = `${styles.timelineDot} ${styles.timelineDotCompleted}`;
                } else if (isCurrent) {
                  dotClass = `${styles.timelineDot} ${styles.timelineDotActive}`;
                }

                return (
                  <div key={step.key} className={styles.timelineItem}>
                    <div className={dotClass}>
                      <div className={styles.timelineDotInner} />
                    </div>
                    <div className={styles.timelineContent}>
                      <p className={styles.timelineLabel}>{step.label}</p>
                      {isCompleted && step.time && (
                        <p className={styles.timelineTime}>{formatDate(step.time)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ORDER SUMMARY */}
        <section className={styles.summarySection}>
          <p className={styles.sectionTitle}>Order Items</p>
          <div style={{ marginBottom: '16px' }}>
            {order.items.map((line) => (
              <div key={`${line.product_id}::${line.size}`} className={styles.summaryProductItem}>
                <div className={styles.summaryThumb}>
                  {line.image_url && (
                    <Image
                      src={line.image_url}
                      alt={line.product_name}
                      fill
                      sizes="56px"
                      style={{ objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div className={styles.summaryDetails}>
                  <p className={styles.summaryProductName}>{line.product_name}</p>
                  <p className={styles.summaryProductMeta}>Size: {line.size} &middot; Qty: {line.quantity}</p>
                </div>
                <p className={styles.summaryProductPrice}>{formatPrice(line.subtotal_paise)}</p>
              </div>
            ))}
          </div>

          <p className={styles.sectionTitle} style={{ marginTop: '24px' }}>Totals & Details</p>
          
          {(order.subtotal_paise ?? 0) > 0 && (
            <div className={styles.summaryRow}>
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal_paise ?? 0)}</span>
            </div>
          )}
          {order.discount_paise > 0 && (
            <div className={styles.summaryRow} style={{ color: '#22C55E', fontWeight: 600 }}>
              <span>Discount</span>
              <span>− {formatPrice(order.discount_paise)}</span>
            </div>
          )}
          {(order.shipping_paise ?? 0) > 0 && (
            <div className={styles.summaryRow}>
              <span>Shipping</span>
              <span>{formatPrice(order.shipping_paise ?? 0)}</span>
            </div>
          )}
          {(order.cod_fee_paise ?? 0) > 0 && (
            <div className={styles.summaryRow}>
              <span>COD fee</span>
              <span>{formatPrice(order.cod_fee_paise ?? 0)}</span>
            </div>
          )}
          <div className={styles.summaryTotal}>
            <span>Total</span>
            <span>{formatPrice(order.total_paise)}</span>
          </div>

          <div className={styles.summaryRow} style={{ marginTop: '16px' }}>
            <span>Payment Method</span>
            <span>
              {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'}
              <span className={
                order.payment_status === 'paid'
                  ? styles.badgePaid
                  : order.payment_method === 'cod'
                  ? styles.badgeSky
                  : styles.badgeYellow
              }>
                {getHumanPaymentStatus(order.payment_method, order.payment_status)}
              </span>
            </span>
          </div>

          <div className={styles.summaryRow}>
            <span>Delivery Customer</span>
            <span>{order.customer.name}</span>
          </div>

          <div className={styles.summaryRow} style={{ alignItems: 'flex-start' }}>
            <span>Shipping Address</span>
            <span className={styles.address}>
              {order.shipping_address.line1}
              {order.shipping_address.line2 && <>, {order.shipping_address.line2}</>}
              <br />
              {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}
            </span>
          </div>
        </section>

        {/* TRACKING */}
        {order.tracking_id && (
          <section className={styles.summarySection}>
            <p className={styles.sectionTitle}>Tracking Info</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="text-xs text-muted" style={{ margin: 0 }}>Courier Provider</p>
                <p style={{ fontWeight: 700, textTransform: 'capitalize', margin: '2px 0 0 0' }}>{order.shipping_provider || 'Pending dispatch'}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className="text-xs text-muted" style={{ margin: 0 }}>Tracking Waybill</p>
                <p style={{ fontWeight: 700, fontFamily: 'monospace', margin: '2px 0 0 0' }}>{order.tracking_id}</p>
              </div>
            </div>
            {order.shipping_provider === 'delhivery' && (
              <a
                href={`https://www.delhivery.com/track/package/${order.tracking_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.btnSecondary}
                style={{ width: '100%', marginTop: '16px', fontWeight: 700 }}
              >
                Track Delhivery Shipment →
              </a>
            )}
            {order.shipping_provider === 'shiprocket' && (
              <a
                href={`https://shiprocket.co/tracking/${order.tracking_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.btnSecondary}
                style={{ width: '100%', marginTop: '16px', fontWeight: 700 }}
              >
                Track Shiprocket Shipment →
              </a>
            )}
          </section>
        )}

        {/* POST-PURCHASE ONE-CLICK UPSELL SLOT */}
        {FEATURE_FLAGS.POST_PURCHASE_UPSELL &&
          upsellProduct &&
          (order.payment_status.toLowerCase() === 'paid' ||
            order.payment_method.toLowerCase() === 'cod') && (
            <section className={styles.summarySection}>
              <p className={styles.sectionTitle}>Complete Your Wardrobe</p>
              <div className={styles.summaryProductItem}>
                <div className={styles.summaryThumb}>
                  <img
                    src={
                      getPublicUrl(
                        Array.isArray(upsellProduct.images) && upsellProduct.images.length > 0
                          ? upsellProduct.images[0]
                          : '',
                      ) || '/product-1.png'
                    }
                    alt={upsellProduct.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div className={styles.summaryDetails}>
                  <div className={styles.summaryProductName}>{upsellProduct.name}</div>
                  <div className={styles.summaryProductMeta}>
                    {formatPrice(
                      upsellProduct.sale_price_paise != null &&
                        upsellProduct.sale_price_paise < upsellProduct.price_paise
                        ? upsellProduct.sale_price_paise
                        : upsellProduct.price_paise,
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <select
                      aria-label="Select upsell size"
                      value={upsellSize}
                      onChange={(e) => setUpsellSize(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-color, #cbd5e1)',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                      }}
                    >
                      {(upsellProduct.inventory && upsellProduct.inventory.length > 0
                        ? upsellProduct.inventory.filter((i) => i.stock > 0).map((i) => i.size)
                        : upsellProduct.sizes?.length
                          ? upsellProduct.sizes
                          : ['S', 'M', 'L', 'XL']
                      ).map((sz) => (
                        <option key={sz} value={sz}>
                          Size {sz}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      style={{ padding: '6px 14px', fontSize: '0.8rem', minHeight: 'auto' }}
                      onClick={() => {
                        const unitPrice =
                          upsellProduct.sale_price_paise != null &&
                          upsellProduct.sale_price_paise < upsellProduct.price_paise
                            ? upsellProduct.sale_price_paise
                            : upsellProduct.price_paise;
                        const maxStock =
                          upsellProduct.inventory?.find((i) => i.size === upsellSize)?.stock ?? 10;
                        addItem(
                          {
                            product_id: upsellProduct.id,
                            name: upsellProduct.name,
                            slug: upsellProduct.slug,
                            size: upsellSize,
                            price_paise: unitPrice,
                            image: Array.isArray(upsellProduct.images) ? upsellProduct.images[0] || '' : '',
                            maxStock,
                          },
                          1,
                          { openDrawer: false },
                        );
                        router.push(
                          `/checkout?product_id=${upsellProduct.id}&size=${encodeURIComponent(upsellSize)}`,
                        );
                      }}
                    >
                      Add &amp; Checkout →
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

        {/* CTA BUTTONS */}
        <div className={styles.buttonGroup}>
          <Link href="/" className={styles.btnSecondary}>
            Continue Shopping
          </Link>
          <Link href={user ? `/orders/${order.id}` : '#'} className={styles.btnPrimary} style={{ display: user ? 'flex' : 'none' }}>
            Track My Order
          </Link>
        </div>
      </div>
    </div>
  );
}
