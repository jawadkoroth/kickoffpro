'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
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
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  async function fetchOrder() {
    try {
      const res = await fetch(`/api/orders/${id}/track`);
      const data = await res.json();
      if (data.success) {
        setOrder(data.order);
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

  const isPendingPayment = order.payment_method === 'online' && order.payment_status === 'pending' && order.order_status !== 'cancelled';
  const isPaid = order.payment_status === 'paid';
  const isCancelled = order.order_status === 'cancelled';
  const canRetry = isPendingPayment && order.retry_count < 3;

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
          {!isCancelled && !isPendingPayment && (
            <>
              <div className={styles.successIcon}>✓</div>
              <h1 className={styles.heroTitle}>Order Placed!</h1>
              <p className={styles.heroSubtitle}>Your jersey order is being processed. Thank you for shopping with KickoffPro!</p>
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
