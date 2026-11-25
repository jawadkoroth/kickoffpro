'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * KickoffPro — Homepage promotional strip.
 *
 * Renders the most recently updated active coupon row whose
 * `show_on_homepage` flag is true. RLS allows public SELECT on
 * active rows so this works for guests too.
 *
 * Premium / non-spammy aesthetic:
 *   - dark accent (royal blue / cobalt / gold / emerald)
 *   - serif headline mark, sans-serif body
 *   - server-driven copy + colour, no hard-coded codes
 *
 * Always rendered when an active banner row exists; no client-side
 * dismiss state (KickoffPro spec: promo visibility is an admin decision,
 * not a per-visitor one — turn off `show_on_homepage` to hide).
 *
 * Hidden silently when no banner is configured. Never blocks the
 * page on its fetch.
 */

const ACCENT_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  'royal-blue': { bg: '#1F3A8A', fg: '#F5F1EA', border: 'rgba(255,255,255,0.18)' },
  cobalt: { bg: '#1E2F8C', fg: '#F5F1EA', border: 'rgba(255,255,255,0.16)' },
  gold: { bg: '#1A1611', fg: '#D4AF37', border: 'rgba(212,175,55,0.35)' },
  emerald: { bg: '#0D3B30', fg: '#E9DDB5', border: 'rgba(255,255,255,0.16)' },
  default: { bg: '#1A1611', fg: '#D4AF37', border: 'rgba(212,175,55,0.35)' },
};

interface BannerCoupon {
  code: string;
  discount_type?: 'percent' | 'flat' | 'bxgy' | null;
  discount_percent: number;
  discount_paise?: number | null;
  homepage_text: string | null;
  homepage_accent: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

export default function HomepageCouponBanner() {
  const [banner, setBanner] = useState<BannerCoupon | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    supabase
      .from('coupons')
      .select(
        'code, discount_type, discount_percent, discount_paise, homepage_text, homepage_accent, starts_at, expires_at',
      )
      .eq('is_active', true)
      .eq('show_on_homepage', true)
      .order('updated_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const valid = (data as BannerCoupon[]).find((c) => {
          if (c.starts_at && c.starts_at > nowIso) return false;
          if (c.expires_at && c.expires_at <= nowIso) return false;
          return true;
        });
        if (valid) setBanner(valid);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) return null;

  const accent = ACCENT_COLORS[banner.homepage_accent ?? 'default'] ?? ACCENT_COLORS.default;

  const defaultOffer =
    banner.discount_type === 'flat' && banner.discount_paise
      ? `₹${Math.round(banner.discount_paise / 100).toLocaleString('en-IN')} off`
      : `${banner.discount_percent}% off`;

  const text =
    (banner.homepage_text && banner.homepage_text.trim()) ||
    `Use code ${banner.code} for ${defaultOffer}`;

  return (
    <div
      role="region"
      aria-label="Promotional offer"
      style={{
        background: accent.bg,
        color: accent.fg,
        borderBottom: `1px solid ${accent.border}`,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontSize: '0.8125rem',
        letterSpacing: '0.02em',
      }}
    >
      <span
        style={{
          fontWeight: 600,
          textAlign: 'center',
          maxWidth: '94%',
        }}
      >
        {text}
      </span>
    </div>
  );
}
