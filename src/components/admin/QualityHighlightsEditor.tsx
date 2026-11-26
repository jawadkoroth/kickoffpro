'use client';

import MediaUploader from '@/components/admin/MediaUploader';
import {
  QUALITY_PRESET_TEMPLATES,
  type QualityHighlightRow,
  type QualityPresetTemplate,
} from '@/lib/catalog/qualityTemplates';

interface QualityHighlightsEditorProps {
  gsm: string;
  fabric: string;
  fit: string;
  modelInfo: string;
  onSpecsChange: (patch: {
    gsm?: string;
    fabric?: string;
    fit?: string;
    modelInfo?: string;
  }) => void;
  rows: QualityHighlightRow[];
  onRowsChange: (rows: QualityHighlightRow[]) => void;
}

export default function QualityHighlightsEditor({
  gsm,
  fabric,
  fit,
  modelInfo,
  onSpecsChange,
  rows,
  onRowsChange,
}: QualityHighlightsEditorProps) {
  function applyPreset(preset: QualityPresetTemplate) {
    onSpecsChange({
      gsm: preset.gsm,
      fabric: preset.fabric,
      fit: preset.fit,
      modelInfo: preset.modelInfo,
    });
    onRowsChange(preset.rows.map((r) => ({ ...r })));
  }

  function addRow() {
    onRowsChange([
      ...rows,
      { badge: 'DETAIL', title: '', subtitle: '', image: null },
    ]);
  }

  function updateRow(idx: number, patch: Partial<QualityHighlightRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  function moveRow(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= rows.length) return;
    const copy = [...rows];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    onRowsChange(copy);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* One-Click Presets */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <span className="input-label" style={{ margin: 0 }}>
            Fabric &amp; Quality Templates (One-Click Fill)
          </span>
          {rows.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ width: 'auto', color: 'var(--text-muted)' }}
              onClick={() => onRowsChange([])}
            >
              Clear Rows
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {QUALITY_PRESET_TEMPLATES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: 'auto' }}
              onClick={() => applyPreset(preset)}
            >
              ⚡ {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Above-the-Fold Spec Pills */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        <div className="input-group">
          <label className="input-label">Fabric Weight (GSM)</label>
          <input
            className="input-field"
            value={gsm}
            onChange={(e) => onSpecsChange({ gsm: e.target.value })}
            placeholder="e.g. 220 GSM"
          />
        </div>
        <div className="input-group">
          <label className="input-label">Fabric Composition</label>
          <input
            className="input-field"
            value={fabric}
            onChange={(e) => onSpecsChange({ fabric: e.target.value })}
            placeholder="e.g. 100% Combed Cotton"
          />
        </div>
        <div className="input-group">
          <label className="input-label">Fit Type</label>
          <input
            className="input-field"
            value={fit}
            onChange={(e) => onSpecsChange({ fit: e.target.value })}
            placeholder="e.g. Regular Everyday Fit"
          />
        </div>
        <div className="input-group">
          <label className="input-label">Model Info</label>
          <input
            className="input-field"
            value={modelInfo}
            onChange={(e) => onSpecsChange({ modelInfo: e.target.value })}
            placeholder={`e.g. Model is 5'10" wearing L`}
          />
        </div>
      </div>

      {/* Below-the-Fold Rectangular Storytelling Rows */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            gap: 8,
          }}
        >
          <div>
            <div className="input-label" style={{ margin: 0 }}>
              Below-the-Fold Quality Showcase Rows ({rows.length})
            </div>
            <p className="text-xs text-muted" style={{ margin: '2px 0 0 0' }}>
              Displayed cleanly row-by-row below the description. Leave empty to hide on PDP.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ width: 'auto', whiteSpace: 'nowrap' }}
            onClick={addRow}
          >
            + Add Row
          </button>
        </div>

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row, idx) => (
              <div
                key={idx}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 12,
                  background: 'var(--bg-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span className="text-xs text-muted" style={{ fontWeight: 700 }}>
                    Row #{idx + 1}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: 'auto', padding: '2px 8px' }}
                      disabled={idx === 0}
                      onClick={() => moveRow(idx, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: 'auto', padding: '2px 8px' }}
                      disabled={idx === rows.length - 1}
                      onClick={() => moveRow(idx, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: 'auto', color: 'var(--error)', padding: '2px 8px' }}
                      onClick={() => removeRow(idx)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(110px, 160px) 1fr',
                    gap: 10,
                  }}
                >
                  <div className="input-group">
                    <label className="input-label">Badge Label</label>
                    <input
                      className="input-field"
                      value={row.badge}
                      onChange={(e) => updateRow(idx, { badge: e.target.value })}
                      placeholder="FABRIC"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Row Headline</label>
                    <input
                      className="input-field"
                      value={row.title}
                      onChange={(e) => updateRow(idx, { title: e.target.value })}
                      placeholder="100% Super Combed Bio-Washed Cotton"
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">Detail Copy</label>
                  <textarea
                    className="input-field"
                    rows={2}
                    value={row.subtitle}
                    onChange={(e) => updateRow(idx, { subtitle: e.target.value })}
                    placeholder="Concise explanation of fabric weight, breathability, shrinkage control, stitch quality, or care..."
                  />
                </div>

                <div>
                  <label className="input-label" style={{ marginBottom: 4 }}>
                    Optional Visual / Swatch Photo
                  </label>
                  <MediaUploader
                    value={row.image ? [row.image] : []}
                    onChange={(urls) => updateRow(idx, { image: urls[0] || null })}
                    folder="products"
                    maxFiles={1}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
