'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import styles from './Navbar.module.css';

export default function Navbar() {
  const pathname = usePathname();
  const { totalItems } = useCart();
  const { user } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Check initial theme from html attribute or localStorage
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      const isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      setTheme(isLight ? 'light' : 'dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Hide on admin pages
  if (pathname.startsWith('/admin')) return null;

  return (
    <nav className={styles.navbar}>
      <Link href="/" className={styles.logo}>
        KICKOFF<span className={styles.logoHighlight}>PRO</span>
      </Link>
      
      <div className={styles.navLinks}>
        <Link href="/products" className={styles.navLink}>Shop</Link>
        <Link href="/products?category=club" className={styles.navLink}>Clubs</Link>
        <Link href="/products?category=national" className={styles.navLink}>National</Link>
        <Link href="/products?category=retro" className={styles.navLink}>Retro</Link>
        <Link href="/products?category=sale" className={`${styles.navLink} ${styles.saleLink}`}>Sale</Link>
      </div>

      <div className={styles.actions}>
        <button onClick={toggleTheme} className={styles.iconBtn} aria-label="Toggle Theme">
          {theme === 'dark' ? (
            // Sun icon
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            // Moon icon
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <Link href="/cart" className={styles.iconBtn} aria-label="Cart">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
          {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
        </Link>
        <Link href={user ? '/profile' : '/auth'} className={styles.iconBtn} aria-label="Profile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
