import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { CartProvider } from '@/lib/cart';
import Navbar from '@/components/Navbar';
import CartDrawer from '@/components/cart/CartDrawer';
import FeedbackButton from '@/components/FeedbackButton';
import PixelScripts from '@/components/tracking/PixelScripts';
import LiveHeartbeat from '@/components/tracking/LiveHeartbeat';
import Footer from '@/components/footer/Footer';
import FooterGate from '@/components/footer/FooterGate';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SITE_URL, BRAND } from '@/lib/seo/site';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import ScrollToTop from '@/components/ScrollToTop';

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
};

/**
 * Viewport is split out per Next.js App Router conventions —
 * `themeColor` and viewport directives live here, not on `metadata`.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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

  // Load public pixel IDs with env fallback
  let metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || null;
  let googleTagId = process.env.NEXT_PUBLIC_GOOGLE_TAG_ID || process.env.NEXT_PUBLIC_GA_ID || null;
  let snapPixelId = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || null;

  try {
    const { data: adsConfig } = await supabase
      .from('ads_integrations_config')
      .select('meta_pixel_id, google_tag_id, snapchat_pixel_id, meta_enabled, google_enabled, snapchat_enabled')
      .limit(1)
      .maybeSingle();

    if (adsConfig) {
      if (adsConfig.meta_enabled === false) metaPixelId = null;
      else if (adsConfig.meta_pixel_id) metaPixelId = adsConfig.meta_pixel_id;

      if (adsConfig.google_enabled === false) googleTagId = null;
      else if (adsConfig.google_tag_id) googleTagId = adsConfig.google_tag_id;

      if (adsConfig.snapchat_enabled === false) snapPixelId = null;
      else if (adsConfig.snapchat_pixel_id) snapPixelId = adsConfig.snapchat_pixel_id;
    }
  } catch {
    // Non-fatal — env fallback used
  }

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
        {/* Unregister any lingering service workers from previous PWA setup */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(function(regs) {
                      regs.forEach(function(r) { r.unregister(); });
                    });
                  }
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
        <AuthProvider initialUser={user}>
          <CartProvider>
            <Navbar />
            <CartDrawer />
            {children}
            <FooterGate>
              <Footer />
            </FooterGate>
            <ScrollToTop />
            <FeedbackButton />
            <LiveHeartbeat />
            <PixelScripts
              metaPixelId={metaPixelId}
              googleTagId={googleTagId}
              snapPixelId={snapPixelId}
            />
            <Analytics />
            <SpeedInsights />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
