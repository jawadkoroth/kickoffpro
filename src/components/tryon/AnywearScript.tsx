'use client';

import { useEffect, useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

interface AnywearScriptProps {
  domain?: string;
  enabled?: boolean;
}

const DECART_SELECTORS = [
  '#__decart-tryon-widget',
  '#__decart-pill-btn',
  '#__decart-imgbtn',
  '#__decart-cam-notice',
  '#__decart-placeholder',
  '#pane-anywear-link',
  '[id^="__decart"]',
  '[id^="decart"]',
  '[class*="vtonPinned"]',
  '[class*="decart-"]',
  '.__decartExpandPill',
  '.decartMobileCamera',
].join(', ');

/**
 * AnywearScript Component
 *
 * Injects and manages the Anywear (Decart.ai) virtual try-on widget.
 *
 * Route Lifecycle Guarantees:
 * 1. Product routes (/product/[slug]):
 *    - The widget and floating card are active and visible.
 * 2. Non-product routes (/checkout, /cart, /orders, /admin, etc.):
 *    - The floating pill card and try-on modal are cleanly closed & hidden.
 *    - Active camera streams are proactively released via DECART_RELEASE_CAMERA message.
 *    - MutationObserver ensures any late-injected Decart DOM elements are immediately suppressed.
 *    - CSS-level html:not([data-anywear-active="true"]) ensures zero flash during transitions.
 * 3. Navigating back to product routes:
 *    - Re-enables the widget seamlessly without duplicating the script or reloading.
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

  // Only initiate script loading once user visits or lands on a product page
  const [hasVisitedProductPage, setHasVisitedProductPage] = useState(isProductPage);

  useEffect(() => {
    if (isProductPage && !hasVisitedProductPage) {
      setHasVisitedProductPage(true);
    }
  }, [isProductPage, hasVisitedProductPage]);

  // Handle route-based visibility, modal closing, and camera release
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const releaseCamera = () => {
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
    };

    const closeAndHideWidgets = () => {
      releaseCamera();

      // Trigger close button if try-on drawer/modal is open
      const closeBtn = document.querySelector<HTMLElement>(
        '#__decart-tryon-widget button, #__decart-tryon-widget [aria-label*="close" i], #__decart-tryon-widget .close'
      );
      if (closeBtn) {
        try {
          closeBtn.click();
        } catch {}
      }

      // Hide all Decart floating & injected elements
      const elements = document.querySelectorAll<HTMLElement>(DECART_SELECTORS);
      elements.forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
      });
    };

    const restoreWidgets = () => {
      const elements = document.querySelectorAll<HTMLElement>(DECART_SELECTORS);
      elements.forEach((el) => {
        el.style.removeProperty('display');
        el.style.removeProperty('visibility');
        el.style.removeProperty('pointer-events');
        el.style.removeProperty('opacity');
      });
    };

    if (isProductPage) {
      document.documentElement.setAttribute('data-anywear-active', 'true');
      restoreWidgets();
    } else {
      document.documentElement.setAttribute('data-anywear-active', 'false');
      closeAndHideWidgets();

      // Guard against late-injected DOM nodes while on non-product routes
      const observer = new MutationObserver(() => {
        if (document.documentElement.getAttribute('data-anywear-active') === 'false') {
          closeAndHideWidgets();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
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
      {/* Global CSS suppression rule to guarantee zero visual flash on non-product routes */}
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
      {hasVisitedProductPage && (
        <Script
          id="anywear-widget-script"
          src={`https://anywear.decart.ai/widget/latest/anywear.js?domain=${encodeURIComponent(domain)}`}
          strategy="afterInteractive"
        />
      )}
    </>
  );
}
