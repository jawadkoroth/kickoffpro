'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const ACCENTS: { id: string; label: string; swatch: string }[] = [
  { id: 'royal-blue', label: 'Royal Blue', swatch: '#1F3A8A' },
  { id: 'cobalt', label: 'Cobalt', swatch: '#2540A8' },
  { id: 'gold', label: 'Deep Gold', swatch: '#A88532' },
  { id: 'emerald', label: 'Emerald', swatch: '#0F4F3F' },
];

type CouponDiscountType = 'percent' | 'flat';

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
  minCartRupees: string;
  maxDiscountRupees: string;
  startsAt: string;
  expiresAt: string;
  perUserLimit: string;
  usageLimit: string;
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
  stackableWithPromo: false,
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInput(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePositiveInt(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export default function AdminManualCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletePending, setDeletePending] = useState(false);

  async function fetchCoupons() {
    const supabase = createClient();
    const { data } = await supabase
      .from('coupons')
      .select(
        'id, code, discount_type, discount_percent, discount_paise, is_active, new_users_only, show_on_homepage, homepage_text, homepage_accent, min_cart_paise, max_discount_paise, starts_at, expires_at, per_user_limit, usage_limit, stackable_with_promo, created_at',
      )
      .order('created_at', { ascending: false });
    const list = ((data as Coupon[]) ?? []).filter(
      (c) => (c.discount_type as string) !== 'bxgy',
    );
    setCoupons(list);
    setLoading(false);
  }

  useEffect(() => {
    fetchCoupons();
  }, []);

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setError('');
  }

  function startEdit(c: Coupon) {
    setEditingId(c.id);
    setDraft({
      code: c.code,
      discountType: c.discount_type === 'flat' ? 'flat' : 'percent',
      percent: c.discount_type === 'flat' ? '' : String(c.discount_percent),
      flatRupees:
        c.discount_type === 'flat' && c.discount_paise ? String(c.discount_paise / 100) : '',
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
    const flatPaise =
      isFlat && draft.flatRupees.trim() ? Math.round(parseFloat(draft.flatRupees) * 100) : null;

    if (!isFlat && (Number.isNaN(percent) || percent < 1 || percent > 100)) {
      return setError('Discount % must be between 1 and 100');
    }
    if (isFlat && (!flatPaise || Number.isNaN(flatPaise) || flatPaise < 100)) {
      return setError('Flat discount must be at least ₹1');
    }

    const minCartRupees = draft.minCartRupees.trim();
    const maxDiscountRupees = draft.maxDiscountRupees.trim();
    const minCartPaise = minCartRupees ? Math.round(parseFloat(minCartRupees) * 100) : null;
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
      min_items: 0,
      buy_qty: null,
      get_qty: null,
      max_discount_paise: maxDiscountPaise,
      starts_at: startsAtIso,
      expires_at: expiresAtIso,
      per_user_limit: perUserLimit,
      usage_limit: usageLimit,
      cart_mode: 'manual_only',
      stackable_with_promo: draft.stackableWithPromo,
    };

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
    await fetchCoupons();
  }

  async function toggleActive(id: string, current: boolean) {
    const supabase = createClient();
    await supabase.from('coupons').update({ is_active: !current }).eq('id', id);
    await fetchCoupons();
  }

  async function handleConfirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/admin/coupons/${deleting.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data?.error || 'Failed to delete coupon.');
        setDeletePending(false);
        return;
      }
      setDeleting(null);
      setDeletePending(false);
      await fetchCoupons();
    } catch {
      setDeleteError('Network error. Please try again.');
      setDeletePending(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        Loading Manual Coupons...
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-4)',
          gap: 12,
        }}
      >
        <p className="text-xs text-muted" style={{ margin: 0 }}>
          Create promo codes customers can enter or click to apply in the Cart Drawer and Checkout ({coupons.length} total).
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ width: 'auto', whiteSpace: 'nowrap' }}
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <div className="input-group">
              <label className="input-label">Discount Type</label>
              <select
                className="input-field"
                value={draft.discountType}
                onChange={(e) =>
                  setDraft({ ...draft, discountType: e.target.value as CouponDiscountType })
                }
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
              checked={draft.stackableWithPromo}
              onChange={(e) => setDraft({ ...draft, stackableWithPromo: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Allow stacking with Auto Offers</div>
              <div className="text-xs text-muted">
                Unchecked by default to prevent double-dipping (e.g. 20% Auto Offer + 20% Coupon).
              </div>
            </div>
          </label>

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
              checked={draft.newUsersOnly}
              onChange={(e) => setDraft({ ...draft, newUsersOnly: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 500 }}>First-order buyers only</div>
              <div className="text-xs text-muted">
                Requires sign-in. Rejected for customers with any past order.
              </div>
            </div>
          </label>

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
              checked={draft.showOnHomepage}
              onChange={(e) => setDraft({ ...draft, showOnHomepage: e.target.checked })}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Show banner on homepage</div>
              <div className="text-xs text-muted">
                Surfaces this offer in the storefront banner.
              </div>
            </div>
          </label>

          {draft.showOnHomepage && (
            <div
              style={{
                paddingLeft: 'var(--space-6)',
                marginBottom: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
              }}
            >
              <div className="input-group">
                <label className="input-label">Homepage headline (optional)</label>
                <input
                  className="input-field"
                  placeholder="e.g. Use code WELCOME10 for 10% off your first order"
                  value={draft.homepageText}
                  onChange={(e) => setDraft({ ...draft, homepageText: e.target.value })}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Banner colour</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, homepageAccent: a.id })}
                      className="btn btn-sm"
                      style={{
                        width: 'auto',
                        background: a.swatch,
                        color: '#FAF9F6',
                        border:
                          draft.homepageAccent === a.id
                            ? '2px solid #FFFFFF'
                            : '2px solid transparent',
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--error)', marginBottom: 'var(--space-3)' }}>
              {error}
            </p>
          )}

          <button
            type="button"
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
          const discLabel =
            coupon.discount_type === 'flat' && coupon.discount_paise
              ? `₹${Math.round(coupon.discount_paise / 100).toLocaleString('en-IN')} off`
              : `${coupon.discount_percent}% off`;

          return (
            <div
              key={coupon.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '1rem' }}>
                    {coupon.code}
                  </span>
                  <span className="text-sm text-muted" style={{ marginLeft: 'var(--space-3)' }}>
                    {discLabel}
                  </span>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${coupon.is_active ? 'btn-success' : 'btn-secondary'}`}
                  onClick={() => toggleActive(coupon.id, coupon.is_active)}
                >
                  {coupon.is_active ? 'Active' : 'Off'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {coupon.min_cart_paise ? (
                  <span className="badge badge-confirmed">
                    MIN ₹{(coupon.min_cart_paise / 100).toLocaleString('en-IN')}
                  </span>
                ) : null}
                {coupon.stackable_with_promo && (
                  <span className="badge badge-confirmed">STACKABLE WITH AUTO OFFERS</span>
                )}
                {coupon.new_users_only && (
                  <span className="badge badge-confirmed">First-order only</span>
                )}
                {coupon.show_on_homepage && <span className="badge badge-paid">On homepage</span>}
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
            No manual coupons yet
          </p>
        )}
      </div>

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-coupon-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 12, 16, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            zIndex: 50,
          }}
          onClick={() => {
            if (!deletePending) setDeleting(null);
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 400, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-coupon-title" style={{ marginBottom: 'var(--space-2)' }}>
              Delete coupon {deleting.code}?
            </h2>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
              Any customer with this code saved will no longer be able to redeem it. Past orders
              that used it keep their recorded discount.
            </p>
            {deleteError && (
              <p className="text-sm" style={{ color: 'var(--error)', marginBottom: 'var(--space-3)' }}>
                {deleteError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: 'auto' }}
                disabled={deletePending}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${deletePending ? 'btn-loading' : ''}`}
                style={{ width: 'auto', background: 'var(--error)', color: '#FAF9F6' }}
                disabled={deletePending}
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
