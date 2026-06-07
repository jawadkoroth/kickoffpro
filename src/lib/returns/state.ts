/**
 * KickoffPro Returns & Exchange State Machine
 * 
 * Canonical states for return/exchange flow:
 * - User initiates request
 * - Admin manually approves/rejects
 * - Reverse pickup handled provider-side
 * - Future: automated provider integration
 */

export type ReturnRequestType = 'return' | 'exchange';
export type ReturnRequestStatus =
  | 'requested'      // User submitted request
  | 'under_review'   // Admin reviewing
  | 'approved'       // Admin approved, pending pickup
  | 'rejected'       // Admin rejected with reason
  | 'pickup_scheduled' // Reverse pickup scheduled
  | 'picked_up'      // Item collected from customer
  | 'in_transit'     // Return shipment in transit
  | 'received'       // Item received at warehouse
  | 'inspection'     // Quality check in progress
  | 'refund_issued'  // Refund processed
  | 'exchange_shipped' // Exchange item dispatched
  | 'completed'      // Process fully complete
  | 'cancelled';     // User cancelled before processing

export interface ReturnRequest {
  id: string;
  order_id: string;
  order_item_id: string; // Specific item being returned
  user_id: string;

  // Request details
  type: ReturnRequestType;
  status: ReturnRequestStatus;

  // Reasoning
  reason: string;
  reason_details?: string;
  images?: string[]; // URLs to uploaded images

  // Admin review
  admin_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;

  // Pickup/shipping info
  pickup_address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  pickup_scheduled_at?: string;
  pickup_tracking_id?: string;

  // For exchanges
  exchange_product_id?: string; // Reference to desired product
  exchange_size?: string; // Desired size (stored as text, no FK)
  exchange_order_id?: string; // Reference to new order for exchange

  // Financial
  refund_amount_paise: number;
  refund_method: 'original' | 'store_credit' | 'bank_transfer';
  refund_processed_at?: string;

  // Item condition on receipt
  received_condition?: 'excellent' | 'good' | 'damaged' | 'missing_parts';
  restocking_fee_paise?: number;

  // Timestamps
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// Valid state transitions
export const VALID_RETURN_TRANSITIONS: Record<ReturnRequestStatus, ReturnRequestStatus[]> = {
  requested: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected'],
  approved: ['pickup_scheduled', 'completed'],
  rejected: ['under_review'], // Can reopen if needed
  pickup_scheduled: ['picked_up', 'cancelled'],
  picked_up: ['in_transit'],
  in_transit: ['received'],
  received: ['inspection'],
  inspection: ['refund_issued', 'exchange_shipped', 'rejected'],
  refund_issued: ['completed'],
  exchange_shipped: ['completed'],
  completed: [], // Terminal state
  cancelled: ['under_review'], // Can reopen
};

// User-visible status labels
export const RETURN_STATUS_LABELS: Record<ReturnRequestStatus, string> = {
  requested: 'Return Requested',
  under_review: 'Under Review',
  approved: 'Return Approved',
  rejected: 'Request Rejected',
  pickup_scheduled: 'Pickup Scheduled',
  picked_up: 'Item Picked Up',
  in_transit: 'In Transit',
  received: 'Received at Warehouse',
  inspection: 'Quality Inspection',
  refund_issued: 'Refund Processed',
  exchange_shipped: 'Exchange Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Check if transition is valid
export function canTransitionReturn(
  currentStatus: ReturnRequestStatus,
  newStatus: ReturnRequestStatus
): boolean {
  return VALID_RETURN_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

// Timeline display order
export const RETURN_TIMELINE_ORDER: ReturnRequestStatus[] = [
  'requested',
  'under_review',
  'approved',
  'pickup_scheduled',
  'picked_up',
  'in_transit',
  'received',
  'inspection',
  'refund_issued',
  'exchange_shipped',
  'completed',
];

// Is status considered "resolved" (no further action needed)
export function isReturnResolved(status: ReturnRequestStatus): boolean {
  return ['completed', 'rejected', 'cancelled'].includes(status);
}

// Is status "in progress" (requires admin attention)
export function isReturnInProgress(status: ReturnRequestStatus): boolean {
  return [
    'requested',
    'under_review',
    'approved',
    'pickup_scheduled',
    'picked_up',
    'in_transit',
    'received',
    'inspection',
  ].includes(status);
}
