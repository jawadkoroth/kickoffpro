'use client';

import { useState } from 'react';
import Link from 'next/link';
import ProductCard from '@/components/ProductCard';
import HomepageCouponBanner from '@/components/HomepageCouponBanner';
import styles from './page.module.css';

interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: string[];
}

interface LandingClientProps {
  products: ProductCardData[];
}

const FEATURED_CLUBS = [
  { name: 'Manchester United', slug: 'manchester-united', shortName: 'Man Utd', color: '#EF4444' },
  { name: 'Real Madrid', slug: 'real-madrid', shortName: 'Real Madrid', color: '#38BDF8' },
  { name: 'Barcelona', slug: 'barcelona', shortName: 'Barcelona', color: '#1E3A8A' },
  { name: 'Arsenal', slug: 'arsenal', shortName: 'Arsenal', color: '#F87171' },
  { name: 'Liverpool', slug: 'liverpool', shortName: 'Liverpool', color: '#DC2626' },
  { name: 'Chelsea', slug: 'chelsea', shortName: 'Chelsea', color: '#2563EB' },
  { name: 'Bayern Munich', slug: 'bayern-munich', shortName: 'Bayern', color: '#E11D48' },
  { name: 'PSG', slug: 'psg', shortName: 'PSG', color: '#0F172A' }
];

const LEAGUES = [
  { name: 'Premier League', query: 'premier-league', tag: 'PL' },
  { name: 'La Liga', query: 'la-liga', tag: 'LaLiga' },
  { name: 'Serie A', query: 'serie-a', tag: 'SerieA' },
  { name: 'Bundesliga', query: 'bundesliga', tag: 'Bundes' },
  { name: 'Champions League', query: 'champions-league', tag: 'UCL' },
  { name: 'National Teams', query: 'national', tag: 'Nations' },
  { name: 'Retro Jerseys', query: 'retro', tag: 'Retro' }
];

const REVIEWS = [
  { name: 'Aman S.', rating: 5, text: 'Awesome quality for just ₹299. Fits perfectly!', product: 'Man United Home Jersey' },
  { name: 'Rahul K.', rating: 5, text: 'Best retro jerseys online. COD was smooth.', product: 'Real Madrid 1998 Retro' },
  { name: 'Vikram D.', rating: 4, text: 'Super fast delivery to Pune. Recommended!', product: 'Arsenal Away Jersey' },
  { name: 'Subham P.', rating: 5, text: 'Great print. Will order PSG away jersey next!', product: 'PSG Third Jersey' }
];

export default function LandingClient({ products }: LandingClientProps) {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubscribed(true);
      setEmail('');
    }
  };

  // Split products for shelves
  const bestSellers = products.slice(0, 4);
  const newArrivals = products.slice(4, 8);

  return (
    <div className={styles.page}>
      {/* Promotional Strip */}
      <HomepageCouponBanner />

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroOverlay} />
        <div className={styles.heroBackground}>
          <div className={styles.heroGradientCircle1} />
          <div className={styles.heroGradientCircle2} />
        </div>
        <div className={styles.heroContent}>
          <span className={styles.heroTag}>🚨 BUDGET JERSEY DESTINATION 🚨</span>
          <h1 className={styles.heroTitle}>PLAY WITH PASSION</h1>
          <p className={styles.heroSubtitle}>
            High quality club, national, and retro football jerseys starting at just <strong>₹250</strong>. 
          </p>
          <div className={styles.heroCtaGroup}>
            <Link href="/products" className={styles.heroCtaPrimary}>
              Shop Jerseys
            </Link>
            <a href="#clubs" className={styles.heroCtaSecondary}>
              Browse Clubs
            </a>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <div className={styles.trustBar}>
        <div className={styles.trustItem}>
          <span className={styles.trustIcon}>🚚</span>
          <div>
            <h4 className={styles.trustTitle}>Free Shipping</h4>
            <p className={styles.trustDesc}>On all orders over ₹499</p>
          </div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustIcon}>💵</span>
          <div>
            <h4 className={styles.trustTitle}>Cash on Delivery</h4>
            <p className={styles.trustDesc}>Pay when you receive</p>
          </div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustIcon}>🔄</span>
          <div>
            <h4 className={styles.trustTitle}>Easy Returns</h4>
            <p className={styles.trustDesc}>No questions asked policy</p>
          </div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustIcon}>🛡️</span>
          <div>
            <h4 className={styles.trustTitle}>Best Price Guarantee</h4>
            <p className={styles.trustDesc}>High quality, budget rates</p>
          </div>
        </div>
      </div>

      {/* Special Offer Highlight */}
      <section className={styles.promoSection}>
        <div className={styles.promoCard}>
          <div className={styles.promoTag}>SEASON DEALS</div>
          <h2 className={styles.promoTitle}>FLAT 10% OFF ON YOUR FIRST ORDER</h2>
          <p className={styles.promoDesc}>Use code <strong className={styles.couponCode}>WELCOME10</strong> at checkout to unlock savings.</p>
          <Link href="/products" className={styles.promoCta}>
            Grab Deal Now
          </Link>
        </div>
      </section>

      {/* Featured Clubs */}
      <section id="clubs" className={styles.section}>
        <div className="container-wide">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>FEATURED CLUBS</h2>
            <p className={styles.sectionSubtitle}>Get your favorite club's jerseys</p>
          </div>
          <div className={styles.clubsGrid}>
            {FEATURED_CLUBS.map((club) => (
              <Link
                key={club.slug}
                href={`/products?q=${club.slug}`}
                className={styles.clubCard}
                style={{ '--club-theme': club.color } as React.CSSProperties}
              >
                <div className={styles.clubBadgeBg} />
                <span className={styles.clubEmoji}>⚽</span>
                <span className={styles.clubName}>{club.shortName}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Categories / Leagues */}
      <section className={styles.sectionAlt}>
        <div className="container-wide">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>POPULAR LEAGUES</h2>
            <p className={styles.sectionSubtitle}>Find jerseys by competition</p>
          </div>
          <div className={styles.leaguesGrid}>
            {LEAGUES.map((league) => (
              <Link
                key={league.query}
                href={`/products?category=${league.query}`}
                className={styles.leagueCard}
              >
                <span className={styles.leagueTag}>{league.tag}</span>
                <span className={styles.leagueName}>{league.name}</span>
                <span className={styles.leagueArrow}>→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Best Sellers Shelf */}
      {bestSellers.length > 0 && (
        <section className={styles.section}>
          <div className="container-wide">
            <div className={styles.sectionHeader}>
              <div className={styles.badgeSale}>HOT</div>
              <h2 className={styles.sectionTitle}>BEST SELLERS</h2>
              <p className={styles.sectionSubtitle}>Most ordered football jerseys this week</p>
            </div>
            <div className={styles.productsGrid}>
              {bestSellers.map((product) => (
                <ProductCard key={product.id} product={{ ...product, totalStock: 10 }} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Limited Stock Urgency Section */}
      <section className={styles.urgencySection}>
        <div className={styles.urgencyBox}>
          <div className={styles.urgencyFlash}>⚡ STOCK CLEARANCE ⚡</div>
          <h2 className={styles.urgencyTitle}>RETRO JERSEYS CLEARING OUT</h2>
          <p className={styles.urgencyDesc}>Classic football designs selling out fast. Get yours before they go!</p>
          <Link href="/products?category=retro" className={styles.urgencyCta}>
            View Retro Catalog
          </Link>
        </div>
      </section>

      {/* New Arrivals Shelf */}
      {newArrivals.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className="container-wide">
            <div className={styles.sectionHeader}>
              <div className={styles.badgeNew}>NEW</div>
              <h2 className={styles.sectionTitle}>NEW ARRIVALS</h2>
              <p className={styles.sectionSubtitle}>Freshly restocked club and national jerseys</p>
            </div>
            <div className={styles.productsGrid}>
              {newArrivals.map((product) => (
                <ProductCard key={product.id} product={{ ...product, totalStock: 10 }} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Customer Reviews */}
      <section className={styles.section}>
        <div className="container-wide">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>FAN REVIEWS</h2>
            <p className={styles.sectionSubtitle}>Read what football fans across India say</p>
          </div>
          <div className={styles.reviewsGrid}>
            {REVIEWS.map((review, idx) => (
              <div key={idx} className={styles.reviewCard}>
                <div className={styles.stars}>★★★★★</div>
                <p className={styles.reviewText}>"{review.text}"</p>
                <div className={styles.reviewFooter}>
                  <strong className={styles.reviewUser}>{review.name}</strong>
                  <span className={styles.reviewProduct}>Verified Buyer - {review.product}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter / Club signup */}
      <section className={styles.newsletterSection}>
        <div className={styles.newsletterCard}>
          <h2 className={styles.newsletterTitle}>JOIN THE KICKOFF CLUB</h2>
          <p className={styles.newsletterDesc}>Get alerts on jersey drops, restocks, and exclusive discount codes.</p>
          {subscribed ? (
            <div className={styles.newsletterSuccess}>
              🎉 Welcome to the club! Check your inbox for deals.
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className={styles.newsletterForm}>
              <input
                type="email"
                required
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.newsletterInput}
              />
              <button type="submit" className={styles.newsletterSubmit}>
                Join Now
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
