'use client';

/**
 * Lightweight, dependency-free SVG charts for the admin dashboard.
 *
 * Choosing inline SVG over a charting library because:
 *   - Zero kB of vendor JS shipped to the admin bundle.
 *   - Full control over the premium dark + gold accent palette
 *     mandated by the design brief (no neon / no flashy gradients).
 *   - No hydration concerns: pure derived markup from props.
 *
 * Two charts:
 *   1. Revenue trend  — line + area (gold accent).
 *   2. Order trend    — bars (subtle bright stroke).
 * Plus a horizontal payment-method split bar.
 */

interface TrendPoint {
  day: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

const ACCENT_COLOR = '#2FA9F5';
const TEXT_MUTED = 'var(--text-muted, #8A8A8A)';
const BORDER = 'rgba(255,255,255,0.08)';

function shortDay(d: string): string {
  // 'YYYY-MM-DD' → 'DD' for tiny x-axis labels.
  return d.slice(8);
}

function formatPrice(paise: number): string {
  if (paise >= 100000) return '₹' + Math.round(paise / 1000) / 100 + 'L';
  if (paise >= 1000) return '₹' + Math.round(paise / 100) + '';
  return '₹' + Math.round(paise / 100);
}

export function RevenueTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <EmptyChart label="No revenue data in the selected range." />
    );
  }
  const W = 600;
  const H = 160;
  const padX = 32;
  const padY = 16;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const stepX = (W - padX * 2) / Math.max(1, data.length - 1);
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = H - padY - (d.revenue / max) * (H - padY * 2);
    return [x, y] as const;
  });
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1][0]},${H - padY} L${points[0][0]},${H - padY} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Revenue trend chart"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="kickoffpro-revenue-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={ACCENT_COLOR} stopOpacity="0.22" />
          <stop offset="100%" stopColor={ACCENT_COLOR} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* horizontal gridline at midpoint */}
      <line
        x1={padX}
        x2={W - padX}
        y1={H / 2}
        y2={H / 2}
        stroke={BORDER}
        strokeDasharray="2 4"
      />
      <path d={areaPath} fill="url(#kickoffpro-revenue-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke={ACCENT_COLOR}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.5} fill={ACCENT_COLOR} />
      ))}
      {/* x-axis labels: only first, middle, last to avoid clutter */}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((i) => (
          <text
            key={i}
            x={padX + i * stepX}
            y={H - 2}
            textAnchor="middle"
            fontSize="10"
            fill={TEXT_MUTED as string}
          >
            {shortDay(data[i].day)}
          </text>
        ))}
      {/* y-axis max */}
      <text x={padX - 4} y={padY + 8} textAnchor="end" fontSize="10" fill={TEXT_MUTED as string}>
        {formatPrice(max)}
      </text>
    </svg>
  );
}

export function OrderTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No orders in the selected range." />;
  }
  const W = 600;
  const H = 120;
  const padX = 32;
  const padY = 12;
  const max = Math.max(1, ...data.map((d) => d.orders));
  const slot = (W - padX * 2) / data.length;
  const barW = Math.max(2, slot * 0.55);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Order trend chart"
      style={{ display: 'block' }}
    >
      {data.map((d, i) => {
        const h = (d.orders / max) * (H - padY * 2);
        const x = padX + i * slot + (slot - barW) / 2;
        const y = H - padY - h;
        return (
          <rect
            key={d.day}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={1.5}
            fill="rgba(236,236,236,0.85)"
          />
        );
      })}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((i) => (
          <text
            key={i}
            x={padX + i * slot + slot / 2}
            y={H - 2}
            textAnchor="middle"
            fontSize="10"
            fill={TEXT_MUTED as string}
          >
            {shortDay(data[i].day)}
          </text>
        ))}
      <text x={padX - 4} y={padY + 8} textAnchor="end" fontSize="10" fill={TEXT_MUTED as string}>
        {max}
      </text>
    </svg>
  );
}

export function PaymentSplitBar({
  online,
  cod,
}: {
  online: number;
  cod: number;
}) {
  const total = Math.max(1, online + cod);
  const pctOnline = Math.round((online / total) * 100);
  const pctCod = 100 - pctOnline;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          background: BORDER,
        }}
      >
        <div
          style={{
            width: `${pctOnline}%`,
            background: ACCENT_COLOR,
            transition: 'width 320ms ease',
          }}
          aria-label={`Online ${pctOnline} percent`}
        />
        <div
          style={{
            width: `${pctCod}%`,
            background: 'rgba(236,236,236,0.65)',
            transition: 'width 320ms ease',
          }}
          aria-label={`COD ${pctCod} percent`}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 8,
          fontSize: '0.75rem',
          color: TEXT_MUTED as string,
        }}
      >
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: ACCENT_COLOR,
              marginRight: 6,
            }}
          />
          Online {online} ({pctOnline}%)
        </span>
        <span>
          COD {cod} ({pctCod}%)
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: 'rgba(236,236,236,0.65)',
              marginLeft: 6,
            }}
          />
        </span>
      </div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      style={{
        height: 120,
        display: 'grid',
        placeItems: 'center',
        color: TEXT_MUTED as string,
        fontSize: '0.8125rem',
        border: `1px dashed ${BORDER}`,
        borderRadius: 8,
      }}
    >
      {label}
    </div>
  );
}
