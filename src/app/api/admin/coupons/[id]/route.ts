import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAdminAction } from '@/lib/audit/logAdminAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/coupons/:id
 *
 * Hard-deletes a coupon row. Admin-only.
 *
 * Safe to hard-delete because `orders.coupon_code` stores the code
 * as plain TEXT (snapshot), not a FK to `coupons.id`. Historical
 * orders keep their recorded code even if the coupon is removed.
 *
 * Writes an audit-log row before returning so the action is traceable.
 */

async function gateAdmin() {
  const ssr = await createServerSupabaseClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return { ok: false as const, status: 401, message: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (!row) return { ok: false as const, status: 403, message: 'Not admin' };
  return { ok: true as const, admin, adminId: user.id };
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return apiError(400, 'Invalid coupon id');
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiError(400, 'Invalid JSON body');
  }

  const payload = body as Record<string, unknown>;
  if (payload.show_on_homepage === true) {
    const { data: existingHomepage } = await gate.admin
      .from('coupons')
      .select('id, code')
      .eq('show_on_homepage', true)
      .neq('id', id)
      .limit(1)
      .maybeSingle();

    if (existingHomepage) {
      return apiError(
        409,
        `Homepage banner is currently active on ${existingHomepage.code} — uncheck it there first to switch.`,
      );
    }
  }

  const { data, error } = await gate.admin
    .from('coupons')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return apiError(400, error.message || 'Failed to update coupon');
  }

  return apiSuccess({ coupon: data });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return apiError(400, 'Invalid coupon id');
  }

  // Fetch the code first so the audit row carries a human-readable
  // hint even after the row is gone.
  const { data: existing } = await gate.admin
    .from('coupons')
    .select('id, code')
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return apiError(404, 'Coupon not found');
  }

  const { error } = await gate.admin.from('coupons').delete().eq('id', id);
  if (error) {
    console.error('[ADMIN_COUPON_DELETE]', error);
    return apiError(500, 'Failed to delete coupon');
  }

  await logAdminAction(gate.admin, {
    adminId: gate.adminId,
    action: 'coupon.delete',
    entityType: 'coupon',
    entityId: id,
    metadata: { code: existing.code },
  });

  return apiSuccess({ deleted: true, id });
}
