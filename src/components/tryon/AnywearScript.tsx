'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

interface AnywearScriptProps {
  domain?: string;
  enabled?: boolean;
}

/**
 * AnywearScript Component
 *
 * Injects and manages the Anywear (Decart.ai) virtual try-on widget.
 *
 * Performance & Stability Guarantees:
 * 1. Script is loaded once asynchronously via Next.js Script strategy="afterInteractive".
 * 2. Route visibility is managed 100% declaratively via CSS scoped to html:not([data-anywear-active="true"]).
 * 3. Absolutely ZERO MutationObservers, ZERO setInterval/polling loops, and ZERO synthetic clicks.
 * 4. Leaving product routes safely signals camera stream release via DECART_RELEASE_CAMERA postMessage.
 * 5. Entering product routes NEVER automatically triggers or opens try-on without direct user interaction.
 */
export default function AnywearScript({
  domain: propDomain,
  enabled: propEnabled,
}: AnywearScriptProps = {}) {
  const pathname = usePathname();
  const isProductPage = useMemo(
    () => Boolean(pathname && /^\/product(?:\/|$)/.test(pathname)),
    [pathname]
  );

  // Sync data attribute with current route, reset Decart session state, and release camera on route changes
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Always clear Decart session open/restore flags so Decart popstate/autostart
    // listeners never auto-open the try-on drawer or activate camera on route transitions
    try {
      sessionStorage.removeItem('_decart_open');
      sessionStorage.removeItem('_decart_pane');
    } catch {}

    if (isProductPage) {
      document.documentElement.setAttribute('data-anywear-active', 'true');

      // If a leftover try-on iframe from a previous session exists, clean the open container
      // so Decart never attempts an autostart on SPA navigation
      const activeIframe = document.querySelector<HTMLIFrameElement>(
        '#__decart-tryon-widget iframe, iframe[src*="decart"], iframe[src*="anywear"]'
      );
      if (activeIframe) {
        try {
          activeIframe.contentWindow?.postMessage(
            { type: 'DECART_RELEASE_CAMERA', reason: 'widget_closed' },
            '*'
          );
        } catch {}
        document.getElementById('__decart-tryon-widget')?.remove();
      }
    } else {
      document.documentElement.setAttribute('data-anywear-active', 'false');

      // Release camera streams in case user had try-on open before navigating away
      const iframes = document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="decart"], iframe[src*="anywear"]'
      );
      iframes.forEach((iframe) => {
        try {
          iframe.contentWindow?.postMessage(
            { type: 'DECART_RELEASE_CAMERA', reason: 'widget_closed' },
            '*'
          );
        } catch {}
      });

      // Remove the try-on modal container so entering back onto a product page starts completely fresh
      document.getElementById('__decart-tryon-widget')?.remove();
    }
  }, [isProductPage]);

  const isExplicitlyDisabled =
    propEnabled === false || process.env.NEXT_PUBLIC_ANYWEAR_ENABLED === 'false';

  if (isExplicitlyDisabled) return null;

  const domain =
    propDomain ||
    process.env.NEXT_PUBLIC_ANYWEAR_DOMAIN ||
    'kickoffpro.in';

  return (
    <>
      {/* Declarative CSS rule: cleanly hides floating Anywear UI on non-product routes without main-thread overhead */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html:not([data-anywear-active="true"]) #__decart-tryon-widget,
            html:not([data-anywear-active="true"]) #__decart-pill-btn,
            html:not([data-anywear-active="true"]) #__decart-imgbtn,
            html:not([data-anywear-active="true"]) #__decart-cam-notice,
            html:not([data-anywear-active="true"]) #__decart-placeholder,
            html:not([data-anywear-active="true"]) #pane-anywear-link,
            html:not([data-anywear-active="true"]) [id^="__decart"],
            html:not([data-anywear-active="true"]) [id^="decart"],
            html:not([data-anywear-active="true"]) [class*="vtonPinned"],
            html:not([data-anywear-active="true"]) [class*="decart-"],
            html:not([data-anywear-active="true"]) .__decartExpandPill,
            html:not([data-anywear-active="true"]) .decartMobileCamera {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }
          `,
        }}
      />
      <Script
        id="anywear-widget-script"
        src={`https://anywear.decart.ai/widget/latest/anywear.js?domain=${encodeURIComponent(domain)}`}
        strategy="afterInteractive"
      />
    </>
  );
}
