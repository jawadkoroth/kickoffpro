'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/useToast';
import { ShipmentDetailPanel } from '@/components/ShipmentDetailPanel';
import { ShipmentTimeline } from '@/components/ShipmentTimeline';
import { ProviderResponsePanel } from '@/components/ProviderResponsePanel';
import AdminNotes from '@/components/admin/AdminNotes';
import type { CanonicalShipmentStatus } from '@/lib/shipping/state';
import type { ParsedProviderError } from '@/lib/shipping/types';

interface OrderLine {
  id: string;
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
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number | null;
  cod_fee_paise: number | null;
  total_paise: number;
  coupon_code: string | null;
  payment_method: string;
  payment_status: string;
  order_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  customer: { name: string; phone: string; email?: string };
  shipping_address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  tracking_id: string | null;
  label_url: string | null;
  shipping_provider: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  shipment?: {
    id: string;
    tracking_id: string | null;
    provider_name: string | null;
    status: CanonicalShipmentStatus;
    label_url: string | null;
    created_at: string;
    last_provider_event_at: string | null;
    environment: string | null;
    failure_reason: string | null;
    /** KickoffPro: Parsed forensic error with actionable diagnostics */
    parsed_error: ParsedProviderError | null;
    retry_safe: boolean | null;
    latency_ms: number | null;
    last_error_at: string | null;
    operational_category: string | null;
    error_severity: string | null;
    raw_create_response: Record<string, unknown> | null;
  } | null;
  shipment_history?: Array<{
    id: string;
    previous_status: CanonicalShipmentStatus | null;
    next_status: CanonicalShipmentStatus;
    created_at: string;
    source: 'webhook' | 'api' | 'admin' | 'system';
    provider_payload: Record<string, unknown> | null;
  }>;
}

export default function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const { toast, showToast } = useToast();
  const [shipmentData, setShipmentData] = useState<{
    shipment: Order['shipment'];
    history: Order['shipment_history'];
  }>({ shipment: null, history: [] });

  useEffect(() => {
    fetchOrder();
    fetchShipmentData();
  }, [id]);

  async function fetchOrder() {
    const supabase = createClient();
    const { data } = await supabase.from('orders').select('*').eq('id', id).single();
    if (data) {
      setOrder(data);
      setNoteText(data.notes || '');
      // Multi-line aware: load order_items rather than chasing
      // legacy orders.product_id. Every order has ≥1 row since
      // phase B1 backfill, so this is uniform across history.
      const { data: itemRows } = await supabase
        .from('order_items')
        .select('id, product_id, product_name, size, quantity, unit_price_paise, subtotal_paise, image_url')
        .eq('order_id', id)
        .order('created_at', { ascending: true });
      setLines((itemRows ?? []) as OrderLine[]);
    }
    setLoading(false);
  }

  async function fetchShipmentData() {
    const supabase = createClient();
    // Fetch shipment from new shipments table with KickoffPro forensic fields
    const { data: shipment } = await supabase
      .from('shipments')
      .select(`
        id, tracking_id, provider_name, status, label_url, created_at,
        last_provider_event_at, environment, failure_reason,
        parsed_error, retry_safe, latency_ms, last_error_at,
        operational_category, error_severity, raw_create_response
      `)
      .eq('order_id', id)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (shipment) {
      const { data: history } = await supabase
        .from('shipment_status_history')
        .select('id, previous_status, next_status, created_at, source, provider_payload')
        .eq('shipment_id', shipment.id)
        .order('created_at', { ascending: true });
      setShipmentData({ shipment, history: history ?? [] });
    } else {
      // Fall back to legacy shipment data from orders table
      const { data: order } = await supabase
        .from('orders')
        .select('tracking_id, label_url, shipping_provider, order_status, updated_at')
        .eq('id', id)
        .single();

      if (order && order.tracking_id) {
        // Create a legacy shipment object for display
        const legacyShipment = {
          id: `legacy-${id}`,
          tracking_id: order.tracking_id,
          provider_name: order.shipping_provider,
          status: order.order_status === 'shipped' ? 'shipment_created' as const : 'pending' as const,
          label_url: order.label_url,
          created_at: order.updated_at,
          last_provider_event_at: order.updated_at,
          environment: null,
          failure_reason: null,
          parsed_error: null,
          retry_safe: null,
          latency_ms: null,
          last_error_at: null,
          operational_category: null,
          error_severity: null,
          raw_create_response: null,
        };
        setShipmentData({ shipment: legacyShipment, history: [] });
      } else {
        setShipmentData({ shipment: null, history: [] });
      }
    }
  }

  const formatPrice = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN');
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function handleAction(action: string) {
    if (actionLoading || !order) return;
    setActionLoading(action);

    const supabase = createClient();

    try {
      if (action === 'verify') {
        await supabase.from('orders').update({ payment_status: 'verified' }).eq('id', id);
      }

      // Track which actions transition order_status so we can fire
      // the lifecycle email afterwards. Notes / payment-verify are
      // not status transitions and skip the notify call.
      let statusChanged = false;

      if (action === 'confirm') {
        await supabase.from('orders').update({ order_status: 'confirmed' }).eq('id', id);
        statusChanged = true;
      }

      if (action === 'cancel') {
        if (!cancelReason.trim()) { setActionLoading(''); return; }
        
        // Fetch current status to ensure transition safety (not_cancelled -> cancelled)
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('order_status, payment_status')
          .eq('id', id)
          .single();

        if (currentOrder && currentOrder.order_status !== 'cancelled') {
          const { data: updatedOrders, error: updateError } = await supabase
            .from('orders')
            .update({ order_status: 'cancelled', cancel_reason: cancelReason })
            .eq('id', id)
            .in('order_status', ['pending', 'confirmed'])
            .select('id');

          if (updatedOrders && updatedOrders.length > 0) {
            if (currentOrder.payment_status !== 'failed') {
              await supabase.rpc('restore_order_stock', { p_order_id: id });
            }
            statusChanged = true;
          }
        }
      }

      if (action === 'ship') {
        const res = await fetch(`/api/admin/orders/${id}/ship`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || 'Shipment creation failed', 'error');
          setActionLoading('');
          return;
        }
        statusChanged = true;
      }

      if (action === 'deliver') {
        await supabase.from('orders').update({ order_status: 'delivered' }).eq('id', id);
        statusChanged = true;
      }

      if (action === 'save-notes') {
        await supabase.from('orders').update({ notes: noteText }).eq('id', id);
      }

      // Fire-and-forget lifecycle email. Server route reads the
      // current status from the DB so it's never spoofable from
      // here. Errors are silently logged server-side.
      if (statusChanged) {
        fetch(`/api/admin/orders/${id}/notify-status`, { method: 'POST' }).catch(() => { });
      }

      await fetchOrder();
      await fetchShipmentData();
      showToast('Action successful', 'success');
    } catch (err) {
      console.error('Action failed:', err);
      showToast('Action failed', 'error');
    }
    setActionLoading('');
  }

  if (loading) return <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>Loading...</div>;
  if (!order) return <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>Order not found</div>;

  const isCOD = order.payment_method === 'cod';
  const isPending = order.order_status === 'pending';
  const isConfirmed = order.order_status === 'confirmed';
  const isCancelled = order.order_status === 'cancelled';

  return (
    <div>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}

      <button onClick={() => router.push('/admin/orders')} className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--space-4)' }}>← Back to Orders</button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, fontFamily: 'monospace' }}>{order.order_number}</h1>
          <p className="text-xs text-muted">{formatDate(order.created_at)}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <span className={`badge badge-${order.order_status}`}>{order.order_status}</span>
          <span className={`badge ${order.payment_status === 'paid' ? 'badge-paid' : 'badge-pending'}`}>
            {order.payment_method === 'cod' ? 'COD' : order.payment_status}
          </span>
        </div>
      </div>

      {/* Customer */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <p className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Customer</p>
        <p style={{ fontWeight: 500 }}>{order.customer.name}</p>
        <p className="text-sm text-muted">{order.customer.phone}</p>
        {order.customer.email && <p className="text-sm text-muted">{order.customer.email}</p>}
      </div>

      {/* Address */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <p className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Shipping Address</p>
        <p className="text-sm">{order.shipping_address.line1}</p>
        {order.shipping_address.line2 && <p className="text-sm">{order.shipping_address.line2}</p>}
        <p className="text-sm">{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}</p>
      </div>

      {/* Items — multi-line aware. Each line on its own row with
          name · size · qty and the line subtotal so admin can
          reconcile against payment-gateway totals at a glance. */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <p className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
          {lines.length > 1 ? `Items (${lines.length})` : 'Item'}
        </p>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No line items.</p>
        ) : (
          lines.map((line, idx) => (
            <div
              key={line.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 'var(--space-3)',
                paddingTop: idx === 0 ? 0 : 'var(--space-2)',
                marginTop: idx === 0 ? 0 : 'var(--space-2)',
                borderTop: idx === 0 ? 'none' : '1px solid var(--border-color)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 500 }}>{line.product_name}</p>
                <p className="text-xs text-muted">
                  Size {line.size} · Qty {line.quantity}
                </p>
              </div>
              <p style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                {formatPrice(line.subtotal_paise)}
              </p>
            </div>
          ))
        )}
        {order.coupon_code && <p className="text-xs text-muted" style={{ marginTop: 'var(--space-3)' }}>Coupon: {order.coupon_code}</p>}
      </div>

      {/* Totals breakdown */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <p className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Totals</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 4 }}>
          <span className="text-muted">Subtotal</span>
          <span>{formatPrice(order.subtotal_paise)}</span>
        </div>
        {order.discount_paise > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 4 }}>
            <span className="text-muted">Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</span>
            <span>− {formatPrice(order.discount_paise)}</span>
          </div>
        )}
        {(order.shipping_paise ?? 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 4 }}>
            <span className="text-muted">Shipping</span>
            <span>{formatPrice(order.shipping_paise ?? 0)}</span>
          </div>
        )}
        {(order.cod_fee_paise ?? 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 4 }}>
            <span className="text-muted">COD fee</span>
            <span>{formatPrice(order.cod_fee_paise ?? 0)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-color)' }}>
          <span>Total</span>
          <span>{formatPrice(order.total_paise)}</span>
        </div>
      </div>

      {/* Shipment Detail Panel */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <p className="input-label" style={{ margin: 0 }}>Shipment</p>
          {shipmentData.shipment && (
            <span style={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              padding: '2px 8px',
              background: 'var(--bg-tertiary)',
              borderRadius: 3,
              border: '1px solid var(--border-color)',
            }}>
              {shipmentData.shipment.provider_name?.toUpperCase() ?? 'KickoffPro'}
            </span>
          )}
        </div>
        <ShipmentDetailPanel
          shipment={shipmentData.shipment ?? null}
          orderNumber={order.order_number}
        />

        {/* KickoffPro: Provider Response Panel — shows forensic error details for failed shipments */}
        {shipmentData.shipment && (
          <ProviderResponsePanel
            provider={shipmentData.shipment.provider_name}
            status={shipmentData.shipment.status}
            parsedError={shipmentData.shipment.parsed_error}
            latencyMs={shipmentData.shipment.latency_ms}
            lastErrorAt={shipmentData.shipment.last_error_at}
            rawResponse={shipmentData.shipment.raw_create_response}
          />
        )}
      </div>

      {/* Shipment Timeline */}
      {shipmentData.history && shipmentData.history.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <p className="input-label" style={{ marginBottom: 'var(--space-4)' }}>Shipment History</p>
          <ShipmentTimeline
            events={shipmentData.history}
            providerName={shipmentData.shipment?.provider_name}
          />
        </div>
      )}

      {/* Actions */}
      {!isCancelled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          {/* COD Verify explicitly bounds to payment_status verified explicitly skipping shipping */}
          {isCOD && order.payment_status === 'pending' && (
            <button
              className={`btn btn-success btn-sm ${actionLoading === 'verify' ? 'btn-loading' : ''}`}
              onClick={() => handleAction('verify')}
              disabled={!!actionLoading}
              style={{ width: '100%' }}
            >
              ✓ Mark Payment Verified
            </button>
          )}

          {isPending && (
            <button
              className={`btn btn-primary ${actionLoading === 'confirm' ? 'btn-loading' : ''}`}
              onClick={() => handleAction('confirm')}
              disabled={!!actionLoading}
            >
              CONFIRM ORDER
            </button>
          )}

          {isConfirmed && !order.tracking_id && (
            <button
              className={`btn btn-primary ${actionLoading === 'ship' ? 'btn-loading' : ''}`}
              onClick={() => handleAction('ship')}
              disabled={!!actionLoading}
            >
              CREATE SHIPMENT
            </button>
          )}

          {order.order_status === 'shipped' && (
            <button
              className={`btn btn-success ${actionLoading === 'deliver' ? 'btn-loading' : ''}`}
              onClick={() => handleAction('deliver')}
              disabled={!!actionLoading}
            >
              MARK DELIVERED
            </button>
          )}

          {!showCancelForm ? (
            <button className="btn btn-ghost" onClick={() => setShowCancelForm(true)} style={{ color: 'var(--error)' }}>
              Cancel Order
            </button>
          ) : (
            <div className="card">
              <p className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Cancel Reason</p>
              <input
                className="input-field"
                placeholder="Enter reason..."
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCancelForm(false)}>Back</button>
                <button
                  className={`btn btn-danger btn-sm ${actionLoading === 'cancel' ? 'btn-loading' : ''}`}
                  onClick={() => handleAction('cancel')}
                  disabled={!cancelReason.trim() || !!actionLoading}
                  style={{ flex: 1 }}
                >
                  CANCEL ORDER
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin Notes — Premium Internal Thread */}
      <AdminNotes orderId={id} />

      {/* Cancel reason display */}
      {isCancelled && order.cancel_reason && (
        <div className="card" style={{ borderColor: 'var(--error)' }}>
          <p className="input-label" style={{ color: 'var(--error)' }}>Cancellation Reason</p>
          <p className="text-sm" style={{ marginTop: 'var(--space-2)' }}>{order.cancel_reason}</p>
        </div>
      )}
    </div>
  );
}
