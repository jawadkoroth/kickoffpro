'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import MediaUploader from '@/components/admin/MediaUploader';
import ColorGroupCard from '@/components/admin/ColorGroupCard';
import ProductVideoManager from '@/components/admin/ProductVideoManager';
import QualityHighlightsEditor from '@/components/admin/QualityHighlightsEditor';
import { normalizeSlug, getUniqueSlug } from '@/lib/slug';
import { normalizeQualityHighlights, type QualityHighlightRow } from '@/lib/catalog/qualityTemplates';
import { extractProductColors } from '@/lib/catalog/extractProductColors';
import { normalizeHexColor, normalizeStyleGroup } from '@/lib/catalog/colorSwatches';
import {
  APPAREL_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  getSizesForCategory,
  getVarietiesForCategory,
  normalizeVideoList,
} from '@/lib/catalog/categories';

interface ProductData {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_paise: number;
  sale_price_paise: number | null;
  sizes: string[];
  images: string[];
  videos?: string[];
  is_active: boolean;
  category?: string | null;
  variety?: string | null;
  is_cart_upsell?: boolean;
}

interface InventoryRow {
  size: string;
  stock: number;
  low_stock_alert: boolean;
}

export default function AdminEditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [sizes, setSizes] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [category, setCategory] = useState(DEFAULT_CATEGORY_ID);
  const [variety, setVariety] = useState('');
  const [customVariety, setCustomVariety] = useState('');
  const [isCartUpsell, setIsCartUpsell] = useState(false);
  const [gsm, setGsm] = useState('');
  const [fabric, setFabric] = useState('');
  const [fit, setFit] = useState('');
  const [modelInfo, setModelInfo] = useState('');
  const [qualityHighlights, setQualityHighlights] = useState<QualityHighlightRow[]>([]);
  const [homepageFeatureImage, setHomepageFeatureImage] = useState('');
  const [homepageFeatureEnabled, setHomepageFeatureEnabled] = useState(false);
  const [styleGroup, setStyleGroup] = useState('');
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('');
  const [colorSecondaryHex, setColorSecondaryHex] = useState('');
  const colorsManuallyEditedRef = useRef(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: p } = await supabase.from('products').select('*').eq('id', id).single();
      if (!p) {
        setLoading(false);
        return;
      }

      const loadedCategory = p.category || DEFAULT_CATEGORY_ID;
      const knownVarieties = getVarietiesForCategory(loadedCategory);
      const loadedVariety = p.variety || '';

      setProduct(p);
      setName(p.name);
      setSlug(p.slug);
      setDescription(p.description || '');
      setPrice((p.price_paise / 100).toString());
      setSalePrice(p.sale_price_paise ? (p.sale_price_paise / 100).toString() : '');
      setSizes(Array.isArray(p.sizes) ? p.sizes : []);
      setImages(Array.isArray(p.images) ? p.images : []);
      setVideos(normalizeVideoList(p.videos));
      setIsActive(p.is_active);
      setCategory(loadedCategory);
      if (loadedVariety && !knownVarieties.includes(loadedVariety)) {
        setVariety('__custom__');
        setCustomVariety(loadedVariety);
      } else {
        setVariety(loadedVariety);
      }
      setIsCartUpsell(Boolean(p.is_cart_upsell));
      setGsm(p.gsm || '');
      setFabric(p.fabric || '');
      setFit(p.fit || '');
      setModelInfo(p.model_info || '');
      setQualityHighlights(normalizeQualityHighlights(p.quality_highlights));
      setHomepageFeatureImage(p.homepage_feature_image || '');
      setHomepageFeatureEnabled(Boolean(p.homepage_feature_enabled));
      setStyleGroup(p.style_group || '');
      setColorName(p.color_name || '');
      setColorHex(p.color_hex || '');
      setColorSecondaryHex(p.color_secondary_hex || '');
      colorsManuallyEditedRef.current = Boolean(p.color_hex);

      const { data: inv } = await supabase
        .from('inventory')
        .select('size, stock, low_stock_alert')
        .eq('product_id', id);
      setInventory(
        ((inv as InventoryRow[]) || []).map((row) => ({
          size: row.size,
          stock: row.stock ?? 0,
          low_stock_alert: Boolean(row.low_stock_alert),
        })),
      );
      setLoading(false);
    }
    load();
  }, [id]);

  const categoryVarieties = getVarietiesForCategory(category);
  const availableSizes = Array.from(new Set([...getSizesForCategory(category), ...sizes]));

  function handleCategoryChange(nextCat: string) {
    setCategory(nextCat);
    const nextVars = getVarietiesForCategory(nextCat);
    if (variety && variety !== '__custom__' && !nextVars.includes(variety)) {
      setVariety(nextVars[0] || '');
    }
  }

  function toggleSize(s: string) {
    setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function getInvRow(s: string): InventoryRow {
    return (
      inventory.find((i) => i.size === s) ?? {
        size: s,
        stock: 0,
        low_stock_alert: false,
      }
    );
  }

  function setStock(s: string, val: number) {
    setInventory((prev) => {
      const exists = prev.find((i) => i.size === s);
      if (exists) return prev.map((i) => (i.size === s ? { ...i, stock: val } : i));
      return [...prev, { size: s, stock: val, low_stock_alert: false }];
    });
  }

  function setLowStockAlert(s: string, checked: boolean) {
    setInventory((prev) => {
      const exists = prev.find((i) => i.size === s);
      if (exists) return prev.map((i) => (i.size === s ? { ...i, low_stock_alert: checked } : i));
      return [...prev, { size: s, stock: 0, low_stock_alert: checked }];
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !price) return;
    setSaving(true);
    setError('');

    const supabase = createClient();
    const priceVal = Math.round(parseFloat(price) * 100);
    const salePriceVal = salePrice ? Math.round(parseFloat(salePrice) * 100) : null;
    const resolvedVariety =
      variety === '__custom__' ? customVariety.trim() || null : variety.trim() || null;

    const baseSlug = slug.trim() || name.trim();
    const finalSlug = await getUniqueSlug(baseSlug, id, supabase);

    const { error: prodErr } = await supabase
      .from('products')
      .update({
        name: name.trim(),
        slug: finalSlug,
        description: description.trim(),
        price_paise: priceVal,
        sale_price_paise: salePriceVal,
        sizes,
        images,
        videos,
        category,
        variety: resolvedVariety,
        is_cart_upsell: isCartUpsell,
        gsm: gsm.trim() || null,
        fabric: fabric.trim() || null,
        fit: fit.trim() || null,
        model_info: modelInfo.trim() || null,
        quality_highlights: normalizeQualityHighlights(qualityHighlights),
        is_active: isActive,
        homepage_feature_image: homepageFeatureImage || null,
        homepage_feature_enabled: homepageFeatureEnabled,
        style_group: normalizeStyleGroup(styleGroup) || null,
        color_name: colorName.trim() || null,
        color_hex: normalizeHexColor(colorHex),
        color_secondary_hex: normalizeHexColor(colorSecondaryHex),
      })
      .eq('id', id);

    if (prodErr) {
      setError(prodErr.message);
      setSaving(false);
      return;
    }

    for (const s of sizes) {
      const row = getInvRow(s);
      const { data: existing } = await supabase
        .from('inventory')
        .select('id')
        .eq('product_id', id)
        .eq('size', s)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('inventory')
          .update({ stock: row.stock, low_stock_alert: row.low_stock_alert })
          .eq('product_id', id)
          .eq('size', s);
      } else {
        await supabase.from('inventory').insert({
          product_id: id,
          size: s,
          stock: row.stock,
          low_stock_alert: row.low_stock_alert,
        });
      }
    }

    router.push('/admin/products?saved=1');
  }

  if (loading) {
    return (
      <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        Loading...
      </div>
    );
  }
  if (!product) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
        Product not found
      </div>
    );
  }

  const isLegacyCat = !APPAREL_CATEGORIES.some((c) => c.id === category);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-5)',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Edit Product</h1>
        <button
          type="button"
          className={`btn btn-sm ${isActive ? 'btn-success' : 'btn-secondary'}`}
          onClick={() => setIsActive(!isActive)}
        >
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </div>

      {error && (
        <div
          className="warning-banner"
          style={{
            marginBottom: 'var(--space-4)',
            color: 'var(--error)',
            borderColor: 'rgba(229,57,53,0.3)',
            background: 'rgba(229,57,53,0.1)',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Product Name</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Slug</label>
            <input className="input-field" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Description</label>
            <textarea
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ resize: 'vertical', minHeight: '60px' }}
            />
          </div>
          <div className="input-row" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Price (₹)</label>
              <input
                className="input-field"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="input-label">Sale Price (₹)</label>
              <input
                className="input-field"
                type="number"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="input-row" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Category</label>
              <select
                className="input-field"
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                {APPAREL_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                {isLegacyCat && category && <option value={category}>{category} (Legacy)</option>}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Variety / Fit Type</label>
              <select
                className="input-field"
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
              >
                <option value="">-- Select Variety --</option>
                {categoryVarieties.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                <option value="__custom__">Custom variety...</option>
              </select>
            </div>
          </div>

          {variety === '__custom__' && (
            <div className="input-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="input-label">Custom Variety Name</label>
              <input
                className="input-field"
                value={customVariety}
                onChange={(e) => setCustomVariety(e.target.value)}
                placeholder="e.g. Boxy Cropped"
              />
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
            Sizes, Stock &amp; Low-Stock Alerts
          </label>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {availableSizes.map((s) => (
              <button
                key={s}
                type="button"
                className={`size-btn ${sizes.includes(s) ? 'size-btn-selected' : ''}`}
                onClick={() => toggleSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 'var(--space-3)',
            }}
          >
            {sizes.map((s) => {
              const row = getInvRow(s);
              return (
                <div
                  key={s}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <div className="input-group" style={{ marginBottom: 8 }}>
                    <label className="input-label">{s} Stock</label>
                    <input
                      className="input-field"
                      type="number"
                      min="0"
                      value={row.stock}
                      onChange={(e) => setStock(s, parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      color: row.low_stock_alert ? '#f59e0b' : 'var(--text-muted)',
                      fontWeight: row.low_stock_alert ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={row.low_stock_alert}
                      onChange={(e) => setLowStockAlert(s, e.target.checked)}
                    />
                    Low Stock Alert
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
            Merchandising &amp; Cart Upsells
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <input
              type="checkbox"
              id="isCartUpsell"
              checked={isCartUpsell}
              onChange={(e) => setIsCartUpsell(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label
              htmlFor="isCartUpsell"
              style={{
                fontSize: '0.875rem',
                cursor: 'pointer',
                userSelect: 'none',
                color: 'var(--text-primary)',
                fontWeight: 500,
              }}
            >
              Show in Magic Cart Upsells (&ldquo;Complete Your Rotation&rdquo;)
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <input
              type="checkbox"
              id="homepageFeatureEnabled"
              checked={homepageFeatureEnabled}
              onChange={(e) => setHomepageFeatureEnabled(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label
              htmlFor="homepageFeatureEnabled"
              style={{
                fontSize: '0.875rem',
                cursor: 'pointer',
                userSelect: 'none',
                color: 'var(--text-primary)',
              }}
            >
              Show this product in homepage category showcase
            </label>
          </div>

          {homepageFeatureEnabled && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <label className="input-label" style={{ marginBottom: 'var(--space-2)' }}>
                Homepage Showcase Image
              </label>
              <MediaUploader
                value={homepageFeatureImage ? [homepageFeatureImage] : []}
                onChange={(urls) => setHomepageFeatureImage(urls[0] || '')}
                folder="products"
                maxFiles={1}
              />
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
            Product Images
          </label>
          <MediaUploader
            value={images}
            onChange={setImages}
            folder="products"
            onFilesSelected={(files) => {
              if (images.length === 0 && !colorsManuallyEditedRef.current && files[0]) {
                extractProductColors(files[0])
                  .then((res) => {
                    if (!res || colorsManuallyEditedRef.current) return;
                    setColorHex(res.primaryHex);
                    setColorSecondaryHex(res.secondaryHex ?? '');
                  })
                  .catch(() => {});
              }
            }}
          />
        </div>

        <ColorGroupCard
          category={category}
          variety={variety === '__custom__' ? customVariety : variety}
          styleGroup={styleGroup}
          colorName={colorName}
          colorHex={colorHex}
          colorSecondaryHex={colorSecondaryHex}
          primaryImagePath={images[0]}
          onManualColorEdit={() => {
            colorsManuallyEditedRef.current = true;
          }}
          onChange={(patch) => {
            if (patch.styleGroup !== undefined) setStyleGroup(patch.styleGroup);
            if (patch.colorName !== undefined) setColorName(patch.colorName);
            if (patch.colorHex !== undefined) setColorHex(patch.colorHex);
            if (patch.colorSecondaryHex !== undefined) setColorSecondaryHex(patch.colorSecondaryHex);
          }}
        />

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
            Fabric Specs &amp; Below-the-Fold Quality Showcase
          </label>
          <QualityHighlightsEditor
            gsm={gsm}
            fabric={fabric}
            fit={fit}
            modelInfo={modelInfo}
            onSpecsChange={(patch) => {
              if (patch.gsm !== undefined) setGsm(patch.gsm);
              if (patch.fabric !== undefined) setFabric(patch.fabric);
              if (patch.fit !== undefined) setFit(patch.fit);
              if (patch.modelInfo !== undefined) setModelInfo(patch.modelInfo);
            }}
            rows={qualityHighlights}
            onRowsChange={setQualityHighlights}
          />
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-2)' }}>
            Product Videos (Optional)
          </label>
          <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            Short fabric/fit clips rendered lazily inside the PDP gallery (`playsInline`, muted by default).
          </p>
          <ProductVideoManager value={videos} onChange={setVideos} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            className={`btn btn-primary ${saving ? 'btn-loading' : ''}`}
            type="submit"
            disabled={saving}
            style={{ flex: 1 }}
          >
            SAVE CHANGES
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => router.push('/admin/products')}
            style={{ flex: 1 }}
          >
            CANCEL
          </button>
        </div>
      </form>
    </div>
  );
}
