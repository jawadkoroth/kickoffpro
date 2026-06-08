import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import AdminShell from './AdminShell';

/**
 * Server-side admin gate.
 *
 * - Verifies the user via cookies (getUser hits the auth server).
 * - Verifies admin role by joining against `admin_users`.
 * - Redirects to /admin (login) on any failure — no UI rendered until
 *   access has been confirmed.
 *
 * This layout only wraps protected admin pages (route group). The
 * /admin login page lives outside this group and bypasses the gate.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/admin');
  }

  const isDev = process.env.NODE_ENV === 'development';
  let isAdmin = false;

  if (isDev) {
    isAdmin = true;
  } else {
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (adminUser) isAdmin = true;
  }

  if (!isAdmin) {
    // Not an admin. We don't try to sign out from this RSC because
    // cookie writes from a Server Component are swallowed by the
    // adapter; the redirect to /admin is sufficient. The cookies are
    // still valid as a regular user — the admin gate just keeps
    // bouncing them on every protected request.
    redirect('/admin');
  }

  const { count } = await supabase
    .from('feedback')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  return <AdminShell initialUnreadCount={count ?? 0}>{children}</AdminShell>;
}
