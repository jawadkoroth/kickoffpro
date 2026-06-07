import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { CartProvider } from '@/lib/cart';
import Navbar from '@/components/Navbar';
import FeedbackButton from '@/components/FeedbackButton';
import Footer from '@/components/footer/Footer';
import FooterGate from '@/components/footer/FooterGate';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { PWAProvider } from '@/components/PWAProvider';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SITE_URL, BRAND } from '@/lib/seo/site';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

/**
 * Root metadata.
 *
 * `title.template` is inherited by every page; pages only need to
 * supply the leading fragment and the suffix is appended. Pages that
 * need to override the suffix (brand page, very short title) set
 * `title: { absolute: 'KickoffPro' }` locally.
 *
 * `metadataBase` is derived from env via `SITE_URL` so CI/preview
 * deploys don't emit `localhost:3000` OG URLs that then get scraped
 * by social cards.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} — Affordable Football Jerseys, India`,
    template: `%s — ${BRAND.titleSuffix}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  referrer: 'strict-origin-when-cross-origin',
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    locale: BRAND.locale,
    url: SITE_URL,
    title: `${BRAND.name} — Affordable Football Jerseys, India`,
    description: BRAND.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — Affordable Football Jerseys, India`,
    description: BRAND.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icons/icon-192x192.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'KickoffPro Admin',
  },
};

/**
 * Viewport is split out per Next.js App Router conventions —
 * `themeColor` and viewport directives live here, not on `metadata`.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hydrate auth state on the server so the very first paint reflects
  // the real user. Using getUser() (not getSession()) because it's the
  // only verified-against-the-server call.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var localTheme = localStorage.getItem('theme');
                  var themeToSet = localTheme || 'light';
                  document.documentElement.setAttribute('data-theme', themeToSet);
                } catch (e) {}
              })();
            `
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PWAProvider>
          <AuthProvider initialUser={user}>
            <CartProvider>
              <Navbar />
              {children}
              <FooterGate>
                <Footer />
              </FooterGate>
              <FeedbackButton />
              <Analytics />
              <SpeedInsights />
            </CartProvider>
          </AuthProvider>
        </PWAProvider>
      </body>
    </html>
  );
}
