'use client';

import Script from 'next/script';

interface AnywearScriptProps {
  domain?: string;
  enabled?: boolean;
}

/**
 * AnywearScript Component
 *
 * Injects the Anywear (Decart.ai) virtual try-on widget asynchronously
 * using Next.js Script strategy="afterInteractive".
 *
 * Guarantees:
 * - Asynchronous, non-blocking page loads.
 * - Idempotent across client-side Next.js route transitions (via script id).
 * - Domain is configurable via NEXT_PUBLIC_ANYWEAR_DOMAIN (defaults to kickoffpro.in).
 * - Feature toggle via NEXT_PUBLIC_ANYWEAR_ENABLED (defaults to true).
 */
export default function AnywearScript({
  domain: propDomain,
  enabled: propEnabled,
}: AnywearScriptProps = {}) {
  const isExplicitlyDisabled =
    propEnabled === false || process.env.NEXT_PUBLIC_ANYWEAR_ENABLED === 'false';

  if (isExplicitlyDisabled) return null;

  const domain =
    propDomain ||
    process.env.NEXT_PUBLIC_ANYWEAR_DOMAIN ||
    'kickoffpro.in';

  return (
    <Script
      id="anywear-widget-script"
      src={`https://anywear.decart.ai/widget/latest/anywear.js?domain=${encodeURIComponent(domain)}`}
      strategy="afterInteractive"
    />
  );
}
