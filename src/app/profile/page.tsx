import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import ProfileClient from './ProfileClient';
import ProfileCard from './ProfileCard';
import AccountSection from './AccountSection';
import AddressesSection from './AddressesSection';
import SettingsSection from './SettingsSection';
import styles from './account.module.css';

/**
 * Account dashboard.
 *
 * Server component: same auth gate as before (middleware + getUser
 * here, redirect to /auth?next=/profile if signed-out, redirect to
 * /profile/complete if phone is missing). The same SSR Supabase
 * client is reused for the optional 2-row recent-orders preview, so
 * we don't add any duplicate round-trips.
 */
export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth?next=/profile');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, email, phone, deleted_at')
    .eq('id', user.id)
    .maybeSingle();

  // Soft-deleted accounts: end the session and bounce. Belt-and-braces
  // alongside the global signOut fired by Settings → Delete account.
  if (profile?.deleted_at) {
    await supabase.auth.signOut();
    redirect('/auth?next=/');
  }

  if (!profile?.phone) {
    redirect('/profile/complete?next=/profile');
  }

  // Sign-in provider — drives password-reset visibility in Settings.
  // Email-link / email-OTP / password users land here as 'email';
  // Google etc. as their identity provider.
  const provider: 'email' | 'google' | 'unknown' =
    user.app_metadata?.provider === 'email'
      ? 'email'
      : user.app_metadata?.provider === 'google'
        ? 'google'
        : 'unknown';

  // Optional recent-orders preview + address count. Same client;
  // piggy-backs on the existing session. RLS restricts both queries
  // to the current user, but we add the explicit filter as
  // belt-and-braces. The count uses head=true so we ship zero rows
  // back — we only need the cardinality to render the collapsed
  // "N saved addresses" summary in the accordion.
  const [recentRes, addressCountRes, ordersCountRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, total_paise, order_status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(2),
    supabase
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);

  const recent = recentRes.data ?? [];
  const addressCount = addressCountRes.count ?? 0;
  const ordersCount = ordersCountRes.count ?? 0;
  const addressSummary =
    addressCount === 0
      ? 'No saved addresses'
      : addressCount === 1
        ? '1 saved address'
        : `${addressCount} saved addresses`;

  const initialProfile = {
    name: profile.name ?? '',
    email: profile.email ?? user.email ?? '',
    phone: profile.phone,
  };

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <ProfileCard
            name={initialProfile.name}
            email={initialProfile.email}
            ordersCount={ordersCount}
          />
        </div>

        <div className={styles.main}>
          <AccountSection
            collapsible
            defaultExpanded
            icon={<UserIcon />}
            title="Profile"
            description="Personal details used at checkout."
          >
            <ProfileClient userId={user.id} initialProfile={initialProfile} />
          </AccountSection>

          <AccountSection
            icon={<BoxIcon />}
            title="Orders"
            description="Track recent orders, view status and history."
            footer={
              <Link href="/orders" className={styles.cta}>
                View orders →
              </Link>
            }
          >
            {recent.length === 0 ? (
              <p className={styles.recentEmpty}>
                No orders yet. Your recent purchases will appear here.
              </p>
            ) : (
              <div className={styles.recentList}>
                {recent.map((order) => (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className={styles.recentRow}
                  >
                    <div className={styles.recentLeft}>
                      <span className={styles.recentNumber}>
                        {order.order_number}
                      </span>
                      <span className={styles.recentMeta}>
                        {formatDate(order.created_at)} ·{' '}
                        {capitalise(order.order_status)}
                      </span>
                    </div>
                    <div className={styles.recentRight}>
                      <span className={styles.recentTotal}>
                        {formatPrice(order.total_paise)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`${styles.statusDot} ${styles[`statusDot_${safeStatus(order.order_status)}`]
                          }`}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </AccountSection>

          <AccountSection
            collapsible
            defaultExpanded={false}
            summary={addressSummary}
            icon={<MapPinIcon />}
            title="Addresses"
            description="Saved addresses for faster checkout."
          >
            <AddressesSection />
          </AccountSection>

          <AccountSection
            collapsible
            defaultExpanded={false}
            icon={<SettingsIcon />}
            title="Settings"
            description="Account security and access."
          >
            <SettingsSection
              email={initialProfile.email}
              provider={provider}
              userId={user.id}
            />
          </AccountSection>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers + inline icons                                              */
/* ------------------------------------------------------------------ */

const formatPrice = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN');

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const capitalise = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

const ALLOWED_STATUSES = [
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
] as const;
type OrderStatus = (typeof ALLOWED_STATUSES)[number];

function safeStatus(s: string): OrderStatus {
  return (ALLOWED_STATUSES as readonly string[]).includes(s)
    ? (s as OrderStatus)
    : 'pending';
}

/* Inline SVGs (no icon-library dep). Stroke uses currentColor so the
 * gold tint comes from `.sectionIcon` — keeps brand control central. */

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
