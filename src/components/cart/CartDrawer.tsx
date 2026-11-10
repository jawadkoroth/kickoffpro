'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useCart } from '@/lib/cart';
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
} from 'lucide-react';
import styles from './CartDrawer.module.css';

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

export default function CartDrawer() {
  const router = useRouter();
  const {
    items,
    isDrawerOpen,
    closeDrawer,
    removeItem,
    updateQuantity,
    swapSize,
    totalItems,
    totalPaise,
    shippingSettings,
    promoProgress,
  } = useCart();

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
    router.push('/checkout');
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

            {/* Dynamic Promotional Progress Bar */}
            {items.length > 0 && promoProgress.isBannerVisible && (
              <div className={styles.shippingBarContainer}>
                <div className={styles.shippingText}>
                  {promoProgress.hasUnlockedGoal ? (
                    <>
                      <CheckCircle2 size={16} className={styles.shippingUnlocked} />
                      <span className={styles.shippingUnlocked}>
                        {promoProgress.unlockedMessage}
                      </span>
                    </>
                  ) : (
                    <>
                      <Truck size={16} className={styles.shippingHighlight} />
                      <span>{promoProgress.inProgressMessage}</span>
                    </>
                  )}
                </div>
                <div className={styles.progressBarTrack}>
                  <div
                    className={`${styles.progressBarFill} ${
                      promoProgress.hasUnlockedGoal ? styles.progressBarFillUnlocked : ''
                    }`}
                    style={{ width: `${promoProgress.goalProgressPercent}%` }}
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
                        key={`${item.product_id}::${item.size}`}
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
                              onClick={() => removeItem(item.product_id, item.size)}
                              aria-label={`Remove ${item.name} size ${item.size}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          {/* Inline Size-Swapping Pill Selector */}
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
                                    onClick={() => swapSize(item.product_id, item.size, s)}
                                    title={`Swap to size ${s}`}
                                  >
                                    {s}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

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
                                  )
                                }
                                disabled={isMaxStockReached}
                                aria-label="Increase quantity"
                              >
                                <Plus size={14} />
                              </button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {promoProgress.discountedItemKeys.includes(`${item.product_id}::${item.size}`) && (
                                <span style={{ fontSize: '0.5625rem', fontWeight: 800, padding: '2px 6px', background: 'rgba(22, 163, 74, 0.15)', color: 'var(--success, #16a34a)', borderRadius: 4 }}>
                                  FREE ITEM
                                </span>
                              )}
                              <span className={styles.lineTotal}>
                                {formatPaise(item.price_paise * item.quantity)}
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

                {/* Footer / Summary / Checkout Action */}
                <div className={styles.footer}>
                  <div className={styles.subtotalRow}>
                    <span className={styles.subtotalLabel}>Subtotal</span>
                    <span className={styles.subtotalValue}>
                      {formatPaise(totalPaise)}
                    </span>
                  </div>

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
                      ) : (
                        `${formatPaise(shippingSettings.default_shipping_charge_paise)} (or FREE over ${formatPaise(promoProgress.thresholdPaise)})`
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

