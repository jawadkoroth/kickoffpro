'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CustomerOrderActionsProps {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  hasTracking: boolean;
  returnType?: string | null;
  returnReason?: string | null;
  returnNotes?: string | null;
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
  returnType,
  returnReason,
  returnNotes,
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
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [justSubmittedReturn, setJustSubmittedReturn] = useState(false);

  const normalizedStatus = orderStatus.toLowerCase();

  // D2C rule: self-serve cancel is ONLY shown after order placement & before dispatch.
  // Once shipped (or tracking created), delivered, cancelled, or in return flow, do NOT render it.
  const canCancel =
    (normalizedStatus === 'pending' || normalizedStatus === 'confirmed') && !hasTracking;

  const canReturn = normalizedStatus === 'delivered';
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
    if (chosenReturnReason === 'Other' && !returnNoteText.trim()) {
      setReturnError('Please share a brief reason in the notes box.');
      return;
    }

    setReturnBusy(true);
    setReturnError('');
    try {
      const res = await fetch(`/api/orders/${orderId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_type: chosenReturnType,
          return_reason: chosenReturnReason,
          return_notes: returnNoteText.trim() || undefined,
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

  if (!canCancel && !canReturn && !isReturnActive) {
    return null;
  }

  return (
    <div style={{ marginBottom: '16px' }}>
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
          <p style={{ margin: '0 0 6px', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5 }}>
            Your return is getting processed. Our team will get in contact with you shortly.
          </p>
          {(returnReason || justSubmittedReturn) && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#854D0E' }}>
              Reason: <strong>{returnReason || chosenReturnReason}</strong>
              {returnNotes ? ` — ${returnNotes}` : ''}
              {returnRequestedAt
                ? ` · Requested ${new Date(returnRequestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}
            </p>
          )}
        </div>
      )}

      {/* Cancel button before dispatch */}
      {canCancel && (
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid rgba(7, 27, 58, 0.08)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#071B3A' }}>
              Need to cancel this order?
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B' }}>
              Available only until your order is dispatched.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCancelError('');
              setShowCancelModal(true);
            }}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              color: '#B91C1C',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Cancel Order
          </button>
        </div>
      )}

      {/* Return / Exchange button after delivery */}
      {canReturn && !justSubmittedReturn && (
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid rgba(7, 27, 58, 0.08)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#071B3A' }}>
              Need a size exchange or return?
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B' }}>
              Submit a quick request and our team will reach out to assist.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReturnError('');
              setShowReturnModal(true);
            }}
            style={{
              padding: '9px 18px',
              borderRadius: '8px',
              background: '#071B3A',
              border: 'none',
              color: '#FFFFFF',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Return / Exchange
          </button>
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
              Select a reason so we can stop dispatch immediately. Any prepaid amount will be refunded automatically.
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
          }}
        >
          <div
            style={{
              maxWidth: '460px',
              width: '100%',
              background: '#FFFFFF',
              borderRadius: '14px',
              padding: '22px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
              color: '#071B3A',
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>
              Return or Exchange {orderNumber}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: '#475569' }}>
              Choose what you prefer and tell us why — our team will contact you to complete the pickup.
            </p>

            {/* Exchange vs Refund */}
            <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              1. What would you like?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
              {[
                { id: 'exchange' as const, title: 'Exchange', desc: 'Swap size or replacement' },
                { id: 'refund' as const, title: 'Refund', desc: 'Return item for refund' },
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

            {/* Reason Chips */}
            <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              2. Reason for return
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
              rows={3}
              placeholder={
                chosenReturnReason === 'Other'
                  ? 'Please describe the issue or size needed...'
                  : 'Optional note (e.g. preferred exchange size)...'
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
                {returnBusy ? 'Submitting...' : 'Submit Return Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
