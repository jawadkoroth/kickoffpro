'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import MediaUploader from '@/components/admin/MediaUploader';
import { normalizeSlug, getUniqueSlug } from '@/lib/slug';

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

interface ProductData {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_paise: number;
  sale_price_paise: number | null;
  sizes: string[];
  images: string[];
  is_active: boolean;
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
  const [isActive, setIsActive] = useState(true);
  const [inventory, setInventory] = useState<{ size: string; stock: number }[]>([]);
  const [category, setCategory] = useState('National Team');
  const [homepageFeatureImage, setHomepageFeatureImage] = useState('');
  const [homepageFeatureEnabled, setHomepageFeatureEnabled] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: p } = await supabase.from('products').select('*').eq('id', id).single();
      if (!p) { setLoading(false); return; }

      setProduct(p);
      setName(p.name);
      setSlug(p.slug);
      setDescription(p.description || '');
      setPrice((p.price_paise / 100).toString());
      setSalePrice(p.sale_price_paise ? (p.sale_price_paise / 100).toString() : '');
      setSizes(p.sizes || []);
      setImages(Array.isArray(p.images) ? p.images : []);
      setIsActive(p.is_active);
      setCategory(p.category || 'National Team');
      setHomepageFeatureImage(p.homepage_feature_image || '');
      setHomepageFeatureEnabled(p.homepage_feature_enabled || false);

      const { data: inv } = await supabase
        .from('inventory')
        .select('size, stock')
        .eq('product_id', id);
      setInventory(inv || []);
      setLoading(false);
    }
    load();
  }, [id]);

  function toggleSize(s: string) {
    setSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function getStock(s: string) {
    return inventory.find(i => i.size === s)?.stock ?? 0;
  }

  function setStock(s: string, val: number) {
    setInventory(prev => {
      const exists = prev.find(i => i.size === s);
      if (exists) return prev.map(i => i.size === s ? { ...i, stock: val } : i);
      return [...prev, { size: s, stock: val }];
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


    // 1. Get a unique normalized slug
    const baseSlug = slug.trim() || name.trim();
    const finalSlug = await getUniqueSlug(baseSlug, id, supabase);

    // 2. Update product
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
        category,
        is_active: isActive,
        homepage_feature_image: homepageFeatureImage || null,
        homepage_feature_enabled: homepageFeatureEnabled,
      })
      .eq('id', id);

    if (prodErr) {
      setError(prodErr.message);
      setSaving(false);
      return;
    }

    // Update inventory — upsert each size
    for (const s of sizes) {
      const stockVal = getStock(s);
      const { data: existing } = await supabase
        .from('inventory')
        .select('id')
        .eq('product_id', id)
        .eq('size', s)
        .single();

      if (existing) {
        await supabase.from('inventory').update({ stock: stockVal }).eq('product_id', id).eq('size', s);
      } else {
        await supabase.from('inventory').insert({ product_id: id, size: s, stock: stockVal });
      }
    }

    router.push('/admin/products?saved=1');
  }

  if (loading) return <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>Loading...</div>;
  if (!product) return <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Product not found</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Edit Product</h1>
        <button
          className={`btn btn-sm ${isActive ? 'btn-success' : 'btn-secondary'}`}
          onClick={() => setIsActive(!isActive)}
        >
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </div>

      {error && <div className="warning-banner" style={{ marginBottom: 'var(--space-4)', color: 'var(--error)', borderColor: 'rgba(229,57,53,0.3)', background: 'rgba(229,57,53,0.1)' }}>{error}</div>}

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Product Name</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Slug</label>
            <input className="input-field" value={slug} onChange={e => setSlug(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="input-label">Description</label>
            <textarea className="input-field" value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ resize: 'vertical', minHeight: '60px' }} />
          </div>
          <div className="input-row" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Price (₹)</label>
              <input className="input-field" type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Sale Price (₹)</label>
              <input className="input-field" type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="Optional" />
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
          <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Sizes & Stock</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {ALL_SIZES.map(s => (
              <button key={s} type="button" className={`size-btn ${sizes.includes(s) ? 'size-btn-selected' : ''}`} onClick={() => toggleSize(s)}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
            {sizes.map(s => (
              <div key={s} className="input-group">
                <label className="input-label">{s}</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  value={getStock(s)}
                  onChange={e => setStock(s, parseInt(e.target.value) || 0)}
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

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button className={`btn btn-primary ${saving ? 'btn-loading' : ''}`} type="submit" disabled={saving} style={{ flex: 1 }}>
            SAVE CHANGES
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => router.push('/admin/products')} style={{ flex: 1 }}>
            CANCEL
          </button>
        </div>
      </form>
    </div>
  );
}
