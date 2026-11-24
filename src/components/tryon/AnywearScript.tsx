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
      const target = e.target as Element | null;
      if (!target) return;

      const isNonWearable = Boolean(
        target.closest('[data-non-wearable="true"], [data-tryon="false"], [class*="teamCard"]')
      );
      const isAnywearBadge = Boolean(
        target.closest(
          '#__decart-imgbtn, .vton-btn, .vton-label, [data-decart-imgbtn], [data-decart-trigger]'
        )
      );

      // If we are NOT on a product detail route, or clicking inside a non-wearable card, suppress the action
      if (isAnywearBadge && (!isProductPage || isNonWearable)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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
            /* Cleanly hide floating Anywear UI & modal on non-product routes */
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

            /* Never show try-on buttons on non-wearable cards, Shop By Nation, and category cards */
            [data-non-wearable="true"] .vton-btn,
            [data-tryon="false"] .vton-btn,
            [class*="teamCard"] .vton-btn,
            [class*="teamImageWrap"] .vton-btn,
            [class*="teamGrid"] .vton-btn,
            [class*="instagramCard"] .vton-btn {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }

            /* Suppress hover badge when mouse is over non-wearable cards */
            body:has([data-non-wearable="true"]:hover) #__decart-imgbtn,
            body:has([data-tryon="false"]:hover) #__decart-imgbtn,
            body:has([class*="teamCard"]:hover) #__decart-imgbtn,
            body:has([class*="teamImageWrap"]:hover) #__decart-imgbtn,
            body:has([class*="instagramCard"]:hover) #__decart-imgbtn {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }

            /* Position pinned try-on badge on wearable product cards at bottom-left so it never covers top-left sale badge */
            [data-wearable="true"] .vton-btn,
            [data-product-card="true"] .vton-btn,
            [class*="imageWrap"] .vton-btn {
              top: auto !important;
              bottom: 10px !important;
              left: 10px !important;
              right: auto !important;
              z-index: 10 !important;
              border-radius: 4px !important;
            }

            /* Offset hover try-on badge so it sits cleanly below the top-left sale badge */
            #__decart-imgbtn {
              margin-top: 34px !important;
              border-radius: 4px !important;
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
