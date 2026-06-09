import type { NextConfig } from "next";

/**
 * KickoffPro — production security headers
 *
 * Applied to every route. CSP is the load-bearing one: it whitelists
 * Razorpay (checkout iframe + script), Supabase (REST + Realtime
 * websocket + Storage), and self-hosted assets, blocking everything
 * else by default. `unsafe-inline` on style-src is required by
 * Next.js's CSS-in-JS pipeline; `unsafe-eval` on script-src is
 * required by Razorpay Checkout's bundle.
 *
 * If you add a new third-party (analytics, Sentry, etc.) you MUST
 * also add its origin to the appropriate directive — otherwise the
 * browser will silently drop the request with a CSP violation in
 * the console.
 */
const csp = [
  "default-src 'self'",
  // Razorpay Checkout requires inline + eval; Supabase realtime requires self.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.razorpay.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Razorpay frame for the checkout sheet.
  "frame-src 'self' https://api.razorpay.com https://*.razorpay.com",
  // REST + Realtime (wss) to Supabase, Razorpay create-order endpoint.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://va.vercel-scripts.com",
  // Web manifest, service worker scope.
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data: https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Belt-and-braces against legacy clickjacking; CSP frame-ancestors
  // is the modern equivalent and takes precedence where supported.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Lock down sensors / autoplay / fullscreen except where we use them.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com"), interest-cohort=()',
  },
  // 1-year HSTS with preload + subdomains. Safe to enable always —
  // browsers ignore the header on plain HTTP.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
