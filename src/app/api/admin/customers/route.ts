import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getMockCustomers() {
  return [
    {
      id: 'mock-cust-1',
      name: 'Jawad Koroth',
      email: 'jawad@kickoffpro.com',
      phone: '+91 9876543210',
      ordersCount: 3,
      totalSpend: 389700,
      lastOrderDate: new Date().toISOString(),
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'mock-cust-2',
      name: 'Rohit Sharma',
      email: 'rohit@indiafc.in',
      phone: '+91 9999999999',
      ordersCount: 1,
      totalSpend: 129900,
      lastOrderDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'mock-cust-3',
      name: 'Virat Kohli',
      email: 'virat@runmachine.com',
      phone: '+91 8888888888',
      ordersCount: 5,
      totalSpend: 649500,
      lastOrderDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];
}

export async function GET(req: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  // Gate check: verify logged-in user is admin
  const serverSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!isDev) {
    if (!user) return apiError(401, 'Unauthorized');

    const supabase = createAdminClient();
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (!adminUser) return apiError(403, 'Not admin');
  }

  const supabase = createAdminClient();
  
  // Fetch profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, email, phone, created_at')
    .order('created_at', { ascending: false });

  if (profilesError) {
    console.error('[ADMIN_CUSTOMERS_PROFILES_ERROR]', profilesError);
    if (isDev) {
      return apiSuccess({ data: getMockCustomers() });
    }
    return apiError(500, 'Failed to load customer profiles');
  }

  // Fetch orders with total_paise and created_at to calculate spend metrics
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('user_id, total_paise, created_at');

  if (ordersError) {
    console.error('[ADMIN_CUSTOMERS_ORDERS_ERROR]', ordersError);
    if (isDev) {
      return apiSuccess({ data: getMockCustomers() });
    }
    return apiError(500, 'Failed to load customer orders');
  }

  // Aggregate orders in memory per customer profile
  const customers = (profiles ?? []).map(p => {
    const userOrders = (orders ?? []).filter(o => o.user_id === p.id);
    const ordersCount = userOrders.length;
    const totalSpend = userOrders.reduce((sum, o) => sum + (o.total_paise ?? 0), 0);
    const lastOrderDate = userOrders.length > 0
      ? userOrders.reduce((max, o) => new Date(o.created_at) > new Date(max) ? o.created_at : max, userOrders[0].created_at)
      : null;

    return {
      id: p.id,
      name: p.name || 'Anonymous User',
      email: p.email || '—',
      phone: p.phone || '—',
      ordersCount,
      totalSpend,
      lastOrderDate,
      createdAt: p.created_at
    };
  });

  return apiSuccess({ data: customers });
}
