'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Admin coupon management.
 *
 * Adds segmentation controls on top of the original simple
 * code+percent CRUD:
 *   - new_users_only       restricts coupon to first-time buyers
 *   - show_on_homepage     renders a homepage banner for this code
 *   - homepage_text        free headline (defaulted server-side)
 *   - homepage_accent      premium colour slot (royal-blue / cobalt
 *                          / gold / emerald)
 *
 * RLS already restricts writes to admin_users — the protected
 * layout has verified that before this client ever mounts. We
 * therefore call Supabase directly from the browser via the
 * cookie-bound client; no extra admin-API endpoint required.
 */

const ACCENTS: { id: string; label: string; swatch: string }[] = [
  { id: 'royal-blue', label: 'Royal Blue', swatch: '#1F3A8A' },
  { id: 'cobalt', label: 'Cobalt', swatch: '#2540A8' },
  { id: 'gold', label: 'Deep Gold', swatch: '#A88532' },
  { id: 'emerald', label: 'Emerald', swatch: '#0F4F3F' },
];

type CouponCartMode = 'sync_auto' | 'manual_with_progress' | 'manual_only';
type CouponDiscountType = 'percent' | 'flat';
type MagicCartMode = 'off' | 'free_shipping' | 'coupon_goal';

interface Coupon {
  id: string;
  code: string;
  discount_type: CouponDiscountType;
  discount_percent: number;
  discount_paise: number | null;
  is_active: boolean;
  new_users_only: boolean;
  show_on_homepage: boolean;
  homepage_text: string | null;
  homepage_accent: string | null;
  min_cart_paise: number | null;
  max_discount_paise: number | null;
  starts_at: string | null;
  expires_at: string | null;
  per_user_limit: number | null;
  usage_limit: number | null;
  cart_mode: CouponCartMode;
  stackable_with_promo: boolean;
  created_at: string;
}

interface DraftState {
  code: string;
  discountType: CouponDiscountType;
  percent: string;
  flatRupees: string;
  isActive: boolean;
  newUsersOnly: boolean;
  showOnHomepage: boolean;
  homepageText: string;
  homepageAccent: string;
  /** Rupees in the form, paise in the DB. */
  minCartRupees: string;
  maxDiscountRupees: string;
  /** datetime-local strings; converted to ISO on save. */
  startsAt: string;
  expiresAt: string;
  perUserLimit: string;
  usageLimit: string;
  cartMode: CouponCartMode;
  stackableWithPromo: boolean;
}

const EMPTY_DRAFT: DraftState = {
  code: '',
  discountType: 'percent',
  percent: '',
  flatRupees: '',
  isActive: true,
  newUsersOnly: false,
  showOnHomepage: false,
  homepageText: '',
  homepageAccent: 'gold',
  minCartRupees: '',
  maxDiscountRupees: '',
  startsAt: '',
  expiresAt: '',
  perUserLimit: '',
  usageLimit: '',
  cartMode: 'manual_only',
  stackableWithPromo: false,
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  // Strip seconds + Z so <input type=datetime-local> accepts it.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePositiveInt(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Delete-confirmation modal state. `deleting` holds the full coupon
  // we are about to remove so the prompt can show the code. `deletePending`
  // gates the confirm button while the request is in-flight.
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Section A: Master Magic Cart Progress Bar state
  const [magicMode, setMagicMode] = useState<MagicCartMode>('free_shipping');
  const [freeShipThresholdPaise, setFreeShipThresholdPaise] = useState<number>(99900);
  const [goalCouponId, setGoalCouponId] = useState<string>('');
  const [goalApplyStyle, setGoalApplyStyle] = useState<'sync_auto' | 'manual_with_progress'>('sync_auto');
  const [savingMagic, setSavingMagic] = useState(false);
  const [magicMsg, setMagicMsg] = useState('');

  useEffect(() => {
    fetchCoupons();
    fetchShippingMagicSettings();
  }, []);

  async function fetchShippingMagicSettings() {
    try {
      const res = await fetch('/api/admin/shipping', { cache: 'no-store' });
      const json = await res.json();
      const s = json?.data?.settings ?? json?.settings;
      if (s) {
        setFreeShipThresholdPaise(Number(s.free_shipping_threshold_paise) || 99900);
        const mode: MagicCartMode =
          s.magic_cart_mode === 'off' || s.magic_cart_mode === 'free_shipping' || s.magic_cart_mode === 'coupon_goal'
            ? s.magic_cart_mode
            : s.promo_banner_enabled === false
              ? 'off'
              : 'free_shipping';
        setMagicMode(mode);
      }
    } catch {}
  }

  async function fetchCoupons() {
    const supabase = createClient();
    const { data } = await supabase
      .from('coupons')
      .select(
        'id, code, discount_type, discount_percent, discount_paise, is_active, new_users_only, show_on_homepage, homepage_text, homepage_accent, min_cart_paise, max_discount_paise, starts_at, expires_at, per_user_limit, usage_limit, cart_mode, stackable_with_promo, created_at',
      )
      .order('created_at', { ascending: false });
    const list = (data as Coupon[]) ?? [];
    setCoupons(list);

    const activeGoal = list.find(
      (c) => c.is_active && (c.cart_mode === 'sync_auto' || c.cart_mode === 'manual_with_progress'),
    );
    if (activeGoal) {
      setGoalCouponId(activeGoal.id);
      setGoalApplyStyle(activeGoal.cart_mode === 'sync_auto' ? 'sync_auto' : 'manual_with_progress');
    } else if (list.length > 0 && !goalCouponId) {
      const firstActive = list.find((c) => c.is_active);
      if (firstActive) setGoalCouponId(firstActive.id);
    }

    setLoading(false);
  }

  async function saveMagicCartBar(
    nextMode: MagicCartMode = magicMode,
    nextCouponId: string = goalCouponId,
    nextStyle: 'sync_auto' | 'manual_with_progress' = goalApplyStyle,
  ) {
    setSavingMagic(true);
    setMagicMsg('');
    try {
      // 1. Save master mode on shipping_settings (clearing any legacy promo_reward_type overrides)
      await fetch('/api/admin/shipping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magic_cart_mode: nextMode }),
      });

      // 2. Sync coupon cart_mode flags so at most ONE coupon drives the progress bar
      const supabase = createClient();
      await supabase.from('coupons').update({ cart_mode: 'manual_only' }).neq('cart_mode', 'manual_only');
      if (nextMode === 'coupon_goal' && nextCouponId) {
        await supabase.from('coupons').update({ cart_mode: nextStyle }).eq('id', nextCouponId);
      }

      setMagicMode(nextMode);
      setGoalCouponId(nextCouponId);
      setGoalApplyStyle(nextStyle);
      setMagicMsg('Saved');
      setTimeout(() => setMagicMsg(''), 2500);
      await fetchCoupons();
    } catch {
      setMagicMsg('Failed to save');
    } finally {
      setSavingMagic(false);
    }
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setError('');
  }

  function startEdit(c: Coupon) {
    setEditingId(c.id);
    setDraft({
      code: c.code,
      discountType: c.discount_type ?? 'percent',
      percent: c.discount_type === 'flat' ? '' : String(c.discount_percent),
      flatRupees: c.discount_type === 'flat' && c.discount_paise ? String(c.discount_paise / 100) : '',
      isActive: c.is_active,
      newUsersOnly: c.new_users_only,
      showOnHomepage: c.show_on_homepage,
      homepageText: c.homepage_text ?? '',
      homepageAccent: c.homepage_accent ?? 'gold',
      minCartRupees: c.min_cart_paise ? String(c.min_cart_paise / 100) : '',
      maxDiscountRupees: c.max_discount_paise ? String(c.max_discount_paise / 100) : '',
      startsAt: toLocalInput(c.starts_at),
      expiresAt: toLocalInput(c.expires_at),
      perUserLimit: c.per_user_limit ? String(c.per_user_limit) : '',
      usageLimit: c.usage_limit ? String(c.usage_limit) : '',
      cartMode: c.cart_mode ?? 'manual_only',
      stackableWithPromo: Boolean(c.stackable_with_promo),
    });
    setShowForm(true);
    setError('');
  }

  async function handleSave() {
    const code = draft.code.toUpperCase().trim();
    if (!code) return setError('Coupon code is required');

    const isFlat = draft.discountType === 'flat';
    const percent = isFlat ? 0 : parseInt(draft.percent, 10);
    const flatPaise = isFlat && draft.flatRupees.trim()
      ? Math.round(parseFloat(draft.flatRupees) * 100)
      : null;

    if (!isFlat && (Number.isNaN(percent) || percent < 1 || percent > 100)) {
      return setError('Discount % must be between 1 and 100');
    }
    if (isFlat && (!flatPaise || Number.isNaN(flatPaise) || flatPaise < 100)) {
      return setError('Flat discount must be at least ₹1');
    }

    // Optional numeric / date fields. Empty input = NULL in the
    // DB which means "no constraint".
    const minCartRupees = draft.minCartRupees.trim();
    const maxDiscountRupees = draft.maxDiscountRupees.trim();
    const minCartPaise = minCartRupees
      ? Math.round(parseFloat(minCartRupees) * 100)
      : null;
    const maxDiscountPaise = maxDiscountRupees
      ? Math.round(parseFloat(maxDiscountRupees) * 100)
      : null;
    if (minCartPaise !== null && (Number.isNaN(minCartPaise) || minCartPaise < 0)) {
      return setError('Minimum cart must be a positive number');
    }
    if (maxDiscountPaise !== null && (Number.isNaN(maxDiscountPaise) || maxDiscountPaise < 0)) {
      return setError('Maximum discount must be a positive number');
    }

    const startsAtIso = parseLocalInput(draft.startsAt);
    const expiresAtIso = parseLocalInput(draft.expiresAt);
    if (
      startsAtIso &&
      expiresAtIso &&
      new Date(startsAtIso).getTime() > new Date(expiresAtIso).getTime()
    ) {
      return setError('Start must be before expiry');
    }

    const perUserLimit = parsePositiveInt(draft.perUserLimit);
    if (draft.perUserLimit.trim() && perUserLimit === null) {
      return setError('Per-user limit must be 1 or higher');
    }
    const usageLimit = parsePositiveInt(draft.usageLimit);
    if (draft.usageLimit.trim() && usageLimit === null) {
      return setError('Usage limit must be 1 or higher');
    }

    setSaving(true);
    setError('');
    const supabase = createClient();
    const payload = {
      code,
      discount_type: draft.discountType,
      discount_percent: percent,
      discount_paise: flatPaise,
      is_active: draft.isActive,
      new_users_only: draft.newUsersOnly,
      show_on_homepage: draft.showOnHomepage,
      homepage_text: draft.homepageText.trim() || null,
      homepage_accent: draft.showOnHomepage ? draft.homepageAccent : null,
      min_cart_paise: minCartPaise,
      max_discount_paise: maxDiscountPaise,
      starts_at: startsAtIso,
      expires_at: expiresAtIso,
      per_user_limit: perUserLimit,
      usage_limit: usageLimit,
      cart_mode: draft.cartMode,
      stackable_with_promo: draft.stackableWithPromo,
    };

    // If this coupon is set to drive the progress bar, reset others cleanly so there's never a conflict
    if (draft.cartMode === 'sync_auto' || draft.cartMode === 'manual_with_progress') {
      await supabase.from('coupons').update({ cart_mode: 'manual_only' }).neq('code', code);
      await fetch('/api/admin/shipping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magic_cart_mode: 'coupon_goal' }),
      }).catch(() => {});
      setMagicMode('coupon_goal');
    }

    const result = editingId
      ? await supabase.from('coupons').update(payload).eq('id', editingId)
      : await supabase.from('coupons').insert(payload);

    if (result.error) {
      setError(result.error.message || 'Failed to save coupon');
      setSaving(false);
      return;
    }

    setShowForm(false);
    resetDraft();
    setSaving(false);
    fetchCoupons();
  }

  async function toggleActive(id: string, isActive: boolean) {
    const supabase = createClient();
    await supabase.from('coupons').update({ is_active: !isActive }).eq('id', id);
    fetchCoupons();
  }

  async function confirmDelete() {
    if (!deleting || deletePending) return;
    setDeletePending(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/admin/coupons/${deleting.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) {
        setDeleteError(data.error || 'Failed to delete coupon');
        setDeletePending(false);
        return;
      }
      setDeleting(null);
      setDeletePending(false);
      await fetchCoupons();
    } catch (err) {
      console.error('[COUPON_DELETE]', err);
      setDeleteError('Network error. Please try again.');
      setDeletePending(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        Loading...
      </div>
    );
  }

  const activeGoalCoupon = coupons.find((c) => c.id === goalCouponId && c.is_active);
  const liveSummarySentence = (() => {
    if (magicMode === 'off') {
      return 'Customers see NO progress bar in the Cart Drawer; only active manual coupon codes are available.';
    }
    if (magicMode === 'free_shipping') {
      const freeRs = Math.round(freeShipThresholdPaise / 100).toLocaleString('en-IN');
      return `Customers see a Free Shipping progress bar (unlocked at ₹${freeRs}) in the Cart Drawer, plus any active manual coupons.`;
    }
    if (activeGoalCoupon) {
      const discLabel =
        activeGoalCoupon.discount_type === 'flat' && activeGoalCoupon.discount_paise
          ? `₹${Math.round(activeGoalCoupon.discount_paise / 100).toLocaleString('en-IN')} OFF`
          : `${activeGoalCoupon.discount_percent}% OFF`;
      const minLabel = activeGoalCoupon.min_cart_paise
        ? `at ₹${Math.round(activeGoalCoupon.min_cart_paise / 100).toLocaleString('en-IN')}`
        : 'on any order';
      const applyMode =
        goalApplyStyle === 'sync_auto'
          ? 'auto-applies when unlocked'
          : 'requires clicking Apply once unlocked';
      return `Customers see a progress bar tracking ${activeGoalCoupon.code} (${discLabel} ${minLabel}), which ${applyMode}.`;
    }
    return 'Coupon Goal is selected, but no active coupon is linked yet — pick an active coupon below.';
  })();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Coupons &amp; Magic Cart Offers</h1>
          <p className="text-xs text-muted" style={{ marginTop: 4 }}>
            Single source of truth for all discounts and the Cart Drawer progress bar.
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
              resetDraft();
            } else {
              resetDraft();
              setShowForm(true);
            }
          }}
        >
          {showForm ? 'Cancel' : '+ New Coupon'}
        </button>
      </div>

      {/* Live Storefront Summary */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-5)',
          padding: '12px 16px',
          borderLeft: '3px solid var(--brand-blue, #2FA9F5)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ fontSize: '0.6875rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
          Live Storefront Summary
        </div>
        <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.45 }}>
          {liveSummarySentence}
        </div>
      </div>

      {/* Section A: Magic Cart Progress Bar (Top Control Card) */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Section A: Magic Cart Progress Bar</h2>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0 0' }}>
              Choose what the progress bar at the top of the Cart Drawer tracks.
            </p>
          </div>
          {magicMsg && (
            <span className="badge badge-paid">{magicMsg}</span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 'var(--space-4)' }}>
          {[
            { id: 'off' as const, title: '1. Off', desc: 'Hide progress bar; show manual coupons only' },
            { id: 'free_shipping' as const, title: '2. Free Shipping', desc: `Track ₹${Math.round(freeShipThresholdPaise / 100)} free-shipping goal` },
            { id: 'coupon_goal' as const, title: '3. Coupon Goal', desc: 'Link 1 active coupon to the progress bar' },
          ].map((opt) => {
            const active = magicMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMagicMode(opt.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: active ? '1.5px solid var(--brand-blue, #2FA9F5)' : '1px solid var(--border-color)',
                  background: active ? 'rgba(47, 169, 245, 0.08)' : 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.8125rem', fontWeight: 700 }}>{opt.title}</div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {magicMode === 'coupon_goal' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 'var(--space-4)' }}>
            <div className="input-group">
              <label className="input-label">Progress Bar Coupon</label>
              <select
                className="input-field"
                value={goalCouponId}
                onChange={(e) => setGoalCouponId(e.target.value)}
              >
                <option value="">-- Select an active coupon --</option>
                {coupons.filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.discount_type === 'flat' && c.discount_paise ? `₹${Math.round(c.discount_paise / 100)} OFF` : `${c.discount_percent}% OFF`}
                    {c.min_cart_paise ? ` · Min ₹${Math.round(c.min_cart_paise / 100)}` : ''})
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Unlock Behavior</label>
              <select
                className="input-field"
                value={goalApplyStyle}
                onChange={(e) => setGoalApplyStyle(e.target.value as 'sync_auto' | 'manual_with_progress')}
              >
                <option value="sync_auto">Auto-Apply when unlocked</option>
                <option value="manual_with_progress">Customer clicks Apply manually</option>
              </select>
            </div>
          </div>
        )}

        <button
          type="button"
          className={`btn btn-primary btn-sm ${savingMagic ? 'btn-loading' : ''}`}
          disabled={savingMagic || (magicMode === 'coupon_goal' && !goalCouponId)}
          onClick={() => saveMagicCartBar(magicMode, goalCouponId, goalApplyStyle)}
          style={{ width: 'auto', minWidth: 180 }}
        >
          SAVE PROGRESS BAR
        </button>
      </div>

      {/* Section B: All Coupons */}
      <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
        Section B: All Coupons ({coupons.length})
      </h2>

      {showForm && (
        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Code</label>
            <input
              className="input-field"
              placeholder="e.g. WELCOME10"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              style={{ textTransform: 'uppercase' }}
              disabled={!!editingId}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Discount Type</label>
              <select
                className="input-field"
                value={draft.discountType}
                onChange={(e) => setDraft({ ...draft, discountType: e.target.value as CouponDiscountType })}
              >
                <option value="percent">Percentage (% OFF)</option>
                <option value="flat">Flat Amount (₹ OFF)</option>
              </select>
            </div>
            {draft.discountType === 'flat' ? (
              <div className="input-group">
                <label className="input-label">Flat Discount (₹)</label>
                <input
                  className="input-field"
                  type="number"
                  placeholder="200"
                  min="1"
                  value={draft.flatRupees}
                  onChange={(e) => setDraft({ ...draft, flatRupees: e.target.value })}
                />
              </div>
            ) : (
              <div className="input-group">
                <label className="input-label">Discount %</label>
                <input
                  className="input-field"
                  type="number"
                  placeholder="10"
                  min="1"
                  max="100"
                  value={draft.percent}
                  onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
                />
              </div>
            )}
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            <span style={{ fontWeight: 500 }}>Coupon is Active</span>
          </label>

          {/* Advanced rules — all optional. Leave blank for "no
              constraint". Stored as paise / int / TIMESTAMPTZ. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <div className="input-group">
              <label className="input-label">Min cart (₹)</label>
              <input
                className="input-field"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 999"
                value={draft.minCartRupees}
                onChange={(e) => setDraft({ ...draft, minCartRupees: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Max discount (₹)</label>
              <input
                className="input-field"
                type="number"
                min="0"
                step="1"
                placeholder="No cap"
                value={draft.maxDiscountRupees}
                onChange={(e) => setDraft({ ...draft, maxDiscountRupees: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Starts at</label>
              <input
                className="input-field"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Expires at</label>
              <input
                className="input-field"
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Per-user limit</label>
              <input
                className="input-field"
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
                value={draft.perUserLimit}
                onChange={(e) => setDraft({ ...draft, perUserLimit: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Total usage limit</label>
              <input
                className="input-field"
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
                value={draft.usageLimit}
                onChange={(e) => setDraft({ ...draft, usageLimit: e.target.value })}
              />
            </div>
          </div>

          <div className="input-group" style={{ marginTop: 'var(--space-2)' }}>
            <label className="input-label">Cart Drawer Behavior Mode</label>
            <select
              className="input-field"
              value={draft.cartMode}
              onChange={(e) => setDraft({ ...draft, cartMode: e.target.value as CouponCartMode })}
            >
              <option value="sync_auto">
                1. Sync with Magic Cart Automation (Auto-apply when eligible, replaces Reward Discount)
              </option>
              <option value="manual_with_progress">
                2. Separate Manual Code + Progress Bar (Customer clicks Apply; bar shows pending amount)
              </option>
              <option value="manual_only">
                3. Normal Manual Coupon (Standard visible coupon)
              </option>
            </select>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-2) 0',
            }}
          >
            <input
              type="checkbox"
              checked={draft.stackableWithPromo}
              onChange={(e) => setDraft({ ...draft, stackableWithPromo: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Allow stacking with Cart Reward Discount</div>
              <div className="text-xs text-muted">Keep unchecked to prevent double-dipping (e.g. 20% + 20% = 40% off).</div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) 0',
              borderTop: '1px solid var(--border-color)',
              marginTop: 'var(--space-2)',
            }}
          >
            <input
              type="checkbox"
              checked={draft.newUsersOnly}
              onChange={(e) => setDraft({ ...draft, newUsersOnly: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 500 }}>First order only</div>
              <div className="text-xs text-muted">Reject this code if the user already has any non-cancelled order.</div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) 0',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <input
              type="checkbox"
              checked={draft.showOnHomepage}
              onChange={(e) => setDraft({ ...draft, showOnHomepage: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Show banner on homepage</div>
              <div className="text-xs text-muted">Renders a single strip below the navbar. The most recently updated active row wins.</div>
            </div>
          </label>

          {draft.showOnHomepage && (
            <>
              <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
                <label className="input-label">Banner Text (optional)</label>
                <input
                  className="input-field"
                  placeholder="e.g. Use code WELCOME10 for 10% off your first order"
                  value={draft.homepageText}
                  onChange={(e) => setDraft({ ...draft, homepageText: e.target.value })}
                  maxLength={120}
                />
              </div>

              <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="input-label">Accent</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {ACCENTS.map((a) => {
                    const active = draft.homepageAccent === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, homepageAccent: a.id })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 10px',
                          border: '1px solid',
                          borderColor: active ? 'var(--text-primary)' : 'var(--border-color)',
                          background: active ? 'var(--bg-tertiary)' : 'transparent',
                          color: 'var(--text-primary)',
                          borderRadius: 999,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: a.swatch,
                          }}
                        />
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="input-error-text" style={{ marginBottom: 'var(--space-3)' }}>
              {error}
            </p>
          )}

          <button
            className={`btn btn-primary ${saving ? 'btn-loading' : ''}`}
            onClick={handleSave}
            disabled={
              saving ||
              !draft.code.trim() ||
              (draft.discountType === 'flat' ? !draft.flatRupees : !draft.percent)
            }
          >
            {editingId ? 'SAVE CHANGES' : 'CREATE COUPON'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {coupons.map((coupon) => {
          const isInProgressBar =
            magicMode === 'coupon_goal' &&
            (coupon.cart_mode === 'sync_auto' || coupon.cart_mode === 'manual_with_progress');
          const discLabel =
            coupon.discount_type === 'flat' && coupon.discount_paise
              ? `₹${Math.round(coupon.discount_paise / 100).toLocaleString('en-IN')} off`
              : `${coupon.discount_percent}% off`;

          return (
          <div
            key={coupon.id}
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '1rem' }}>{coupon.code}</span>
                <span className="text-sm text-muted" style={{ marginLeft: 'var(--space-3)' }}>
                  {discLabel}
                </span>
              </div>
              <button
                className={`btn btn-sm ${coupon.is_active ? 'btn-success' : 'btn-secondary'}`}
                onClick={() => toggleActive(coupon.id, coupon.is_active)}
              >
                {coupon.is_active ? 'Active' : 'Off'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {isInProgressBar && (
                <span className="badge badge-paid">LIVE IN PROGRESS BAR</span>
              )}
              <span className="badge badge-pending">
                {coupon.cart_mode === 'sync_auto' ? 'AUTO-APPLY' : 'MANUAL CODE'}
              </span>
              {coupon.min_cart_paise ? (
                <span className="badge badge-confirmed">MIN ₹{(coupon.min_cart_paise / 100).toLocaleString('en-IN')}</span>
              ) : null}
              {coupon.stackable_with_promo && (
                <span className="badge badge-confirmed">STACKABLE</span>
              )}
              {coupon.new_users_only && (
                <span className="badge badge-confirmed">First-order only</span>
              )}
              {coupon.show_on_homepage && (
                <span className="badge badge-paid">On homepage</span>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => startEdit(coupon)}
                className="btn btn-ghost btn-sm"
                style={{ width: 'auto' }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleting(coupon);
                  setDeleteError('');
                }}
                className="btn btn-ghost btn-sm"
                style={{ width: 'auto', color: 'var(--error)' }}
                aria-label={`Delete coupon ${coupon.code}`}
              >
                Delete
              </button>
            </div>
          </div>
          );
        })}

        {coupons.length === 0 && (
          <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
            No coupons yet
          </p>
        )}
      </div>

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coupon-delete-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletePending) {
              setDeleting(null);
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-5)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              maxWidth: 440,
              width: '100%',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
            }}
          >
            <h2
              id="coupon-delete-title"
              style={{ fontSize: '1.0625rem', fontWeight: 600, marginBottom: 'var(--space-3)' }}
            >
              Delete coupon {deleting.code}?
            </h2>
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.5, marginBottom: 'var(--space-5)' }}
            >
              This permanently removes the coupon. Orders that already used
              {' '}<span style={{ fontFamily: 'monospace' }}>{deleting.code}</span>{' '}
              keep their recorded code and discount untouched.
            </p>
            {deleteError && (
              <p
                className="input-error-text"
                style={{ marginBottom: 'var(--space-3)' }}
              >
                {deleteError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleting(null)}
                disabled={deletePending}
                style={{ width: 'auto' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-primary btn-sm ${deletePending ? 'btn-loading' : ''}`}
                onClick={confirmDelete}
                disabled={deletePending}
                style={{ width: 'auto', background: 'var(--error)', borderColor: 'var(--error)' }}
              >
                {deletePending ? 'DELETING…' : 'DELETE COUPON'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
