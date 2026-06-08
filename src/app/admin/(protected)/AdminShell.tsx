'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import AdminFeedbackDrawer from '@/components/AdminFeedbackDrawer';
import AdminRealtimeProvider from '@/components/admin/AdminRealtimeProvider';
import AdminPushPrompt from '@/components/admin/AdminPushPrompt';
import AdminReturnsBadge from '@/components/admin/AdminReturnsBadge';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/products', label: 'Products', icon: '👕' },
  { href: '/admin/orders', label: 'Orders', icon: '📦' },
  { href: '/admin/customers', label: 'Customers', icon: '👥' },
  { href: '/admin/coupons', label: 'Coupons', icon: '🏷️' },
  { href: '/admin/shipping', label: 'Shipping', icon: '🚚' },
  { href: '/admin/diagnostics', label: 'Diagnostics', icon: '🩺' },
];

export default function AdminShell({
  initialUnreadCount,
  children,
}: {
  initialUnreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="admin-layout">
      {/* Desktop Permanent Sidebar */}
      <aside className="admin-desktop-sidebar">
        <div style={{ padding: 'var(--space-6) var(--space-6) 0 var(--space-6)', marginBottom: 'var(--space-8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.05em', color: '#FFFFFF' }}>
              KICKOFF<span style={{ color: '#FFC928' }}>PRO</span>
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2FA9F5', letterSpacing: '0.15em' }}>ADMIN</span>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 var(--space-4)', flex: 1 }}>
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-sidebar-item ${isActive ? 'admin-sidebar-item-active' : ''}`}
              >
                <span style={{ marginRight: '12px', fontSize: '1.1rem' }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Admin Header */}
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button 
            className="admin-mobile-menu-btn" 
            onClick={() => setMobileMenuOpen(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 'var(--space-1)', fontSize: '1.5rem', color: '#071B3A' }}
            aria-label="Open navigation menu"
          >
            ☰
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="admin-mobile-menu-btn" style={{ fontFamily: 'var(--font-sans)', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', color: '#071B3A' }}>
              KICKOFF<span style={{ color: '#FFC928' }}>PRO</span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <AdminReturnsBadge />
          <AdminPushPrompt />
          <button
            onClick={() => setIsFeedbackOpen(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}
            aria-label="Feedback logs"
          >
            <span style={{ fontSize: '1.25rem' }}>💬</span>
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: '-4px', right: '-8px', background: 'var(--error)', color: 'white', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '10px' }}>
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div 
          className="admin-drawer-overlay" 
          onClick={() => setMobileMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(7, 27, 58, 0.4)', zIndex: 100, backdropFilter: 'blur(4px)' }}
        >
          <div 
            className="admin-drawer"
            onClick={e => e.stopPropagation()}
            style={{ width: '280px', height: '100%', background: '#071B3A', borderRight: '1px solid rgba(255,255,255,0.08)', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', position: 'relative' }}
          >
            <button 
              onClick={() => setMobileMenuOpen(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: '#FFFFFF', fontSize: '1.5rem', cursor: 'pointer' }}
              aria-label="Close menu"
            >
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.05em', color: '#FFFFFF' }}>
                KICKOFF<span style={{ color: '#FFC928' }}>PRO</span>
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2FA9F5', letterSpacing: '0.15em' }}>ADMIN</span>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {NAV_ITEMS.map(item => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`admin-sidebar-item ${isActive ? 'admin-sidebar-item-active' : ''}`}
                  >
                    <span style={{ marginRight: '12px', fontSize: '1.1rem' }}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      <AdminRealtimeProvider />

      <main className="admin-content">{children}</main>

      <AdminFeedbackDrawer
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        onUnreadDelta={delta =>
          setUnreadCount(prev => Math.max(0, prev + delta))
        }
      />
    </div>
  );
}
