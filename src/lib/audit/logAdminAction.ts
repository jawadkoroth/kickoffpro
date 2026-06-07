import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * KickoffPro — Admin audit log helper.
 *
 * Fire-and-forget write into `admin_audit_log`. The helper never
 * throws; any failure is logged to stderr and swallowed so audit
 * logging can NEVER break a business action. Use the service-role
 * admin client (`createAdminClient()`), because RLS on the table
 * blocks writes from the anon / user path by design.
 *
 * Usage:
 *
 *   await logAdminAction(supabaseAdmin, {
 *     adminId: user.id,
 *     action: 'coupon.delete',
 *     entityType: 'coupon',
 *     entityId: couponId,
 *     metadata: { code: 'WELCOME10' },
 *   });
 *
 * Action naming convention:
 *   <entity>.<verb>     e.g. "product.archive", "coupon.create",
 *                            "order.bulk_cancel", "shipping.update"
 *
 * Metadata should stay small (< 4 KB). For large diffs, log only
 * the changed fields, not the full row.
 */

export interface LogAdminActionInput {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAdminAction(
  supabase: SupabaseClient,
  input: LogAdminActionInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_id: input.adminId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error('[AUDIT_LOG_WRITE]', error.message, {
        action: input.action,
        entityType: input.entityType,
      });
    }
  } catch (err) {
    // Last-line: never let audit failure escape to the caller.
    console.error('[AUDIT_LOG_UNEXPECTED]', err);
  }
}
