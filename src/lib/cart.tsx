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
import { formatPaise } from '@/lib/format';
import {
  calcAutoOfferDiscount,
  type PromoRewardType,
  type CartLineItemSummary,
} from '@/lib/cart-offers';

export type { PromoRewardType };

export interface ShippingSettingsSummary {
  free_shipping_threshold_paise: number;
  default_shipping_charge_paise: number;
  cod_fee_paise: number;
  cod_enabled: boolean;
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
  promo_reward_type: PromoRewardType;
  reward_percentage: number;
  reward_product_id: string | null;
  buy_x_quantity: number;
  get_y_quantity: number;
}

export interface PromoProgressSummary {
  /** Effective free shipping threshold in paise */
  thresholdPaise: number;
  /** Whether the subtotal qualifies for free shipping based on free_shipping_threshold_paise */
  hasFreeShipping: boolean;
  /** Remaining paise needed to reach free_shipping_threshold_paise */
  remainingForFreeShipping: number;
  /** Progress towards free shipping (0-100) */
  shippingProgressPercent: number;

  /** Dynamic Promo Goal & Reward Details */
  promoRewardType: PromoRewardType;
  rewardPercentage: number;
  rewardProductId: string | null;
  buyXQuantity: number;
  getYQuantity: number;

  isItemCountGoal: boolean;
  targetGoalPaise: number;
  targetItemCount: number;
  hasUnlockedGoal: boolean;
  remainingGoalPaise: number;
  remainingGoalItems: number;
  goalProgressPercent: number;

  /** Calculated auto discount in paise from the active cart reward rule (0 if coupon active or not unlocked) */
  autoDiscountPaise: number;
  /** ID(s) or key of discounted items under buy_x_get_cheapest_free or specific free */
  discountedItemKeys: string[];

  /** Formatted dynamic messages with placeholder replacements */
  inProgressMessage: string;
  unlockedMessage: string;
  rewardBadge: string;
  nudgeTitle: string;
  nudgeText: string;
  nudgeBadge: string;
  isBannerVisible: boolean;
  isNudgeVisible: boolean;
}

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettingsSummary = {
  free_shipping_threshold_paise: 99900,
  default_shipping_charge_paise: 9900,
  cod_fee_paise: 5000,
  cod_enabled: true,
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

export function computePromoProgress(
  settings: ShippingSettingsSummary,
  subtotalPaise: number,
  totalItems: number,
  items: CartLineItemSummary[] = [],
): PromoProgressSummary {
  const autoOffer = calcAutoOfferDiscount(settings, subtotalPaise, items);

  const thresholdPaise = settings.free_shipping_threshold_paise;
  const hasFreeShipping =
    (thresholdPaise > 0 && subtotalPaise >= thresholdPaise) ||
    (settings.promo_reward_type === 'free_shipping' && autoOffer.hasUnlockedGoal);
  const remainingForFreeShipping = Math.max(0, thresholdPaise - subtotalPaise);
  const shippingProgressPercent = thresholdPaise > 0
    ? Math.min(100, Math.round((subtotalPaise / thresholdPaise) * 100))
    : 100;

  const isItemCountGoal = settings.promo_goal_type === 'item_count';
  const targetGoalPaise = settings.promo_goal_threshold_paise ?? settings.free_shipping_threshold_paise;
  const targetItemCount = Math.max(1, settings.promo_goal_item_count || 2);

  // Format dynamic copy for conversion nudge
  const codFeeFormatted = formatPaise(settings.cod_fee_paise);
  const nudgeTitle = (
    settings.promo_nudge_title || 'Pay with UPI & Save {cod_fee}'
  ).replace(/\{cod_fee\}/g, codFeeFormatted);

  const nudgeText = (
    settings.promo_nudge_text ||
    'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.'
  ).replace(/\{cod_fee\}/g, codFeeFormatted);

  const nudgeBadge = settings.promo_nudge_badge || 'LOWEST PRICE';

  return {
    thresholdPaise,
    hasFreeShipping,
    remainingForFreeShipping,
    shippingProgressPercent,
    promoRewardType: settings.promo_reward_type || 'free_shipping',
    rewardPercentage: Number(settings.reward_percentage) || 0,
    rewardProductId: settings.reward_product_id ?? null,
    buyXQuantity: Number(settings.buy_x_quantity) || 2,
    getYQuantity: Number(settings.get_y_quantity) || 1,
    isItemCountGoal,
    targetGoalPaise,
    targetItemCount,
    hasUnlockedGoal: autoOffer.hasUnlockedGoal,
    remainingGoalPaise: autoOffer.remainingGoalPaise,
    remainingGoalItems: autoOffer.remainingGoalItems,
    goalProgressPercent: autoOffer.goalProgressPercent,
    autoDiscountPaise: autoOffer.autoDiscountPaise,
    discountedItemKeys: autoOffer.discountedItemKeys,
    inProgressMessage: autoOffer.inProgressMessage,
    unlockedMessage: autoOffer.unlockedMessage,
    rewardBadge: autoOffer.rewardBadge,
    nudgeTitle,
    nudgeText,
    nudgeBadge,
    isBannerVisible: settings.promo_banner_enabled !== false,
    isNudgeVisible: settings.promo_nudge_enabled !== false,
  };
}

/**
 * KickoffPro cart — local, client-side, localStorage-backed.
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
 *    swapSize / applyValidation / getTotal) is intentionally storage-agnostic.
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
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number, options?: { openDrawer?: boolean }) => void;
  removeItem: (product_id: string, size: string) => void;
  updateQuantity: (product_id: string, size: string, qty: number) => void;
  swapSize: (product_id: string, currentSize: string, newSize: string) => void;
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

  /** Slide-out "Magic" Cart Drawer state & controls */
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;

  /** Dynamic shipping & promotional settings sync */
  shippingSettings: ShippingSettingsSummary;
  shippingLoading: boolean;
  promoProgress: PromoProgressSummary;
  refreshShippingSettings: () => Promise<void>;
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Dynamic shipping & promotional settings sync
  const [shippingSettings, setShippingSettings] = useState<ShippingSettingsSummary>(DEFAULT_SHIPPING_SETTINGS);
  const [shippingLoading, setShippingLoading] = useState(true);

  const refreshShippingSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/shipping/quote', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setShippingSettings({
            free_shipping_threshold_paise: Number(json.data.free_shipping_threshold_paise) || 99900,
            default_shipping_charge_paise: Number(json.data.default_shipping_charge_paise) || 9900,
            cod_fee_paise: Number(json.data.cod_fee_paise) || 5000,
            cod_enabled: json.data.cod_enabled !== false,
            promo_banner_enabled: json.data.promo_banner_enabled !== false,
            promo_goal_type: json.data.promo_goal_type === 'item_count' ? 'item_count' : 'amount',
            promo_goal_threshold_paise: json.data.promo_goal_threshold_paise !== undefined
              ? Number(json.data.promo_goal_threshold_paise)
              : Number(json.data.free_shipping_threshold_paise) || 99900,
            promo_goal_item_count: Number(json.data.promo_goal_item_count) || 2,
            promo_progress_template: json.data.promo_progress_template || 'Add {remaining} more to unlock FREE SHIPPING',
            promo_unlocked_text: json.data.promo_unlocked_text || 'You unlocked FREE Standard Shipping!',
            promo_nudge_enabled: json.data.promo_nudge_enabled !== false,
            promo_nudge_title: json.data.promo_nudge_title || 'Pay with UPI & Save {cod_fee}',
            promo_nudge_badge: json.data.promo_nudge_badge || 'LOWEST PRICE',
            promo_nudge_text: json.data.promo_nudge_text || 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
            promo_reward_type: (json.data.promo_reward_type as PromoRewardType) || 'free_shipping',
            reward_percentage: Number(json.data.reward_percentage) || 0,
            reward_product_id: json.data.reward_product_id ?? null,
            buy_x_quantity: Number(json.data.buy_x_quantity) || 2,
            get_y_quantity: Number(json.data.get_y_quantity) || 1,
          });
        }
      }
    } catch {
      // Fallback defaults preserved gracefully
    } finally {
      setShippingLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshShippingSettings();

    const handleUpdate = () => {
      void refreshShippingSettings();
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refreshShippingSettings();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('kickoffpro:shipping-settings-updated', handleUpdate);
      window.addEventListener('visibilitychange', handleVisibility);
      window.addEventListener('focus', handleUpdate);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('kickoffpro:shipping-settings-updated', handleUpdate);
        window.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', handleUpdate);
      }
    };
  }, [refreshShippingSettings]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    void refreshShippingSettings();
  }, [refreshShippingSettings]);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen((prev) => {
      const next = !prev;
      if (next) void refreshShippingSettings();
      return next;
    });
  }, [refreshShippingSettings]);

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
    (item: Omit<CartItem, 'quantity'>, qty = 1, options?: { openDrawer?: boolean }) => {
      if (!item.maxStock || item.maxStock <= 0) return;
      const safeQty = Math.max(1, Math.floor(qty));

      setItems(prev => {
        const idx = prev.findIndex(
          i => i.product_id === item.product_id && i.size === item.size,
        );
        if (idx >= 0) {
          const existing = prev[idx];
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
      setValidatedAt(null);

      // Open drawer on add unless explicitly disabled
      if (options?.openDrawer ?? true) {
        setIsDrawerOpen(true);
      }
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

  const swapSize = useCallback(
    (product_id: string, currentSize: string, newSize: string) => {
      if (currentSize === newSize) return;

      setItems(prev => {
        const currentItemIndex = prev.findIndex(
          i => i.product_id === product_id && i.size === currentSize,
        );
        if (currentItemIndex === -1) return prev;

        const currentItem = prev[currentItemIndex];
        const existingTargetIndex = prev.findIndex(
          i => i.product_id === product_id && i.size === newSize,
        );

        if (existingTargetIndex !== -1) {
          // Merge current line into existing target size
          const targetItem = prev[existingTargetIndex];
          const mergedQty = targetItem.quantity + currentItem.quantity;
          const clampedQty = targetItem.maxStock > 0
            ? Math.min(mergedQty, targetItem.maxStock)
            : mergedQty;

          return prev
            .filter((_, idx) => idx !== currentItemIndex)
            .map(item => {
              if (item.product_id === product_id && item.size === newSize) {
                return { ...item, quantity: clampedQty };
              }
              return item;
            });
        }

        // Clean size swap
        return prev.map((item, idx) => {
          if (idx === currentItemIndex) {
            return {
              ...item,
              size: newSize,
            };
          }
          return item;
        });
      });

      setValidatedAt(null);
    },
    [],
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
        const byKey = new Map<string, CartValidationEntry>();
        for (const entry of result.items) {
          byKey.set(`${entry.product_id}::${entry.size}`, entry);
        }

        const next: CartItem[] = [];
        for (const line of prev) {
          const entry = byKey.get(`${line.product_id}::${line.size}`);
          if (!entry) {
            next.push(line);
            continue;
          }

          if (entry.removed || entry.maxStock <= 0) {
            summary.removedItems.push(line);
            continue;
          }

          const clampedQty = entry.clampedQuantity;
          if (clampedQty !== line.quantity || entry.maxStock !== line.maxStock) {
            const updated = {
              ...line,
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

  const promoProgress = useMemo(
    () => computePromoProgress(shippingSettings, totalPaise, totalItems, items),
    [shippingSettings, totalPaise, totalItems, items],
  );

  const value = useMemo<CartContextType>(
    () => ({
      items,
      addItem,
      removeItem,
      updateQuantity,
      swapSize,
      clearCart,
      applyValidation,
      totalItems,
      totalPaise,
      getTotal,
      validatedAt,
      isValidationFresh,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      shippingSettings,
      shippingLoading,
      promoProgress,
      refreshShippingSettings,
    }),
    [
      items,
      addItem,
      removeItem,
      updateQuantity,
      swapSize,
      clearCart,
      applyValidation,
      totalItems,
      totalPaise,
      getTotal,
      validatedAt,
      isValidationFresh,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      shippingSettings,
      shippingLoading,
      promoProgress,
      refreshShippingSettings,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
