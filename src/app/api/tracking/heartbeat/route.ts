import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : null;
    if (!sessionId || sessionId.length < 5) {
      return NextResponse.json({ success: false, error: 'Valid sessionId required' }, { status: 400 });
    }

    const currentPath = typeof body.path === 'string' ? body.path.slice(0, 255) : '/';
    // Do not record admin dashboard visits as storefront visitor traffic
    if (currentPath.startsWith('/admin') || currentPath.startsWith('/api')) {
      return NextResponse.json({ success: true, ignored: true });
    }

    const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null;
    const productCount = typeof body.productCount === 'number' && Number.isFinite(body.productCount) ? Math.max(0, body.productCount) : 0;
    const cartTotalPaise = typeof body.cartTotalPaise === 'number' && Number.isFinite(body.cartTotalPaise) ? Math.max(0, body.cartTotalPaise) : 0;

    // Detect client IP
    const forwardedFor = req.headers.get('x-forwarded-for');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : req.headers.get('x-real-ip') || '127.0.0.1';

    // Geo headers (Vercel Edge / Cloudflare / Proxies)
    const rawCountry = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || 'India';
    const rawState = req.headers.get('x-vercel-ip-country-region') || 'Unknown';
    let rawCity = req.headers.get('x-vercel-ip-city') || 'Unknown';
    try {
      if (rawCity !== 'Unknown') rawCity = decodeURIComponent(rawCity);
    } catch {}

    const userAgent = req.headers.get('user-agent')?.slice(0, 300) || null;

    // Optional user ID from auth session
    let userId: string | null = null;
    try {
      const serverSupabase = await createServerSupabaseClient();
      const { data: { user } } = await serverSupabase.auth.getUser();
      if (user?.id) userId = user.id;
    } catch {
      // Non-fatal
    }

    const adminClient = createAdminClient();
    await adminClient.rpc('record_visitor_heartbeat', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_ip_address: clientIp,
      p_country: rawCountry,
      p_state: rawState,
      p_city: rawCity,
      p_current_path: currentPath,
      p_referrer: referrer,
      p_user_agent: userAgent,
      p_product_count: productCount,
      p_cart_total_paise: cartTotalPaise,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[HEARTBEAT_ERROR]', err);
    return NextResponse.json({ success: false, error: 'Tracking error' }, { status: 500 });
  }
}
