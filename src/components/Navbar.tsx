'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Search, ShoppingCart, User, Menu, X, Sun, Moon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import styles from './Navbar.module.css';

export default function Navbar() {
  const pathname = usePathname();
  const { totalItems } = useCart();
  const { user } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  // Sync state with DOM mutation if it changes externally
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const currentTheme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark';
          if (currentTheme !== theme) setTheme(currentTheme);
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const closeMenu = () => setMobileMenuOpen(false);

  // Hide on admin pages
  if (pathname.startsWith('/admin')) return null;

  return (
    <>
      <nav className={styles.navbar}>
        <button className={styles.mobileMenuBtn} onClick={() => setMobileMenuOpen(true)}>
          <Menu size={24} />
        </button>

        <Link href="/" className={styles.logo} onClick={closeMenu}>
          KICKOFF<span className={styles.logoHighlight}>PRO</span>
        </Link>
        
        <div className={styles.navLinks}>
          <Link href="/products" className={styles.navLink}>Home</Link>
          <Link href="/products?category=national" className={styles.navLink}>National Teams</Link>
          <Link href="/products?category=club" className={styles.navLink}>Club Jerseys</Link>
          <Link href="/products?category=retro" className={styles.navLink}>Retro Jerseys</Link>
          <Link href="/products?sort=newest" className={styles.navLink}>New Arrivals</Link>
          <Link href="/products?sale=true" className={`${styles.navLink} ${styles.saleLink}`}>Sale</Link>
        </div>

        <div className={styles.actions}>
          <button onClick={toggleTheme} className={styles.iconBtn} aria-label="Toggle Theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          <Link href="/products" className={styles.iconBtn} aria-label="Search">
            <Search size={20} />
          </Link>

          <Link href="/cart" className={styles.iconBtn} aria-label="Cart">
            <ShoppingCart size={20} />
            {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
          </Link>

          <Link href={user ? '/profile' : '/auth'} className={styles.iconBtn} aria-label="Profile">
            <User size={20} />
          </Link>
        </div>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={styles.mobileMenu}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <Link href="/" className={styles.logo} onClick={closeMenu}>
                KICKOFF<span className={styles.logoHighlight}>PRO</span>
              </Link>
              <button className={styles.iconBtn} onClick={closeMenu}>
                <X size={28} />
              </button>
            </div>
            
            <Link href="/" className={styles.mobileNavLink} onClick={closeMenu}>Home</Link>
            <Link href="/products?category=national" className={styles.mobileNavLink} onClick={closeMenu}>National Teams</Link>
            <Link href="/products?category=club" className={styles.mobileNavLink} onClick={closeMenu}>Club Jerseys</Link>
            <Link href="/products?category=retro" className={styles.mobileNavLink} onClick={closeMenu}>Retro Jerseys</Link>
            <Link href="/products?sort=newest" className={styles.mobileNavLink} onClick={closeMenu}>New Arrivals</Link>
            <Link href="/products?sale=true" className={`${styles.mobileNavLink} ${styles.saleLink}`} onClick={closeMenu}>Sale</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
