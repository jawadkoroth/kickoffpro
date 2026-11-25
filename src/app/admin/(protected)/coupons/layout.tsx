'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const COUPON_TABS = [
  { href: '/admin/coupons/auto', label: 'Auto Offers (Magic Cart)' },
  { href: '/admin/coupons/manual', label: 'Manual Coupons' },
];

export default function AdminCouponsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Coupons &amp; Offers</h1>
        <p className="text-xs text-muted" style={{ marginTop: 4, marginBottom: 0 }}>
          Configure automated Magic Cart progress bar rewards or manual checkout coupon codes.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Coupons and Offers sections"
        style={{
          display: 'flex',
          gap: 6,
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 'var(--space-5)',
          paddingBottom: 0,
          overflowX: 'auto',
        }}
      >
        {COUPON_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              style={{
                padding: '10px 16px',
                fontSize: '0.875rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: isActive
                  ? '2px solid var(--brand-blue, #2FA9F5)'
                  : '2px solid transparent',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
