import Link from 'next/link';
import { BRAND, CONTACT, SOCIAL } from '@/lib/seo/site';
import styles from './Footer.module.css';

/**
 * KickoffPro — global footer.
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
