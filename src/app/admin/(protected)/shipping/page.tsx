'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';

/* ─────────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────────── */
interface SettingsState {
  provider_enabled: boolean;
  provider_name: string;
  api_url: string;
  api_key_set: boolean;
  pickup_name: string;
  pickup_phone: string;
  pickup_address_line1: string;
  pickup_address_line2: string;
  pickup_city: string;
  pickup_state: string;
  pickup_pincode: string;
  free_shipping_threshold_paise: number;
  default_shipping_charge_paise: number;
  cod_enabled: boolean;
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
  // Advanced Cart Offers
  promo_reward_type: 'free_shipping' | 'threshold_percentage' | 'buy_x_get_specific_free' | 'buy_x_get_cheapest_free';
  reward_percentage: number;
  reward_product_id: string | null;
  buy_x_quantity: number;
  get_y_quantity: number;
}

type Tab = 'providers' | 'promotions' | 'cod' | 'diagnostics';

/* ─────────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────────── */
const EMPTY: SettingsState = {
  provider_enabled: false,
  provider_name: 'delhivery',
  api_url: '',
  api_key_set: false,
  pickup_name: '',
  pickup_phone: '',
  pickup_address_line1: '',
  pickup_address_line2: '',
  pickup_city: '',
  pickup_state: '',
  pickup_pincode: '',
  free_shipping_threshold_paise: 0,
  default_shipping_charge_paise: 0,
  cod_enabled: true,
  cod_fee_paise: 0,
  promo_banner_enabled: true,
  promo_goal_type: 'amount',
  promo_goal_threshold_paise: 99900,
  promo_goal_item_count: 2,
  promo_progress_template: 'Add {remaining} more to unlock FREE SHIPPING',
  promo_unlocked_text: 'You unlocked FREE Standard Shipping!',
  promo_nudge_enabled: true,
  promo_nudge_title: 'Pay with UPI & Save {cod_fee}',
  promo_nudge_badge: 'LOWEST PRICE',
  promo_nudge_text: 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
  promo_reward_type: 'free_shipping',
  reward_percentage: 10,
  reward_product_id: null,
  buy_x_quantity: 2,
  get_y_quantity: 1,
};

const PROVIDER_META: Record<string, { label: string; defaultUrl: string; description: string }> = {
  delhivery: {
    label: 'DELHIVERY',
    defaultUrl: 'https://track.delhivery.com',
    description: 'Surface network · 18,500+ pin codes',
  },
  shiprocket: {
    label: 'SHIPROCKET',
    defaultUrl: 'https://apiv2.shiprocket.in/v1/external',
    description: 'Multi-courier aggregator · JWT auth',
  },
};

/* ─────────────────────────────────────────────────────────────────────
   Utils
───────────────────────────────────────────────────────────────────── */
const paiseToRupees = (p: number) => (p === 0 ? '' : (p / 100).toString());
const rupeesToPaise = (r: string) => {
  const n = Number(r);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};
function pickupOneliner(s: SettingsState): string {
  const parts = [s.pickup_address_line1, s.pickup_city, s.pickup_state]
    .map((x) => (x ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : 'No pickup address';
}

/* ─────────────────────────────────────────────────────────────────────
   Primitive components
───────────────────────────────────────────────────────────────────── */
function Field({
  label, error, hint, children,
}: {
  label: string; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="input-group">
      <label className="input-label">
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.55 }}>{hint}</span>}
      </label>
      {children}
      {error && <span className="input-error-text">{error}</span>}
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 18px' }}>
      <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
    </div>
  );
}

function ToggleRow({
  title, subtitle, checked, onChange,
}: {
  title: string; subtitle: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
      <div>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
      </div>
      <label className="premium-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="premium-toggle-slider" />
      </label>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: active ? 'var(--success)' : 'var(--border-light)',
      boxShadow: active ? '0 0 0 3px rgba(76,175,80,0.15)' : 'none',
      transition: 'all 0.2s',
    }} />
  );
}

function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'active' | 'muted' | 'neutral' | 'error' }) {
  const styles: Record<string, React.CSSProperties> = {
    active: { background: 'rgba(76,175,80,0.12)', color: 'var(--success)', border: '1px solid rgba(76,175,80,0.25)' },
    error: { background: 'rgba(229,57,53,0.1)', color: 'var(--error)', border: '1px solid rgba(229,57,53,0.2)' },
    muted: { background: 'var(--bg-input)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' },
    neutral: { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' },
  };
  return (
    <span style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 3, ...styles[tone] }}>
      {label}
    </span>
  );
}

function CapPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 99,
      fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
      border: `1px solid ${active ? 'var(--border-light)' : 'var(--border-color)'}`,
      color: active ? 'var(--text-secondary)' : 'var(--text-muted)',
      opacity: active ? 1 : 0.4,
    }}>
      {label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Tab bar
───────────────────────────────────────────────────────────────────── */
const TABS: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'promotions', label: 'Rules & Offers' },
  { id: 'cod', label: 'COD' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: 32 }}>
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 20px', fontSize: '0.8125rem', fontWeight: isActive ? 700 : 500,
              letterSpacing: '0.04em', color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Provider card
───────────────────────────────────────────────────────────────────── */
interface TestResult {
  success: boolean;
  provider: string;
  checks: {
    auth: { ok: boolean; latency_ms: number; message?: string };
    api: { ok: boolean; message?: string };
    pickup: { ok: boolean; message?: string };
  };
  errors: string[];
  warnings: string[];
  timestamp: string;
}

function ProviderCard({
  providerKey, state, isExpanded, onExpand, onStateChange, errors, newApiKey, onApiKeyChange, onSave, saving,
}: {
  providerKey: string;
  state: SettingsState;
  isExpanded: boolean;
  onExpand: () => void;
  onStateChange: (patch: Partial<SettingsState>) => void;
  errors: Record<string, string>;
  newApiKey: string;
  onApiKeyChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const { showToast } = useToast();

  const meta = PROVIDER_META[providerKey] ?? PROVIDER_META.delhivery;
  const isActive = state.provider_name === providerKey && state.provider_enabled;
  const hasKey = state.api_key_set;
  const pickup = pickupOneliner(state);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/shipping/test', { method: 'POST' });
      const data = await res.json() as TestResult;
      setTestResult(data);

      if (data.success) {
        showToast(`${meta.label} connection verified`, 'success');
      } else {
        showToast(data.errors[0] || 'Connection test failed', 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      showToast(`Test failed: ${msg}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      border: `1px solid ${isActive ? 'var(--border-light)' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12,
      transition: 'border-color 0.2s',
    }}>
      {/* ── Collapsed header ── */}
      <button
        onClick={onExpand}
        style={{ width: '100%', background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-secondary)', border: 'none', padding: '18px 24px', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}
        aria-expanded={isExpanded}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <StatusDot active={isActive} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.1em', color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {meta.label}
              </span>
              {isActive && <Pill label="ACTIVE" tone="active" />}
              <Pill label={hasKey && state.provider_name === providerKey ? 'LIVE' : 'SANDBOX'} tone={hasKey && state.provider_name === providerKey ? 'active' : 'muted'} />
            </div>
            <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: hasKey && state.provider_name === providerKey ? 'var(--success)' : 'var(--text-muted)' }}>
                {hasKey && state.provider_name === providerKey ? 'Connected' : 'Not configured'}
              </span>
              {pickup !== 'No pickup address' && state.provider_name === providerKey && (
                <>
                  <span style={{ opacity: 0.35 }}>·</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickup}</span>
                </>
              )}
            </div>
          </div>

          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>▾</span>
        </div>
      </button>

      {/* ── Expanded body ── */}
      {isExpanded && (
        <>
          <div style={{ height: 1, background: 'var(--border-color)' }} />
          <div style={{ padding: '20px 24px 28px', background: 'var(--bg-secondary)' }}>

            {/* Operational status bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 22 }}>
              {[
                { label: 'API', value: hasKey && state.provider_name === providerKey ? 'Connected' : 'Not set', ok: hasKey && state.provider_name === providerKey },
                { label: 'Environment', value: hasKey && state.provider_name === providerKey ? 'Live' : 'Sandbox', ok: hasKey && state.provider_name === providerKey },
                { label: 'Webhooks', value: 'Pending setup', ok: false },
                { label: 'Last shipment', value: '—', ok: null },
              ].map((item) => (
                <div key={item.label} style={{ padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: item.ok === true ? 'var(--success)' : item.ok === false ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Provider activation */}
            <ToggleRow
              title="Provider active"
              subtitle={isActive ? 'Shipments routed through this courier' : 'Enable to route shipments through this courier'}
              checked={isActive}
              onChange={(v) => onStateChange({ provider_enabled: v, provider_name: v ? providerKey : state.provider_name })}
            />

            {/* Capabilities */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0' }}>
              <CapPill label="COD" active={state.cod_enabled} />
              <CapPill label="Prepaid" active />
              <CapPill label="Reverse" active={false} />
              <CapPill label="Insurance" active={false} />
            </div>

            {/* Credentials */}
            <SectionRule label="Credentials" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="API URL" error={errors.api_url}>
                <input
                  className={`input-field${errors.api_url ? ' input-error' : ''}`}
                  placeholder={meta.defaultUrl}
                  value={state.api_url}
                  onChange={(e) => onStateChange({ api_url: e.target.value })}
                />
              </Field>
              <Field label="API Key" error={errors.api_key} hint={hasKey ? '(leave blank to keep existing)' : undefined}>
                <div style={{ position: 'relative' }}>
                  <input
                    className={`input-field${errors.api_key ? ' input-error' : ''}`}
                    type="password"
                    placeholder={hasKey ? '••••••••' : 'Enter API key'}
                    value={newApiKey}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                    autoComplete="new-password"
                    style={{ paddingRight: hasKey ? 70 : undefined }}
                  />
                  {hasKey && (
                    <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--success)', pointerEvents: 'none' }}>
                      SET ✓
                    </span>
                  )}
                </div>
              </Field>
            </div>

            {/* Pickup address */}
            <SectionRule label="Pickup Address" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="input-row">
                <Field label="Contact name" error={errors.pickup_name}>
                  <input className={`input-field${errors.pickup_name ? ' input-error' : ''}`} placeholder="Warehouse manager" value={state.pickup_name} onChange={(e) => onStateChange({ pickup_name: e.target.value })} />
                </Field>
                <Field label="Phone" error={errors.pickup_phone}>
                  <input className={`input-field${errors.pickup_phone ? ' input-error' : ''}`} placeholder="10-digit mobile" value={state.pickup_phone} onChange={(e) => onStateChange({ pickup_phone: e.target.value })} />
                </Field>
              </div>
              <Field label="Address line 1" error={errors.pickup_address_line1}>
                <input className={`input-field${errors.pickup_address_line1 ? ' input-error' : ''}`} placeholder="Street, building, unit" value={state.pickup_address_line1} onChange={(e) => onStateChange({ pickup_address_line1: e.target.value })} />
              </Field>
              <Field label="Address line 2">
                <input className="input-field" placeholder="Landmark, area (optional)" value={state.pickup_address_line2} onChange={(e) => onStateChange({ pickup_address_line2: e.target.value })} />
              </Field>
              <div className="input-row">
                <Field label="City" error={errors.pickup_city}>
                  <input className={`input-field${errors.pickup_city ? ' input-error' : ''}`} value={state.pickup_city} onChange={(e) => onStateChange({ pickup_city: e.target.value })} />
                </Field>
                <Field label="State" error={errors.pickup_state}>
                  <input className={`input-field${errors.pickup_state ? ' input-error' : ''}`} value={state.pickup_state} onChange={(e) => onStateChange({ pickup_state: e.target.value })} />
                </Field>
              </div>
              <Field label="Pincode" error={errors.pickup_pincode}>
                <input className={`input-field${errors.pickup_pincode ? ' input-error' : ''}`} placeholder="6-digit pincode" value={state.pickup_pincode} onChange={(e) => onStateChange({ pickup_pincode: e.target.value })} />
              </Field>
            </div>

            {/* Actions */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className={`btn btn-primary btn-sm${saving ? ' btn-loading' : ''}`} onClick={onSave} disabled={saving} style={{ width: 'auto', minWidth: 130 }}>
                SAVE PROVIDER
              </button>
              <button
                className={`btn btn-secondary btn-sm${testing ? ' btn-loading' : ''}`}
                style={{ width: 'auto' }}
                onClick={handleTestConnection}
                disabled={testing || saving}
              >
                {testing ? 'TESTING…' : 'TEST CONNECTION'}
              </button>
            </div>

            {/* Test Results Panel */}
            {testResult && (
              <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-input)', borderRadius: 8, border: `1px solid ${testResult.success ? 'rgba(76,175,80,0.3)' : 'rgba(229,57,53,0.3)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <StatusDot active={testResult.success} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: testResult.success ? 'var(--success)' : 'var(--error)' }}>
                    {testResult.success ? 'CONNECTION VERIFIED' : 'CONNECTION FAILED'}
                  </span>
                  <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {new Date(testResult.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {/* Check results */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'Authentication', check: testResult.checks.auth },
                    { label: 'API Endpoint', check: testResult.checks.api },
                    { label: 'Pickup Location', check: testResult.checks.pickup },
                  ].map(({ label, check }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {'latency_ms' in check && typeof check.latency_ms === 'number' && check.latency_ms > 0 && (
                          <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {check.latency_ms}ms
                          </span>
                        )}
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: check.ok ? 'var(--success)' : 'var(--error)' }}>
                          {check.ok ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Errors */}
                {testResult.errors.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {testResult.errors.map((err, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--error)', padding: '6px 0', borderBottom: i < testResult.errors.length - 1 ? '1px solid var(--border-color)' : undefined }}>
                        • {err}
                      </div>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {testResult.warnings.length > 0 && (
                  <div>
                    {testResult.warnings.map((warn, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--warning, #f0ad4e)', padding: '6px 0', borderBottom: i < testResult.warnings.length - 1 ? '1px solid var(--border-color)' : undefined }}>
                        ⚠ {warn}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Tab content components
───────────────────────────────────────────────────────────────────── */
function ProvidersTab({
  state, onStateChange, errors, newApiKey, onApiKeyChange, onSave, saving,
}: {
  state: SettingsState;
  onStateChange: (patch: Partial<SettingsState>) => void;
  errors: Record<string, string>;
  newApiKey: string;
  onApiKeyChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          One courier active at a time. Expand a provider to configure credentials and pickup address.
        </p>
      </div>
      {Object.keys(PROVIDER_META).map((key) => (
        <ProviderCard
          key={key}
          providerKey={key}
          state={state}
          isExpanded={expanded === key}
          onExpand={() => setExpanded(expanded === key ? null : key)}
          onStateChange={onStateChange}
          errors={errors}
          newApiKey={newApiKey}
          onApiKeyChange={onApiKeyChange}
          onSave={onSave}
          saving={saving}
        />
      ))}
    </div>
  );
}

function RulesAndOffersTab({
  state,
  onStateChange,
  freeThresholdRs,
  setFreeThresholdRs,
  shippingChargeRs,
  setShippingChargeRs,
  promoThresholdRs,
  setPromoThresholdRs,
  codFeeRs,
  storeProducts = [],
  errors,
  onSave,
  saving,
}: {
  state: SettingsState;
  onStateChange: (patch: Partial<SettingsState>) => void;
  freeThresholdRs: string;
  setFreeThresholdRs: (v: string) => void;
  shippingChargeRs: string;
  setShippingChargeRs: (v: string) => void;
  promoThresholdRs: string;
  setPromoThresholdRs: (v: string) => void;
  codFeeRs: string;
  storeProducts?: Array<{ id: string; name: string; price_paise: number }>;
  errors: Record<string, string>;
  onSave: () => void;
  saving: boolean;
}) {
  const threshold = rupeesToPaise(freeThresholdRs) / 100;
  const charge = rupeesToPaise(shippingChargeRs) / 100;
  const currentCodFeeText = codFeeRs && Number(codFeeRs) > 0 ? `₹${codFeeRs}` : '₹50';
  const effectivePromoGoalRs = promoThresholdRs || freeThresholdRs || '999';
  const previewRemaining = state.promo_goal_type === 'item_count' ? '1 item' : '₹349';

  // Dynamic preview banner based on selected promotion reward type
  const selectedGiftProduct = storeProducts.find((p) => p.id === state.reward_product_id);
  const giftLabel = selectedGiftProduct?.name || 'FREE Gift';

  const REWARD_DEFAULTS: Record<
    SettingsState['promo_reward_type'],
    { progress: string; unlocked: string }
  > = {
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
  };

  const selectRewardType = (nextType: SettingsState['promo_reward_type']) => {
    const knownProgress = new Set(Object.values(REWARD_DEFAULTS).map((d) => d.progress));
    const knownUnlocked = new Set(Object.values(REWARD_DEFAULTS).map((d) => d.unlocked));
    const curProgress = (state.promo_progress_template || '').trim();
    const curUnlocked = (state.promo_unlocked_text || '').trim();

    const patch: Partial<SettingsState> = { promo_reward_type: nextType };
    if (!curProgress || knownProgress.has(curProgress)) {
      patch.promo_progress_template = REWARD_DEFAULTS[nextType].progress;
    }
    if (!curUnlocked || knownUnlocked.has(curUnlocked)) {
      patch.promo_unlocked_text = REWARD_DEFAULTS[nextType].unlocked;
    }
    onStateChange(patch);
  };

  let previewBannerIcon = '🚚';
  if (state.promo_reward_type === 'threshold_percentage') previewBannerIcon = '🏷️';
  else if (state.promo_reward_type === 'buy_x_get_cheapest_free') previewBannerIcon = '⚡';
  else if (state.promo_reward_type === 'buy_x_get_specific_free') previewBannerIcon = '🎁';

  const activeFallback = REWARD_DEFAULTS[state.promo_reward_type || 'free_shipping']?.progress || REWARD_DEFAULTS.free_shipping.progress;
  const rawPreviewTpl = (state.promo_progress_template || '').trim();
  const effectivePreviewTpl =
    !rawPreviewTpl || (state.promo_reward_type !== 'free_shipping' && rawPreviewTpl === REWARD_DEFAULTS.free_shipping.progress)
      ? activeFallback
      : rawPreviewTpl;

  const previewProgressText = effectivePreviewTpl
    .replace(/\{remaining\}/g, previewRemaining)
    .replace(/\{remaining_items\}/g, '1 item')
    .replace(/\{item_count\}/g, String(state.promo_goal_item_count || 2))
    .replace(/\{threshold\}/g, `₹${effectivePromoGoalRs}`)
    .replace(/\{reward_percentage\}/g, `${state.reward_percentage || 10}%`)
    .replace(/\{reward_product\}/g, giftLabel)
    .replace(/\{buy_x\}/g, String(state.buy_x_quantity || 2))
    .replace(/\{get_y\}/g, String(state.get_y_quantity || 1));

  const previewNudgeTitle = (state.promo_nudge_title || 'Pay with UPI & Save {cod_fee}')
    .replace(/\{cod_fee\}/g, currentCodFeeText);

  const previewNudgeText = (state.promo_nudge_text || 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.')
    .replace(/\{cod_fee\}/g, currentCodFeeText);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Unified shipping rules, free shipping thresholds, slide-out drawer promos, automated reward promotions (BOGO, % discounts, gift items), and prepaid conversion nudges.
        </p>
      </div>

      {/* ── Section 1: Global Shipping Policy & Thresholds ── */}
      <SectionRule label="Global Shipping Policy" />

      {/* Quick Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ padding: '16px 18px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            Free Shipping Threshold
          </div>
          <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {threshold > 0 ? `₹${threshold}` : 'Disabled'}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 3 }}>
            {threshold > 0 ? `Orders ≥ ₹${threshold} ship free` : 'All orders charged standard fee'}
          </div>
        </div>
        <div style={{ padding: '16px 18px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            Default Shipping Fee
          </div>
          <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {charge > 0 ? `₹${charge}` : '₹0 (Free)'}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 3 }}>
            Applied when subtotal &lt; threshold
          </div>
        </div>
      </div>

      {/* Form Fields: Global Threshold & Default Charge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
        <Field label="Free Shipping Threshold (₹)" hint="0 = disabled; orders above this get free shipping" error={errors.free_shipping_threshold_paise}>
          <input
            className={`input-field${errors.free_shipping_threshold_paise ? ' input-error' : ''}`}
            type="number"
            min={0}
            step={1}
            placeholder="999"
            value={freeThresholdRs}
            onChange={(e) => {
              const val = e.target.value;
              setFreeThresholdRs(val);
              if (state.promo_goal_type === 'amount' && (!promoThresholdRs || promoThresholdRs === freeThresholdRs)) {
                setPromoThresholdRs(val);
              }
            }}
          />
        </Field>
        <Field label="Default Shipping Charge (₹)" hint="Standard delivery charge when subtotal is below threshold" error={errors.default_shipping_charge_paise}>
          <input
            className={`input-field${errors.default_shipping_charge_paise ? ' input-error' : ''}`}
            type="number"
            min={0}
            step={1}
            placeholder="99"
            value={shippingChargeRs}
            onChange={(e) => setShippingChargeRs(e.target.value)}
          />
        </Field>
      </div>

      {/* ── Live Preview Card ── */}
      <SectionRule label="Live Drawer Preview" />
      <div style={{
        padding: '18px 20px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        marginBottom: 28,
      }}>
        <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
          Live Cart Drawer Preview
        </div>

        {/* Promo Bar Preview */}
        {state.promo_banner_enabled ? (
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              <span>{previewBannerIcon}</span>
              <span>{previewProgressText}</span>
            </div>
            <div style={{ height: 6, width: '100%', background: 'var(--border-color)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: '65%', height: '100%', background: 'var(--brand-primary, #0052FF)', borderRadius: 99 }} />
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 14, border: '1px dashed var(--border-color)' }}>
            Promotional progress bar is currently hidden.
          </div>
        )}

        {/* Nudge Card Preview */}
        {state.promo_nudge_enabled ? (
          <div style={{
            background: 'rgba(255, 179, 0, 0.08)',
            border: '1px solid rgba(255, 179, 0, 0.25)',
            borderRadius: 8,
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                <span>⚡</span>
                <span>{previewNudgeTitle}</span>
              </div>
              {state.promo_nudge_badge && (
                <span style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 6px', background: 'rgba(255, 179, 0, 0.2)', color: 'var(--text-primary)', borderRadius: 4 }}>
                  {state.promo_nudge_badge}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              {previewNudgeText}
            </p>
          </div>
        ) : (
          <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.6875rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)' }}>
            Prepaid conversion nudge card is currently hidden.
          </div>
        )}
      </div>

      {/* ── Section 2: Progress Goal & Automated Rewards Engine ── */}
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
          {/* Promotion / Reward Type 4-Way Selector */}
          <div className="input-group">
            <label className="input-label">Reward / Goal Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              <button
                type="button"
                onClick={() => selectRewardType('free_shipping')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${state.promo_reward_type === 'free_shipping' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                  background: state.promo_reward_type === 'free_shipping' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>🚚 Free Shipping Unlock</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>Unlock ₹0 shipping on minimum order value or item count</div>
              </button>

              <button
                type="button"
                onClick={() => selectRewardType('threshold_percentage')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${state.promo_reward_type === 'threshold_percentage' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                  background: state.promo_reward_type === 'threshold_percentage' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>🏷️ % Off on Threshold</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>Spend ₹X, automatically get Y% off the entire cart</div>
              </button>

              <button
                type="button"
                onClick={() => selectRewardType('buy_x_get_cheapest_free')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${state.promo_reward_type === 'buy_x_get_cheapest_free' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                  background: state.promo_reward_type === 'buy_x_get_cheapest_free' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>⚡ Buy X Get Lowest Free (BOGO)</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>Buy X items, get the lowest-priced item(s) free</div>
              </button>

              <button
                type="button"
                onClick={() => selectRewardType('buy_x_get_specific_free')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${state.promo_reward_type === 'buy_x_get_specific_free' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                  background: state.promo_reward_type === 'buy_x_get_specific_free' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>🎁 Buy X Get Free Specific Gift</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>Buy X items, receive a designated catalog item free</div>
              </button>
            </div>
          </div>

          {/* Conditional Controls based on promo_reward_type */}
          {state.promo_reward_type === 'free_shipping' && (
            <>
              <div className="input-group">
                <label className="input-label">Goal Target Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onStateChange({ promo_goal_type: 'amount' });
                      if (!promoThresholdRs) setPromoThresholdRs(freeThresholdRs);
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${state.promo_goal_type === 'amount' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                      background: state.promo_goal_type === 'amount' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Order Value (₹)</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>e.g. Free shipping over ₹999</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStateChange({ promo_goal_type: 'item_count' })}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${state.promo_goal_type === 'item_count' ? 'var(--brand-primary, #0052FF)' : 'var(--border-color)'}`,
                      background: state.promo_goal_type === 'item_count' ? 'rgba(0, 82, 255, 0.08)' : 'var(--bg-input)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Bundle Count (Items)</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>e.g. Add 2 tees for free delivery</div>
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
                    onChange={(e) => onStateChange({ promo_goal_item_count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
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
                  onChange={(e) => onStateChange({ reward_percentage: Math.min(90, Math.max(1, parseInt(e.target.value, 10) || 0)) })}
                />
              </Field>
            </div>
          )}

          {state.promo_reward_type === 'buy_x_get_cheapest_free' && (
            <div className="input-row">
              <Field label="Buy X Paid Items" hint={`e.g. 2 for Buy 2 Get ${state.get_y_quantity || 1} Free (Cart total needed: ${(state.buy_x_quantity || 2) + (state.get_y_quantity || 1)})`}>
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  placeholder="2"
                  value={state.buy_x_quantity || 2}
                  onChange={(e) => onStateChange({ buy_x_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
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
                  onChange={(e) => onStateChange({ get_y_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
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
                  onChange={(e) => onStateChange({ buy_x_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
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

          {/* Progress Template */}
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

          {/* Unlocked Message */}
          <Field label="Unlocked Congratulations Message" hint="Rendered when goal is reached">
            <input
              className="input-field"
              type="text"
              placeholder="Congratulations! Your reward has been unlocked!"
              value={state.promo_unlocked_text}
              onChange={(e) => onStateChange({ promo_unlocked_text: e.target.value })}
            />
          </Field>
        </div>
      )}

      {/* ── Section 3: Prepaid Conversion Nudge ── */}
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
          className={`btn btn-primary btn-sm${saving ? ' btn-loading' : ''}`}
          onClick={onSave}
          disabled={saving}
          style={{ width: 'auto', minWidth: 160 }}
        >
          SAVE RULES & OFFERS
        </button>
      </div>
    </div>
  );
}

function CodTab({
  state, onStateChange, codFeeRs, setCodFeeRs, errors, onSave, saving,
}: {
  state: SettingsState;
  onStateChange: (patch: Partial<SettingsState>) => void;
  codFeeRs: string; setCodFeeRs: (v: string) => void;
  errors: Record<string, string>; onSave: () => void; saving: boolean;
}) {
  const fee = rupeesToPaise(codFeeRs) / 100;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Cash on Delivery policy. These controls apply globally to all orders and are provider-independent.
        </p>
      </div>

      {/* Status preview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: '16px 18px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: `1px solid ${state.cod_enabled ? 'rgba(76,175,80,0.3)' : 'var(--border-color)'}` }}>
          <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Status</div>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: state.cod_enabled ? 'var(--success)' : 'var(--text-muted)' }}>
            {state.cod_enabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>
        <div style={{ padding: '16px 18px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>COD fee</div>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {state.cod_enabled ? (fee > 0 ? `₹${fee}` : 'Free') : '—'}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ToggleRow
          title="Cash on Delivery"
          subtitle={state.cod_enabled ? 'Customers can pay on delivery' : 'COD disabled — prepaid only'}
          checked={state.cod_enabled}
          onChange={(v) => onStateChange({ cod_enabled: v })}
        />
      </div>

      {state.cod_enabled && (
        <Field label="COD fee per order (₹)" hint="0 = no fee" error={errors.cod_fee_paise}>
          <input
            className={`input-field${errors.cod_fee_paise ? ' input-error' : ''}`}
            type="number" min={0} step={1} placeholder="0"
            value={codFeeRs} onChange={(e) => setCodFeeRs(e.target.value)}
          />
        </Field>
      )}

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
        <button className={`btn btn-primary btn-sm${saving ? ' btn-loading' : ''}`} onClick={onSave} disabled={saving} style={{ width: 'auto', minWidth: 130 }}>
          SAVE COD POLICY
        </button>
      </div>
    </div>
  );
}

interface DiagnosticsData {
  timestamp: string;
  provider: {
    name: string | null;
    is_active: boolean;
    auth_configured: boolean;
    pickup_configured: boolean;
  } | null;
  webhooks: {
    last_24h: { received: number; processed: number; failed: number; duplicate: number };
    last_received_at: string | null;
    last_failed_at: string | null;
  };
  shipments: {
    total: number;
    pending: number;
    in_transit: number;
    delivered: number;
    failed: number;
    stuck_over_48h: number;
    without_tracking: number;
    last_created_at: string | null;
    last_failed_at: string | null;
    success_rate_7d: number;
  };
  database: {
    orphaned_shipments: number;
    shipments_without_history: number;
    duplicate_webhook_attempts: number;
    invalid_state_transitions_24h: number;
  };
  events: Array<{
    id: string;
    type: string;
    message: string;
    severity: string;
    created_at: string;
  }>;
}

function DiagnosticsTab() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const fetchDiagnostics = async () => {
    try {
      const res = await fetch('/api/admin/shipping/diagnostics');
      if (res.ok) {
        const diagnostics = await res.json() as DiagnosticsData;
        setData(diagnostics);
      } else {
        showToast('Failed to load diagnostics', 'error');
      }
    } catch (err) {
      showToast('Network error loading diagnostics', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchDiagnostics, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDiagnostics();
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 16px' }} />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading operational metrics…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--error)' }}>Failed to load diagnostics</p>
        <button className="btn btn-secondary btn-sm" onClick={handleRefresh} style={{ marginTop: 16 }}>
          RETRY
        </button>
      </div>
    );
  }

  const providerHealth = data.provider?.is_active && data.provider?.auth_configured;
  const webhookHealth = data.webhooks.last_24h.failed === 0;
  const shipmentHealth = data.shipments.failed === 0 && data.shipments.stuck_over_48h === 0;
  const dbHealth = data.database.orphaned_shipments === 0 && data.database.shipments_without_history === 0;

  return (
    <div>
      {/* Header with refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6, maxWidth: '70%' }}>
          Live operational metrics. Auto-refreshes every 30 seconds.
        </p>
        <button
          className={`btn btn-secondary btn-sm${refreshing ? ' btn-loading' : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ width: 'auto' }}
        >
          {refreshing ? 'REFRESHING…' : 'REFRESH'}
        </button>
      </div>

      {/* Health Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
        <HealthCard
          title="Provider"
          status={providerHealth ? 'healthy' : data.provider?.is_active ? 'warning' : 'critical'}
          value={data.provider?.name?.toUpperCase() ?? 'NONE'}
          subtitle={data.provider?.auth_configured ? 'Authenticated' : 'Not configured'}
        />
        <HealthCard
          title="Webhooks (24h)"
          status={webhookHealth ? 'healthy' : 'warning'}
          value={`${data.webhooks.last_24h.received}`}
          subtitle={`${data.webhooks.last_24h.failed} failed`}
        />
        <HealthCard
          title="Shipments"
          status={shipmentHealth ? 'healthy' : 'warning'}
          value={`${data.shipments.pending}`}
          subtitle={`${data.shipments.stuck_over_48h} stuck >48h`}
        />
        <HealthCard
          title="Success Rate"
          status={data.shipments.success_rate_7d >= 95 ? 'healthy' : data.shipments.success_rate_7d >= 80 ? 'warning' : 'critical'}
          value={`${data.shipments.success_rate_7d}%`}
          subtitle="7 day delivery rate"
        />
      </div>

      {/* Provider Section */}
      <SectionRule label="Provider Health" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        <MetricRow label="Active provider" value={data.provider?.name ?? 'None'} status={data.provider?.is_active ? 'ok' : 'neutral'} />
        <MetricRow label="Authentication" value={data.provider?.auth_configured ? 'Configured' : 'Not set'} status={data.provider?.auth_configured ? 'ok' : 'error'} />
        <MetricRow label="Pickup location" value={data.provider?.pickup_configured ? 'Configured' : 'Incomplete'} status={data.provider?.pickup_configured ? 'ok' : 'warning'} />
        <MetricRow label="API endpoint" value={data.provider?.name === 'delhivery' ? 'Delhivery One' : data.provider?.name === 'shiprocket' ? 'Shiprocket v2' : '—'} status="neutral" />
      </div>

      {/* Webhook Section */}
      <SectionRule label="Webhook Health (24h)" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        <MetricRow label="Received" value={data.webhooks.last_24h.received.toString()} status="neutral" />
        <MetricRow label="Processed" value={data.webhooks.last_24h.processed.toString()} status={data.webhooks.last_24h.processed > 0 ? 'ok' : 'neutral'} />
        <MetricRow label="Failed" value={data.webhooks.last_24h.failed.toString()} status={data.webhooks.last_24h.failed === 0 ? 'ok' : 'error'} />
        <MetricRow label="Duplicates" value={data.webhooks.last_24h.duplicate.toString()} status={data.webhooks.last_24h.duplicate === 0 ? 'ok' : 'warning'} />
        {data.webhooks.last_received_at && (
          <MetricRow label="Last received" value={new Date(data.webhooks.last_received_at).toLocaleTimeString()} status="neutral" />
        )}
      </div>

      {/* Shipment Pipeline */}
      <SectionRule label="Shipment Pipeline" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatPill label="Total" value={data.shipments.total} />
        <StatPill label="Pending" value={data.shipments.pending} color={data.shipments.pending > 10 ? 'warning' : 'neutral'} />
        <StatPill label="In Transit" value={data.shipments.in_transit} />
        <StatPill label="Delivered" value={data.shipments.delivered} color="success" />
        <StatPill label="Failed" value={data.shipments.failed} color={data.shipments.failed > 0 ? 'error' : 'neutral'} />
      </div>
      {data.shipments.without_tracking > 0 && (
        <div style={{ padding: 10, background: 'rgba(229,57,53,0.1)', borderRadius: 6, marginBottom: 16 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--error)' }}>
            ⚠ {data.shipments.without_tracking} shipments missing tracking IDs
          </span>
        </div>
      )}
      {data.shipments.stuck_over_48h > 0 && (
        <div style={{ padding: 10, background: 'rgba(240,173,78,0.1)', borderRadius: 6, marginBottom: 24 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--warning, #f0ad4e)' }}>
            ⚠ {data.shipments.stuck_over_48h} shipments stuck pending over 48h
          </span>
        </div>
      )}

      {/* Database Health */}
      <SectionRule label="Database Integrity" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        <MetricRow
          label="Orphaned shipments"
          value={data.database.orphaned_shipments.toString()}
          status={data.database.orphaned_shipments === 0 ? 'ok' : 'error'}
        />
        <MetricRow
          label="Missing history"
          value={data.database.shipments_without_history.toString()}
          status={data.database.shipments_without_history === 0 ? 'ok' : 'warning'}
        />
        <MetricRow
          label="Invalid state transitions (24h)"
          value={data.database.invalid_state_transitions_24h.toString()}
          status={data.database.invalid_state_transitions_24h === 0 ? 'ok' : 'warning'}
        />
      </div>

      {/* Live Events */}
      <SectionRule label="Live Event Stream" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }}>
        {data.events.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
            No recent events
          </p>
        ) : (
          data.events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))
        )}
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)', fontSize: '0.625rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        Updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

function HealthCard({ title, status, value, subtitle }: {
  title: string;
  status: 'healthy' | 'warning' | 'critical' | 'neutral';
  value: string;
  subtitle: string;
}) {
  const colors = {
    healthy: { border: 'rgba(76,175,80,0.3)', bg: 'rgba(76,175,80,0.08)', text: 'var(--success)' },
    warning: { border: 'rgba(240,173,78,0.3)', bg: 'rgba(240,173,78,0.08)', text: 'var(--warning, #f0ad4e)' },
    critical: { border: 'rgba(229,57,53,0.3)', bg: 'rgba(229,57,53,0.08)', text: 'var(--error)' },
    neutral: { border: 'var(--border-color)', bg: 'var(--bg-input)', text: 'var(--text-muted)' },
  };
  const c = colors[status];

  return (
    <div style={{ padding: 14, background: c.bg, borderRadius: 8, border: `1px solid ${c.border}` }}>
      <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: c.text, marginBottom: 3 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
        {subtitle}
      </div>
    </div>
  );
}

function MetricRow({ label, value, status }: { label: string; value: string; status: 'ok' | 'error' | 'warning' | 'neutral' }) {
  const colors = {
    ok: 'var(--success)',
    error: 'var(--error)',
    warning: 'var(--warning, #f0ad4e)',
    neutral: 'var(--text-muted)',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 6 }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: colors[status] }}>{value}</span>
    </div>
  );
}

function StatPill({ label, value, color = 'neutral' }: { label: string; value: number; color?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const colors = {
    neutral: { bg: 'var(--bg-input)', text: 'var(--text-primary)' },
    success: { bg: 'rgba(76,175,80,0.12)', text: 'var(--success)' },
    warning: { bg: 'rgba(240,173,78,0.12)', text: 'var(--warning, #f0ad4e)' },
    error: { bg: 'rgba(229,57,53,0.12)', text: 'var(--error)' },
  };
  const c = colors[color];

  return (
    <div style={{ padding: '12px 16px', background: c.bg, borderRadius: 6, textAlign: 'center' }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: c.text }}>{value}</div>
      <div style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: DiagnosticsData['events'][0] }) {
  const colors: Record<string, string> = {
    error: 'var(--error)',
    warning: 'var(--warning, #f0ad4e)',
    info: 'var(--text-muted)',
    success: 'var(--success)',
  };

  const icon = event.severity === 'error' ? '✕' : event.severity === 'warning' ? '⚠' : '•';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 6, borderLeft: `2px solid ${colors[event.severity] || colors.info}` }}>
      <span style={{ fontSize: '0.75rem', color: colors[event.severity] || colors.info, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 2 }}>
          {event.type}
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.message}
        </div>
      </div>
      <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {new Date(event.created_at).toLocaleTimeString()}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────────────── */
export default function AdminShipping() {
  const [state, setState] = useState<SettingsState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('providers');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [freeThresholdRs, setFreeThresholdRs] = useState('');
  const [shippingChargeRs, setShippingChargeRs] = useState('');
  const [codFeeRs, setCodFeeRs] = useState('');
  const [promoThresholdRs, setPromoThresholdRs] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [storeProducts, setStoreProducts] = useState<Array<{ id: string; name: string; price_paise: number }>>([]);

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.products)) {
          setStoreProducts(d.products.map((p: { id: string; name: string; price_paise: number }) => ({
            id: p.id,
            name: p.name,
            price_paise: p.price_paise,
          })));
        }
      })
      .catch(() => {});
  }, []);

  const { toast, showToast } = useToast();

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/shipping?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) { showToast('Failed to load shipping settings', 'error'); return; }
      const raw = data.settings || {};
      const rewardType: SettingsState['promo_reward_type'] = raw.promo_reward_type ?? EMPTY.promo_reward_type;
      const rewardDefaults: Record<SettingsState['promo_reward_type'], { progress: string; unlocked: string }> = {
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
      };
      const s: SettingsState = {
        ...EMPTY,
        ...raw,
        provider_name: raw.provider_name ?? EMPTY.provider_name,
        api_url: raw.api_url ?? '',
        pickup_name: raw.pickup_name ?? '',
        pickup_phone: raw.pickup_phone ?? '',
        pickup_address_line1: raw.pickup_address_line1 ?? '',
        pickup_address_line2: raw.pickup_address_line2 ?? '',
        pickup_city: raw.pickup_city ?? '',
        pickup_state: raw.pickup_state ?? '',
        pickup_pincode: raw.pickup_pincode ?? '',
        promo_banner_enabled: raw.promo_banner_enabled ?? EMPTY.promo_banner_enabled,
        promo_goal_type: raw.promo_goal_type ?? EMPTY.promo_goal_type,
        promo_goal_threshold_paise: raw.promo_goal_threshold_paise ?? EMPTY.promo_goal_threshold_paise,
        promo_goal_item_count: raw.promo_goal_item_count ?? EMPTY.promo_goal_item_count,
        promo_progress_template: raw.promo_progress_template || rewardDefaults[rewardType]?.progress || EMPTY.promo_progress_template,
        promo_unlocked_text: raw.promo_unlocked_text || rewardDefaults[rewardType]?.unlocked || EMPTY.promo_unlocked_text,
        promo_nudge_enabled: raw.promo_nudge_enabled ?? EMPTY.promo_nudge_enabled,
        promo_nudge_title: raw.promo_nudge_title ?? EMPTY.promo_nudge_title,
        promo_nudge_badge: raw.promo_nudge_badge ?? EMPTY.promo_nudge_badge,
        promo_nudge_text: raw.promo_nudge_text ?? EMPTY.promo_nudge_text,
        promo_reward_type: rewardType,
        reward_percentage: Number(raw.reward_percentage) || EMPTY.reward_percentage,
        reward_product_id: raw.reward_product_id ?? EMPTY.reward_product_id,
        buy_x_quantity: Number(raw.buy_x_quantity) || EMPTY.buy_x_quantity,
        get_y_quantity: Number(raw.get_y_quantity) || EMPTY.get_y_quantity,
      };
      setState(s);
      setFreeThresholdRs(paiseToRupees(s.free_shipping_threshold_paise));
      setShippingChargeRs(paiseToRupees(s.default_shipping_charge_paise));
      setCodFeeRs(paiseToRupees(s.cod_fee_paise));
      setPromoThresholdRs(paiseToRupees(s.promo_goal_threshold_paise));
    } catch {
      showToast('Failed to load shipping settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (state.provider_enabled) {
      if (!state.api_url.trim()) e.api_url = 'API URL is required';
      if (!state.api_key_set && !newApiKey.trim()) e.api_key = 'API key is required';
      if (!state.pickup_name.trim()) e.pickup_name = 'Contact name is required';
      if (!state.pickup_address_line1.trim()) e.pickup_address_line1 = 'Address is required';
      if (!state.pickup_city.trim()) e.pickup_city = 'City is required';
      if (!state.pickup_state.trim()) e.pickup_state = 'State is required';
      if (!/^\d{6}$/.test(state.pickup_pincode)) e.pickup_pincode = 'Enter a valid 6-digit pincode';
      if (state.pickup_phone && !/^[6-9]\d{9}$/.test(state.pickup_phone)) e.pickup_phone = 'Enter a valid 10-digit phone';
    }
    if (Number(freeThresholdRs) < 0) e.free_shipping_threshold_paise = 'Cannot be negative';
    if (Number(shippingChargeRs) < 0) e.default_shipping_charge_paise = 'Cannot be negative';
    if (state.cod_enabled && Number(codFeeRs) < 0) e.cod_fee_paise = 'Cannot be negative';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      provider_enabled: state.provider_enabled,
      provider_name: state.provider_name || 'delhivery',
      api_url: state.api_url,
      pickup_name: state.pickup_name,
      pickup_phone: state.pickup_phone,
      pickup_address_line1: state.pickup_address_line1,
      pickup_address_line2: state.pickup_address_line2,
      pickup_city: state.pickup_city,
      pickup_state: state.pickup_state,
      pickup_pincode: state.pickup_pincode,
      free_shipping_threshold_paise: rupeesToPaise(freeThresholdRs),
      default_shipping_charge_paise: rupeesToPaise(shippingChargeRs),
      cod_enabled: state.cod_enabled,
      cod_fee_paise: rupeesToPaise(codFeeRs),
      promo_banner_enabled: state.promo_banner_enabled,
      promo_goal_type: state.promo_goal_type,
      promo_goal_threshold_paise: rupeesToPaise(promoThresholdRs || freeThresholdRs),
      promo_goal_item_count: Number(state.promo_goal_item_count) || 2,
      promo_progress_template: state.promo_progress_template,
      promo_unlocked_text: state.promo_unlocked_text,
      promo_nudge_enabled: state.promo_nudge_enabled,
      promo_nudge_title: state.promo_nudge_title,
      promo_nudge_badge: state.promo_nudge_badge,
      promo_nudge_text: state.promo_nudge_text,
      promo_reward_type: state.promo_reward_type || 'free_shipping',
      reward_percentage: Number(state.reward_percentage) || 0,
      reward_product_id: state.reward_product_id ?? null,
      buy_x_quantity: Number(state.buy_x_quantity) || 2,
      get_y_quantity: Number(state.get_y_quantity) || 1,
    };
    if (newApiKey.trim().length > 0) payload.api_key = newApiKey.trim();
    try {
      const res = await fetch('/api/admin/shipping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.error || 'Failed to save', 'error'); return; }
      showToast('Settings saved', 'success');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('kickoffpro:shipping-settings-updated'));
        try {
          localStorage.setItem('kickoffpro:settings_version', String(Date.now()));
        } catch {
          // ignore storage errors in private browsing
        }
      }
      if (newApiKey.trim().length > 0) {
        setNewApiKey('');
        setState((s) => ({ ...s, api_key_set: true }));
      }
      await fetchSettings();
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
        LOADING
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
          KickoffPro · Shipping Console
        </p>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.01em', color: 'var(--text-primary)', margin: 0 }}>
          Shipping
        </h1>
      </div>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab content — constrained to 600px for form readability on desktop */}
      <div style={{ maxWidth: 620 }}>
        {activeTab === 'providers' && (
          <ProvidersTab
            state={state}
            onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            errors={errors}
            newApiKey={newApiKey}
            onApiKeyChange={setNewApiKey}
            onSave={handleSave}
            saving={saving}
          />
        )}
        {activeTab === 'promotions' && (
          <RulesAndOffersTab
            state={state}
            onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            freeThresholdRs={freeThresholdRs}
            setFreeThresholdRs={setFreeThresholdRs}
            shippingChargeRs={shippingChargeRs}
            setShippingChargeRs={setShippingChargeRs}
            promoThresholdRs={promoThresholdRs}
            setPromoThresholdRs={setPromoThresholdRs}
            codFeeRs={codFeeRs}
            storeProducts={storeProducts}
            errors={errors}
            onSave={handleSave}
            saving={saving}
          />
        )}
        {activeTab === 'cod' && (
          <CodTab
            state={state}
            onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            codFeeRs={codFeeRs} setCodFeeRs={setCodFeeRs}
            errors={errors} onSave={handleSave} saving={saving}
          />
        )}
        {activeTab === 'diagnostics' && <DiagnosticsTab />}
      </div>
    </div>
  );
}
