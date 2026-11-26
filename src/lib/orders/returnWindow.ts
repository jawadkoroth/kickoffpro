export const RETURN_WINDOW_DAYS = 7;
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface ReturnWindowState {
  eligible: boolean;
  expired: boolean;
  anchorIso: string | null;
  expiresAtIso: string | null;
  daysRemaining: number;
}

/**
 * Computes whether a delivered order is still inside the strict 7-day
 * return/exchange window anchored to `delivered_at` (with fallback to `updated_at`
 * only for legacy delivered orders missing `delivered_at`).
 */
export function getReturnWindowState(
  order: {
    order_status: string;
    delivered_at?: string | null;
    updated_at?: string | null;
  },
  nowMs = Date.now(),
): ReturnWindowState {
  const anchorIso = order.delivered_at || order.updated_at || null;
  if (!anchorIso) {
    return {
      eligible: false,
      expired: true,
      anchorIso: null,
      expiresAtIso: null,
      daysRemaining: 0,
    };
  }

  const anchorMs = Date.parse(anchorIso);
  if (Number.isNaN(anchorMs)) {
    return {
      eligible: false,
      expired: true,
      anchorIso: null,
      expiresAtIso: null,
      daysRemaining: 0,
    };
  }

  const expiresAtMs = anchorMs + RETURN_WINDOW_MS;
  const remainingMs = expiresAtMs - nowMs;
  const isDelivered = order.order_status.toLowerCase() === 'delivered';
  const withinWindow = remainingMs >= 0;

  return {
    eligible: isDelivered && withinWindow,
    expired: !withinWindow,
    anchorIso,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    daysRemaining: withinWindow ? Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))) : 0,
  };
}
