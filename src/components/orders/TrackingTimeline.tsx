import React from 'react';

export interface TrackingScanItem {
  timestamp: string;
  status: string;
  location?: string;
  activity?: string;
}

function formatScanTime(raw: string): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TrackingTimeline({
  events,
  collapsible = false,
  emptyLabel = 'No courier scans recorded yet.',
}: {
  events?: TrackingScanItem[] | null;
  collapsible?: boolean;
  emptyLabel?: string;
}) {
  const list = Array.isArray(events) ? events : [];

  if (list.length === 0) {
    return (
      <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem', opacity: 0.7 }}>
        {emptyLabel}
      </p>
    );
  }

  const timelineBody = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginTop: 10,
        paddingLeft: 10,
        borderLeft: '2px solid rgba(255,255,255,0.14)',
      }}
    >
      {list.map((ev, idx) => (
        <div
          key={`${ev.timestamp}-${idx}`}
          style={{
            position: 'relative',
            paddingLeft: 10,
            fontSize: '0.75rem',
            lineHeight: 1.45,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: -15,
              top: 5,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: idx === 0 ? '#4ADE80' : 'rgba(148,163,184,0.6)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontWeight: 700 }}>
              {ev.status || ev.activity || 'Scan update'}
            </strong>
            <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>
              {formatScanTime(ev.timestamp)}
            </span>
          </div>
          {ev.activity && ev.activity !== ev.status && (
            <div style={{ opacity: 0.85, marginTop: 2 }}>{ev.activity}</div>
          )}
          {ev.location && (
            <div style={{ opacity: 0.65, fontSize: '0.7rem', marginTop: 2 }}>
              {ev.location}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (!collapsible) return timelineBody;

  const latest = list[0];
  return (
    <details style={{ marginTop: 12 }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          opacity: 0.9,
          userSelect: 'none',
        }}
      >
        Live Tracking History ({list.length}) — {latest?.status || latest?.activity || 'Latest scan'}
      </summary>
      {timelineBody}
    </details>
  );
}
