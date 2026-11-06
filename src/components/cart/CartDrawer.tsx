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

interface ShippingSettingsSummary {
  free_shipping_threshold_paise: number;
  default_shipping_charge_paise: number;
  cod_fee_paise: number;
  cod_enabled: boolean;
  promo_banner_enabled?: boolean;
  promo_goal_type?: 'amount' | 'item_count';
  promo_goal_threshold_paise?: number;
  promo_goal_item_count?: number;
  promo_progress_template?: string;
  promo_unlocked_text?: string;
  promo_nudge_enabled?: boolean;
  promo_nudge_title?: string;
  promo_nudge_badge?: string;
  promo_nudge_text?: string;
}

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
  } = useCart();

  const [shippingSettings, setShippingSettings] = useState<ShippingSettingsSummary>({
    free_shipping_threshold_paise: 99900, // ₹999 default fallback
    default_shipping_charge_paise: 9900,  // ₹99 default fallback
    cod_fee_paise: 5000,                 // ₹50 default fallback
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
  });

  // Fetch dynamic threshold and promo settings from shipping_settings on mount
  useEffect(() => {
    let active = true;
    async function loadSettings() {
      try {
        const res = await fetch('/api/shipping/quote');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data && active) {
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
            });
          }
        }
      } catch {
        // Fallback defaults preserved gracefully
      }
    }
    loadSettings();
    return () => {
      active = false;
    };
  }, []);

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

  // Dynamic promotional goal & shipping progress calculation
  const isItemCountGoal = shippingSettings.promo_goal_type === 'item_count';
  const targetGoalPaise = shippingSettings.promo_goal_threshold_paise ?? shippingSettings.free_shipping_threshold_paise;
  const targetItemCount = Math.max(1, shippingSettings.promo_goal_item_count || 2);

  const hasUnlockedGoal = isItemCountGoal
    ? totalItems >= targetItemCount
    : targetGoalPaise > 0 && totalPaise >= targetGoalPaise;

  const remainingPaise = Math.max(0, targetGoalPaise - totalPaise);
  const remainingItems = Math.max(0, targetItemCount - totalItems);

  const progressPercent = isItemCountGoal
    ? Math.min(100, Math.round((totalItems / targetItemCount) * 100))
    : targetGoalPaise > 0
    ? Math.min(100, Math.round((totalPaise / targetGoalPaise) * 100))
    : 100;

  const threshold = shippingSettings.free_shipping_threshold_paise;
  const hasFreeShipping = threshold > 0 && totalPaise >= threshold;

  // Format dynamic copy for the progress banner
  const inProgressMessage = (
    shippingSettings.promo_progress_template || 'Add {remaining} more to unlock FREE SHIPPING'
  )
    .replace(/\{remaining\}/g, formatPaise(remainingPaise))
    .replace(/\{remaining_items\}/g, `${remainingItems} ${remainingItems === 1 ? 'item' : 'items'}`)
    .replace(/\{item_count\}/g, String(targetItemCount))
    .replace(/\{threshold\}/g, formatPaise(targetGoalPaise));

  const unlockedMessage =
    shippingSettings.promo_unlocked_text || 'You unlocked FREE Standard Shipping!';

  // Format dynamic copy for conversion nudge
  const codFeeFormatted = formatPaise(shippingSettings.cod_fee_paise);
  const nudgeTitle = (
    shippingSettings.promo_nudge_title || 'Pay with UPI & Save {cod_fee}'
  ).replace(/\{cod_fee\}/g, codFeeFormatted);
  const nudgeText = (
    shippingSettings.promo_nudge_text ||
    'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.'
  ).replace(/\{cod_fee\}/g, codFeeFormatted);

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
            {items.length > 0 && shippingSettings.promo_banner_enabled !== false && (
              <div className={styles.shippingBarContainer}>
                <div className={styles.shippingText}>
                  {hasUnlockedGoal ? (
                    <>
                      <CheckCircle2 size={16} className={styles.shippingUnlocked} />
                      <span className={styles.shippingUnlocked}>
                        {unlockedMessage}
                      </span>
                    </>
                  ) : (
                    <>
                      <Truck size={16} className={styles.shippingHighlight} />
                      <span>{inProgressMessage}</span>
                    </>
                  )}
                </div>
                <div className={styles.progressBarTrack}>
                  <div
                    className={`${styles.progressBarFill} ${
                      hasUnlockedGoal ? styles.progressBarFillUnlocked : ''
                    }`}
                    style={{ width: `${progressPercent}%` }}
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

                            <span className={styles.lineTotal}>
                              {formatPaise(item.price_paise * item.quantity)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Conversion Nudge: Highlight UPI Discount/Savings vs COD Fees (Low RTO) */}
                {shippingSettings.promo_nudge_enabled !== false && (
                  <div className={styles.conversionNudgeCard}>
                    <div className={styles.nudgeIconWrap}>
                      <Zap size={18} />
                    </div>
                    <div className={styles.nudgeContent}>
                      <div className={styles.nudgeTitle}>
                        <span>{nudgeTitle}</span>
                        {shippingSettings.promo_nudge_badge && (
                          <span className={styles.nudgeBadge}>
                            {shippingSettings.promo_nudge_badge}
                          </span>
                        )}
                      </div>
                      <p className={styles.nudgeText}>
                        {nudgeText}
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

                  <div className={styles.shippingEstimateRow}>
                    <span>Shipping</span>
                    <span>
                      {hasFreeShipping ? (
                        <span className={styles.freeBadge}>FREE</span>
                      ) : (
                        `${formatPaise(shippingSettings.default_shipping_charge_paise)} (or FREE over ${formatPaise(threshold)})`
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

