'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getReturnWindowState } from '@/lib/orders/returnWindow';

export interface CustomerOrderLine {
  id: string;
  product_id: string;
  product_name: string;
  size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
  available_sizes?: string[];
}

export interface StoredReturnItemView {
  order_item_id: string;
  product_id: string;
  title: string;
  current_size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
  requested_size?: string | null;
}

interface CustomerOrderActionsProps {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  hasTracking: boolean;
  deliveredAt?: string | null;
  updatedAt?: string | null;
  items?: CustomerOrderLine[];
  hasOfferApplied?: boolean;
  totalPaise?: number;
  shippingPaise?: number | null;
  codFeePaise?: number | null;
  returnType?: string | null;
  returnReason?: string | null;
  returnNotes?: string | null;
  returnItems?: StoredReturnItemView[] | null;
  estimatedRefundPaise?: number | null;
  returnStatus?: string | null;
  returnRequestedAt?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  onUpdated?: () => void;
}

const CANCEL_REASONS = [
  'Ordered by mistake',
  'Wrong size selected',
  'Need to update delivery address',
  'Expected delivery too late',
  'Other',
];

const RETURN_REASONS = [
  'Size too small',
  'Size too large',
  'Defective / Damaged item',
  'Wrong item received',
  'Fabric / Fit not as expected',
  'Other',
];

function formatPrice(paise: number): string {
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

function formatReturnStatus(status?: string | null): string {
  const map: Record<string, string> = {
    requested: 'Processing Request',
    approved: 'Approved — Team Contacting You',
    pickup_scheduled: 'Pickup Scheduled',
    received: 'Received at Warehouse',
    completed: 'Completed',
    rejected: 'Closed',
  };
  return (status && map[status]) || 'Processing Request';
}

export default function CustomerOrderActions({
  orderId,
  orderNumber,
  orderStatus,
  hasTracking,
  deliveredAt,
  updatedAt,
  items = [],
  hasOfferApplied = false,
  totalPaise = 0,
  shippingPaise = 0,
  codFeePaise = 0,
  returnType,
  returnReason,
  returnNotes,
  returnItems,
  estimatedRefundPaise,
  returnStatus,
  returnRequestedAt,
  guestEmail,
  guestPhone,
  onUpdated,
}: CustomerOrderActionsProps) {
  const router = useRouter();

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelOtherNote, setCancelOtherNote] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [chosenReturnType, setChosenReturnType] = useState<'exchange' | 'refund'>('exchange');
  const [chosenReturnReason, setChosenReturnReason] = useState(RETURN_REASONS[0]);
  const [returnNoteText, setReturnNoteText] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() =>
    items.length === 1 ? new Set([items[0].id]) : new Set(),
  );
  const [exchangeSizeMap, setExchangeSizeMap] = useState<Record<string, string>>({});
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [justSubmittedReturn, setJustSubmittedReturn] = useState(false);

  // Sync default item selection & prefill new sizes when items prop or modal opens
  useEffect(() => {
    if (items.length === 0) return;
    setSelectedItemIds((prev) => {
      if (chosenReturnType === 'refund' && hasOfferApplied) {
        return new Set(items.map((it) => it.id));
      }
      if (items.length === 1) {
        return new Set([items[0].id]);
      }
      return prev;
    });
    setExchangeSizeMap((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (!next[it.id]) {
          const sizes = it.available_sizes?.length
            ? it.available_sizes
            : ['S', 'M', 'L', 'XL', 'XXL'];
          const alternate = sizes.find((s) => s !== it.size) || sizes[0];
          next[it.id] = alternate;
        }
      }
      return next;
    });
  }, [items, chosenReturnType, hasOfferApplied]);

  const normalizedStatus = orderStatus.toLowerCase();

  const canCancel =
    (normalizedStatus === 'pending' || normalizedStatus === 'confirmed') && !hasTracking;

  const returnWindow = getReturnWindowState({
    order_status: normalizedStatus,
    delivered_at: deliveredAt,
    updated_at: updatedAt,
  });

  const canReturn = normalizedStatus === 'delivered' && returnWindow.eligible;
  const returnWindowClosed = normalizedStatus === 'delivered' && returnWindow.expired;
  const isReturnActive =
    normalizedStatus === 'return_requested' ||
    normalizedStatus === 'returned' ||
    justSubmittedReturn;

  function notifyParent() {
    if (onUpdated) {
      onUpdated();
    } else {
      router.refresh();
    }
  }

  function toggleItem(itemId: string) {
    if (chosenReturnType === 'refund' && hasOfferApplied) return; // Locked to full order
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        if (items.length > 1) next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  const effectiveSelectedItems =
    chosenReturnType === 'refund' && hasOfferApplied
      ? items
      : items.filter((it) => selectedItemIds.has(it.id));

  const computedEstimatedRefundPaise =
    chosenReturnType === 'refund'
      ? effectiveSelectedItems.length === items.length && totalPaise > 0
        ? Math.max(0, totalPaise - (shippingPaise ?? 0) - (codFeePaise ?? 0))
        : effectiveSelectedItems.reduce((sum, it) => sum + it.subtotal_paise, 0)
      : 0;

  async function handleCancelSubmit() {
    if (cancelBusy) return;
    const finalReason =
      cancelReason === 'Other'
        ? cancelOtherNote.trim() || 'Cancelled by customer'
        : cancelReason;
    if (cancelReason === 'Other' && !cancelOtherNote.trim()) {
      setCancelError('Please tell us briefly why you want to cancel.');
      return;
    }

    setCancelBusy(true);
    setCancelError('');
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: finalReason,
          email: guestEmail || undefined,
          phone: guestPhone || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setCancelError(json.error || 'Could not cancel order');
        return;
      }
      setShowCancelModal(false);
      notifyParent();
    } catch {
      setCancelError('Network error while cancelling order.');
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleReturnSubmit() {
    if (returnBusy) return;
    if (effectiveSelectedItems.length === 0) {
      setReturnError('Please select at least one item.');
      return;
    }
    if (chosenReturnType === 'exchange') {
      for (const it of effectiveSelectedItems) {
        if (!exchangeSizeMap[it.id]) {
          setReturnError(`Please choose a new size for ${it.product_name}.`);
          return;
        }
      }
    }
    if (chosenReturnReason === 'Other' && !returnNoteText.trim()) {
      setReturnError('Please share a brief reason in the notes box.');
      return;
    }

    setReturnBusy(true);
    setReturnError('');
    try {
      const payloadItems = effectiveSelectedItems.map((it) => ({
        order_item_id: it.id,
        requested_size: chosenReturnType === 'exchange' ? exchangeSizeMap[it.id] : null,
      }));

      const res = await fetch(`/api/orders/${orderId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_type: chosenReturnType,
          return_reason: chosenReturnReason,
          return_notes: returnNoteText.trim() || undefined,
          return_items: payloadItems,
          email: guestEmail || undefined,
          phone: guestPhone || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setReturnError(json.error || 'Could not submit return request.');
        return;
      }
      setShowReturnModal(false);
      setJustSubmittedReturn(true);
      notifyParent();
    } catch {
      setReturnError('Network error submitting return request.');
    } finally {
      setReturnBusy(false);
    }
  }

  if (!canCancel && !canReturn && !returnWindowClosed && !isReturnActive) {
    return null;
  }

  return (
    <div style={{ marginTop: '20px', marginBottom: '8px' }}>
      {/* Return in-progress status banner */}
      {isReturnActive && (
        <div
          style={{
            background: '#FEFCE8',
            border: '1px solid #FDE047',
            borderRadius: '12px',
            padding: '16px 18px',
            color: '#713F12',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {(returnType || chosenReturnType) === 'exchange' ? 'Exchange Request' : 'Refund Return Request'}
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#FEF08A',
                color: '#854D0E',
                textTransform: 'uppercase',
              }}
            >
              {formatReturnStatus(returnStatus)}
            </span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5 }}>
            Your return is getting processed. Our team will get in contact with you shortly.
          </p>
          {(returnReason || justSubmittedReturn) && (
            <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: '#854D0E' }}>
              Reason: <strong>{returnReason || chosenReturnReason}</strong>
              {returnNotes ? ` — ${returnNotes}` : ''}
              {returnRequestedAt
                ? ` · Requested ${new Date(returnRequestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}
            </p>
          )}
          {Array.isArray(returnItems) && returnItems.length > 0 && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(161, 98, 7, 0.2)', fontSize: '0.78rem' }}>
              {returnItems.map((ri) => (
                <div key={ri.order_item_id}>
                  • {ri.title} (Qty {ri.quantity}) — Size {ri.current_size}
                  {ri.requested_size ? ` → ${ri.requested_size}` : ''}
                </div>
              ))}
              {typeof estimatedRefundPaise === 'number' && estimatedRefundPaise > 0 && (
                <div style={{ marginTop: '4px', fontWeight: 700 }}>
                  Estimated Refund: {formatPrice(estimatedRefundPaise)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subtle, low-emphasis Cancel link/footer (placed at very bottom of page) */}
      {canCancel && (
        <div
          style={{
            padding: '12px 4px',
            borderTop: '1px solid rgba(7, 27, 58, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
            Changed your mind before dispatch?
          </span>
          <button
            type="button"
            onClick={() => {
              setCancelError('');
              setShowCancelModal(true);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'transparent',
              border: '1px solid rgba(7, 27, 58, 0.14)',
              color: '#64748B',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel Order
          </button>
        </div>
      )}

      {/* Subtle, low-emphasis Return / Exchange footer (strict 7-day window) */}
      {canReturn && !justSubmittedReturn && (
        <div
          style={{
            padding: '12px 4px',
            borderTop: '1px solid rgba(7, 27, 58, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
            Size issue or defect? Eligible until{' '}
            {returnWindow.expiresAtIso
              ? new Date(returnWindow.expiresAtIso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '7 days from delivery'}
            .
          </span>
          <button
            type="button"
            onClick={() => {
              setReturnError('');
              setShowReturnModal(true);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              background: '#F8FAFC',
              border: '1px solid rgba(7, 27, 58, 0.16)',
              color: '#334155',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Request Return / Exchange
          </button>
        </div>
      )}

      {returnWindowClosed && !justSubmittedReturn && (
        <div
          style={{
            padding: '10px 4px',
            borderTop: '1px solid rgba(7, 27, 58, 0.06)',
            fontSize: '0.75rem',
            color: '#94A3B8',
          }}
        >
          7-day return &amp; exchange window closed.
        </div>
      )}

      {/* Cancel Order Modal */}
      {showCancelModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 27, 58, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              maxWidth: '440px',
              width: '100%',
              background: '#FFFFFF',
              borderRadius: '14px',
              padding: '22px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
              color: '#071B3A',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 800 }}>
              Cancel Order {orderNumber}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: '#475569' }}>
              Select a reason so we can stop dispatch immediately. Any prepaid amount will be reviewed and refunded within 5–7 business days.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {CANCEL_REASONS.map((r) => {
                const active = cancelReason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCancelReason(r)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${active ? '#DC2626' : '#CBD5E1'}`,
                      background: active ? '#FEF2F2' : '#F8FAFC',
                      color: active ? '#B91C1C' : '#334155',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                );
              })}
            </div>

            {cancelReason === 'Other' && (
              <textarea
                rows={3}
                placeholder="Tell us why you are cancelling..."
                value={cancelOtherNote}
                onChange={(e) => setCancelOtherNote(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  marginBottom: '12px',
                }}
              />
            )}

            {cancelError && (
              <p style={{ color: '#DC2626', fontSize: '0.8rem', margin: '0 0 12px', fontWeight: 600 }}>
                {cancelError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={cancelBusy}
                onClick={() => setShowCancelModal(false)}
                style={{
                  padding: '9px 14px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Keep Order
              </button>
              <button
                type="button"
                disabled={cancelBusy}
                onClick={handleCancelSubmit}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: cancelBusy ? 'not-allowed' : 'pointer',
                  opacity: cancelBusy ? 0.7 : 1,
                }}
              >
                {cancelBusy ? 'Cancelling...' : 'Confirm Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return / Exchange Modal */}
      {showReturnModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 27, 58, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              maxWidth: '500px',
              width: '100%',
              background: '#FFFFFF',
              borderRadius: '14px',
              padding: '22px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
              color: '#071B3A',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>
              Return or Exchange {orderNumber}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: '#475569' }}>
              Choose your option, select item(s), and tell us why — our team will contact you shortly.
            </p>

            {/* 1. Exchange vs Refund */}
            <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              1. What would you like?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
              {[
                { id: 'exchange' as const, title: 'Exchange', desc: 'Swap size or replacement' },
                { id: 'refund' as const, title: 'Refund', desc: 'Return item(s) for refund' },
              ].map((opt) => {
                const active = chosenReturnType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setChosenReturnType(opt.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: `2px solid ${active ? '#071B3A' : '#E2E8F0'}`,
                      background: active ? '#F0F9FF' : '#FFFFFF',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#071B3A' }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '2px' }}>
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Offer Protection Notice */}
            {chosenReturnType === 'refund' && hasOfferApplied && (
              <div
                style={{
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  color: '#92400E',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '0.78rem',
                  marginBottom: '12px',
                  lineHeight: 1.45,
                }}
              >
                Because a promotional offer/coupon was applied to this order, refunds are only available for the full order. You can still exchange individual item sizes!
              </div>
            )}

            {/* 2. Item-Level Selection (+ New Size Picker for Exchange) */}
            {items.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
                  {chosenReturnType === 'exchange'
                    ? '2. Select item(s) & new size'
                    : hasOfferApplied
                      ? '2. Full order items included in refund'
                      : '2. Select item(s) to refund'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {items.map((it) => {
                    const lockedFull = chosenReturnType === 'refund' && hasOfferApplied;
                    const checked = lockedFull || selectedItemIds.has(it.id);
                    const sizes = it.available_sizes?.length
                      ? it.available_sizes
                      : ['S', 'M', 'L', 'XL', 'XXL'];
                    return (
                      <div
                        key={it.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: `1px solid ${checked ? '#0284C7' : '#E2E8F0'}`,
                          background: checked ? '#F8FAFC' : '#FFFFFF',
                        }}
                      >
                        <label style={{ display: 'flex', gap: '10px', alignItems: 'center', cursor: lockedFull ? 'default' : 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={lockedFull}
                            onChange={() => toggleItem(it.id)}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#071B3A' }}>
                              {it.product_name}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                              Current Size: <strong>{it.size}</strong> · Qty {it.quantity} · {formatPrice(it.subtotal_paise)}
                            </div>
                          </div>
                        </label>

                        {checked && chosenReturnType === 'exchange' && (
                          <div style={{ marginTop: '8px', paddingLeft: '24px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#475569' }}>
                              New Size:
                            </span>
                            <select
                              aria-label={`New size for ${it.product_name}`}
                              value={exchangeSizeMap[it.id] || ''}
                              onChange={(e) =>
                                setExchangeSizeMap((prev) => ({ ...prev, [it.id]: e.target.value }))
                              }
                              style={{
                                padding: '5px 10px',
                                borderRadius: '6px',
                                border: '1px solid #CBD5E1',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                background: '#FFFFFF',
                                color: '#071B3A',
                              }}
                            >
                              {sizes.map((sz) => (
                                <option key={sz} value={sz}>
                                  {sz === it.size ? `${sz} (Current Size)` : sz}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {chosenReturnType === 'refund' && effectiveSelectedItems.length > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: '#F0F9FF',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#0369A1',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Estimated Refund Amount</span>
                    <span>{formatPrice(computedEstimatedRefundPaise)}</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Reason Chips */}
            <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              3. Reason for return
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {RETURN_REASONS.map((r) => {
                const active = chosenReturnReason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setChosenReturnReason(r)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${active ? '#0284C7' : '#CBD5E1'}`,
                      background: active ? '#E0F2FE' : '#F8FAFC',
                      color: active ? '#0369A1' : '#334155',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                );
              })}
            </div>

            <textarea
              rows={2}
              placeholder={
                chosenReturnReason === 'Other'
                  ? 'Please describe the issue...'
                  : 'Optional note for our support team...'
              }
              value={returnNoteText}
              onChange={(e) => setReturnNoteText(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontSize: '0.85rem',
                marginBottom: '12px',
              }}
            />

            {returnError && (
              <p style={{ color: '#DC2626', fontSize: '0.8rem', margin: '0 0 12px', fontWeight: 600 }}>
                {returnError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={returnBusy}
                onClick={() => setShowReturnModal(false)}
                style={{
                  padding: '9px 14px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={returnBusy}
                onClick={handleReturnSubmit}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#071B3A',
                  color: '#FFFFFF',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: returnBusy ? 'not-allowed' : 'pointer',
                  opacity: returnBusy ? 0.7 : 1,
                }}
              >
                {returnBusy ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
