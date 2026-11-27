'use client';

import React from 'react';
import type { CanonicalShipmentStatus } from '@/lib/shipping/state';

interface TimelineEvent {
  id: string;
  previous_status: CanonicalShipmentStatus | null;
  next_status: CanonicalShipmentStatus;
  created_at: string;
  source: 'webhook' | 'api' | 'admin' | 'system';
  provider_payload?: Record<string, unknown> | null;
}

interface ShipmentTimelineProps {
  events: TimelineEvent[];
  providerName?: string | null;
}

const STATUS_LABELS: Record<CanonicalShipmentStatus, string> = {
  pending:            'Order placed',
  processing:         'Processing',
  shipment_created:   'Shipment created',
  picked_up:          'Picked up',
  in_transit:         'In transit',
  out_for_delivery:   'Out for delivery',
  delivered:          'Delivered',
  rto_initiated:      'RTO In Transit',
  failed:             'Delivery failed',
  returned:           'Returned',
  cancelled:          'Cancelled',
};

const STATUS_ICONS: Record<CanonicalShipmentStatus, string> = {
  pending:            '●',
  processing:         '◐',
  shipment_created:   '◉',
  picked_up:          '↑',
  in_transit:         '→',
  out_for_delivery:   '◇',
  delivered:          '✓',
  rto_initiated:      '↩',
  failed:             '✕',
  returned:           '↺',
  cancelled:          '⊘',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ShipmentTimeline({ events, providerName }: ShipmentTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-5)',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
          No shipment history available
        </p>
      </div>
    );
  }

  // Sort by time ascending (oldest first for timeline)
  const sorted = [...events].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Group by date
  const grouped = sorted.reduce((acc, event) => {
    const date = formatDateOnly(event.created_at);
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {} as Record<string, TimelineEvent[]>);

  return (
    <div style={{ position: 'relative' }}>
      {/* Vertical line */}
      <div style={{
        position: 'absolute',
        left: 11,
        top: 8,
        bottom: 8,
        width: 1,
        background: 'var(--border-color)',
        zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {Object.entries(grouped).map(([date, dateEvents], groupIndex) => (
          <div key={date} style={{ marginBottom: groupIndex < Object.keys(grouped).length - 1 ? 24 : 0 }}>
            {/* Date header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
              paddingLeft: 28,
            }}>
              <span style={{
                fontSize: '0.5625rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                padding: '2px 8px',
                background: 'var(--bg-tertiary)',
                borderRadius: 3,
              }}>
                {date}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border-color)', opacity: 0.5 }} />
            </div>

            {/* Events */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {dateEvents.map((event, index) => {
                const isLast = index === dateEvents.length - 1 && groupIndex === Object.keys(grouped).length - 1;
                const isFirst = groupIndex === 0 && index === 0;
                const isTerminal = ['delivered', 'cancelled', 'returned'].includes(event.next_status);
                const isError = event.next_status === 'failed';

                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '10px 0',
                      paddingLeft: 0,
                    }}
                  >
                    {/* Icon/dot */}
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      background: isTerminal
                        ? 'var(--success)'
                        : isError
                        ? 'var(--error)'
                        : isFirst
                        ? 'var(--text-primary)'
                        : 'var(--bg-input)',
                      border: `1px solid ${isTerminal || isError || isFirst ? 'transparent' : 'var(--border-light)'}`,
                      boxShadow: isTerminal
                        ? '0 0 0 3px rgba(76,175,80,0.15)'
                        : isError
                        ? '0 0 0 3px rgba(229,57,53,0.1)'
                        : 'none',
                    }}>
                      <span style={{
                        fontSize: '0.625rem',
                        color: isTerminal || isError || isFirst ? 'var(--bg-primary)' : 'var(--text-muted)',
                        fontWeight: 700,
                      }}>
                        {STATUS_ICONS[event.next_status]}
                      </span>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                          color: isError ? 'var(--error)' : 'var(--text-primary)',
                          textTransform: 'capitalize',
                        }}>
                          {STATUS_LABELS[event.next_status]}
                        </span>
                        <span style={{
                          fontSize: '0.625rem',
                          color: 'var(--text-muted)',
                          fontWeight: 500,
                          letterSpacing: '0.03em',
                        }}>
                          {formatDateTime(event.created_at)}
                        </span>
                      </div>

                      {/* Source badge */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 4,
                      }}>
                        <span style={{
                          fontSize: '0.5625rem',
                          fontWeight: 700,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'var(--text-muted)',
                          padding: '1px 6px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: 2,
                          border: '1px solid var(--border-color)',
                        }}>
                          {event.source}
                        </span>
                        {providerName && (
                          <span style={{
                            fontSize: '0.5625rem',
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                          }}>
                            {providerName.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
