'use client';

import { useEffect, useState, useMemo } from 'react';
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

interface ActiveCoupon {
  id: string;
  code: string;
  discount_percent: number;
  min_cart_paise?: number | null;
  max_discount_paise?: number | null;
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
    applyCoupon,
    clearCoupon,
  } = useCart();

  const [upsellProducts, setUpsellProducts] = useState<UpsellProduct[]>([]);
  const [upsellSizes, setUpsellSizes] = useState<Record<string, string>>({});
  const [activeCoupons, setActiveCoupons] = useState<ActiveCoupon[]>([]);
  const [couponError, setCouponError] = useState('');

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

  // Recompute applied coupon discount when totalPaise changes
  const couponDiscountPaise = useMemo(() => {
    if (!FEATURE_FLAGS.CART_COUPONS || !appliedCoupon || totalPaise <= 0) return 0;
    const match = activeCoupons.find((c) => c.code === appliedCoupon.code);
    if (match?.min_cart_paise && totalPaise < match.min_cart_paise) {
      return 0;
    }
    let disc = Math.round((totalPaise * appliedCoupon.discountPercent) / 100);
    if (match?.max_discount_paise && disc > match.max_discount_paise) {
      disc = match.max_discount_paise;
    }
    return Math.min(disc, totalPaise);
  }, [appliedCoupon, activeCoupons, totalPaise]);

  // Visible cross-sell recommendations (not already in cart, with stock > 0)
  const visibleUpsells = useMemo(() => {
    if (!FEATURE_FLAGS.CART_UPSELLS) return [];
    const inCartIds = new Set(items.map((i) => i.product_id));
    return upsellProducts
      .filter((p) => !inCartIds.has(p.id))
      .filter((p) => {
        if (!p.inventory || p.inventory.length === 0) return true;
        return p.inventory.some((inv) => inv.stock > 0);
      })
      .slice(0, 3);
  }, [upsellProducts, items]);

  // Single unified progress bar (Safeguard #2: never render two stacked progress bars)
  const unifiedProgress = useMemo(() => {
    const paidCount = items
      .filter((i) => !i.is_free_gift)
      .reduce((sum, i) => sum + i.quantity, 0);

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
  }, [items, promoProgress]);

  const handleApplyCouponChip = async (coupon: ActiveCoupon) => {
    setCouponError('');
    if (coupon.min_cart_paise && totalPaise < coupon.min_cart_paise) {
      setCouponError(`Add ${formatPaise(coupon.min_cart_paise - totalPaise)} more to use ${coupon.code}`);
      return;
    }
    const disc = Math.round((totalPaise * coupon.discount_percent) / 100);
    const capped = coupon.max_discount_paise ? Math.min(disc, coupon.max_discount_paise) : disc;
    applyCoupon({
      code: coupon.code,
      discountPaise: Math.min(capped, totalPaise),
      discountPercent: coupon.discount_percent,
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

            {/* Unified Promotional / Pack Progress Bar (single bar only) */}
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

                {/* Footer / Summary / Checkout Action */}
                <div className={styles.footer}>
                  {/* Click-to-Apply Coupons */}
                  {FEATURE_FLAGS.CART_COUPONS && activeCoupons.length > 0 && (
                    <div className={styles.couponSection}>
                      <div className={styles.couponHeading}>
                        <Tag size={12} />
                        <span>Available Offers</span>
                      </div>
                      <div className={styles.couponChips}>
                        {activeCoupons.map((c) => {
                          const isApplied = appliedCoupon?.code === c.code;
                          return (
                            <div
                              key={c.id}
                              className={`${styles.couponChip} ${
                                isApplied ? styles.couponChipActive : ''
                              }`}
                            >
                              <span>
                                <strong>{c.code}</strong> ({c.discount_percent}% OFF)
                              </span>
                              {isApplied ? (
                                <button
                                  type="button"
                                  className={styles.couponRemoveBtn}
                                  onClick={() => {
                                    clearCoupon();
                                    setCouponError('');
                                  }}
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.couponApplyBtn}
                                  onClick={() => handleApplyCouponChip(c)}
                                >
                                  Apply
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {couponError && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--error, #dc2626)', marginTop: 4 }}>
                          {couponError}
                        </p>
                      )}
                    </div>
                  )}

                  <div className={styles.subtotalRow}>
                    <span className={styles.subtotalLabel}>Subtotal</span>
                    <span className={styles.subtotalValue}>
                      {couponDiscountPaise > 0 ? (
                        <>
                          <span className={styles.strikePrice}>{formatPaise(totalPaise)}</span>
                          <span>{formatPaise(Math.max(0, totalPaise - couponDiscountPaise))}</span>
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

                  {promoProgress.autoDiscountPaise > 0 && (
                    <div className={styles.subtotalRow} style={{ color: 'var(--success, #16a34a)' }}>
                      <span className={styles.subtotalLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.5625rem', padding: '2px 6px', background: 'rgba(22, 163, 74, 0.12)', color: 'var(--success, #16a34a)', borderRadius: 4, fontWeight: 700 }}>
                          {promoProgress.rewardBadge || 'AUTO OFFER'}
                        </span>
                        Reward Discount
                      </span>
                      <span className={styles.subtotalValue} style={{ color: 'var(--success, #16a34a)', fontWeight: 700 }}>
                        − {formatPaise(promoProgress.autoDiscountPaise)}
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

