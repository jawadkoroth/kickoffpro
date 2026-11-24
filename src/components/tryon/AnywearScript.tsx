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
 * Behavior & Safety Guarantees:
 * 1. Script is loaded once asynchronously via Next.js Script strategy="afterInteractive".
 * 2. On non-product routes (/products, /, /checkout, /cart, /admin):
 *    - The floating try-on modal (#__decart-tryon-widget) and floating pill (#__decart-pill-btn) are hidden.
 *    - The "+ Try-On" card badge (#__decart-imgbtn) remains visible on collection cards.
 *    - A capture-phase click listener stops all click events on the badge so clicking it is a complete no-op
 *      and never starts the camera or opens try-on.
 * 3. On product detail routes (/product/[slug]):
 *    - The widget and virtual try-on button operate normally.
 * 4. Background Tab Camera Release (visibilitychange):
 *    - Whenever document.visibilityState === 'hidden' (e.g. switching Chrome tabs),
 *      DECART_RELEASE_CAMERA is sent and session storage is cleared, instantly turning off the webcam.
 * 5. Absolutely zero MutationObservers, polling loops, or layout thrashing.
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

  // Capture-phase click interceptor: disable "+ Try-On" card badge clicks on collection/catalog pages
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleCaptureClick = (e: MouseEvent) => {
      // If we are NOT on a product detail route, intercept any clicks on Decart's card badges/triggers
      if (!isProductPage) {
        const target = e.target as Element | null;
        if (
          target &&
          target.closest(
            '#__decart-imgbtn, .vton-btn, .vton-label, [data-decart-imgbtn], [data-decart-trigger]'
          )
        ) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    };

    document.addEventListener('click', handleCaptureClick, true);
    return () => {
      document.removeEventListener('click', handleCaptureClick, true);
    };
  }, [isProductPage]);

  // Release camera immediately when tab becomes hidden (e.g. user switches tabs)
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        try {
          sessionStorage.removeItem('_decart_open');
          sessionStorage.removeItem('_decart_pane');
        } catch {}

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
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const isExplicitlyDisabled =
    propEnabled === false || process.env.NEXT_PUBLIC_ANYWEAR_ENABLED === 'false';

  if (isExplicitlyDisabled) return null;

  const domain =
    propDomain ||
    process.env.NEXT_PUBLIC_ANYWEAR_DOMAIN ||
    'kickoffpro.in';

  return (
    <>
      {/* Declarative CSS rule: cleanly hides floating Anywear UI & modal on non-product routes without hiding card badges */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html:not([data-anywear-active="true"]) #__decart-tryon-widget,
            html:not([data-anywear-active="true"]) #__decart-pill-btn,
            html:not([data-anywear-active="true"]) #__decart-cam-notice,
            html:not([data-anywear-active="true"]) #__decart-placeholder,
            html:not([data-anywear-active="true"]) #pane-anywear-link,
            html:not([data-anywear-active="true"]) [class*="vtonPinned"],
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
