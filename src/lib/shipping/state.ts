/**
 * KickoffPro — Canonical shipment state machine.
 *
 * Provider-specific status strings (Delhivery scan codes, Shiprocket
 * status labels, etc.) are ALWAYS mapped into CanonicalShipmentStatus
 * before touching any business logic. This ensures:
 *
 *   - The rest of the system never knows or cares which provider is active.
 *   - Status transitions are validated against a hard-coded allowed set.
 *   - Audit history is append-only and human-readable regardless of provider.
 *
 * Adding a new provider = implement the mapping in that provider's file.
 * The state machine itself never changes.
 */

export type CanonicalShipmentStatus =
  | 'pending'
  | 'processing'
  | 'shipment_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'cancelled';

/**
 * Allowed forward transitions.
 * Any `to` not listed for a given `from` is an illegal transition
 * and will be rejected by canTransition().
 *
 * Design notes:
 *   - Terminal states (delivered, cancelled, returned) are intentionally
 *     closed — no further transitions are allowed except for dispute-
 *     resolution overrides which go through the manual admin path and
 *     write an explicit audit entry.
 *   - `failed` can retry back to `pending` (retry shipment button).
 *   - `returned` can come from `in_transit` or `out_for_delivery` (RTO).
 */
const ALLOWED_TRANSITIONS: Record<CanonicalShipmentStatus, CanonicalShipmentStatus[]> = {
  pending:            ['processing', 'shipment_created', 'failed', 'cancelled'],
  processing:         ['shipment_created', 'failed', 'cancelled'],
  shipment_created:   ['picked_up', 'in_transit', 'failed', 'cancelled'],
  picked_up:          ['in_transit', 'failed', 'cancelled'],
  in_transit:         ['out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled'],
  out_for_delivery:   ['delivered', 'failed', 'returned'],
  delivered:          [],
  failed:             ['pending', 'cancelled'],
  returned:           [],
  cancelled:          [],
};

/**
 * Returns true if transitioning from `from` to `to` is a legal move.
 * Always returns true when `from` is null (initial state recording).
 */
export function canTransition(
  from: CanonicalShipmentStatus | null,
  to: CanonicalShipmentStatus,
): boolean {
  if (from === null) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Returns the next status after applying an event, or null if the
 * transition is not legal from the current state.
 */
export function applyEvent(
  currentStatus: CanonicalShipmentStatus,
  incomingStatus: CanonicalShipmentStatus,
): CanonicalShipmentStatus | null {
  if (!canTransition(currentStatus, incomingStatus)) return null;
  return incomingStatus;
}

/**
 * Maps an orders.order_status value to the nearest canonical shipment
 * status. Used during the PR 1 backfill and for legacy reads.
 */
export function orderStatusToShipmentStatus(
  orderStatus: string,
): CanonicalShipmentStatus {
  switch (orderStatus) {
    case 'delivered':  return 'delivered';
    case 'shipped':    return 'in_transit';
    case 'cancelled':  return 'cancelled';
    case 'confirmed':  return 'shipment_created';
    default:           return 'pending';
  }
}

/**
 * Maps a canonical shipment status back to the closest orders.order_status
 * for the denormalised back-compat column update.
 * Only terminal / milestone statuses cause an order status change.
 */
export function shipmentStatusToOrderStatus(
  shipmentStatus: CanonicalShipmentStatus,
): string | null {
  switch (shipmentStatus) {
    case 'shipment_created': return 'confirmed';
    case 'in_transit':       return 'shipped';
    case 'out_for_delivery': return 'shipped';
    case 'delivered':        return 'delivered';
    case 'cancelled':        return 'cancelled';
    case 'returned':         return 'cancelled';
    default:                 return null;
  }
}

/**
 * Delhivery scan-code → canonical status mapping.
 * Reference: Delhivery tracking API status codes.
 * Unknown codes map to null (caller decides whether to ignore or flag).
 */
export function mapDelhiveryStatus(
  rawStatus: string,
): CanonicalShipmentStatus | null {
  const s = rawStatus?.toUpperCase?.() ?? '';
  if (['DLVD', 'DELIVERED'].includes(s))              return 'delivered';
  if (['OFD', 'OUT FOR DELIVERY'].includes(s))        return 'out_for_delivery';
  if (['IT', 'IN TRANSIT', 'PKD', 'PACKED'].includes(s)) return 'in_transit';
  if (['PU', 'PICKED UP', 'PICKUP'].includes(s))      return 'picked_up';
  if (['SHP', 'SHIPMENT CREATED', 'MANIFESTED'].includes(s)) return 'shipment_created';
  if (['RTO', 'RTO INITIATED', 'RTO DELIVERED', 'RETURNED'].includes(s)) return 'returned';
  if (['CNL', 'CANCELLED', 'CANCEL'].includes(s))     return 'cancelled';
  if (['FAILED', 'UNDELIVERED', 'UD'].includes(s))    return 'failed';
  return null;
}
