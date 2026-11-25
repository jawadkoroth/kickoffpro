'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useCart } from '@/lib/cart';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import {
  X,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  ArrowRight,
  Truck,
  Zap,
  CheckCircle2,
  Gift,
  Tag,
} from 'lucide-react';
import styles from './CartDrawer.module.css';

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

interface UpsellProduct {
  id: string;
  name: string;
  slug: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: string[];
  sizes: string[];
  inventory?: { size: string; stock: number }[];
}

import { calcBxgyDiscountPaise } from '@/lib/coupons/evaluateCoupon';

interface ActiveCoupon {
  id: string;
  code: string;
  discount_type?: 'percent' | 'flat' | 'bxgy';
  discount_percent: number;
  discount_paise?: number | null;
  min_cart_paise?: number | null;
  min_order_paise?: number | null;
  min_items?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  max_discount_paise?: number | null;
  cart_mode?: 'sync_auto' | 'manual_with_progress' | 'manual_only';
  stackable_with_promo?: boolean;
}

function formatCouponOfferLabel(
  c: Pick<ActiveCoupon, 'discount_type' | 'discount_percent' | 'discount_paise' | 'buy_qty' | 'get_qty'>,
): string {
  if (c.discount_type === 'bxgy') {
    return `Buy ${c.buy_qty ?? 2} Get ${c.get_qty ?? 1} Free`;
  }
  if (c.discount_type === 'flat' && c.discount_paise && c.discount_paise > 0) {
    return `₹${Math.round(c.discount_paise / 100).toLocaleString('en-IN')} OFF`;
  }
  return `${c.discount_percent}% OFF`;
}

function getCouponShortfall(
  c: Pick<ActiveCoupon, 'discount_type' | 'min_cart_paise' | 'min_order_paise' | 'min_items' | 'buy_qty' | 'get_qty'>,
  subtotalPaise: number,
  paidCount: number,
) {
  const minCartReq = c.min_cart_paise ?? c.min_order_paise ?? 0;
  const requiredItems =
    c.discount_type === 'bxgy'
      ? (c.buy_qty ?? 2) + (c.get_qty ?? 1)
      : (c.min_items ?? 0);
  const shortfallPaise = minCartReq > 0 ? Math.max(0, minCartReq - subtotalPaise) : 0;
  const shortfallItems = requiredItems > 0 ? Math.max(0, requiredItems - paidCount) : 0;
  return {
    minCartReq,
    requiredItems,
    shortfallPaise,
    shortfallItems,
    isEligible: subtotalPaise > 0 && shortfallPaise === 0 && shortfallItems === 0,
  };
}

function formatShortfallMessage(shortfallPaise: number, shortfallItems: number): string {
  const parts: string[] = [];
  if (shortfallPaise > 0) {
    parts.push(`₹${Math.ceil(shortfallPaise / 100).toLocaleString('en-IN')}`);
  }
  if (shortfallItems > 0) {
    parts.push(`${shortfallItems} more item${shortfallItems === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return '';
  if (shortfallPaise > 0 && shortfallItems === 0) {
    return `${parts[0]} more`;
  }
  return parts.join(' & ');
}

function calcCouponDiscountPaise(
  c: Pick<ActiveCoupon, 'discount_type' | 'discount_percent' | 'discount_paise' | 'max_discount_paise' | 'buy_qty' | 'get_qty'>,
  subtotalPaise: number,
  cartItems: { price_paise: number; quantity: number; is_free_gift?: boolean }[] = [],
): number {
  if (subtotalPaise <= 0) return 0;
  let disc = 0;
  if (c.discount_type === 'bxgy') {
    const paidItems = cartItems
      .filter((i) => !i.is_free_gift)
      .map((i) => ({ unit_price_paise: i.price_paise, quantity: i.quantity }));
    disc = calcBxgyDiscountPaise(paidItems, c.buy_qty ?? 2, c.get_qty ?? 1);
  } else if (c.discount_type === 'flat' && c.discount_paise && c.discount_paise > 0) {
    disc = Math.min(c.discount_paise, subtotalPaise);
  } else {
    disc = Math.round((subtotalPaise * c.discount_percent) / 100);
  }
  if (c.max_discount_paise && c.max_discount_paise > 0 && disc > c.max_discount_paise) {
    disc = c.max_discount_paise;
  }
  return Math.min(disc, subtotalPaise);
}

export default function CartDrawer() {
  const router = useRouter();
  const {
    items,
    isDrawerOpen,
    closeDrawer,
    addItem,
    removeItem,
    updateQuantity,
    swapSize,
    totalItems,
    totalPaise,
    shippingSettings,
    promoProgress,
    appliedCoupon,
    couponNotice,
    applyCoupon,
    clearCoupon,
    clearCouponNotice,
  } = useCart();

  const [upsellProducts, setUpsellProducts] = useState<UpsellProduct[]>([]);
  const [upsellSizes, setUpsellSizes] = useState<Record<string, string>>({});
  const [activeCoupons, setActiveCoupons] = useState<ActiveCoupon[]>([]);
  const [couponError, setCouponError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Always scroll drawer body to top whenever drawer opens
  useEffect(() => {
    if (!isDrawerOpen) return;
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
    const raf = requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isDrawerOpen]);

  // Fetch cross-sells & active coupons lazily when drawer opens
  useEffect(() => {
    if (!isDrawerOpen) return;

    if (FEATURE_FLAGS.CART_UPSELLS && upsellProducts.length === 0) {
      fetch('/api/products')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.success && Array.isArray(data.products)) {
            setUpsellProducts(data.products);
          }
        })
        .catch(() => {});
    }

    if (FEATURE_FLAGS.CART_COUPONS && activeCoupons.length === 0) {
      fetch('/api/coupons/active')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.success && Array.isArray(data.coupons)) {
            setActiveCoupons(data.coupons);
          }
        })
        .catch(() => {});
    }
  }, [isDrawerOpen, upsellProducts.length, activeCoupons.length]);

  const paidCount = useMemo(
    () => items.filter((i) => !i.is_free_gift).reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );

  // Recompute applied coupon discount when totalPaise or items change
  const couponDiscountPaise = useMemo(() => {
    if (!FEATURE_FLAGS.CART_COUPONS || !appliedCoupon || totalPaise <= 0) return 0;
    const match = activeCoupons.find((c) => c.code === appliedCoupon.code);
    if (match) {
      const { isEligible } = getCouponShortfall(match, totalPaise, paidCount);
      if (!isEligible) return 0;
      return calcCouponDiscountPaise(match, totalPaise, items);
    }
    return calcCouponDiscountPaise(
      {
        discount_type: appliedCoupon.discountType ?? 'percent',
        discount_percent: appliedCoupon.discountPercent,
        discount_paise: appliedCoupon.discountPaiseFlat ?? null,
        max_discount_paise: appliedCoupon.maxDiscountPaise ?? null,
        buy_qty: appliedCoupon.buyQty ?? null,
        get_qty: appliedCoupon.getQty ?? null,
      },
      totalPaise,
      items,
    );
  }, [appliedCoupon, activeCoupons, totalPaise, paidCount, items]);

  // Visible cross-sell recommendations (not already in cart, with stock > 0, max 2 items)
  const visibleUpsells = useMemo(() => {
    if (!FEATURE_FLAGS.CART_UPSELLS) return [];
    const inCartIds = new Set(items.map((i) => i.product_id));
    return upsellProducts
      .filter((p) => !inCartIds.has(p.id))
      .filter((p) => {
        if (!p.inventory || p.inventory.length === 0) return true;
        return p.inventory.some((inv) => inv.stock > 0);
      })
      .slice(0, 2);
  }, [upsellProducts, items]);

  // Sync activeCoupons metadata with appliedCoupon and handle sync_auto mode
  useEffect(() => {
    if (!FEATURE_FLAGS.CART_COUPONS || activeCoupons.length === 0) return;

    // 1. If a coupon is applied, verify its live eligibility against totalPaise & paidCount
    if (appliedCoupon) {
      const match = activeCoupons.find((c) => c.code === appliedCoupon.code);
      if (match) {
        const { isEligible } = getCouponShortfall(match, totalPaise, paidCount);
        if (!isEligible) {
          clearCoupon();
          return;
        }
        // Keep metadata fresh in case admin updated rules
        const nextType = match.discount_type ?? 'percent';
        if (
          appliedCoupon.minCartPaise !== (match.min_cart_paise ?? null) ||
          appliedCoupon.minItems !== (match.min_items ?? 0) ||
          appliedCoupon.discountType !== nextType ||
          appliedCoupon.buyQty !== (match.buy_qty ?? null) ||
          appliedCoupon.getQty !== (match.get_qty ?? null) ||
          appliedCoupon.stackableWithPromo !== Boolean(match.stackable_with_promo)
        ) {
          applyCoupon({
            code: match.code,
            discountPaise: calcCouponDiscountPaise(match, totalPaise, items),
            discountPercent: match.discount_percent,
            discountType: nextType,
            discountPaiseFlat: match.discount_paise ?? null,
            minCartPaise: match.min_cart_paise ?? null,
            minItems: match.min_items ?? 0,
            buyQty: match.buy_qty ?? null,
            getQty: match.get_qty ?? null,
            maxDiscountPaise: match.max_discount_paise ?? null,
            stackableWithPromo: Boolean(match.stackable_with_promo),
            cartMode: match.cart_mode ?? 'manual_only',
            autoApplied: appliedCoupon.autoApplied,
          });
        }
      }
      return;
    }

    // 2. If no coupon is applied and there is a sync_auto coupon whose threshold is met, auto-apply it
    const syncCoupon = activeCoupons.find((c) => c.cart_mode === 'sync_auto');
    if (syncCoupon && totalPaise > 0) {
      const { isEligible } = getCouponShortfall(syncCoupon, totalPaise, paidCount);
      if (isEligible) {
        applyCoupon({
          code: syncCoupon.code,
          discountPaise: calcCouponDiscountPaise(syncCoupon, totalPaise, items),
          discountPercent: syncCoupon.discount_percent,
          discountType: syncCoupon.discount_type ?? 'percent',
          discountPaiseFlat: syncCoupon.discount_paise ?? null,
          minCartPaise: syncCoupon.min_cart_paise ?? null,
          minItems: syncCoupon.min_items ?? 0,
          buyQty: syncCoupon.buy_qty ?? null,
          getQty: syncCoupon.get_qty ?? null,
          maxDiscountPaise: syncCoupon.max_discount_paise ?? null,
          stackableWithPromo: Boolean(syncCoupon.stackable_with_promo),
          cartMode: 'sync_auto',
          autoApplied: true,
        });
      }
    }
  }, [activeCoupons, appliedCoupon, totalPaise, paidCount, items, applyCoupon, clearCoupon]);

  // Mutual exclusion: never double-dip Reward Discount + non-stackable Coupon
  const effectiveAutoDiscountPaise = useMemo(() => {
    if (couponDiscountPaise > 0 && !appliedCoupon?.stackableWithPromo) {
      return 0;
    }
    return promoProgress.autoDiscountPaise;
  }, [couponDiscountPaise, appliedCoupon, promoProgress.autoDiscountPaise]);

  // Single unified progress bar (driven by /admin/coupons/auto Magic Cart settings)
  const unifiedProgress = useMemo(() => {
    if (items.length === 0) {
      return {
        visible: false,
        unlocked: false,
        percent: 0,
        message: '',
        iconType: 'free_shipping' as const,
      };
    }

    const paidCount = items
      .filter((i) => !i.is_free_gift)
      .reduce((sum, i) => sum + i.quantity, 0);

    // Check if an active coupon drives the progress bar (sync_auto or manual_with_progress)
    const progressCoupon = FEATURE_FLAGS.CART_COUPONS
      ? activeCoupons.find(
          (c) =>
            (c.cart_mode === 'sync_auto' || c.cart_mode === 'manual_with_progress') &&
            ((c.min_cart_paise ?? c.min_order_paise ?? 0) > 0 ||
              c.discount_type === 'bxgy' ||
              (c.min_items ?? 0) > 0),
        )
      : undefined;

    if (progressCoupon) {
      const { minCartReq, requiredItems, shortfallPaise, shortfallItems, isEligible } =
        getCouponShortfall(progressCoupon, totalPaise, paidCount);
      const unlocked = isEligible;
      const percent = unlocked
        ? 100
        : requiredItems > 0 && (shortfallItems > 0 || minCartReq === 0)
          ? Math.min(100, Math.round((paidCount / requiredItems) * 100))
          : minCartReq > 0
            ? Math.min(100, Math.round((totalPaise / minCartReq) * 100))
            : 100;
      const offerLabel = formatCouponOfferLabel(progressCoupon);
      const shortfallText = formatShortfallMessage(shortfallPaise, shortfallItems);

      let message = '';
      if (!unlocked) {
        if (progressCoupon.discount_type === 'bxgy' && shortfallItems > 0 && shortfallPaise === 0) {
          const getQty = progressCoupon.get_qty ?? 1;
          const freeText = getQty === 1 ? 'get your lowest-priced item FREE!' : `get ${getQty} lowest-priced items FREE!`;
          message =
            progressCoupon.cart_mode === 'sync_auto'
              ? `Add ${shortfallText} to ${freeText}`
              : `Add ${shortfallText} to unlock ${progressCoupon.code} (${offerLabel})`;
        } else {
          message =
            progressCoupon.cart_mode === 'sync_auto'
              ? `Add ${shortfallText} to auto-apply ${progressCoupon.code} (${offerLabel})`
              : `Add ${shortfallText} to unlock ${progressCoupon.code} (${offerLabel})`;
        }
      } else if (progressCoupon.cart_mode === 'sync_auto' || appliedCoupon?.code === progressCoupon.code) {
        message = `${progressCoupon.code} (${offerLabel}) applied!`;
      } else {
        message = `${progressCoupon.code} (${offerLabel}) unlocked — click Apply below!`;
      }

      return {
        visible: true,
        unlocked,
        percent,
        message,
        iconType:
          progressCoupon.discount_type === 'bxgy'
            ? ('buy_x_get_cheapest_free' as const)
            : ('threshold_percentage' as const),
      };
    }

    if (shippingSettings.promo_banner_enabled === false || !promoProgress.isBannerVisible) {
      return {
        visible: false,
        unlocked: false,
        percent: 0,
        message: '',
        iconType: 'free_shipping' as const,
      };
    }

    if (shippingSettings.promo_reward_type === 'manual_coupon_only') {
      if (!FEATURE_FLAGS.CART_COUPONS || activeCoupons.length === 0) {
        return {
          visible: false,
          unlocked: false,
          percent: 0,
          message: '',
          iconType: 'threshold_percentage' as const,
        };
      }

      const explicitCode = shippingSettings.promo_manual_coupon_code?.trim().toUpperCase();
      let trackedCoupon = explicitCode
        ? activeCoupons.find((c) => c.code.toUpperCase() === explicitCode)
        : undefined;

      if (!trackedCoupon) {
        const sorted = [...activeCoupons]
          .map((c) => ({
            coupon: c,
            ...getCouponShortfall(c, totalPaise, paidCount),
          }))
          .sort((a, b) => a.shortfallPaise - b.shortfallPaise || a.shortfallItems - b.shortfallItems);
        trackedCoupon = sorted[0]?.coupon;
      }

      if (!trackedCoupon) {
        return {
          visible: false,
          unlocked: false,
          percent: 0,
          message: '',
          iconType: 'threshold_percentage' as const,
        };
      }

      const { minCartReq, requiredItems, shortfallPaise, shortfallItems, isEligible } =
        getCouponShortfall(trackedCoupon, totalPaise, paidCount);
      const unlocked = isEligible;
      const percent = unlocked
        ? 100
        : requiredItems > 0 && (shortfallItems > 0 || minCartReq === 0)
          ? Math.min(100, Math.round((paidCount / requiredItems) * 100))
          : minCartReq > 0
            ? Math.min(100, Math.round((totalPaise / minCartReq) * 100))
            : 100;

      const offerLabel = formatCouponOfferLabel(trackedCoupon);
      const shortfallText = formatShortfallMessage(shortfallPaise, shortfallItems);
      const savingsPaise = calcCouponDiscountPaise(trackedCoupon, totalPaise, items);

      let message = '';
      if (!unlocked) {
        message = `Add ${shortfallText} to unlock ${trackedCoupon.code} (${offerLabel})`;
      } else if (appliedCoupon?.code === trackedCoupon.code) {
        message = `${trackedCoupon.code} applied — saving ${formatPaise(savingsPaise)}!`;
      } else {
        message = `You unlocked ${trackedCoupon.code}! Click Apply below to save ${formatPaise(savingsPaise)}`;
      }

      return {
        visible: true,
        unlocked,
        percent,
        message,
        iconType: 'threshold_percentage' as const,
      };
    }

    if (FEATURE_FLAGS.CART_PACK_BAR) {
      // If admin configured a specialized auto-offer (percentage / BOGO), honour it cleanly
      if (promoProgress.isBannerVisible && promoProgress.promoRewardType !== 'free_shipping') {
        return {
          visible: true,
          unlocked: promoProgress.hasUnlockedGoal,
          percent: promoProgress.goalProgressPercent,
          message: promoProgress.hasUnlockedGoal
            ? promoProgress.unlockedMessage
            : promoProgress.inProgressMessage,
          iconType: promoProgress.promoRewardType,
        };
      }

      // Otherwise render the D2C Pack / Multi-Buy progress bar (Pack of 2 -> Pack of 3)
      const targetPack = paidCount < 2 ? 2 : 3;
      const remaining = Math.max(0, targetPack - paidCount);
      const unlocked = paidCount >= 2 && (promoProgress.hasFreeShipping || paidCount >= 3);
      const percent = Math.min(100, Math.round((paidCount / targetPack) * 100));

      let message = '';
      if (paidCount < 2) {
        message = `Add ${remaining} more item to unlock Pack of 2 & Free Shipping`;
      } else if (paidCount === 2) {
        message = 'Pack of 2 unlocked! Add 1 more for Pack of 3 savings';
      } else {
        message = 'Pack of 3+ unlocked! Best bundle value + Free Shipping';
      }

      return {
        visible: items.length > 0,
        unlocked,
        percent,
        message,
        iconType: 'pack' as const,
      };
    }

    return {
      visible: items.length > 0 && promoProgress.isBannerVisible,
      unlocked: promoProgress.hasUnlockedGoal,
      percent: promoProgress.goalProgressPercent,
      message: promoProgress.hasUnlockedGoal
        ? promoProgress.unlockedMessage
        : promoProgress.inProgressMessage,
      iconType: promoProgress.promoRewardType,
    };
  }, [
    items,
    paidCount,
    promoProgress,
    activeCoupons,
    totalPaise,
    appliedCoupon?.code,
    shippingSettings.promo_banner_enabled,
    shippingSettings.promo_reward_type,
    shippingSettings.promo_manual_coupon_code,
    shippingSettings.free_shipping_threshold_paise,
  ]);

  const handleApplyCouponChip = async (coupon: ActiveCoupon) => {
    setCouponError('');
    clearCouponNotice();
    const { shortfallPaise, shortfallItems, isEligible } = getCouponShortfall(coupon, totalPaise, paidCount);
    if (!isEligible) {
      setCouponError(`Add ${formatShortfallMessage(shortfallPaise, shortfallItems)} to unlock ${coupon.code} (${formatCouponOfferLabel(coupon)})`);
      return;
    }
    applyCoupon({
      code: coupon.code,
      discountPaise: calcCouponDiscountPaise(coupon, totalPaise, items),
      discountPercent: coupon.discount_percent,
      discountType: coupon.discount_type ?? 'percent',
      discountPaiseFlat: coupon.discount_paise ?? null,
      minCartPaise: coupon.min_cart_paise ?? null,
      minItems: coupon.min_items ?? 0,
      buyQty: coupon.buy_qty ?? null,
      getQty: coupon.get_qty ?? null,
      maxDiscountPaise: coupon.max_discount_paise ?? null,
      stackableWithPromo: Boolean(coupon.stackable_with_promo),
      cartMode: coupon.cart_mode ?? 'manual_only',
      autoApplied: false,
    });
  };

  // Lock body scroll and register Escape key listener when drawer is open
  useEffect(() => {
    if (!isDrawerOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDrawerOpen, closeDrawer]);

  const handleCheckoutClick = () => {
    closeDrawer();
    const couponQuery =
      FEATURE_FLAGS.CART_COUPONS && appliedCoupon?.code
        ? `?coupon=${encodeURIComponent(appliedCoupon.code)}`
        : '';
    router.push(`/checkout${couponQuery}`);
  };

  return (
    <AnimatePresence>
      {isDrawerOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Slide-out Drawer Panel */}
          <motion.aside
            className={styles.drawer}
            initial={{ x: '100%' }}
            animate={{ x: '0%' }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label="Shopping Cart"
          >
            {/* Header */}
            <div className={styles.header}>
              <div className={styles.headerTitle}>
                <ShoppingBag size={20} color="var(--brand-navy)" />
                <span>Your Locker</span>
                {totalItems > 0 && (
                  <span className={styles.itemCountBadge}>{totalItems}</span>
                )}
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={closeDrawer}
                aria-label="Close Cart Drawer"
              >
                <X size={22} />
              </button>
            </div>

            {/* Main Content: Items List or Empty State */}
            {items.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconCircle}>
                  <ShoppingBag size={36} />
                </div>
                <h3 className={styles.emptyTitle}>Your locker is empty</h3>
                <p className={styles.emptySubtitle}>
                  Looks like you haven&apos;t added any jerseys or track pants yet.
                </p>
                <Link
                  href="/products"
                  className={styles.exploreBtn}
                  onClick={closeDrawer}
                >
                  Explore Kits & Jerseys
                  <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <>
                {/* Single Scrollable Body: Progress -> Cart Items -> Nudge -> Coupons -> Compact Upsells */}
                <div ref={bodyRef} className={styles.drawerBody}>
                  {unifiedProgress.visible && (
                    <div className={styles.shippingBarContainer}>
                      <div className={styles.shippingText}>
                        {unifiedProgress.unlocked ? (
                          <>
                            <CheckCircle2 size={16} className={styles.shippingUnlocked} />
                            <span className={styles.shippingUnlocked}>
                              {unifiedProgress.message}
                            </span>
                          </>
                        ) : (
                          <>
                            {unifiedProgress.iconType === 'buy_x_get_specific_free' ? (
                              <Gift size={16} className={styles.shippingHighlight} />
                            ) : unifiedProgress.iconType === 'threshold_percentage' ? (
                              <Tag size={16} className={styles.shippingHighlight} />
                            ) : unifiedProgress.iconType === 'buy_x_get_cheapest_free' || unifiedProgress.iconType === 'pack' ? (
                              <Zap size={16} className={styles.shippingHighlight} />
                            ) : (
                              <Truck size={16} className={styles.shippingHighlight} />
                            )}
                            <span>{unifiedProgress.message}</span>
                          </>
                        )}
                      </div>
                      <div className={styles.progressBarTrack}>
                        <div
                          className={`${styles.progressBarFill} ${
                            unifiedProgress.unlocked ? styles.progressBarFillUnlocked : ''
                          }`}
                          style={{ width: `${unifiedProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className={styles.itemsList}>
                  {items.map((item) => {
                    const itemCover = getPublicUrl(item.image) || '/product-1.png';
                    const isMaxStockReached =
                      item.maxStock > 0 && item.quantity >= item.maxStock;

                    // Ensure the current size is always in the pill list
                    const sizes = DEFAULT_SIZES.includes(item.size)
                      ? DEFAULT_SIZES
                      : [item.size, ...DEFAULT_SIZES];

                    return (
                      <div
                        key={`${item.product_id}::${item.size}${item.is_free_gift ? '::gift' : ''}`}
                        className={styles.cartItem}
                      >
                        <div className={styles.itemImageWrap}>
                          <img
                            src={itemCover}
                            alt={item.name}
                            className={styles.itemImage}
                          />
                        </div>

                        <div className={styles.itemDetails}>
                          <div className={styles.itemTop}>
                            <Link
                              href={`/product/${item.slug}`}
                              className={styles.itemName}
                              onClick={closeDrawer}
                            >
                              {item.name}
                            </Link>
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() => removeItem(item.product_id, item.size, item.is_free_gift)}
                              aria-label={`Remove ${item.name} size ${item.size}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          {/* Inline Size-Swapping Pill Selector */}
                          {FEATURE_FLAGS.CART_UPSELLS ? (
                            <div className={styles.sizeSwapSection}>
                              <div className={styles.sizeLabel}>Size: {item.size}</div>
                              <div className={styles.sizePillRow}>
                                {sizes.map((s) => {
                                  const isSelected = s === item.size;
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      className={`${styles.sizePill} ${
                                        isSelected ? styles.sizePillActive : ''
                                      }`}
                                      onClick={() => swapSize(item.product_id, item.size, s, item.is_free_gift)}
                                      title={`Swap to size ${s}`}
                                    >
                                      {s}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className={styles.sizeSwapSection}>
                              <div className={styles.sizeLabel}>Size: {item.size}</div>
                            </div>
                          )}

                          {/* Quantity Controls & Line Total */}
                          <div className={styles.itemBottom}>
                            <div className={styles.quantityControl}>
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() =>
                                  updateQuantity(
                                    item.product_id,
                                    item.size,
                                    item.quantity - 1,
                                    item.is_free_gift,
                                  )
                                }
                                aria-label="Decrease quantity"
                              >
                                <Minus size={14} />
                              </button>
                              <span className={styles.qtyNumber}>
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() =>
                                  updateQuantity(
                                    item.product_id,
                                    item.size,
                                    item.quantity + 1,
                                    item.is_free_gift,
                                  )
                                }
                                disabled={isMaxStockReached || Boolean(item.is_free_gift)}
                                title={item.is_free_gift ? 'Promotional gift is limited to 1 per order' : undefined}
                                aria-label="Increase quantity"
                              >
                                <Plus size={14} />
                              </button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {(item.is_free_gift || promoProgress.discountedItemKeys.includes(`${item.product_id}::${item.size}`)) && (
                                <span style={{ fontSize: '0.5625rem', fontWeight: 800, padding: '2px 6px', background: 'rgba(22, 163, 74, 0.15)', color: 'var(--success, #16a34a)', borderRadius: 4 }}>
                                  {item.is_free_gift ? 'FREE GIFT' : 'FREE ITEM'}
                                </span>
                              )}
                              <span className={styles.lineTotal} style={item.is_free_gift || item.price_paise === 0 ? { color: 'var(--success, #16a34a)', fontWeight: 700 } : undefined}>
                                {item.is_free_gift || item.price_paise === 0 ? 'FREE' : formatPaise(item.price_paise * item.quantity)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Conversion Nudge: Highlight UPI Discount/Savings vs COD Fees (Low RTO) */}
                {promoProgress.isNudgeVisible && (
                  <div className={styles.conversionNudgeCard}>
                    <div className={styles.nudgeIconWrap}>
                      <Zap size={18} />
                    </div>
                    <div className={styles.nudgeContent}>
                      <div className={styles.nudgeTitle}>
                        <span>{promoProgress.nudgeTitle}</span>
                        {promoProgress.nudgeBadge && (
                          <span className={styles.nudgeBadge}>
                            {promoProgress.nudgeBadge}
                          </span>
                        )}
                      </div>
                      <p className={styles.nudgeText}>
                        {promoProgress.nudgeText}
                      </p>
                    </div>
                  </div>
                )}

                {/* Quick-Add Cross-Sells */}
                {FEATURE_FLAGS.CART_UPSELLS && visibleUpsells.length > 0 && (
                  <div className={styles.upsellSection}>
                    <div className={styles.upsellHeading}>Complete Your Rotation</div>
                    <div className={styles.upsellList}>
                      {visibleUpsells.map((up) => {
                        const availableSizes =
                          up.inventory && up.inventory.length > 0
                            ? up.inventory.filter((i) => i.stock > 0).map((i) => i.size)
                            : Array.isArray(up.sizes) && up.sizes.length > 0
                              ? up.sizes
                              : DEFAULT_SIZES;
                        const chosenSize = upsellSizes[up.id] || availableSizes[0] || 'M';
                        const stockForSize =
                          up.inventory?.find((i) => i.size === chosenSize)?.stock ?? 10;
                        const unitPrice =
                          up.sale_price_paise != null && up.sale_price_paise < up.price_paise
                            ? up.sale_price_paise
                            : up.price_paise;
                        const cover =
                          getPublicUrl(
                            Array.isArray(up.images) && up.images.length > 0 ? up.images[0] : '',
                          ) || '/product-1.png';

                        return (
                          <div key={up.id} className={styles.upsellCard}>
                            <img src={cover} alt={up.name} className={styles.upsellImg} />
                            <div className={styles.upsellInfo}>
                              <div className={styles.upsellTitle}>{up.name}</div>
                              <div className={styles.upsellPrice}>{formatPaise(unitPrice)}</div>
                              <div className={styles.upsellControls}>
                                <select
                                  aria-label={`Size for ${up.name}`}
                                  className={styles.upsellSizeSelect}
                                  value={chosenSize}
                                  onChange={(e) =>
                                    setUpsellSizes((prev) => ({ ...prev, [up.id]: e.target.value }))
                                  }
                                >
                                  {availableSizes.map((sz) => (
                                    <option key={sz} value={sz}>
                                      {sz}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className={styles.upsellAddBtn}
                                  onClick={() =>
                                    addItem(
                                      {
                                        product_id: up.id,
                                        name: up.name,
                                        slug: up.slug,
                                        size: chosenSize,
                                        price_paise: unitPrice,
                                        image: Array.isArray(up.images) ? up.images[0] || '' : '',
                                        maxStock: stockForSize,
                                      },
                                      1,
                                      { openDrawer: true },
                                    )
                                  }
                                >
                                  + Add
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                  {/* Click-to-Apply Coupons (proactive eligibility + shortfall + auto-remove notice) */}
                  {FEATURE_FLAGS.CART_COUPONS && (activeCoupons.length > 0 || couponNotice) && (
                    <div className={styles.couponSection} style={{ padding: '12px 20px 10px', margin: 0 }}>
                      {activeCoupons.length > 0 && (
                        <>
                          <div className={styles.couponHeading}>
                            <Tag size={12} />
                            <span>Available Offers</span>
                          </div>
                          <div className={styles.couponChips}>
                            {activeCoupons.map((c) => {
                              const isApplied = appliedCoupon?.code === c.code;
                              const { shortfallPaise, shortfallItems, isEligible } = getCouponShortfall(
                                c,
                                totalPaise,
                                paidCount,
                              );
                              const shortfallText = formatShortfallMessage(shortfallPaise, shortfallItems);
                              const chipSavingsPaise = isEligible
                                ? calcCouponDiscountPaise(c, totalPaise, items)
                                : 0;
                              const chipPayablePaise = Math.max(0, totalPaise - chipSavingsPaise);

                              return (
                                <div
                                  key={c.id}
                                  className={`${styles.couponChip} ${
                                    isApplied
                                      ? styles.couponChipActive
                                      : !isEligible
                                        ? styles.couponChipDisabled
                                        : ''
                                  }`}
                                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'space-between' }}>
                                    <span>
                                      <strong>{c.code}</strong> ({formatCouponOfferLabel(c)})
                                    </span>
                                    {isApplied ? (
                                      <button
                                        type="button"
                                        className={styles.couponRemoveBtn}
                                        onClick={() => {
                                          clearCoupon();
                                          clearCouponNotice();
                                          setCouponError('');
                                        }}
                                      >
                                        Remove
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className={styles.couponApplyBtn}
                                        disabled={!isEligible}
                                        onClick={() => handleApplyCouponChip(c)}
                                      >
                                        Apply
                                      </button>
                                    )}
                                  </div>
                                  {!isApplied && isEligible && chipSavingsPaise > 0 && (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        color: 'var(--success, #059669)',
                                      }}
                                    >
                                      Save {formatPaise(chipSavingsPaise)} → Pay {formatPaise(chipPayablePaise)}
                                    </span>
                                  )}
                                  {!isApplied && !isEligible && shortfallText && (
                                    <span className={styles.couponShortfall}>
                                      Add {shortfallText} to unlock
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {couponNotice && (
                        <div className={styles.couponNotice} role="status">
                          {couponNotice}
                        </div>
                      )}
                      {couponError && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--error, #dc2626)', marginTop: 4 }}>
                          {couponError}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Pinned Compact Footer: Subtotal + Checkout Action */}
                <div className={styles.footer}>

                  <div className={styles.subtotalRow}>
                    <span className={styles.subtotalLabel}>Subtotal</span>
                    <span className={styles.subtotalValue}>
                      {couponDiscountPaise + effectiveAutoDiscountPaise > 0 ? (
                        <>
                          <span className={styles.strikePrice}>{formatPaise(totalPaise)}</span>
                          <span>
                            {formatPaise(Math.max(0, totalPaise - couponDiscountPaise - effectiveAutoDiscountPaise))}
                          </span>
                        </>
                      ) : (
                        formatPaise(totalPaise)
                      )}
                    </span>
                  </div>

                  {couponDiscountPaise > 0 && appliedCoupon && (
                    <div className={styles.subtotalRow} style={{ color: 'var(--success, #16a34a)' }}>
                      <span className={styles.subtotalLabel}>Coupon ({appliedCoupon.code})</span>
                      <span className={styles.subtotalValue} style={{ color: 'var(--success, #16a34a)', fontWeight: 700 }}>
                        − {formatPaise(couponDiscountPaise)}
                      </span>
                    </div>
                  )}

                  {effectiveAutoDiscountPaise > 0 && (
                    <div className={styles.subtotalRow} style={{ color: 'var(--success, #16a34a)' }}>
                      <span className={styles.subtotalLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.5625rem', padding: '2px 6px', background: 'rgba(22, 163, 74, 0.12)', color: 'var(--success, #16a34a)', borderRadius: 4, fontWeight: 700 }}>
                          {promoProgress.rewardBadge || 'AUTO OFFER'}
                        </span>
                        Reward Discount
                      </span>
                      <span className={styles.subtotalValue} style={{ color: 'var(--success, #16a34a)', fontWeight: 700 }}>
                        − {formatPaise(effectiveAutoDiscountPaise)}
                      </span>
                    </div>
                  )}

                  <div className={styles.shippingEstimateRow}>
                    <span>Shipping</span>
                    <span>
                      {promoProgress.hasFreeShipping ? (
                        <span className={styles.freeBadge}>FREE</span>
                      ) : promoProgress.thresholdPaise > 0 ? (
                        `${formatPaise(shippingSettings.default_shipping_charge_paise)} (or FREE over ${formatPaise(promoProgress.thresholdPaise)})`
                      ) : (
                        formatPaise(shippingSettings.default_shipping_charge_paise)
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={styles.checkoutBtn}
                    onClick={handleCheckoutClick}
                  >
                    <span>PROCEED TO CHECKOUT</span>
                    <ArrowRight size={18} />
                  </button>

                  <Link
                    href="/cart"
                    className={styles.viewCartLink}
                    onClick={closeDrawer}
                  >
                    View detailed bag &amp; apply coupons
                  </Link>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

