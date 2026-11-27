'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPublicUrl } from '@/lib/media';
import { extractProductColors } from '@/lib/catalog/extractProductColors';
import {
  getSwatchBackground,
  normalizeHexColor,
  normalizeStyleGroup,
} from '@/lib/catalog/colorSwatches';

interface ColorGroupCardProps {
  category: string;
  variety: string;
  styleGroup: string;
  colorName: string;
  colorHex: string;
  colorSecondaryHex: string;
  primaryImagePath?: string;
  onChange: (patch: {
    styleGroup?: string;
    colorName?: string;
    colorHex?: string;
    colorSecondaryHex?: string;
  }) => void;
  onManualColorEdit?: () => void;
}

export default function ColorGroupCard({
  category,
  variety,
  styleGroup,
  colorName,
  colorHex,
  colorSecondaryHex,
  primaryImagePath,
  onChange,
  onManualColorEdit,
}: ColorGroupCardProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchGroups() {
      try {
        const supabase = createClient();
        let query = supabase
          .from('products')
          .select('style_group, category, variety')
          .not('style_group', 'is', null)
          .limit(100);
        if (category) {
          query = query.eq('category', category);
        }
        const { data } = await query;
        if (cancelled || !data) return;

        // Prioritize exact variety matches first, then other groups in same category
        const exact: string[] = [];
        const rest: string[] = [];
        const normVar = variety.trim().toLowerCase();
        for (const r of data as Array<{ style_group: string | null; variety: string | null }>) {
          const g = r.style_group?.trim();
          if (!g) continue;
          if (normVar && (r.variety || '').trim().toLowerCase() === normVar) {
            if (!exact.includes(g)) exact.push(g);
          } else if (!rest.includes(g) && !exact.includes(g)) {
            rest.push(g);
          }
        }
        setSuggestions([...exact, ...rest].slice(0, 10));
      } catch {
        // Non-fatal suggestion lookup
      }
    }
    fetchGroups();
    return () => {
      cancelled = true;
    };
  }, [category, variety]);

  const cleanPrimary = normalizeHexColor(colorHex) ?? '#111827';
  const cleanSecondary = normalizeHexColor(colorSecondaryHex);
  const hasSecondary = Boolean(cleanSecondary || colorSecondaryHex.trim());

  async function handleAutoDetect() {
    if (!primaryImagePath) {
      setDetectNote('Upload a primary product image first.');
      return;
    }
    setDetecting(true);
    setDetectNote('');
    try {
      const url = getPublicUrl(primaryImagePath);
      const res = await extractProductColors(url);
      if (!res) {
        setDetectNote('Could not read pixels from image (try re-uploading).');
      } else {
        onChange({
          colorHex: res.primaryHex,
          colorSecondaryHex: res.secondaryHex ?? '',
        });
        setDetectNote(
          res.secondaryHex
            ? `Detected two-tone: ${res.primaryHex} & ${res.secondaryHex}`
            : `Detected primary: ${res.primaryHex}`,
        );
      }
    } catch {
      setDetectNote('Auto-detection unavailable for this image.');
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div>
          <label className="input-label" style={{ margin: 0 }}>
            Color &amp; Model Grouping
          </label>
          <p className="text-xs text-muted" style={{ margin: '2px 0 0 0' }}>
            Link different colorways of the exact same model (e.g. Classic Ringer Tee) using one Style Group key.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleAutoDetect}
          disabled={detecting || !primaryImagePath}
          style={{ width: 'auto', fontSize: '0.75rem' }}
        >
          {detecting ? 'Detecting...' : '✦ Auto-detect from primary image'}
        </button>
      </div>

      {detectNote && (
        <p className="text-xs" style={{ marginBottom: 'var(--space-3)', color: 'var(--brand-blue)' }}>
          {detectNote}
        </p>
      )}

      {/* Style Group + Color Name */}
      <div className="input-row" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="input-group">
          <label className="input-label" style={{ fontSize: '0.7rem' }}>
            Model / Style Group
          </label>
          <input
            className="input-field"
            list="style-group-suggestions"
            value={styleGroup}
            onChange={(e) => onChange({ styleGroup: e.target.value })}
            onBlur={() => {
              if (styleGroup.trim()) {
                onChange({ styleGroup: normalizeStyleGroup(styleGroup) });
              }
            }}
            placeholder="e.g. classic-ringer-tee"
          />
          <datalist id="style-group-suggestions">
            {suggestions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>

        <div className="input-group">
          <label className="input-label" style={{ fontSize: '0.7rem' }}>
            Color Name
          </label>
          <input
            className="input-field"
            value={colorName}
            onChange={(e) => onChange({ colorName: e.target.value })}
            placeholder="e.g. Off-White & Navy"
          />
        </div>
      </div>

      {/* Existing style_group quick-pick chips */}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <span className="text-xs text-muted">Existing models:</span>
          {suggestions.map((g) => {
            const active = normalizeStyleGroup(styleGroup) === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onChange({ styleGroup: g })}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: active ? 700 : 500,
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: active ? '1px solid var(--brand-blue)' : '1px solid var(--border-color)',
                  background: active ? 'rgba(47, 169, 245, 0.14)' : 'var(--bg-input)',
                  color: active ? 'var(--brand-blue)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {g}
              </button>
            );
          })}
        </div>
      )}

      {/* Color Pickers + Two-Tone Toggle + Live Swatch Preview */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Live Swatch Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-label="Swatch preview"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              display: 'inline-block',
              background: colorHex.trim()
                ? getSwatchBackground(cleanPrimary, cleanSecondary)
                : 'transparent',
              border: '2px solid rgba(148,163,184,0.45)',
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.65)',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {colorName.trim() || 'Swatch Preview'}
            </div>
            <div className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>
              {colorHex.trim()
                ? cleanSecondary
                  ? `${cleanPrimary} / ${cleanSecondary}`
                  : cleanPrimary
                : 'Not set'}
            </div>
          </div>
        </div>

        {/* Primary Color Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="text-xs text-muted" style={{ fontWeight: 600 }}>
            Primary:
          </label>
          <input
            type="color"
            aria-label="Primary swatch color"
            value={cleanPrimary}
            onChange={(e) => {
              onManualColorEdit?.();
              onChange({ colorHex: e.target.value.toUpperCase() });
            }}
            style={{
              width: 34,
              height: 34,
              padding: 0,
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              background: 'none',
              cursor: 'pointer',
            }}
          />
          <input
            className="input-field"
            value={colorHex}
            onChange={(e) => {
              onManualColorEdit?.();
              onChange({ colorHex: e.target.value.toUpperCase() });
            }}
            placeholder="#F4F1EA"
            style={{ width: 96, padding: '6px 8px', fontSize: '0.75rem', fontFamily: 'monospace' }}
          />
        </div>

        {/* Secondary Color (Optional Two-Tone / Gradient) */}
        {hasSecondary ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label className="text-xs text-muted" style={{ fontWeight: 600 }}>
              Secondary:
            </label>
            <input
              type="color"
              aria-label="Secondary swatch color"
              value={cleanSecondary ?? '#1E293B'}
              onChange={(e) => {
                onManualColorEdit?.();
                onChange({ colorSecondaryHex: e.target.value.toUpperCase() });
              }}
              style={{
                width: 34,
                height: 34,
                padding: 0,
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                background: 'none',
                cursor: 'pointer',
              }}
            />
            <input
              className="input-field"
              value={colorSecondaryHex}
              onChange={(e) => {
                onManualColorEdit?.();
                onChange({ colorSecondaryHex: e.target.value.toUpperCase() });
              }}
              placeholder="#1E293B"
              style={{ width: 96, padding: '6px 8px', fontSize: '0.75rem', fontFamily: 'monospace' }}
            />
            <button
              type="button"
              onClick={() => {
                onManualColorEdit?.();
                onChange({ colorSecondaryHex: '' });
              }}
              style={{
                fontSize: '0.7rem',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Clear 2nd
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onManualColorEdit?.();
              onChange({ colorSecondaryHex: '#1E293B' });
            }}
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px dashed var(--border-color)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            + Two-Tone / Gradient
          </button>
        )}
      </div>
    </div>
  );
}
