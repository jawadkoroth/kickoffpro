'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
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
  // Legacy single-line fields. Track API still populates them from
  // items[0] for back-compat; multi-line UI prefers `items[]`.
  product_name: string;
  size: string;
  // Per-line breakdown — present on every order since phase B1.
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
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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

      // Load Razorpay
      if (!(window as unknown as { Razorpay: unknown }).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.body.appendChild(script);
        });
      }

      const RazorpayClass = (window as unknown as { Razorpay: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;

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
        theme: { color: '#1A1A1A' },
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
          {loading
            ? <div className="animate-pulse text-muted">Loading order...</div>
            : <p className="text-muted">Order not found</p>
          }
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
        {/* Success Header */}
        {!isCancelled && !isPendingPayment && (
          <div className={styles.successHeader}>
            <div className={styles.checkmark}>✓</div>
            <h1 className={styles.heading}>Order Placed!</h1>
            <p className={styles.orderNumber}>{order.order_number}</p>
          </div>
        )}

        {/* Payment Pending Warning */}
        {isPendingPayment && (
          <div className={styles.warningHeader}>
            <div className={styles.warningIcon}>⚠</div>
            <h1 className={styles.heading}>Payment Pending</h1>
            <p className={styles.orderNumber}>{order.order_number}</p>

            {canRetry && (
              <>
                <button
                  className={`btn btn-primary ${retrying ? 'btn-loading' : ''}`}
                  onClick={handleRetryPayment}
                  disabled={retrying}
                  style={{ marginTop: 'var(--space-4)' }}
                >
                  RETRY PAYMENT
                </button>
                <p className="text-xs text-muted" style={{ marginTop: 'var(--space-2)' }}>
                  Attempt {order.retry_count} of 3
                </p>
              </>
            )}
            {!canRetry && (
              <p className="text-sm text-muted" style={{ marginTop: 'var(--space-4)' }}>
                Maximum retries reached. Please contact support.
              </p>
            )}
          </div>
        )}

        {/* Cancelled */}
        {isCancelled && (
          <div className={styles.cancelledHeader}>
            <div className={styles.cancelledIcon}>✕</div>
            <h1 className={styles.heading}>Order Cancelled</h1>
            <p className={styles.orderNumber}>{order.order_number}</p>
          </div>
        )}

        {/* Order Details */}
        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          {order.items.map((line) => (
            <div
              key={`${line.product_id}::${line.size}`}
              className={styles.detailRow}
              style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}
            >
              {line.image_url && (
                <div style={{ flexShrink: 0, width: 48, height: 48, position: 'relative', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                  <Image
                    src={line.image_url}
                    alt={line.product_name}
                    fill
                    sizes="48px"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <span className="text-muted">
                  {line.product_name} · {line.size}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                </span>
              </div>
              <span>{formatPrice(line.subtotal_paise)}</span>
            </div>
          ))}
          {(order.subtotal_paise ?? 0) > 0 && (
            <div className={styles.detailRow}>
              <span className="text-muted">Subtotal</span>
              <span>{formatPrice(order.subtotal_paise ?? 0)}</span>
            </div>
          )}
          {order.discount_paise > 0 && (
            <div className={styles.detailRow}>
              <span className="text-muted">Discount</span>
              <span>− {formatPrice(order.discount_paise)}</span>
            </div>
          )}
          {(order.shipping_paise ?? 0) > 0 && (
            <div className={styles.detailRow}>
              <span className="text-muted">Shipping</span>
              <span>{formatPrice(order.shipping_paise ?? 0)}</span>
            </div>
          )}
          {(order.cod_fee_paise ?? 0) > 0 && (
            <div className={styles.detailRow}>
              <span className="text-muted">COD fee</span>
              <span>{formatPrice(order.cod_fee_paise ?? 0)}</span>
            </div>
          )}
          <div className={styles.detailRow}>
            <span className="text-muted">Total</span>
            <span>{formatPrice(order.total_paise)}</span>
          </div>
          <div className={styles.detailRow}>
            <span className="text-muted">Payment</span>
            <span>
              {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'}
              {' '}
              {isPaid && <span className="badge badge-paid">Paid</span>}
              {isPendingPayment && <span className="badge badge-pending">Pending</span>}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className="text-muted">Deliver to</span>
            <span>{order.customer.name}</span>
          </div>
          <div className={styles.detailRow}>
            <span className="text-muted">Address</span>
            <span className={styles.address}>
              {order.shipping_address.line1}
              {order.shipping_address.line2 && <>, {order.shipping_address.line2}</>}
              <br />{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}
            </span>
          </div>
        </div>

        {/* Order Timeline */}
        {!isCancelled && (
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <div className="timeline">
              {statusSteps.map((step) => (
                <div key={step.key} className="timeline-item">
                  <div className={`timeline-dot ${step.done ? 'timeline-dot-success' : ''}`} />
                  <div className="timeline-content">
                    <div className="timeline-title">{step.label}</div>
                    {step.done && step.time && (
                      <div className="timeline-time">{formatDate(step.time)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tracking */}
        {order.tracking_id && (
          <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
            <p className="text-sm text-muted">Tracking ID</p>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-3)' }}>{order.tracking_id}</p>
            {order.shipping_provider === 'delhivery' && (
              <a
                href={`https://www.delhivery.com/track/package/${order.tracking_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ width: '100%' }}
              >
                Track on Delhivery →
              </a>
            )}
          </div>
        )}

        {/* Actions */}
        <div className={styles.actions}>
          {order.customer.email && (
            <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
              📧 Confirmation sent to {order.customer.email}
            </p>
          )}
          <a href="/" className="btn btn-secondary" style={{ marginTop: 'var(--space-4)' }}>
            Continue Shopping
          </a>
        </div>
      </div>
    </div>
  );
}
