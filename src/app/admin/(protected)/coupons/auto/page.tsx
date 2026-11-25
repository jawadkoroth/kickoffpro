'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/useToast';

type PromoRewardType =
  | 'free_shipping'
  | 'threshold_percentage'
  | 'buy_x_get_specific_free'
  | 'buy_x_get_cheapest_free'
  | 'manual_coupon_only';

interface AutoOfferState {
  free_shipping_threshold_paise: number;
  default_shipping_charge_paise: number;
  cod_fee_paise: number;
  promo_banner_enabled: boolean;
  promo_goal_type: 'amount' | 'item_count';
  promo_goal_threshold_paise: number;
  promo_goal_item_count: number;
  promo_progress_template: string;
  promo_unlocked_text: string;
  promo_nudge_enabled: boolean;
  promo_nudge_title: string;
  promo_nudge_badge: string;
  promo_nudge_text: string;
  promo_reward_type: PromoRewardType;
  promo_manual_coupon_code: string | null;
  reward_percentage: number;
  reward_product_id: string | null;
  buy_x_quantity: number;
  get_y_quantity: number;
}

const EMPTY_STATE: AutoOfferState = {
  free_shipping_threshold_paise: 99900,
  default_shipping_charge_paise: 9900,
  cod_fee_paise: 5000,
  promo_banner_enabled: true,
  promo_goal_type: 'amount',
  promo_goal_threshold_paise: 99900,
  promo_goal_item_count: 2,
  promo_progress_template: 'Add {remaining} more to unlock FREE SHIPPING',
  promo_unlocked_text: 'You unlocked FREE Standard Shipping!',
  promo_nudge_enabled: true,
  promo_nudge_title: 'Pay with UPI & Save {cod_fee}',
  promo_nudge_badge: 'LOWEST PRICE',
  promo_nudge_text:
    'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
  promo_reward_type: 'free_shipping',
  promo_manual_coupon_code: null,
  reward_percentage: 10,
  reward_product_id: null,
  buy_x_quantity: 2,
  get_y_quantity: 1,
};

const REWARD_DEFAULTS: Record<PromoRewardType, { progress: string; unlocked: string }> = {
  free_shipping: {
    progress: 'Add {remaining} more to unlock FREE SHIPPING',
    unlocked: 'You unlocked FREE Standard Shipping!',
  },
  threshold_percentage: {
    progress: 'Add {remaining} more to get {reward_percentage} OFF your order!',
    unlocked: '🎉 {reward_percentage} OFF automatically applied!',
  },
  buy_x_get_cheapest_free: {
    progress: 'Add {remaining_items} more to get your lowest-priced item FREE!',
    unlocked: '⚡ Lowest-priced item FREE automatically applied!',
  },
  buy_x_get_specific_free: {
    progress: 'Add {remaining_items} more to unlock FREE {reward_product}!',
    unlocked: '🎁 Free {reward_product} unlocked with your order!',
  },
  manual_coupon_only: {
    progress: 'Add {remaining} more to unlock your coupon!',
    unlocked: 'You unlocked a manual coupon — click Apply below!',
  },
};

function paiseToRupees(paise: number | null | undefined): string {
  if (!paise && paise !== 0) return '';
  return String(Math.round(paise / 100));
}

function rupeesToPaise(rs: string): number {
  const n = Number(rs);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function SectionRule({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 16px' }}>
      <span
        style={{
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      {children}
      {hint && (
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 14px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
      }}
    >
      <div>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: 'var(--brand-primary, #0052FF)' }}
      />
    </label>
  );
}

export default function AdminAutoOffersPage() {
  const { toast, showToast } = useToast();
  const [state, setState] = useState<AutoOfferState>(EMPTY_STATE);
  const [promoThresholdRs, setPromoThresholdRs] = useState('999');
  const [storeProducts, setStoreProducts] = useState<
    Array<{ id: string; name: string; price_paise: number }>
  >([]);
  const [activeManualCoupons, setActiveManualCoupons] = useState<
    Array<{
      id: string;
      code: string;
      discount_type: string | null;
      discount_percent: number;
      discount_paise: number | null;
      min_cart_paise: number | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const supabase = createClient();
      const [shipRes, prodRes, coupRes] = await Promise.all([
        fetch('/api/admin/shipping'),
        supabase
          .from('products')
          .select('id, name, price_paise')
          .eq('is_active', true)
          .order('name', { ascending: true })
          .limit(100),
        supabase
          .from('coupons')
          .select('id, code, discount_type, discount_percent, discount_paise, min_cart_paise')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
      ]);

      const data = await shipRes.json();
      if (!shipRes.ok) {
        showToast(data?.error || 'Failed to load auto-offer settings', 'error');
        return;
      }

      const raw = data.settings || {};
      const rewardType: PromoRewardType = raw.promo_reward_type ?? EMPTY_STATE.promo_reward_type;
      const next: AutoOfferState = {
        ...EMPTY_STATE,
        ...raw,
        promo_banner_enabled: raw.promo_banner_enabled ?? EMPTY_STATE.promo_banner_enabled,
        promo_goal_type: raw.promo_goal_type ?? EMPTY_STATE.promo_goal_type,
        promo_goal_threshold_paise:
          raw.promo_goal_threshold_paise ??
          raw.free_shipping_threshold_paise ??
          EMPTY_STATE.promo_goal_threshold_paise,
        promo_goal_item_count: raw.promo_goal_item_count ?? EMPTY_STATE.promo_goal_item_count,
        promo_progress_template:
          raw.promo_progress_template ||
          REWARD_DEFAULTS[rewardType]?.progress ||
          EMPTY_STATE.promo_progress_template,
        promo_unlocked_text:
          raw.promo_unlocked_text ||
          REWARD_DEFAULTS[rewardType]?.unlocked ||
          EMPTY_STATE.promo_unlocked_text,
        promo_nudge_enabled: raw.promo_nudge_enabled ?? EMPTY_STATE.promo_nudge_enabled,
        promo_nudge_title: raw.promo_nudge_title ?? EMPTY_STATE.promo_nudge_title,
        promo_nudge_badge: raw.promo_nudge_badge ?? EMPTY_STATE.promo_nudge_badge,
        promo_nudge_text: raw.promo_nudge_text ?? EMPTY_STATE.promo_nudge_text,
        promo_reward_type: rewardType,
        promo_manual_coupon_code: raw.promo_manual_coupon_code ?? null,
        reward_percentage: Number(raw.reward_percentage) || EMPTY_STATE.reward_percentage,
        reward_product_id: raw.reward_product_id ?? null,
        buy_x_quantity: Number(raw.buy_x_quantity) || EMPTY_STATE.buy_x_quantity,
        get_y_quantity: Number(raw.get_y_quantity) || EMPTY_STATE.get_y_quantity,
      };
      setState(next);
      setPromoThresholdRs(paiseToRupees(next.promo_goal_threshold_paise));

      if (prodRes.data) {
        setStoreProducts(prodRes.data as Array<{ id: string; name: string; price_paise: number }>);
      }
      if (coupRes.data) {
        setActiveManualCoupons(
          (coupRes.data as Array<{
            id: string;
            code: string;
            discount_type: string | null;
            discount_percent: number;
            discount_paise: number | null;
            min_cart_paise: number | null;
          }>).filter((c) => c.discount_type !== 'bxgy'),
        );
      }
    } catch {
      showToast('Failed to load auto-offer settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onStateChange = (patch: Partial<AutoOfferState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const selectRewardType = (nextType: PromoRewardType) => {
    const knownProgress = new Set(Object.values(REWARD_DEFAULTS).map((d) => d.progress));
    const knownUnlocked = new Set(Object.values(REWARD_DEFAULTS).map((d) => d.unlocked));
    const curProgress = (state.promo_progress_template || '').trim();
    const curUnlocked = (state.promo_unlocked_text || '').trim();

    const patch: Partial<AutoOfferState> = { promo_reward_type: nextType };
    if (!curProgress || knownProgress.has(curProgress)) {
      patch.promo_progress_template = REWARD_DEFAULTS[nextType].progress;
    }
    if (!curUnlocked || knownUnlocked.has(curUnlocked)) {
      patch.promo_unlocked_text = REWARD_DEFAULTS[nextType].unlocked;
    }
    onStateChange(patch);
  };

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        promo_banner_enabled: state.promo_banner_enabled,
        promo_goal_type: state.promo_goal_type,
        promo_goal_threshold_paise: rupeesToPaise(
          promoThresholdRs || paiseToRupees(state.free_shipping_threshold_paise),
        ),
        promo_goal_item_count: Number(state.promo_goal_item_count) || 2,
        promo_progress_template: state.promo_progress_template,
        promo_unlocked_text: state.promo_unlocked_text,
        promo_nudge_enabled: state.promo_nudge_enabled,
        promo_nudge_title: state.promo_nudge_title,
        promo_nudge_badge: state.promo_nudge_badge,
        promo_nudge_text: state.promo_nudge_text,
        promo_reward_type: state.promo_reward_type || 'free_shipping',
        promo_manual_coupon_code:
          state.promo_reward_type === 'manual_coupon_only'
            ? state.promo_manual_coupon_code || null
            : null,
        reward_percentage: Number(state.reward_percentage) || 0,
        reward_product_id: state.reward_product_id ?? null,
        buy_x_quantity: Number(state.buy_x_quantity) || 2,
        get_y_quantity: Number(state.get_y_quantity) || 1,
      };

      const res = await fetch('/api/admin/shipping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'Failed to save auto-offer settings', 'error');
        return;
      }
      showToast('Magic Cart Auto Offers saved', 'success');
    } catch {
      showToast('Network error while saving', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        Loading Auto Offers...
      </div>
    );
  }

  const currentCodFeeText =
    state.cod_fee_paise > 0 ? `₹${Math.round(state.cod_fee_paise / 100)}` : '₹50';
  const effectivePromoGoalRs =
    promoThresholdRs || paiseToRupees(state.free_shipping_threshold_paise) || '999';
  const previewRemaining = state.promo_goal_type === 'item_count' ? '1 item' : '₹349';
  const selectedGiftProduct = storeProducts.find((p) => p.id === state.reward_product_id);
  const giftLabel = selectedGiftProduct?.name || 'FREE Gift';

  let previewBannerIcon = '🚚';
  if (state.promo_reward_type === 'threshold_percentage') previewBannerIcon = '🏷️';
  else if (state.promo_reward_type === 'buy_x_get_cheapest_free') previewBannerIcon = '⚡';
  else if (state.promo_reward_type === 'buy_x_get_specific_free') previewBannerIcon = '🎁';
  else if (state.promo_reward_type === 'manual_coupon_only') previewBannerIcon = '🎟️';

  const previewManualCoupon =
    (state.promo_manual_coupon_code
      ? activeManualCoupons.find((c) => c.code === state.promo_manual_coupon_code)
      : null) ?? activeManualCoupons[0];

  const activeFallback =
    REWARD_DEFAULTS[state.promo_reward_type || 'free_shipping']?.progress ||
    REWARD_DEFAULTS.free_shipping.progress;
  const rawPreviewTpl = (state.promo_progress_template || '').trim();
  const effectivePreviewTpl =
    !rawPreviewTpl ||
    (state.promo_reward_type !== 'free_shipping' &&
      rawPreviewTpl === REWARD_DEFAULTS.free_shipping.progress)
      ? activeFallback
      : rawPreviewTpl;

  const previewProgressText =
    state.promo_reward_type === 'manual_coupon_only'
      ? previewManualCoupon
        ? `Add ₹349 more to unlock ${previewManualCoupon.code} (${
            previewManualCoupon.discount_type === 'flat' && previewManualCoupon.discount_paise
              ? `₹${Math.round(previewManualCoupon.discount_paise / 100)} OFF`
              : `${previewManualCoupon.discount_percent}% OFF`
          })`
        : 'Add ₹349 more to unlock your manual coupon!'
      : effectivePreviewTpl
          .replace(/\{remaining\}/g, previewRemaining)
          .replace(/\{remaining_items\}/g, '1 item')
          .replace(/\{item_count\}/g, String(state.promo_goal_item_count || 2))
          .replace(/\{threshold\}/g, `₹${effectivePromoGoalRs}`)
          .replace(/\{reward_percentage\}/g, `${state.reward_percentage || 10}%`)
          .replace(/\{reward_product\}/g, giftLabel)
          .replace(/\{buy_x\}/g, String(state.buy_x_quantity || 2))
          .replace(/\{get_y\}/g, String(state.get_y_quantity || 1));

  const previewNudgeTitle = (state.promo_nudge_title || 'Pay with UPI & Save {cod_fee}').replace(
    /\{cod_fee\}/g,
    currentCodFeeText,
  );
  const previewNudgeText = (
    state.promo_nudge_text ||
    'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.'
  ).replace(/\{cod_fee\}/g, currentCodFeeText);

  return (
    <div className="card">
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Configure automated Magic Cart progress bar rewards (Free Shipping, % Off, Buy X Get Y Free, Free Gift) and prepaid conversion nudges. Base shipping charges and COD fees remain in{' '}
          <Link href="/admin/shipping" style={{ color: 'var(--brand-blue, #2FA9F5)', fontWeight: 600 }}>
            Shipping &amp; COD
          </Link>
          .
        </p>
      </div>

      {/* Live Preview Card */}
      <SectionRule label="Live Cart Drawer Preview" />
      <div
        style={{
          padding: '18px 20px',
          background: 'var(--bg-input)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          marginBottom: 24,
        }}
      >
        {state.promo_banner_enabled ? (
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}
            >
              <span>{previewBannerIcon}</span>
              <span>{previewProgressText}</span>
            </div>
            <div
              style={{
                height: 6,
                width: '100%',
                background: 'var(--border-color)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '65%',
                  height: '100%',
                  background: 'var(--brand-primary, #0052FF)',
                  borderRadius: 99,
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              borderRadius: 6,
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              marginBottom: 14,
              border: '1px dashed var(--border-color)',
            }}
          >
            Promotional progress bar is currently hidden.
          </div>
        )}

        {state.promo_nudge_enabled ? (
          <div
            style={{
              background: 'rgba(255, 179, 0, 0.08)',
              border: '1px solid rgba(255, 179, 0, 0.25)',
              borderRadius: 8,
              padding: '12px 14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                <span>⚡</span>
                <span>{previewNudgeTitle}</span>
              </div>
              {state.promo_nudge_badge && (
                <span
                  style={{
                    fontSize: '0.5625rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    padding: '2px 6px',
                    background: 'rgba(255, 179, 0, 0.2)',
                    color: 'var(--text-primary)',
                    borderRadius: 4,
                  }}
                >
                  {state.promo_nudge_badge}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              {previewNudgeText}
            </p>
          </div>
        ) : (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              borderRadius: 6,
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
            }}
          >
            Prepaid conversion nudge card is currently hidden.
          </div>
        )}
      </div>

      {/* Automated Rewards & Promotion Type */}
      <SectionRule label="Automated Rewards & Promotion Type" />

      <div style={{ marginBottom: 16 }}>
        <ToggleRow
          title="Promotional Progress Banner"
          subtitle="Display dynamic unlock progress tracker at the top of Cart Drawer"
          checked={state.promo_banner_enabled}
          onChange={(v) => onStateChange({ promo_banner_enabled: v })}
        />
      </div>

      {state.promo_banner_enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
          <div className="input-group">
            <label className="input-label">Reward / Goal Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              {[
                {
                  id: 'free_shipping' as const,
                  title: '🚚 Free Shipping Unlock',
                  desc: 'Unlock ₹0 shipping on minimum order value or item count',
                },
                {
                  id: 'threshold_percentage' as const,
                  title: '🏷️ % Off on Threshold',
                  desc: 'Spend ₹X, automatically get Y% off the entire cart',
                },
                {
                  id: 'buy_x_get_cheapest_free' as const,
                  title: '⚡ Buy X Get Lowest Free (BOGO)',
                  desc: 'Buy X items, get the lowest-priced item(s) free',
                },
                {
                  id: 'buy_x_get_specific_free' as const,
                  title: '🎁 Buy X Get Free Specific Gift',
                  desc: 'Buy X items, receive a designated catalog item free',
                },
                {
                  id: 'manual_coupon_only' as const,
                  title: '🎟️ Manual Coupon Only (Auto Offers OFF)',
                  desc: 'Disable all automatic cart discounts and track a manual coupon in the progress bar',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectRewardType(opt.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${state.promo_reward_type === opt.id ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                    background:
                      state.promo_reward_type === opt.id ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {opt.title}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {state.promo_reward_type === 'free_shipping' && (
            <>
              <div className="input-group">
                <label className="input-label">Goal Target Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onStateChange({ promo_goal_type: 'amount' });
                      if (!promoThresholdRs) {
                        setPromoThresholdRs(paiseToRupees(state.free_shipping_threshold_paise));
                      }
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${state.promo_goal_type === 'amount' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                      background:
                        state.promo_goal_type === 'amount' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Order Value (₹)
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      e.g. Free shipping over ₹999
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStateChange({ promo_goal_type: 'item_count' })}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${state.promo_goal_type === 'item_count' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                      background:
                        state.promo_goal_type === 'item_count'
                          ? 'rgba(0, 82, 255, 0.08)'
                          : 'var(--bg-input)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Bundle Count (Items)
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      e.g. Add 2 tees for free delivery
                    </div>
                  </button>
                </div>
              </div>

              {state.promo_goal_type === 'amount' ? (
                <Field label="Goal Threshold Amount (₹)" hint="Cart total required to unlock free shipping">
                  <input
                    className="input-field"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="999"
                    value={promoThresholdRs}
                    onChange={(e) => setPromoThresholdRs(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="Goal Item Count" hint="Number of items required in cart">
                  <input
                    className="input-field"
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    placeholder="2"
                    value={state.promo_goal_item_count || 2}
                    onChange={(e) =>
                      onStateChange({ promo_goal_item_count: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                  />
                </Field>
              )}
            </>
          )}

          {state.promo_reward_type === 'threshold_percentage' && (
            <div className="input-row">
              <Field label="Spend Threshold (₹)" hint="Subtotal required to unlock discount">
                <input
                  className="input-field"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="999"
                  value={promoThresholdRs}
                  onChange={(e) => setPromoThresholdRs(e.target.value)}
                />
              </Field>
              <Field label="Reward Discount (%)" hint="Percentage deducted from cart subtotal">
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  placeholder="15"
                  value={state.reward_percentage || 10}
                  onChange={(e) =>
                    onStateChange({
                      reward_percentage: Math.min(90, Math.max(1, parseInt(e.target.value, 10) || 0)),
                    })
                  }
                />
              </Field>
            </div>
          )}

          {state.promo_reward_type === 'buy_x_get_cheapest_free' && (
            <div className="input-row">
              <Field
                label="Buy X Paid Items"
                hint={`e.g. 2 for Buy 2 Get ${state.get_y_quantity || 1} Free (Cart total needed: ${(state.buy_x_quantity || 2) + (state.get_y_quantity || 1)})`}
              >
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  placeholder="2"
                  value={state.buy_x_quantity || 2}
                  onChange={(e) =>
                    onStateChange({ buy_x_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                />
              </Field>
              <Field label="Get Y Lowest-Priced Free Items" hint="e.g. 1 cheapest item discounted to ₹0">
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  placeholder="1"
                  value={state.get_y_quantity || 1}
                  onChange={(e) =>
                    onStateChange({ get_y_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                />
              </Field>
            </div>
          )}

          {state.promo_reward_type === 'buy_x_get_specific_free' && (
            <>
              <Field label="Required Items in Cart to Unlock Gift" hint="Number of items needed to qualify">
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  placeholder="2"
                  value={state.buy_x_quantity || 2}
                  onChange={(e) =>
                    onStateChange({ buy_x_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                />
              </Field>
              <Field label="Select Free Gift Product" hint="Designated product gifted at ₹0 when items count is met">
                <select
                  className="input-field"
                  value={state.reward_product_id || ''}
                  onChange={(e) => onStateChange({ reward_product_id: e.target.value || null })}
                  style={{ background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                >
                  <option value="">-- Choose a Product to Gift --</option>
                  {storeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Value: ₹{(p.price_paise / 100).toFixed(0)})
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {state.promo_reward_type === 'manual_coupon_only' && (
            <Field
              label="Progress Bar Manual Coupon"
              hint="All automatic Magic Cart discounts are disabled. Customers must click Apply on the manual coupon once unlocked."
            >
              <select
                className="input-field"
                value={state.promo_manual_coupon_code || ''}
                onChange={(e) =>
                  onStateChange({ promo_manual_coupon_code: e.target.value || null })
                }
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              >
                <option value="">Auto-pick closest active manual coupon</option>
                {activeManualCoupons.map((c) => {
                  const offerLabel =
                    c.discount_type === 'flat' && c.discount_paise
                      ? `₹${Math.round(c.discount_paise / 100).toLocaleString('en-IN')} OFF`
                      : `${c.discount_percent}% OFF`;
                  const minLabel = c.min_cart_paise
                    ? ` · Min ₹${Math.round(c.min_cart_paise / 100).toLocaleString('en-IN')}`
                    : '';
                  return (
                    <option key={c.id} value={c.code}>
                      {c.code} ({offerLabel}
                      {minLabel})
                    </option>
                  );
                })}
              </select>
            </Field>
          )}

          {state.promo_reward_type !== 'manual_coupon_only' && (
            <>
              <Field
                label="In-Progress Copy Template"
                hint="Supports {remaining}, {remaining_items}, {threshold}, {reward_percentage}, {reward_product}, {buy_x}"
              >
                <input
                  className="input-field"
                  type="text"
                  placeholder="Add {remaining} more to unlock reward"
                  value={state.promo_progress_template}
                  onChange={(e) => onStateChange({ promo_progress_template: e.target.value })}
                />
              </Field>

              <Field label="Unlocked Congratulations Message" hint="Rendered when goal is reached">
                <input
                  className="input-field"
                  type="text"
                  placeholder="Congratulations! Your reward has been unlocked!"
                  value={state.promo_unlocked_text}
                  onChange={(e) => onStateChange({ promo_unlocked_text: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      )}

      {/* Prepaid Conversion Nudge */}
      <SectionRule label="Prepaid Nudge (Low RTO)" />

      <div style={{ marginBottom: 16 }}>
        <ToggleRow
          title="Prepaid Conversion Nudge"
          subtitle="Incentivize UPI prepaid checkout to eliminate COD returns and RTO losses"
          checked={state.promo_nudge_enabled}
          onChange={(v) => onStateChange({ promo_nudge_enabled: v })}
        />
      </div>

      {state.promo_nudge_enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="input-row">
            <Field label="Nudge Title" hint="Supports {cod_fee}">
              <input
                className="input-field"
                type="text"
                placeholder="Pay with UPI & Save {cod_fee}"
                value={state.promo_nudge_title}
                onChange={(e) => onStateChange({ promo_nudge_title: e.target.value })}
              />
            </Field>
            <Field label="Badge Text" hint="Small pill badge">
              <input
                className="input-field"
                type="text"
                placeholder="LOWEST PRICE"
                value={state.promo_nudge_badge}
                onChange={(e) => onStateChange({ promo_nudge_badge: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Nudge Description Text" hint="Supports {cod_fee}">
            <textarea
              className="input-field"
              rows={2}
              style={{ resize: 'vertical', minHeight: 64 }}
              placeholder="Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours."
              value={state.promo_nudge_text}
              onChange={(e) => onStateChange({ promo_nudge_text: e.target.value })}
            />
          </Field>
        </div>
      )}

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
        <button
          type="button"
          className={`btn btn-primary btn-sm${saving ? ' btn-loading' : ''}`}
          onClick={handleSave}
          disabled={saving}
          style={{ width: 'auto', minWidth: 180 }}
        >
          SAVE AUTO OFFERS
        </button>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            padding: '12px 18px',
            borderRadius: 10,
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: '#FFFFFF',
            background: toast.type === 'error' ? '#DC2626' : '#059669',
            boxShadow: '0 10px 25px rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{toast.type === 'error' ? '✕' : '✓'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
