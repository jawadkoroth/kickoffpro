import type { Metadata } from 'next';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbLd } from '@/lib/seo/jsonLd';
import { BRAND, CONTACT, SOCIAL, canonicalUrl } from '@/lib/seo/site';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About',
  description:
    `${BRAND.name} is India's budget-friendly football jersey store. ` +
    `High-quality club, national team, and retro jerseys with budget-friendly pricing.`,
  alternates: { canonical: canonicalUrl('/about') },
  openGraph: {
    type: 'website',
    url: canonicalUrl('/about'),
    title: `About — ${BRAND.name}`,
    description:
      `Budget football jerseys. Premium fan and retro classics. Made for the game.`,
  },
};

export default function AboutPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'About', path: '/about' },
        ])}
      />

      <main className={styles.page}>
        {/* 1 — Opening statement */}
        <section className={styles.opening} aria-labelledby="about-heading">
          <p className={styles.openingEyebrow}>Our Mission</p>
          <h1 id="about-heading" className={styles.openingTitle}>
            Football is not just a game.
            <br />
            It is a passion.
          </h1>
          <p className={styles.openingSub}>
            We make one thing — high-quality football jerseys for every fan at unbeatable, budget-friendly prices.
          </p>
        </section>

        {/* 2 — Standards */}
        <section className={styles.standards} aria-labelledby="standards-heading">
          <div className={styles.standardsBody}>
            <p className={styles.eyebrow}>Standards</p>
            <h2 id="standards-heading" className={styles.sectionHeading}>
              Unbeatable quality at affordable prices.
            </h2>

            <dl className={styles.standardsList}>
              <div className={styles.standard}>
                <dt>Pricing</dt>
                <dd>
                  Budget-friendly pricing. Perfect for students, players, and passionate fans who want to support their club without breaking the bank.
                </dd>
              </div>
              <div className={styles.standard}>
                <dt>Quality Fabric</dt>
                <dd>
                  Premium Dot-Knit Fabric. Lightweight, breathable construction designed for all-day comfort and match-day wear.
                </dd>
              </div>
              <div className={styles.standard}>
                <dt>Vast Selection</dt>
                <dd>
                  From the latest 2026 club kits and national teams to classic retro jerseys. Custom badges and detailing on every piece.
                </dd>
              </div>
              <div className={styles.standard}>
                <dt>COD & Free Shipping</dt>
                <dd>
                  Pay easily using Cash on Delivery. Get Free Shipping on all orders above ₹499 across India.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 3 — Philosophy */}
        <section className={styles.philosophy} aria-labelledby="philosophy-heading">
          <p className={styles.eyebrow}>Our Goals</p>
          <h2 id="philosophy-heading" className={styles.sectionHeading}>
            Jersey destination for fans.
          </h2>
          <ul className={styles.notes}>
            <li>Passionate designs for every supporter.</li>
            <li>No high margins, only fair pricing.</li>
            <li>Lightweight performance gear.</li>
            <li>Fast delivery right to your door.</li>
          </ul>
        </section>

        {/* 4 — Closing / contact */}
        <section className={styles.closing} aria-labelledby="contact-heading" id="contact">
          <span className={styles.emblem} aria-hidden="true">
            {BRAND.name}
          </span>
          <h2 id="contact-heading" className={styles.closingHeading}>
            Reach out to our team.
          </h2>
          <ul className={styles.contactList}>
            {CONTACT.email && (
              <li>
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
                <span className={styles.contactNote}>Support & bulk orders</span>
              </li>
            )}
            {SOCIAL.instagram && (
              <li>
                <a href={SOCIAL.instagram} target="_blank" rel="noopener noreferrer">
                  Instagram
                </a>
                <span className={styles.contactNote}>Latest jersey drops</span>
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}
