'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import ProductCard, { ProductCardData } from '@/components/ProductCard';
import { 
  Truck, 
  ShieldCheck, 
  CreditCard, 
  RefreshCw, 
  Star, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp, 
  Heart, 
  MessageSquare 
} from 'lucide-react';
import { getPublicUrl } from '@/lib/media';
import styles from './page.module.css';

interface LandingClientProps {
  products: ProductCardData[];
}

// Popular national teams mapping for Quick Access and category deductions
const POPULAR_NATIONAL_TEAMS = [
  'Argentina', 'Brazil', 'Portugal', 'France', 'Germany', 'Spain', 'England', 'Italy'
];

// Popular clubs mapping for category showcases
const POPULAR_CLUBS = [
  'Real Madrid', 'Barcelona', 'Manchester United', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'PSG', 'Bayern Munich', 'Juventus'
];

export default function LandingClient({ products }: LandingClientProps) {
  // Helper to extract team name from product name
  const getTeamName = (p: ProductCardData) => {
    const team = POPULAR_NATIONAL_TEAMS.find(t => p.name.toLowerCase().includes(t.toLowerCase()));
    return team || p.name;
  };

  // Helper to extract club name from product name
  const getClubName = (p: ProductCardData) => {
    const club = POPULAR_CLUBS.find(c => p.name.toLowerCase().includes(c.toLowerCase()));
    return club || p.name;
  };

  // Try to deduce available national teams from products for quick access pills
  const availableTeams = POPULAR_NATIONAL_TEAMS.filter(team => 
    products.some(p => p.name.toLowerCase().includes(team.toLowerCase()))
  );

  // Filter products for homepage featured nation and club showcases
  const featuredNations = products
    .filter(p => p.homepage_feature_enabled && p.category?.toLowerCase() === 'national team')
    .slice(0, 4);

  const featuredClubs = products
    .filter(p => p.homepage_feature_enabled && p.category?.toLowerCase() === 'club jersey')
    .slice(0, 4);

  // Trending (Top 8)
  const trendingProducts = products.slice(0, 8);
  
  // New Arrivals (Sorted by date)
  const newArrivals = [...products].sort((a, b) => {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  }).slice(0, 8);

  // Best Sellers (Assume items with category 'best-seller' or slice middle of catalogue)
  const bestSellers = products.filter(
    p => p.category?.toLowerCase().includes('best') || p.name.toLowerCase().includes('home')
  ).slice(0, 8);

  // FAQ state
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(prev => (prev === index ? null : index));
  };

  // Newsletter Form State
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterStatus, setNewsletterStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [newsletterMessage, setNewsletterMessage] = useState('');

  async function handleNewsletterSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newsletterStatus === 'loading') return;

    const email = newsletterEmail.trim();
    if (!email) {
      setNewsletterStatus('error');
      setNewsletterMessage('Please enter your email.');
      return;
    }

    setNewsletterStatus('loading');
    setNewsletterMessage('');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'homepage' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewsletterStatus('error');
        setNewsletterMessage(data.error || 'Could not subscribe right now.');
        return;
      }
      setNewsletterStatus('ok');
      setNewsletterMessage('Subscribed successfully!');
      setNewsletterEmail('');
    } catch {
      setNewsletterStatus('error');
      setNewsletterMessage('Could not subscribe right now.');
    }
  }

  // Static FAQ data
  const faqs = [
    {
      q: 'What is the quality of the jerseys?',
      a: 'All our jerseys are premium quality fan versions, featuring embroidered logos, high-density decals, and Premium Dot-Knit Fabric designed for all-day comfort and match-day wear.'
    },
    {
      q: 'Is Cash on Delivery (COD) available?',
      a: 'Yes! We support Cash on Delivery (COD) across major pin codes in India at no extra cost, alongside secure online UPI, Net Banking, and Cards payment options.'
    },
    {
      q: 'How long does shipping and delivery take?',
      a: 'We process orders within 24 hours. Delivery takes 3 to 5 business days for major Indian cities, and up to 7 business days for regional and remote locations.'
    },
    {
      q: 'What is your return and exchange policy?',
      a: 'We offer a 7-Day Size Exchange and Damage Protection policy. If your jersey has a sizing issue or arrived damaged, you can request a size exchange or submit a claim by contacting our support email within 7 days of delivery.'
    }
  ];

  // Customer Reviews
  const reviews = [
    {
      author: 'Rohit S.',
      rating: 5,
      text: 'Absolutely blown away by the quality of the Argentina jersey! The embroidery is top-notch, fits perfectly, and delivery was exceptionally fast in Mumbai.'
    },
    {
      author: 'Aravind K.',
      rating: 5,
      text: 'Perfect fit for match nights! UPI checkout was smooth, got my jersey in Chennai in just 4 days. Highly recommend KickoffPro.'
    },
    {
      author: 'Aditya M.',
      rating: 5,
      text: 'Excellent value for money. ₹299 is a steal for this print quality. Will be ordering the Portugal home jersey next!'
    }
  ];

  // Instagram Feed using local assets
  const instagramFeed = [
    { image: '/story-1.png', likes: '1.2k', comments: '42' },
    { image: '/story-2.png', likes: '890', comments: '19' },
    { image: '/story-3.png', likes: '2.4k', comments: '98' },
    { image: '/story-4.png', likes: '1.5k', comments: '31' }
  ];

  return (
    <main className={styles.page}>
      
      {/* SECTION 1: WORLD CUP HERO */}
      <section className={styles.hero}>
        <div className={styles.heroBackground}>
          <img src="/product-2.png" alt="Stadium Jersey Atmosphere" loading="eager" />
        </div>
        <div className={styles.heroOverlay} />
        
        <motion.div 
          className={styles.heroContent}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <span style={{ color: '#FFC928', fontSize: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '16px', display: 'block' }}>
            🏆 World Cup Fever Is Live 🏆
          </span>
          <h1 className={styles.heroTitle}>
            Support Your Team
          </h1>
          <p className={styles.heroSubtitle}>
            Premium Quality Football Jerseys Starting At ₹299. Get ready for the ultimate matchday experience.
          </p>
          
          <div className={styles.heroCtaGroup}>
            <Link href="/products" className={styles.heroCtaPrimary}>
              Shop Collections
            </Link>
            <Link href="/products?category=national" className={styles.heroCtaSecondary}>
              National Teams
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
      {featuredNations.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Shop By Nation</h2>
          </div>
          <div className={styles.teamGrid}>
            {featuredNations.map(p => {
              const teamName = getTeamName(p);
              const imageUrl = getPublicUrl(p.homepage_feature_image || p.images?.[0]) || '/product-1.png';
              return (
                <Link key={p.id} href={`/products?q=${teamName}`} className={styles.teamCard}>
                  <div className={styles.teamImageWrap}>
                    <img 
                      src={imageUrl} 
                      alt={teamName} 
                      loading="lazy" 
                    />
                  </div>
                  <div className={styles.teamBody}>
                    <h3 className={styles.teamName}>{teamName}</h3>
                    <p className={styles.teamPrice}>From ₹299</p>
                    <span className={styles.teamShopBtn}>
                      Shop Now <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* SECTION 3.5: SHOP BY CLUB */}
      {featuredClubs.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Shop By Club</h2>
          </div>
          <div className={styles.teamGrid}>
            {featuredClubs.map(p => {
              const clubName = getClubName(p);
              const imageUrl = getPublicUrl(p.homepage_feature_image || p.images?.[0]) || '/product-1.png';
              return (
                <Link key={p.id} href={`/products?q=${clubName}`} className={styles.teamCard}>
                  <div className={styles.teamImageWrap}>
                    <img 
                      src={imageUrl} 
                      alt={clubName} 
                      loading="lazy" 
                    />
                  </div>
                  <div className={styles.teamBody}>
                    <h3 className={styles.teamName}>{clubName}</h3>
                    <p className={styles.teamPrice}>From ₹299</p>
                    <span className={styles.teamShopBtn}>
                      Shop Now <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
                    </span>
                  </div>
                </Link>
              );
            })}
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

      {/* SECTION 5: NEW ARRIVALS */}
      {newArrivals.length > 0 && (
        <section className={styles.section}>
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

      {/* SECTION 6: BEST SELLERS */}
      {bestSellers.length > 0 && (
        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Best Sellers</h2>
          </div>
          <div className={styles.productsGrid}>
            {bestSellers.map((product) => (
              <ProductCard key={`best-${product.id}`} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* SECTION 7: TRUST INDICATORS */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Why KickoffPro</h2>
        </div>
        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <Truck size={32} className={styles.featureIcon} style={{ color: '#2FA9F5' }} />
            <h3 className={styles.featureTitle}>Fast Shipping</h3>
          </div>
          <div className={styles.featureCard}>
            <CreditCard size={32} className={styles.featureIcon} style={{ color: '#2FA9F5' }} />
            <h3 className={styles.featureTitle}>Cash On Delivery</h3>
          </div>
          <div className={styles.featureCard}>
            <ShieldCheck size={32} className={styles.featureIcon} style={{ color: '#2FA9F5' }} />
            <h3 className={styles.featureTitle}>Secure Payments</h3>
          </div>
          <div className={styles.featureCard}>
            <RefreshCw size={32} className={styles.featureIcon} style={{ color: '#2FA9F5' }} />
            <h3 className={styles.featureTitle}>7-Day Exchange</h3>
          </div>
          <div className={styles.featureCard}>
            <Star size={32} className={styles.featureIcon} style={{ color: '#FFC928' }} />
            <h3 className={styles.featureTitle}>Best Value</h3>
          </div>
        </div>
      </section>

      {/* SECTION 8: CUSTOMER REVIEWS */}
      <section className={styles.sectionAlt}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Fan Reviews</h2>
        </div>
        <div className={styles.reviewsGrid}>
          {reviews.map((rev, i) => (
            <div key={i} className={styles.reviewCard}>
              <div className={styles.stars}>
                {[...Array(rev.rating)].map((_, s) => (
                  <Star key={s} size={16} fill="#FFC928" color="#FFC928" />
                ))}
              </div>
              <p className={styles.reviewText}>&quot;{rev.text}&quot;</p>
              <h4 className={styles.reviewAuthor}>{rev.author}</h4>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 9: FAQ ACCORDION */}
      <section className={styles.section}>
        <div className={styles.sectionHeader} style={{ textAlign: 'center', alignItems: 'center' }}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
        </div>
        <div className={styles.faqContainer}>
          {faqs.map((faq, index) => (
            <div key={index} className={styles.faqItem}>
              <button className={styles.faqQuestion} onClick={() => toggleFaq(index)}>
                <span>{faq.q}</span>
                {openFaq === index ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              <AnimatePresence>
                {openFaq === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className={styles.faqAnswer}>
                      {faq.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 10: INSTAGRAM FAN FEED */}
      <section className={styles.sectionAlt}>
        <div className={styles.sectionHeader} style={{ textAlign: 'center', alignItems: 'center' }}>
          <span style={{ color: '#2FA9F5', fontSize: '0.8125rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            #KickoffProFans
          </span>
          <h2 className={styles.sectionTitle}>Wear It With Pride</h2>
        </div>
        <div className={styles.instagramGrid}>
          {instagramFeed.map((post, i) => (
            <div key={i} className={styles.instagramCard}>
              <img src={post.image} alt={`Fan wear ${i+1}`} loading="lazy" />
              <div className={styles.instagramOverlay}>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Heart size={16} fill="#FFFFFF" /> {post.likes}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MessageSquare size={16} fill="#FFFFFF" /> {post.comments}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 11: NEWSLETTER */}
      <section className={styles.section}>
        <div className={styles.newsletterWrapper}>
          <h2 className={styles.newsletterTitle}>Get Match-Day Offers</h2>
          <p className={styles.heroSubtitle} style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px', marginInline: 'auto' }}>
            Subscribe to our newsletter for exclusive discounts on your favorite teams.
          </p>
          <form className={styles.newsletterForm} onSubmit={handleNewsletterSubmit}>
            <input 
              type="email" 
              placeholder="Enter your email address" 
              className={styles.newsletterInput} 
              value={newsletterEmail}
              onChange={(e) => {
                setNewsletterEmail(e.target.value);
                if (newsletterStatus !== 'idle') {
                  setNewsletterStatus('idle');
                  setNewsletterMessage('');
                }
              }}
              disabled={newsletterStatus === 'loading'}
              required 
            />
            <button 
              type="submit" 
              className={styles.newsletterSubmit}
              style={{ background: '#FFC928', color: '#071B3A', border: 'none', fontWeight: 800 }}
              disabled={newsletterStatus === 'loading'}
            >
              {newsletterStatus === 'loading' ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>
          {newsletterMessage && (
            <p style={{
              marginTop: '12px',
              fontSize: '0.875rem',
              color: newsletterStatus === 'error' ? '#EF4444' : '#22C55E',
              fontWeight: 600,
              textAlign: 'center'
            }}>
              {newsletterMessage}
            </p>
          )}
        </div>
      </section>

    </main>
  );
}
