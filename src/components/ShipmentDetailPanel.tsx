'use client';

import React from 'react';
import type { CanonicalShipmentStatus } from '@/lib/shipping/state';

interface ShipmentDetail {
  id: string;
  tracking_id: string | null;
  provider_name: string | null;
  status: CanonicalShipmentStatus;
  label_url: string | null;
  created_at: string;
  last_provider_event_at: string | null;
  environment: string | null;
  failure_reason: string | null;
}

interface ShipmentDetailPanelProps {
  shipment: ShipmentDetail | null;
  orderNumber: string;
}

const STATUS_COLORS: Record<CanonicalShipmentStatus, string> = {
  pending: 'var(--text-muted)',
  processing: 'var(--text-muted)',
  shipment_created: 'var(--text-secondary)',
  picked_up: 'var(--text-secondary)',
  in_transit: 'var(--text-accent)',
  out_for_delivery: 'var(--text-accent)',
  delivered: 'var(--success)',
  rto_initiated: 'var(--warning)',
  failed: 'var(--error)',
  returned: 'var(--warning)',
  cancelled: 'var(--text-muted)',
};

const STATUS_LABELS: Record<CanonicalShipmentStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipment_created: 'Shipment created',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  rto_initiated: 'RTO In Transit',
  failed: 'Failed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusDot({ status }: { status: CanonicalShipmentStatus }) {
  const color = STATUS_COLORS[status];
  const isTerminal = ['delivered', 'cancelled', 'returned'].includes(status);
  const isError = status === 'failed';

  return (
    <div style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      boxShadow: isTerminal
        ? '0 0 0 3px rgba(76,175,80,0.15)'
        : isError
          ? '0 0 0 3px rgba(229,57,53,0.1)'
          : 'none',
    }} />
  );
}

export function ShipmentDetailPanel({ shipment, orderNumber }: ShipmentDetailPanelProps) {
  if (!shipment) {
    return (
      <div style={{
        padding: 'var(--space-5)',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, marginBottom: 8 }}>
          No shipment created for this order
        </p>
        <p style={{ fontSize: '0.625rem', color: 'var(--text-muted)', margin: 0 }}>
          Click "CREATE SHIPMENT" to initiate fulfillment
        </p>
      </div>
    );
  }

  const fields = [
    { label: 'Provider', value: shipment.provider_name?.toUpperCase() ?? '—' },
    { label: 'AWB / Tracking', value: shipment.tracking_id ?? '—' },
    { label: 'Order', value: orderNumber },
    { label: 'Environment', value: (shipment.environment ?? 'sandbox').toUpperCase() },
    { label: 'Created', value: formatDateTime(shipment.created_at) },
    { label: 'Last update', value: formatDateTime(shipment.last_provider_event_at) },
  ];

  return (
    <div>
      {/* Status header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        marginBottom: 16,
      }}>
        <StatusDot status={shipment.status} />
        <div>
          <div style={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            textTransform: 'capitalize',
          }}>
            {STATUS_LABELS[shipment.status]}
          </div>
          <div style={{
            fontSize: '0.625rem',
            color: 'var(--text-muted)',
            marginTop: 2,
            letterSpacing: '0.03em',
          }}>
            Last updated: {formatDateTime(shipment.last_provider_event_at)}
          </div>
        </div>

        {/* Label button */}
        {shipment.label_url && (
          <a
            href={shipment.label_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginLeft: 'auto',
              fontSize: '0.625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              padding: '6px 12px',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLAnchorElement).style.background = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLAnchorElement).style.background = 'transparent';
            }}
          >
            Label ↗
          </a>
        )}
      </div>

      {/* Detail grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 2,
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
      }}>
        {fields.map((field) => (
          <div
            key={field.label}
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-color)',
              borderRight: '1px solid var(--border-color)',
            }}
          >
            <div style={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}>
              {field.label}
            </div>
            <div style={{
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {field.value}
            </div>
          </div>
        ))}
      </div>

      {/* Error state */}
      {shipment.failure_reason && (
        <div style={{
          marginTop: 12,
          padding: 'var(--space-4)',
          background: 'rgba(229,57,53,0.08)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(229,57,53,0.2)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}>
            <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>⚠</span>
            <span style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              color: 'var(--error)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Shipment Error
            </span>
          </div>
          <p style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            margin: 0,
            lineHeight: 1.6,
          }}>
            {shipment.failure_reason}
          </p>
        </div>
      )}
    </div>
  );
}
