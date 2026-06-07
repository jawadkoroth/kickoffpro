import Link from 'next/link';
import NewsletterField from './NewsletterField';
import { BRAND, CONTACT, SOCIAL } from '@/lib/seo/site';
import styles from './Footer.module.css';

/**
 * KickoffPro — global footer.
 *
 * Server-rendered. The only client island inside is the
 * <NewsletterField/>. Everything else is static and crawlable.
 *
 * Visual brief (per the brand direction):
 *   - Editorial spacing, generous breathing room.
 *   - Soft hairline separators only.
 *   - No emojis, no icons in the link rows.
 *   - No "Get 10% off your first order" — the newsletter line
 *     is editorial, not promotional.
 *   - Monochrome only. No gold, no glow. The accent gold token
 *     stays untouched in globals; we just don't reach for it.
 *
 * Information architecture:
 *
 *   SHOP        COMPANY     SUPPORT     CONNECT
 *   Shirts      About       Shipping    Instagram
 *   Hoodies     Journal     Returns     Pinterest
 *   T-Shirts    Contact     Privacy     YouTube
 *   Collections             Terms       Email
 *
 * Shop column links route to category-filtered listings on
 * `/products?category=…`. Until category filtering exists in the
 * collection page, these still resolve to `/products` and append
 * a query string the listing safely ignores. This way the IA is
 * future-proofed without speculative routes.
 */

interface NavSection {
  title: string;
  items: Array<{ label: string; href: string; external?: boolean }>;
}

function buildSections(): NavSection[] {
  const connect: NavSection['items'] = [];
  if (SOCIAL.instagram)
    connect.push({ label: 'Instagram', href: SOCIAL.instagram, external: true });
  if (SOCIAL.pinterest)
    connect.push({ label: 'Pinterest', href: SOCIAL.pinterest, external: true });
  if (SOCIAL.youtube)
    connect.push({ label: 'YouTube', href: SOCIAL.youtube, external: true });
  if (CONTACT.email)
    connect.push({ label: 'Email', href: `mailto:${CONTACT.email}` });

  const sections: NavSection[] = [
    {
      title: 'Shop Jerseys',
      items: [
        { label: 'Club Jerseys', href: '/products?category=club' },
        { label: 'National Teams', href: '/products?category=national' },
        { label: 'Retro Jerseys', href: '/products?category=retro' },
        { label: 'New Arrivals', href: '/products?category=new' },
        { label: 'Sale & Offers', href: '/products?category=sale' },
      ],
    },
    {
      title: 'Company',
      items: [
        { label: 'About', href: '/about' },
        { label: 'Journal', href: '/journal' },
        {
          label: 'Contact',
          href: CONTACT.email ? `mailto:${CONTACT.email}` : '/about',
        },
      ],
    },
    {
      title: 'Support',
      items: [
        { label: 'Shipping', href: '/legal/shipping' },
        { label: 'Returns', href: '/legal/returns' },
        { label: 'Privacy', href: '/legal/privacy' },
        { label: 'Terms', href: '/legal/terms' },
      ],
    },
  ];

  if (connect.length > 0) {
    sections.push({ title: 'Connect', items: connect });
  }

  return sections;
}

export default function Footer() {
  const sections = buildSections();
  const year = new Date().getFullYear();
  const addressLine = [
    CONTACT.locality,
    CONTACT.region,
    CONTACT.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <footer className={styles.footer} role="contentinfo">
      <div className={styles.inner}>
        <section className={styles.editorial} aria-labelledby="footer-newsletter-heading">
          <h2 id="footer-newsletter-heading" className={styles.brand}>
            {BRAND.name}
          </h2>
          <NewsletterField source="footer" />
        </section>

        <nav className={styles.columns} aria-label="Footer">
          {sections.map((section) => (
            <div key={section.title} className={styles.column}>
              <h3 className={styles.columnTitle}>{section.title}</h3>
              <ul className={styles.columnList}>
                {section.items.map((item) => (
                  <li key={`${section.title}-${item.label}`}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.columnLink}
                      >
                        {item.label}
                      </a>
                    ) : item.href.startsWith('mailto:') ? (
                      <a href={item.href} className={styles.columnLink}>
                        {item.label}
                      </a>
                    ) : (
                      <Link href={item.href} className={styles.columnLink}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <hr className={styles.rule} aria-hidden="true" />

        <div className={styles.meta}>
          <p className={styles.copy}>
            © {year} {BRAND.legalName}. All rights reserved.
          </p>
          {addressLine && <p className={styles.address}>{addressLine}</p>}
        </div>
      </div>
    </footer>
  );
}
