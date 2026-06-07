'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';

/**
 * NOIR cart — local, client-side, localStorage-backed.
 *
 * Design notes:
 *
 * 1. Three-layer stock enforcement.
 *    - PDP disables sold-out sizes (UI level).
 *    - This provider clamps quantities at add/update against `maxStock`
 *      (a snapshot of `inventory.stock` for the selected size at the
 *      moment the line was added).
 *    - The `/api/cart/validate` route re-reads live inventory on
 *      `/cart` mount and on checkout submission to catch any drift
 *      that happened while the cart sat idle.
 *    The database remains the only authoritative source of truth — the
 *    snapshot exists purely so the UI can clamp instantly without a
 *    network round-trip on every `+` click.
 *
 * 2. Inactive product handling.
 *    When the validation route flags a line as `removed` (product
 *    `is_active = false`, or no inventory rows exist anymore), the
 *    line is deleted outright — never silently retained at qty 0.
 *
 * 3. Multi-tab sync.
 *    A `storage` listener mirrors writes from sibling tabs but is
 *    filtered to our key and JSON-diff guarded so it cannot loop.
 *
 * 4. Upgrade path.
 *    To swap in a database-backed cart later, replace `loadCart` /
 *    `saveCart` and the corresponding effects; the public context
 *    surface (addItem / updateQuantity / removeItem / clearCart /
 *    applyValidation / getTotal) is intentionally storage-agnostic.
 */
export interface CartItem {
  product_id: string;
  name: string;
  slug: string;
  size: string;
  price_paise: number;
  quantity: number;
  image: string;
  /**
   * Snapshot of available stock for this (product, size) at the time
   * the line was added or last revalidated. Used purely for instant
   * client-side clamping — never trusted at order time.
   *
   * Legacy `localStorage` entries written before this field existed
   * load with `maxStock = 0`, which makes `+` disabled until the next
   * server revalidation rehydrates the real value.
   */
  maxStock: number;
}

export interface CartValidationEntry {
  product_id: string;
  size: string;
  maxStock: number;
  clampedQuantity: number;
  removed: boolean;
}

export interface CartValidationResult {
  items: CartValidationEntry[];
}

/**
 * Result of `applyValidation` — reports exactly which lines were
 * dropped (out-of-stock / inactive / removed) and which had their
 * quantity reduced to fit available stock. Consumers use this to
 * render explicit user-facing copy; the cart `items` array has
 * already been mutated to match by the time this is returned.
 */
interface ApplyValidationSummary {
  removedItems: CartItem[];
  clampedItems: CartItem[];
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number) => void;
  removeItem: (product_id: string, size: string) => void;
  updateQuantity: (product_id: string, size: string, qty: number) => void;
  clearCart: () => void;
  applyValidation: (result: CartValidationResult) => ApplyValidationSummary;
  totalItems: number;
  totalPaise: number;
  /** Spec-compatible alias for `totalPaise`. */
  getTotal: () => number;
  /**
   * Epoch-ms timestamp of the last successful `applyValidation` call,
   * or `null` if the cart has never been server-validated.
   *
   * Consumers can compare against `Date.now()` to decide whether the
   * snapshot is fresh enough to trust. The checkout page treats
   * anything older than 15 s as stale and forces a revalidation
   * before allowing an order POST.
   */
  validatedAt: number | null;
  /** True if a non-zero number of items have been validated and not mutated since. */
  isValidationFresh: (maxAgeMs?: number) => boolean;
}

const CartContext = createContext<CartContextType | null>(null);

const CART_KEY = 'kickoffpro_cart';

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.product_id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.slug === 'string' &&
    typeof v.size === 'string' &&
    typeof v.price_paise === 'number' &&
    typeof v.quantity === 'number' &&
    typeof v.image === 'string'
  );
}

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCartItem).map(item => ({
      ...item,
      // Backfill for legacy entries written before maxStock existed.
      maxStock: typeof item.maxStock === 'number' ? item.maxStock : 0,
      quantity: Math.max(1, Math.floor(item.quantity)),
    }));
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch (err) {
    // Quota exceeded / private mode — non-fatal.
    console.error('[CART_PERSIST_FAILED]', err);
  }
}

/** Default freshness window for `isValidationFresh` and checkout's stale check. */
const DEFAULT_FRESH_MS = 15_000;

/** Debounce for sibling-tab `storage` events (ms). Tunable, kept short. */
const STORAGE_SYNC_DEBOUNCE_MS = 75;

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [validatedAt, setValidatedAt] = useState<number | null>(null);

  // Tracks the last JSON we wrote to localStorage so the storage
  // listener can ignore echoes of our own writes.
  const lastSerializedRef = useRef<string>('[]');

  // Initial hydrate from localStorage.
  useEffect(() => {
    const initial = loadCart();
    lastSerializedRef.current = JSON.stringify(initial);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(initial);
    setLoaded(true);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (!loaded) return;
    const serialized = JSON.stringify(items);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    saveCart(items);
  }, [items, loaded]);

  // Multi-tab sync: respond to writes in sibling tabs only.
  //
  // Bursts of writes from another tab (e.g. holding the `+` button)
  // would otherwise trigger a re-render per event. We coalesce by
  // recording the latest payload and applying it on a short timer;
  // a fresh event resets the timer so only the final value lands.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pendingPayload: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      timer = null;
      const next = pendingPayload;
      pendingPayload = null;
      if (next === null) return;
      if (next === lastSerializedRef.current) return;
      try {
        const parsed: unknown = JSON.parse(next);
        if (!Array.isArray(parsed)) return;
        const sanitized = parsed.filter(isCartItem).map(item => ({
          ...item,
          maxStock: typeof item.maxStock === 'number' ? item.maxStock : 0,
        }));
        const reserialized = JSON.stringify(sanitized);
        if (reserialized === lastSerializedRef.current) return;
        lastSerializedRef.current = reserialized;
        setItems(sanitized);
        // A sibling-tab mutation invalidates our last server
        // validation snapshot — quantities or composition just
        // changed without going through `applyValidation`.
        setValidatedAt(null);
      } catch {
        // Ignore malformed payloads from other tabs.
      }
    }

    function onStorage(e: StorageEvent) {
      if (e.key !== CART_KEY) return;
      const next = e.newValue ?? '[]';
      if (next === lastSerializedRef.current) return;
      pendingPayload = next;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, STORAGE_SYNC_DEBOUNCE_MS);
    }

    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  const addItem = useCallback(
    (item: Omit<CartItem, 'quantity'>, qty = 1) => {
      // Defence-in-depth: PDP should already block this, but never
      // silently push a sold-out line into the cart.
      if (!item.maxStock || item.maxStock <= 0) return;
      const safeQty = Math.max(1, Math.floor(qty));

      setItems(prev => {
        const idx = prev.findIndex(
          i => i.product_id === item.product_id && i.size === item.size,
        );
        if (idx >= 0) {
          const existing = prev[idx];
          // Always overwrite maxStock with the freshest snapshot the
          // PDP just observed.
          const merged = {
            ...existing,
            ...item,
            quantity: Math.min(existing.quantity + safeQty, item.maxStock),
            maxStock: item.maxStock,
          };
          const next = [...prev];
          next[idx] = merged;
          return next;
        }
        return [
          ...prev,
          { ...item, quantity: Math.min(safeQty, item.maxStock) },
        ];
      });
      // Local mutation invalidates the validation snapshot.
      setValidatedAt(null);
    },
    [],
  );

  const removeItem = useCallback((product_id: string, size: string) => {
    setItems(prev =>
      prev.filter(i => !(i.product_id === product_id && i.size === size)),
    );
    setValidatedAt(null);
  }, []);

  const updateQuantity = useCallback(
    (product_id: string, size: string, qty: number) => {
      if (qty <= 0) {
        removeItem(product_id, size);
        return;
      }
      setItems(prev =>
        prev.map(i =>
          i.product_id === product_id && i.size === size
            ? {
              ...i,
              // Clamp to `[1, maxStock]`. If maxStock is 0 (legacy
              // entry pre-revalidation), keep the existing quantity
              // rather than zero it out — revalidation will fix it.
              quantity:
                i.maxStock > 0
                  ? Math.min(Math.max(1, Math.floor(qty)), i.maxStock)
                  : i.quantity,
            }
            : i,
        ),
      );
      setValidatedAt(null);
    },
    [removeItem],
  );

  const clearCart = useCallback(() => {
    setItems([]);
    setValidatedAt(null);
  }, []);

  const applyValidation = useCallback(
    (result: CartValidationResult): ApplyValidationSummary => {
      const summary: ApplyValidationSummary = {
        removedItems: [],
        clampedItems: [],
      };

      setItems(prev => {
        // Map by composite key for O(1) lookup against validation rows.
        const byKey = new Map<string, CartValidationEntry>();
        for (const entry of result.items) {
          byKey.set(`${entry.product_id}::${entry.size}`, entry);
        }

        const next: CartItem[] = [];
        for (const line of prev) {
          const entry = byKey.get(`${line.product_id}::${line.size}`);
          if (!entry) {
            // Server didn't return this line (shouldn't happen, but
            // be defensive: keep it untouched).
            next.push(line);
            continue;
          }

          // Hard-remove any line that the server says is unsellable.
          // `removed` covers inactive products and missing inventory
          // rows; `maxStock === 0` covers the common case of an
          // active product whose size is currently out of stock
          // (server returns removed=false, maxStock=0). Both must
          // drop the line outright — never clamp to 1, never keep
          // a ghost line that would block checkout downstream.
          if (entry.removed || entry.maxStock <= 0) {
            summary.removedItems.push(line);
            continue;
          }

          const clampedQty = entry.clampedQuantity;
          if (clampedQty !== line.quantity || entry.maxStock !== line.maxStock) {
            const updated = {
              ...line,
              // Safe floor of 1 here only because the entry has
              // already been proven sellable (maxStock > 0).
              quantity: Math.max(1, clampedQty),
              maxStock: entry.maxStock,
            };
            if (clampedQty < line.quantity) {
              summary.clampedItems.push(updated);
            }
            next.push(updated);
          } else {
            next.push(line);
          }
        }
        return next;
      });

      // Mark as freshly validated so consumers (e.g. checkout) can
      // skip a redundant round-trip when they navigate immediately
      // after a successful /cart validation.
      setValidatedAt(Date.now());

      return summary;
    },
    [],
  );

  const isValidationFresh = useCallback(
    (maxAgeMs: number = DEFAULT_FRESH_MS) => {
      if (validatedAt === null) return false;
      return Date.now() - validatedAt <= maxAgeMs;
    },
    [validatedAt],
  );

  const totalItems = useMemo(
    () => items.reduce((s, i) => s + i.quantity, 0),
    [items],
  );
  const totalPaise = useMemo(
    () => items.reduce((s, i) => s + i.price_paise * i.quantity, 0),
    [items],
  );

  const getTotal = useCallback(() => totalPaise, [totalPaise]);

  const value = useMemo<CartContextType>(
    () => ({
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      applyValidation,
      totalItems,
      totalPaise,
      getTotal,
      validatedAt,
      isValidationFresh,
    }),
    [
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      applyValidation,
      totalItems,
      totalPaise,
      getTotal,
      validatedAt,
      isValidationFresh,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
