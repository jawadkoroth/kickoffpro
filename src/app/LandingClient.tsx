'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import ProductCard, { ProductCardData } from '@/components/ProductCard';
import { Truck, ShieldCheck, CreditCard, RefreshCw, Star, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

interface LandingClientProps {
  products: ProductCardData[];
}

// Popular national teams mapping for Quick Access
const POPULAR_NATIONAL_TEAMS = [
  'Argentina', 'Brazil', 'Portugal', 'France', 'Germany', 'Spain', 'England', 'Italy'
];

export default function LandingClient({ products }: LandingClientProps) {
  // Extract National Teams
  const nationalProducts = products.filter(p => p.category === 'national' || p.category?.toLowerCase().includes('national'));
  
  // Try to deduce available national teams from products
  // E.g., if product name is "Argentina Home Jersey", team is "Argentina"
  const availableTeams = POPULAR_NATIONAL_TEAMS.filter(team => 
    products.some(p => p.name.toLowerCase().includes(team.toLowerCase()))
  );

  // Trending (Top 8, assume newest or highest stock, etc., here we just take first 8)
  const trendingProducts = products.slice(0, 8);
  
  // New Arrivals
  const newArrivals = [...products].sort((a, b) => {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  }).slice(0, 8);

  // Club Jerseys
  const clubProducts = products.filter(p => p.category === 'club' || p.category?.toLowerCase().includes('club')).slice(0, 4);

  return (
    <main className={styles.page}>
      
      {/* SECTION 1: WORLD CUP HERO */}
      <section className={styles.hero}>
        <div className={styles.heroBackground}>
          <img src="/hero-stadium.jpg" alt="Stadium Atmosphere" loading="eager" />
        </div>
        <div className={styles.heroOverlay} />
        
        <motion.div 
          className={styles.heroContent}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <h1 className={styles.heroTitle}>
            Support Your Nation
          </h1>
          <p className={styles.heroSubtitle}>
            Premium Quality Football Jerseys Starting At ₹299. Get ready for the ultimate matchday experience.
          </p>
          
          <div className={styles.heroCtaGroup}>
            <Link href="/products" className={styles.heroCtaPrimary}>
              Shop Now
            </Link>
            <Link href="/products?category=national" className={styles.heroCtaSecondary}>
              View National Teams
            </Link>
          </div>
        </motion.div>
      </section>

      {/* SECTION 2: WORLD CUP TEAM QUICK ACCESS */}
      {availableTeams.length > 0 && (
        <section className={styles.quickAccess}>
          <div className={styles.quickAccessList}>
            {availableTeams.map(team => (
              <Link key={team} href={`/products?q=${team}`} className={styles.quickAccessBtn}>
                {team}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 3: SHOP BY NATIONAL TEAM */}
      {availableTeams.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Shop By Nation</h2>
          </div>
          <div className={styles.teamGrid}>
            {availableTeams.map(team => (
              <Link key={team} href={`/products?q=${team}`} className={styles.teamCard}>
                <div className={styles.teamImageWrap}>
                  {/* Using a placeholder-like real url or we can just use the team name in a search to find the cover image. For now using the first product that matches. */}
                  {(() => {
                    const matchedProduct = products.find(p => p.name.toLowerCase().includes(team.toLowerCase()));
                    return matchedProduct ? (
                      <img src={matchedProduct.images?.[0] || '/placeholder.jpg'} alt={team} loading="lazy" />
                    ) : (
                      <div style={{width: '100%', height: '100%', background: 'var(--border-color)'}} />
                    )
                  })()}
                </div>
                <div className={styles.teamBody}>
                  <h3 className={styles.teamName}>{team}</h3>
                  <p className={styles.teamPrice}>From ₹299</p>
                  <span className={styles.teamShopBtn}>Shop Now <ChevronRight size={14} style={{display:'inline', verticalAlign:'middle'}}/></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 4: TRENDING JERSEYS */}
      {trendingProducts.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Trending Jerseys</h2>
          </div>
          <div className={styles.productsGrid}>
            {trendingProducts.map((product) => (
              <ProductCard key={`trending-${product.id}`} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* SECTION 5: SHOP BY CLUB */}
      {clubProducts.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Top Club Jerseys</h2>
          </div>
          <div className={styles.productsGrid}>
            {clubProducts.map((product) => (
              <ProductCard key={`club-${product.id}`} product={product} />
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 'var(--space-6)' }}>
            <Link href="/products?category=club" className={styles.quickAccessBtn} style={{ padding: '12px 32px' }}>
              View All Clubs
            </Link>
          </div>
        </section>
      )}

      {/* SECTION 6: NEW ARRIVALS */}
      {newArrivals.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>New Arrivals</h2>
          </div>
          <div className={styles.productsGrid}>
            {newArrivals.map((product) => (
              <ProductCard key={`new-${product.id}`} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* SECTION 7: WHY KICKOFFPRO */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Why KickoffPro</h2>
        </div>
        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <Truck size={32} className={styles.featureIcon} />
            <h3 className={styles.featureTitle}>Fast Shipping</h3>
          </div>
          <div className={styles.featureCard}>
            <CreditCard size={32} className={styles.featureIcon} />
            <h3 className={styles.featureTitle}>Cash On Delivery</h3>
          </div>
          <div className={styles.featureCard}>
            <ShieldCheck size={32} className={styles.featureIcon} />
            <h3 className={styles.featureTitle}>Secure Payments</h3>
          </div>
          <div className={styles.featureCard}>
            <RefreshCw size={32} className={styles.featureIcon} />
            <h3 className={styles.featureTitle}>Easy Returns</h3>
          </div>
          <div className={styles.featureCard}>
            <Star size={32} className={styles.featureIcon} />
            <h3 className={styles.featureTitle}>Best Value</h3>
          </div>
        </div>
      </section>

      {/* SECTION 8: INSTAGRAM COMMUNITY (Hide if no data) */}
      {/* We mock this by checking if there's any data, if not it doesn't render. 
          Currently we don't have instagram data in Supabase payload. */}
      {false && (
        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>#KickoffProFans</h2>
          </div>
          <div className={styles.productsGrid}>
            {/* Grid of images would go here */}
          </div>
        </section>
      )}

      {/* SECTION 9: NEWSLETTER */}
      <section className={styles.section}>
        <div className={styles.newsletterWrapper}>
          <h2 className={styles.newsletterTitle}>Get Match-Day Offers</h2>
          <p className={styles.heroSubtitle} style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px', marginInline: 'auto' }}>
            Subscribe to our newsletter for exclusive discounts on your favorite teams.
          </p>
          <form className={styles.newsletterForm} onSubmit={(e) => e.preventDefault()}>
            <input 
              type="email" 
              placeholder="Enter your email address" 
              className={styles.newsletterInput} 
              required 
            />
            <button type="submit" className={styles.newsletterSubmit}>
              Subscribe
            </button>
          </form>
        </div>
      </section>

    </main>
  );
}
