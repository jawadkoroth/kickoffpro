'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import MediaUploader from '@/components/admin/MediaUploader';
import { normalizeSlug, getUniqueSlug } from '@/lib/slug';

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function AdminNewProduct() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [pricePaise, setPricePaise] = useState('');
  const [salePricePaise, setSalePricePaise] = useState('');
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('National Team');
  const [homepageFeatureImage, setHomepageFeatureImage] = useState('');
  const [homepageFeatureEnabled, setHomepageFeatureEnabled] = useState(false);

  function handleNameChange(val: string) {
    setName(val);
    setSlug(normalizeSlug(val));
  }

  function toggleSize(s: string) {
    setSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pricePaise) return;
    setSaving(true);
    setError('');

    const supabase = createClient();

    const price = Math.round(parseFloat(pricePaise) * 100);
    const salePrice = salePricePaise ? Math.round(parseFloat(salePricePaise) * 100) : null;

    // 1. Get a unique normalized slug
    const baseSlug = slug.trim() || name.trim();
    const finalSlug = await getUniqueSlug(baseSlug, null, supabase);

    // 2. Insert product
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
        category,
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

    // 2. Insert inventory for each size
    const inventoryRows = sizes.map(s => ({
      product_id: product.id,
      size: s,
      stock: parseInt(stock[s] || '0') || 0,
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
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-5)' }}>Add New Product</h1>

      {error && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-4)', color: 'var(--error)', borderColor: 'rgba(229,57,53,0.3)', background: 'rgba(229,57,53,0.1)' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Product Name</label>
            <input className="input-field" value={name} onChange={e => handleNameChange(e.target.value)} required />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Slug (URL)</label>
            <input className="input-field" value={slug} onChange={e => setSlug(e.target.value)} placeholder="auto-generated" />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Description</label>
            <textarea className="input-field" value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ resize: 'vertical', minHeight: '60px' }} />
          </div>
          <div className="input-row" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Price (₹)</label>
              <input className="input-field" type="number" step="0.01" value={pricePaise} onChange={e => setPricePaise(e.target.value)} required placeholder="1299" />
            </div>
            <div className="input-group">
              <label className="input-label">Sale Price (₹, optional)</label>
              <input className="input-field" type="number" step="0.01" value={salePricePaise} onChange={e => setSalePricePaise(e.target.value)} placeholder="999" />
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Category</label>
            <select 
              className="input-field" 
              value={category} 
              onChange={e => setCategory(e.target.value)}
              style={{ width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            >
              <option value="National Team">National Team</option>
              <option value="Club Jersey">Club Jersey</option>
              <option value="Retro Jersey">Retro Jersey</option>
              <option value="Sale">Sale</option>
            </select>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Sizes & Initial Stock</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {ALL_SIZES.map(s => (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
            {sizes.map(s => (
              <div key={s} className="input-group">
                <label className="input-label">{s} Stock</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  value={stock[s] || ''}
                  onChange={e => setStock(prev => ({ ...prev, [s]: e.target.value }))}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Homepage Showcase</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <input
              type="checkbox"
              id="homepageFeatureEnabled"
              checked={homepageFeatureEnabled}
              onChange={e => setHomepageFeatureEnabled(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label htmlFor="homepageFeatureEnabled" style={{ fontSize: '0.875rem', cursor: 'pointer', userSelect: 'none', color: 'var(--text-primary)' }}>
              Show this product in homepage category showcase
            </label>
          </div>
          
          {homepageFeatureEnabled && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <label className="input-label" style={{ marginBottom: 'var(--space-2)' }}>Homepage Category Image</label>
              <MediaUploader
                value={homepageFeatureImage ? [homepageFeatureImage] : []}
                onChange={urls => setHomepageFeatureImage(urls[0] || '')}
                folder="products"
                maxFiles={1}
              />
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Product Images</label>
          <MediaUploader
            value={images}
            onChange={setImages}
            folder="products"
          />
        </div>

        <button className={`btn btn-primary ${saving ? 'btn-loading' : ''}`} type="submit" disabled={saving}>
          CREATE PRODUCT
        </button>
      </form>
    </div>
  );
}
