'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import MediaUploader from '@/components/admin/MediaUploader';
import ProductVideoManager from '@/components/admin/ProductVideoManager';
import { normalizeSlug, getUniqueSlug } from '@/lib/slug';
import {
  APPAREL_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  getSizesForCategory,
  getVarietiesForCategory,
} from '@/lib/catalog/categories';

export default function AdminNewProduct() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [pricePaise, setPricePaise] = useState('');
  const [salePricePaise, setSalePricePaise] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY_ID);
  const [variety, setVariety] = useState(() => getVarietiesForCategory(DEFAULT_CATEGORY_ID)[0] || '');
  const [customVariety, setCustomVariety] = useState('');
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [lowStockAlerts, setLowStockAlerts] = useState<Record<string, boolean>>({});
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [isCartUpsell, setIsCartUpsell] = useState(false);
  const [homepageFeatureImage, setHomepageFeatureImage] = useState('');
  const [homepageFeatureEnabled, setHomepageFeatureEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableSizes = getSizesForCategory(category);
  const categoryVarieties = getVarietiesForCategory(category);

  function handleNameChange(val: string) {
    setName(val);
    setSlug(normalizeSlug(val));
  }

  function handleCategoryChange(nextCat: string) {
    setCategory(nextCat);
    const nextVarieties = getVarietiesForCategory(nextCat);
    if (!nextVarieties.includes(variety) && variety !== '__custom__') {
      setVariety(nextVarieties[0] || '');
    }
  }

  function toggleSize(s: string) {
    setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pricePaise) return;
    setSaving(true);
    setError('');

    const supabase = createClient();

    const price = Math.round(parseFloat(pricePaise) * 100);
    const salePrice = salePricePaise ? Math.round(parseFloat(salePricePaise) * 100) : null;
    const resolvedVariety =
      variety === '__custom__' ? customVariety.trim() || null : variety.trim() || null;

    const baseSlug = slug.trim() || name.trim();
    const finalSlug = await getUniqueSlug(baseSlug, null, supabase);

    const { data: product, error: prodErr } = await supabase
      .from('products')
      .insert({
        name: name.trim(),
        slug: finalSlug,
        description: description.trim(),
        price_paise: price,
        sale_price_paise: salePrice,
        sizes,
        images,
        videos,
        category,
        variety: resolvedVariety,
        is_cart_upsell: isCartUpsell,
        is_active: true,
        homepage_feature_image: homepageFeatureImage || null,
        homepage_feature_enabled: homepageFeatureEnabled,
      })
      .select('id')
      .single();

    if (prodErr || !product) {
      setError(prodErr?.message || 'Failed to create product');
      setSaving(false);
      return;
    }

    const inventoryRows = sizes.map((s) => ({
      product_id: product.id,
      size: s,
      stock: parseInt(stock[s] || '0', 10) || 0,
      low_stock_alert: Boolean(lowStockAlerts[s]),
    }));

    const { error: invErr } = await supabase.from('inventory').insert(inventoryRows);
    if (invErr) {
      setError('Product created but inventory failed: ' + invErr.message);
      setSaving(false);
      return;
    }

    router.push('/admin/products?saved=1');
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-5)' }}>
        Add New Product
      </h1>

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

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Product Name</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              placeholder="e.g. Heavyweight 240 GSM Everyday Tee — Charcoal"
            />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Slug (URL)</label>
            <input
              className="input-field"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-generated"
            />
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
                value={pricePaise}
                onChange={(e) => setPricePaise(e.target.value)}
                required
                placeholder="999"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Sale Price (₹, optional)</label>
              <input
                className="input-field"
                type="number"
                step="0.01"
                value={salePricePaise}
                onChange={(e) => setSalePricePaise(e.target.value)}
                placeholder="699"
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
            Sizes, Initial Stock &amp; Low-Stock Alerts
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
            {sizes.map((s) => (
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
                    value={stock[s] || ''}
                    onChange={(e) => setStock((prev) => ({ ...prev, [s]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    color: lowStockAlerts[s] ? '#f59e0b' : 'var(--text-muted)',
                    fontWeight: lowStockAlerts[s] ? 600 : 400,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(lowStockAlerts[s])}
                    onChange={(e) =>
                      setLowStockAlerts((prev) => ({ ...prev, [s]: e.target.checked }))
                    }
                  />
                  Low Stock Alert
                </label>
              </div>
            ))}
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
          <MediaUploader value={images} onChange={setImages} folder="products" />
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

        <button className={`btn btn-primary ${saving ? 'btn-loading' : ''}`} type="submit" disabled={saving}>
          CREATE PRODUCT
        </button>
      </form>
    </div>
  );
}
