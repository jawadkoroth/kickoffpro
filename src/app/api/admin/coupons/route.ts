import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

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
    .insert(payload)
    .select()
    .single();

  if (error) {
    return apiError(400, error.message || 'Failed to create coupon');
  }

  return apiSuccess({ coupon: data });
}
