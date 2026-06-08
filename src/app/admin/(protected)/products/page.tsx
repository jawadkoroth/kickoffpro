'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/useToast';
import { getPublicUrl } from '@/lib/media';
import styles from './products.module.css';

/**
 * /admin/products — luxury inventory surface.
 *
 * Architecture preserved verbatim from the previous iteration:
 *   - Loads products + inventory in two queries (no schema/RLS change).
 *   - Archive / restore go through /api/admin/products/[id] so server
 *     authorisation, RLS, and audit logging keep working unchanged.
 *   - is_active toggle and per-size stock writes go direct via the
 *     RLS-enforced client.
 *
 * Visual layer is owned entirely by `products.module.css`. The page
 * is a calm row list with a sticky toolbar (search · status filter ·
 * sort · count · +Add). Stock-by-size editing is preserved but
 * collapsed by default behind an expand chevron, so the catalogue
 * scans cleanly at rest.
 */

interface InventoryRow { size: string; stock: number }

interface Product {
  id: string;
  name: string;
  slug: string;
  price_paise: number;
  sale_price_paise: number | null;
  is_active: boolean;
  archived_at: string | null;
  category: string | null;
  images: string[] | null;
  created_at: string;
  inventory?: InventoryRow[];
}

type StatusFilter = 'all' | 'live' | 'inactive' | 'archived';
type SortKey =
  | 'newest'
  | 'oldest'
  | 'price_asc'
  | 'price_desc'
  | 'stock_desc';

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('live');
  const [sort, setSort] = useState<SortKey>('newest');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [archiving, setArchiving] = useState<Product | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const { toast, showToast } = useToast();
  const searchParams = useSearchParams();

  // Archived rows must be fetched whenever the filter could include
  // them. Re-fetching on every filter change keeps the data model
  // simple; the cost is one query per toggle.
  const includeArchivedInFetch = status === 'all' || status === 'archived';

  useEffect(() => {
    fetchProducts(includeArchivedInFetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeArchivedInFetch]);

  useEffect(() => {
    if (searchParams.get('saved') === '1') {
      showToast('Product saved', 'success');
      window.history.replaceState({}, '', '/admin/products');
    }
  }, [searchParams, showToast]);

  async function fetchProducts(includeArchived: boolean) {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('products')
      .select(
        'id, name, slug, price_paise, sale_price_paise, is_active, archived_at, category, images, created_at',
      )
      .order('created_at', { ascending: false });
    if (!includeArchived) query = query.is('archived_at', null);

    const { data } = await query;
    if (!data) {
      showToast('Failed to load products', 'error');
      setLoading(false);
      return;
    }

    const ids = data.map((p) => p.id);
    let inv: { product_id: string; size: string; stock: number }[] = [];
    if (ids.length > 0) {
      const { data: invRows } = await supabase
        .from('inventory')
        .select('product_id, size, stock')
        .in('product_id', ids);
      inv = invRows ?? [];
    }

    const enriched: Product[] = data.map((p) => ({
      ...p,
      images: Array.isArray(p.images) ? (p.images as string[]) : null,
      inventory: inv
        .filter((i) => i.product_id === p.id)
        .sort((a, b) => a.size.localeCompare(b.size)),
    }));
    setProducts(enriched);
    setLoading(false);
  }

  // -------- Filtering + sorting (client side) --------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = products.slice();

    if (status === 'live') {
      rows = rows.filter((p) => p.archived_at === null && p.is_active);
    } else if (status === 'inactive') {
      rows = rows.filter((p) => p.archived_at === null && !p.is_active);
    } else if (status === 'archived') {
      rows = rows.filter((p) => p.archived_at !== null);
    }

    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          (p.category ?? '').toLowerCase().includes(q),
      );
    }

    const totalStock = (p: Product) =>
      (p.inventory ?? []).reduce((s, i) => s + i.stock, 0);
    const livePrice = (p: Product) => p.sale_price_paise ?? p.price_paise;

    rows.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.created_at.localeCompare(b.created_at);
        case 'price_asc':
          return livePrice(a) - livePrice(b);
        case 'price_desc':
          return livePrice(b) - livePrice(a);
        case 'stock_desc':
          return totalStock(b) - totalStock(a);
        case 'newest':
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return rows;
  }, [products, status, search, sort]);

  // -------- Actions ----------------------------------------------
  async function confirmArchive() {
    if (!archiving || archivePending) return;
    setArchivePending(true);
    setArchiveError('');
    try {
      const res = await fetch(`/api/admin/products/${archiving.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) {
        setArchiveError(data.error || 'Failed to archive product');
        setArchivePending(false);
        return;
      }
      setArchiving(null);
      setArchivePending(false);
      showToast('Product archived', 'success');
      await fetchProducts(includeArchivedInFetch);
    } catch (err) {
      console.error('[PRODUCT_ARCHIVE]', err);
      setArchiveError('Network error. Please try again.');
      setArchivePending(false);
    }
  }

  async function restoreProduct(product: Product) {
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'restore' }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || 'Failed to restore', 'error');
        return;
      }
      showToast('Product restored', 'success');
      await fetchProducts(includeArchivedInFetch);
    } catch (err) {
      console.error('[PRODUCT_RESTORE]', err);
      showToast('Network error', 'error');
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    const supabase = createClient();
    const { error } = await supabase
      .from('products')
      .update({ is_active: !isActive })
      .eq('id', id);
    if (error) {
      showToast('Failed to toggle status', 'error');
      return;
    }
    showToast(`Product ${!isActive ? 'activated' : 'deactivated'}`, 'success');
    // Optimistic local update — avoids a full re-fetch and keeps
    // the row's expand state intact.
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_active: !isActive } : p)),
    );
  }

  async function updateStock(productId: string, size: string, newStock: number) {
    const clamped = Math.max(0, newStock);
    const supabase = createClient();
    const { error } = await supabase
      .from('inventory')
      .update({ stock: clamped })
      .eq('product_id', productId)
      .eq('size', size);
    if (error) {
      showToast('Failed to update stock', 'error');
      return;
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              inventory: (p.inventory ?? []).map((i) =>
                i.size === size ? { ...i, stock: clamped } : i,
              ),
            }
          : p,
      ),
    );
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // -------- Helpers ----------------------------------------------
  const formatPrice = (paise: number) =>
    '₹' + (paise / 100).toLocaleString('en-IN');
  const totalStock = (inv: InventoryRow[] | undefined) =>
    (inv ?? []).reduce((s, i) => s + i.stock, 0);
  const stockClass = (n: number) =>
    n === 0 ? styles.stockOut : n <= 10 ? styles.stockLow : styles.stockHigh;

  // -------- Render -----------------------------------------------
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Products</h1>
          <span className={styles.count}>
            {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <Link href="/admin/products/new" className={`btn btn-primary btn-sm ${styles.addCta}`}>
          + Add Product
        </Link>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden>⌕</span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search name, slug or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className={styles.segmented} role="tablist" aria-label="Filter by status">
          {(
            [
              ['live', 'Live'],
              ['inactive', 'Inactive'],
              ['archived', 'Archived'],
              ['all', 'All'],
            ] as [StatusFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={status === key}
              onClick={() => setStatus(key)}
              className={`${styles.segmentedBtn} ${
                status === key ? styles.segmentedBtnActive : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className={styles.sort}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort products"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="price_desc">Price · high → low</option>
          <option value="price_asc">Price · low → high</option>
          <option value="stock_desc">Stock · high → low</option>
        </select>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}

      {loading ? (
        <div className={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            {search
              ? 'No matches'
              : status === 'archived'
                ? 'No archived products'
                : 'No products yet'}
          </p>
          <p className={styles.emptyHint}>
            {search
              ? 'Try a different search term or clear filters.'
              : 'Add your first product to start selling.'}
          </p>
          {!search && status !== 'archived' && (
            <Link
              href="/admin/products/new"
              className="btn btn-primary btn-sm"
              style={{ width: 'auto' }}
            >
              + Add Product
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((product) => {
            const isOpen = expanded.has(product.id);
            const stock = totalStock(product.inventory);
            const firstImage =
              product.images && product.images.length > 0
                ? product.images[0]
                : null;
            const archived = product.archived_at !== null;
            return (
              <div
                key={product.id}
                className={`${styles.row} ${archived ? styles.rowArchived : ''}`}
              >
                {/* Thumb */}
                <div className={styles.thumb}>
                  {firstImage ? (
                    <Image
                      src={getPublicUrl(firstImage)}
                      alt={product.name}
                      fill
                      sizes="64px"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <div className={styles.thumbPlaceholder}>NO IMG</div>
                  )}
                </div>

                {/* Identity */}
                <div className={styles.identity}>
                  <Link
                    href={`/admin/products/${product.id}/edit`}
                    className={styles.name}
                  >
                    {product.name}
                  </Link>
                  <div className={styles.metaLine}>
                    <span className={styles.slug}>/{product.slug}</span>
                    {product.category && (
                      <span className={styles.category}>{product.category}</span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className={styles.priceBlock}>
                  {product.sale_price_paise ? (
                    <>
                      <span className={styles.priceLive}>
                        {formatPrice(product.sale_price_paise)}
                      </span>
                      <span className={styles.priceStrike}>
                        {formatPrice(product.price_paise)}
                      </span>
                      <span className={styles.priceSaleHint}>On sale</span>
                    </>
                  ) : (
                    <span className={styles.priceLive}>
                      {formatPrice(product.price_paise)}
                    </span>
                  )}
                </div>

                {/* Stock chip */}
                <span className={`${styles.stockChip} ${stockClass(stock)}`}>
                  <span className={styles.stockDot} />
                  {stock} in stock
                </span>

                {/* Status pill */}
                <span
                  className={`${styles.statusPill} ${
                    archived
                      ? styles.statusArchived
                      : product.is_active
                        ? styles.statusActive
                        : styles.statusInactive
                  }`}
                >
                  {archived ? 'Archived' : product.is_active ? 'Live' : 'Inactive'}
                </span>

                {/* Actions */}
                <div className={styles.actions}>
                  {archived ? (
                    <button
                      type="button"
                      onClick={() => restoreProduct(product)}
                      className={styles.iconBtn}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <label
                        className={styles.toggle}
                        title={product.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <input
                          type="checkbox"
                          checked={product.is_active}
                          onChange={() =>
                            toggleActive(product.id, product.is_active)
                          }
                          aria-label={`Toggle active for ${product.name}`}
                        />
                      </label>
                      <Link
                        href={`/admin/products/${product.id}/edit`}
                        className={styles.iconBtn}
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setArchiving(product);
                          setArchiveError('');
                        }}
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        aria-label={`Archive ${product.name}`}
                      >
                        Archive
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`${styles.expandBtn} ${
                      isOpen ? styles.expandBtnOpen : ''
                    }`}
                    onClick={() => toggleExpand(product.id)}
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen ? 'Collapse stock detail' : 'Expand stock detail'
                    }
                  >
                    ⌄
                  </button>
                </div>

                {/* Expanded stock grid */}
                {isOpen && (
                  <div className={styles.expand}>
                    {(product.inventory ?? []).length === 0 ? (
                      <p className="text-xs text-muted">
                        No size inventory rows. Add sizes in the edit screen.
                      </p>
                    ) : (
                      (product.inventory ?? []).map((inv) => (
                        <div key={inv.size} className={styles.sizeCell}>
                          <span className={styles.sizeLabel}>{inv.size}</span>
                          <div className={styles.stepper}>
                            <button
                              type="button"
                              className={styles.stepperBtn}
                              onClick={() =>
                                updateStock(product.id, inv.size, inv.stock - 1)
                              }
                              aria-label={`Decrease ${inv.size} stock`}
                              disabled={inv.stock === 0}
                            >
                              −
                            </button>
                            <span
                              className={`${styles.stepperVal} ${
                                inv.stock === 0 ? styles.stepperValZero : ''
                              }`}
                            >
                              {inv.stock}
                            </span>
                            <button
                              type="button"
                              className={styles.stepperBtn}
                              onClick={() =>
                                updateStock(product.id, inv.size, inv.stock + 1)
                              }
                              aria-label={`Increase ${inv.size} stock`}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {archiving && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-archive-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !archivePending) {
              setArchiving(null);
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
              maxWidth: 460,
              width: '100%',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
            }}
          >
            <h2
              id="product-archive-title"
              style={{
                fontSize: '1.0625rem',
                fontWeight: 600,
                marginBottom: 'var(--space-3)',
              }}
            >
              Archive “{archiving.name}”?
            </h2>
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.55, marginBottom: 'var(--space-3)' }}
            >
              This hides the product from the storefront and cart, and marks it
              inactive. Historical orders, invoices and order detail pages keep
              their reference intact.
            </p>
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.55, marginBottom: 'var(--space-5)' }}
            >
              Archiving is reversible — use the “Archived” filter and click
              Restore to bring the product back.
            </p>
            {archiveError && (
              <p
                className="input-error-text"
                style={{ marginBottom: 'var(--space-3)' }}
              >
                {archiveError}
              </p>
            )}
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setArchiving(null)}
                disabled={archivePending}
                style={{ width: 'auto' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-primary btn-sm ${
                  archivePending ? 'btn-loading' : ''
                }`}
                onClick={confirmArchive}
                disabled={archivePending}
                style={{
                  width: 'auto',
                  background: 'var(--error)',
                  borderColor: 'var(--error)',
                }}
              >
                {archivePending ? 'ARCHIVING…' : 'ARCHIVE PRODUCT'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
