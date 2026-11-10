'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart, computePromoProgress, type CartValidationResult } from '@/lib/cart';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import { Truck, CheckCircle2 } from 'lucide-react';
import styles from './page.module.css';

/**
 * Cart page.
 *
 * On mount, re-validates the cart against live inventory by POSTing
 * the current line items to `/api/cart/validate`. The provider then
 * removes inactive products outright and clamps quantities to the
 * server-reported `maxStock`. If the route fails for any reason
 * (network, 5xx, parse error) we keep the cart fully usable on the
 * snapshot and surface a soft, non-blocking warning — checkout will
 * revalidate again before the order POST, and the database remains
 * the final inventory gate.
 */
const COUPON_STORAGE_KEY = 'kickoffpro_coupon_code';

export default function CartPage() {
  const router = useRouter();
  const {
    items,
    removeItem,
    updateQuantity,
    totalPaise,
    totalItems,
    applyValidation,
    shippingSettings,
    promoProgress,
  } = useCart();

  // Inline coupon state. Applied coupons persist in localStorage so
  // the code survives a page reload within the same session and is
  // forwarded to /checkout via the `coupon` query param.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string>('');
  const [discountPaise, setDiscountPaise] = useState(0);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [couponMinCartPaise, setCouponMinCartPaise] = useState<number | null>(null);

  // Shipping + COD estimate. Derived from /api/shipping/quote with
  // paymentMethod=cod so we get BOTH shippingPaise (same in either
  // flow) and codFeePaise in a single round trip. COD fee is shown
  // as an informational “available at checkout” line, not added to
  // the cart total — payment method is picked on /checkout.
  const [pricingQuote, setPricingQuote] = useState<{
    shippingPaise: number;
    codFeePaise: number;
    codEnabled: boolean;
    freeShippingThresholdPaise?: number;
    codFeePaiseSetting?: number;
  } | null>(null);

  // `isValidating` starts true whenever the cart has anything in it,
  // so the very first paint after mount has the checkout button
  // disabled — closing the race window where a fast tapper on a slow
  // mobile network could click PROCEED before the validate effect has
  // even scheduled. The effect flips this back to false on completion.
  const [isValidating, setIsValidating] = useState(
    () => items.length > 0,
  );
  const [adjusted, setAdjusted] = useState<{
    removed: string[];
    clamped: string[];
  } | null>(null);
  const [softWarning, setSoftWarning] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isRouting, setIsRouting] = useState(false);

  // The current in-flight validation promise (if any). handleCheckout
  // ALWAYS awaits this before navigating — so even if the user taps
  // the button before the effect's promise has begun, the click path
  // resolves on the same outcome the UI sees. validationOkRef tracks
  // the outcome of the most recent attempt: true means we have fresh
  // server-confirmed stock data, false means it failed (network / 5xx)
  // and we must NOT navigate.
  const validationPromiseRef = useRef<Promise<void> | null>(null);
  const validationOkRef = useRef<boolean>(false);

  // True when any line in the cart is currently unsellable
  // (maxStock <= 0). Belt-and-braces: applyValidation already drops
  // these lines, but a stale localStorage entry written before this
  // build could still surface a maxStock=0 row that escaped the
  // server round-trip (e.g. validate request failed). The checkout
  // button is gated on this so the user can never proceed with a
  // ghost item, even if the validate fetch has not landed yet.
  const cartInvalid = useMemo(
    () => items.some(line => line.maxStock <= 0),
    [items],
  );

  // Sticky flag so we can show the “all your items became unavailable”
  // empty-state copy after applyValidation has just emptied the cart.
  // Kept across the items.length === 0 early-return below.
  const [allRemoved, setAllRemoved] = useState(false);

  // Revalidate exactly once per mount, only after the provider has
  // hydrated from localStorage and there is something to check.
  const validatedRef = useRef(false);

  useEffect(() => {
    if (validatedRef.current) return;
    if (items.length === 0) return;
    validatedRef.current = true;

    let cancelled = false;
    setIsValidating(true);
    validationOkRef.current = false;

    const initialCount = items.length;
    const promise = (async () => {
      try {
        const res = await fetch('/api/cart/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map(i => ({
              product_id: i.product_id,
              size: i.size,
              quantity: i.quantity,
            })),
          }),
        });

        if (!res.ok) throw new Error(`validate ${res.status}`);
        const data = (await res.json()) as CartValidationResult;
        if (cancelled) return;

        const summary = applyValidation(data);
        if (
          summary.removedItems.length > 0 ||
          summary.clampedItems.length > 0
        ) {
          setAdjusted({
            removed: summary.removedItems.map(
              i => `${i.name} (Size ${i.size})`,
            ),
            clamped: summary.clampedItems.map(
              i => `${i.name} (Size ${i.size}) → ${i.quantity}`,
            ),
          });
        }
        // If the cart had items going in and every single line was
        // dropped, surface the explicit empty-state copy. We compare
        // against `initialCount` (captured before applyValidation ran)
        // because by the time `summary` resolves the local `items`
        // closure is stale.
        if (
          summary.removedItems.length === initialCount &&
          summary.clampedItems.length === 0 &&
          summary.removedItems.length > 0
        ) {
          setAllRemoved(true);
        }
        validationOkRef.current = true;
      } catch (err) {
        if (cancelled) return;
        console.error('[CART_VALIDATE_FAILED]', err);
        setSoftWarning(true);
        validationOkRef.current = false;
      } finally {
        if (!cancelled) setIsValidating(false);
      }
    })();
    validationPromiseRef.current = promise;

    return () => {
      cancelled = true;
    };
    // retryCount is included so the user can explicitly re-trigger
    // validation after a network failure without a full page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // Stable, ordered keys for memoized list rendering.
  const renderedItems = useMemo(() => items, [items]);

  // Post-discount subtotal drives the shipping quote and the displayed
  // total. When a manual coupon is active, it takes priority and overrides
  // auto-applied cart drawer rewards (mutual exclusivity).
  const isManualCouponActive = Boolean(appliedCode && discountPaise > 0);
  const effectiveDiscountPaise = isManualCouponActive
    ? Math.min(discountPaise, totalPaise)
    : Math.min(promoProgress.autoDiscountPaise, totalPaise);
  const postDiscountSubtotal = Math.max(0, totalPaise - effectiveDiscountPaise);

  // Hydrate persisted coupon once the cart is known and non-empty.
  // Deferred until items.length > 0 so we never preflight a coupon
  // against an empty cart (min_cart would always reject).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (items.length === 0) return;
    if (appliedCode) return;
    try {
      const saved = window.localStorage.getItem(COUPON_STORAGE_KEY);
      if (saved && saved.trim()) {
        setCouponInput(saved);
        void applyCouponInternal(saved, totalPaise);
      }
    } catch {
      // Non-fatal — localStorage may be disabled.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Re-validate the applied coupon whenever the subtotal changes
  // (quantity edit, line removal). Server is the single source of
  // truth for min_cart, expiry, and max_discount cap.
  useEffect(() => {
    if (!appliedCode) return;
    if (totalPaise <= 0) {
      setDiscountPaise(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await validateCoupon(appliedCode, totalPaise);
      if (cancelled) return;
      if (res.ok) {
        setDiscountPaise(res.discountPaise);
        setCouponError('');
        setCouponMinCartPaise(null);
      } else {
        setDiscountPaise(0);
        setCouponError(res.message);
        setCouponMinCartPaise(res.minCartPaise ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCode, totalPaise]);

  // Shipping + COD fee estimate for the breakdown. Fetched with
  // paymentMethod=cod so we get both fields; shippingPaise is
  // identical in either method.
  useEffect(() => {
    if (items.length === 0) {
      setPricingQuote(null);
      return;
    }
    let cancelled = false;
    fetch('/api/shipping/quote', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtotalPaise: postDiscountSubtotal,
        paymentMethod: 'cod',
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success) return;
        setPricingQuote({
          shippingPaise: data.shippingPaise ?? 0,
          codFeePaise: data.codFeePaise ?? 0,
          codEnabled: data.codEnabled !== false,
          freeShippingThresholdPaise: data.freeShippingThresholdPaise ?? 99900,
          codFeePaiseSetting: data.codFeePaiseSetting ?? 5000,
        });
      })
      .catch(() => {
        /* non-fatal — display falls back gracefully */
      });
    return () => {
      cancelled = true;
    };
  }, [postDiscountSubtotal, items.length]);

  async function validateCoupon(
    code: string,
    subtotal: number,
  ): Promise<
    | { ok: true; discountPaise: number }
    | { ok: false; message: string; minCartPaise?: number }
  > {
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          subtotalPaise: subtotal,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        return { ok: true, discountPaise: Number(data.discount_paise) || 0 };
      }
      return {
        ok: false,
        message: data?.error || 'Coupon could not be applied.',
        minCartPaise:
          typeof data?.details?.minCartPaise === 'number'
            ? data.details.minCartPaise
            : undefined,
      };
    } catch {
      return { ok: false, message: 'Network error. Please try again.' };
    }
  }

  async function applyCouponInternal(code: string, subtotal: number) {
    setCouponLoading(true);
    setCouponError('');
    const res = await validateCoupon(code, subtotal);
    if (res.ok) {
      setAppliedCode(code.toUpperCase());
      setDiscountPaise(res.discountPaise);
      setCouponMinCartPaise(null);
      try {
        window.localStorage.setItem(COUPON_STORAGE_KEY, code.toUpperCase());
      } catch {
        /* ignore */
      }
    } else {
      setAppliedCode('');
      setDiscountPaise(0);
      setCouponError(res.message);
      setCouponMinCartPaise(res.minCartPaise ?? null);
      try {
        window.localStorage.removeItem(COUPON_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    setCouponLoading(false);
  }

  async function handleApplyCoupon() {
    const code = couponInput.toUpperCase().trim();
    if (!code) {
      setCouponError('Enter a coupon code.');
      return;
    }
    if (totalPaise <= 0) {
      setCouponError('Your cart is empty.');
      return;
    }
    await applyCouponInternal(code, totalPaise);
  }

  function handleRemoveCoupon() {
    setAppliedCode('');
    setDiscountPaise(0);
    setCouponInput('');
    setCouponError('');
    setCouponMinCartPaise(null);
    try {
      window.localStorage.removeItem(COUPON_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          {allRemoved && (
            <div
              role="status"
              className={`${styles.banner} ${styles.bannerWarn}`}
              style={{ maxWidth: 460, marginBottom: 'var(--space-5)' }}
            >
              <p className={styles.bannerTitle}>
                Items in your cart became unavailable and were removed.
              </p>
            </div>
          )}
          <h2 className={styles.emptyTitle}>Your cart is empty</h2>
          <p className={styles.emptyDesc}>
            {allRemoved
              ? 'Browse the collection to add fresh picks.'
              : 'Discover the collection.'}
          </p>
          <Link
            href="/products"
            className="btn btn-primary"
            style={{ maxWidth: '260px' }}
          >
            BROWSE PRODUCTS
          </Link>
        </div>
      </div>
    );
  }

  async function handleCheckout() {
    if (isRouting) return;
    if (cartInvalid) return;

    // Always wait for the in-flight validation to settle before
    // routing. Mobile users on slow networks frequently tap the
    // button before the validate fetch has finished; without this
    // await they’d hit /checkout with a stale snapshot, where the
    // submit-time revalidation throws and the UX dies on a generic
    // “verification failed”. We block here instead.
    setIsRouting(true);
    try {
      if (validationPromiseRef.current) {
        await validationPromiseRef.current;
      }
      // After the await, items / cartInvalid may have updated; the
      // cartInvalid memo will re-evaluate on the next render but the
      // local closure is stale, so re-read both flags via refs.
      if (!validationOkRef.current) {
        // Validation failed (network / 5xx). Surface the warning
        // so the user sees the retry option, but do NOT navigate.
        setSoftWarning(true);
        return;
      }
      // Re-pull the latest items synchronously: applyValidation may
      // have just removed lines or clamped quantities.
      const currentItems = items;
      if (currentItems.length === 0) return;
      if (currentItems.some(l => l.maxStock <= 0)) return;

      // Cart-driven checkout — no `product_id`/`size` URL params.
      // The checkout page reads every line from useCart() and posts
      // them as items[] to /api/orders. URL params are reserved for
      // PDP "Buy Now" intent which routes a single line through the
      // same surface. Applied coupon is forwarded so the checkout
      // coupon effect re-validates against the summed subtotal.
      const params = new URLSearchParams();
      if (appliedCode) params.set('coupon', appliedCode);
      const qs = params.toString();
      router.push(qs ? `/checkout?${qs}` : '/checkout');
    } finally {
      setIsRouting(false);
    }
  }

  // Unified promotional goal & shipping progress calculation
  // When a manual coupon is active, calculate against postDiscountSubtotal; otherwise use shared promoProgress from useCart()
  const activeProgress = useMemo(() => {
    return isManualCouponActive
      ? computePromoProgress(shippingSettings, postDiscountSubtotal, totalItems, items)
      : promoProgress;
  }, [isManualCouponActive, shippingSettings, postDiscountSubtotal, totalItems, items, promoProgress]);

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.title}>
          Your Cart{' '}
          <span className={styles.count}>({items.length})</span>
        </h1>

        {/* Free Shipping Progress Tracker (mirrors Cart Drawer & Checkout) */}
        {activeProgress.isBannerVisible && (
          <div className={styles.shippingBarContainer}>
            <div className={styles.shippingText}>
              {activeProgress.hasUnlockedGoal ? (
                <>
                  <CheckCircle2 size={16} className={styles.shippingUnlocked} />
                  <span className={styles.shippingUnlocked}>
                    {activeProgress.unlockedMessage}
                  </span>
                </>
              ) : (
                <>
                  <Truck size={16} className={styles.shippingHighlight} />
                  <span>{activeProgress.inProgressMessage}</span>
                </>
              )}
            </div>
            <div className={styles.progressBarTrack}>
              <div
                className={`${styles.progressBarFill} ${
                  activeProgress.hasUnlockedGoal ? styles.progressBarFillUnlocked : ''
                }`}
                style={{ width: `${activeProgress.goalProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Explicit, item-named feedback so the user knows exactly
            what changed and why — never the vague “we adjusted your
            cart” copy. Two separate banners because the actions
            (removed vs reduced) demand different mental models. */}
        {adjusted && adjusted.removed.length > 0 && (
          <div
            role="status"
            className={`${styles.banner} ${styles.bannerWarn}`}
          >
            <div>
              <p className={styles.bannerTitle}>
                Some items were removed because they are out of stock.
              </p>
              <ul className={styles.bannerList}>
                {adjusted.removed.map(label => (
                  <li key={`r-${label}`}>{label}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {adjusted && adjusted.clamped.length > 0 && (
          <div
            role="status"
            className={`${styles.banner} ${styles.bannerWarn}`}
          >
            <div>
              <p className={styles.bannerTitle}>
                Quantity updated due to limited stock.
              </p>
              <ul className={styles.bannerList}>
                {adjusted.clamped.map(label => (
                  <li key={`c-${label}`}>{label}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {softWarning && !adjusted && (
          <div
            role="status"
            className={`${styles.banner} ${styles.bannerSoft}`}
          >
            <span>
              Couldn&rsquo;t verify stock right now —{' '}
              <button
                type="button"
                onClick={() => {
                  setSoftWarning(false);
                  setIsValidating(true);
                  validationOkRef.current = false;
                  validatedRef.current = false;
                  setRetryCount(c => c + 1);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                tap to retry
              </button>.
            </span>
          </div>
        )}

        <div className={styles.items}>
          {renderedItems.map(item => {
            const atMax = item.maxStock > 0 && item.quantity >= item.maxStock;
            const showLow =
              item.maxStock > 0 && item.maxStock <= 5 && item.quantity === item.maxStock;
            return (
              <div
                key={`${item.product_id}-${item.size}`}
                className={styles.item}
              >
                <Link
                  href={`/product/${item.slug}`}
                  className={styles.itemImage}
                >
                  <img src={getPublicUrl(item.image)} alt={item.name} />
                </Link>
                <div className={styles.itemInfo}>
                  <Link
                    href={`/product/${item.slug}`}
                    className={styles.itemName}
                  >
                    {item.name}
                  </Link>
                  <p className={styles.itemSize}>Size: {item.size}</p>
                  <p className={styles.itemPrice}>
                    {formatPaise(item.price_paise)}
                  </p>
                  {showLow && (
                    <p className={styles.lowStockTag}>
                      Only {item.maxStock} left
                    </p>
                  )}
                  <div className={styles.itemActions}>
                    <div className={styles.qty}>
                      <button
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
                        −
                      </button>
                      <span className={styles.qtyVal}>{item.quantity}</span>
                      <button
                        className={styles.qtyBtn}
                        disabled={atMax}
                        onClick={() =>
                          updateQuantity(
                            item.product_id,
                            item.size,
                            item.quantity + 1,
                          )
                        }
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeItem(item.product_id, item.size)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Inline coupon application. Server-authoritative: the
            /api/coupons/validate route evaluates min_cart, max_discount,
            expiry, per_user_limit and usage_limit against the current
            subtotal and returns a final discount_paise that the UI
            renders verbatim. Zero client-side coupon math. */}
        <div className={styles.couponBox} aria-label="Coupon code">
          {appliedCode ? (
            <div className={styles.couponApplied}>
              <div>
                <span className={styles.couponAppliedLabel}>Applied</span>
                <span className={styles.couponAppliedCode}>{appliedCode}</span>
                <span className={styles.couponSavings}>
                  − {formatPaise(discountPaise)}
                </span>
              </div>
              <button
                type="button"
                className={styles.couponRemove}
                onClick={handleRemoveCoupon}
                aria-label="Remove coupon"
              >
                Remove
              </button>
            </div>
          ) : (
            <form
              className={styles.couponForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (!couponLoading) void handleApplyCoupon();
              }}
            >
              <input
                type="text"
                className={styles.couponInput}
                placeholder="Coupon code"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value.toUpperCase());
                  if (couponError) setCouponError('');
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                disabled={couponLoading}
              />
              <button
                type="submit"
                className={styles.couponApply}
                disabled={couponLoading || !couponInput.trim()}
              >
                {couponLoading ? '…' : 'Apply'}
              </button>
            </form>
          )}
          {couponError && (
            <p className={styles.couponHint}>
              {couponError}
              {couponMinCartPaise !== null &&
                ` Add ${formatPaise(Math.max(0, couponMinCartPaise - totalPaise))} more to unlock.`}
            </p>
          )}
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{formatPaise(totalPaise)}</span>
          </div>
          {isManualCouponActive ? (
            <>
              <div className={styles.summaryRow}>
                <span>Discount ({appliedCode})</span>
                <span className={styles.discountText}>
                  − {formatPaise(discountPaise)}
                </span>
              </div>
              {promoProgress.hasUnlockedGoal && promoProgress.autoDiscountPaise > 0 && (
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 8, padding: '6px 10px', background: 'var(--bg-input)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                  ℹ️ Coupon code <strong>{appliedCode}</strong> applied. Auto cart offers cannot be combined with coupon codes.
                </div>
              )}
            </>
          ) : effectiveDiscountPaise > 0 ? (
            <div className={styles.summaryRow}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.625rem', padding: '2px 6px', background: 'rgba(22, 163, 74, 0.12)', color: 'var(--success, #16a34a)', borderRadius: 4, fontWeight: 700 }}>
                  {promoProgress.rewardBadge || 'AUTO REWARD'}
                </span>
                Offer Discount
              </span>
              <span className={styles.discountText} style={{ color: 'var(--success, #16a34a)' }}>
                − {formatPaise(effectiveDiscountPaise)}
              </span>
            </div>
          ) : null}
          <div className={styles.summaryRow}>
            <span>Shipping</span>
            <span className={pricingQuote && pricingQuote.shippingPaise === 0 ? styles.freeText : undefined}>
              {!pricingQuote
                ? '…'
                : pricingQuote.shippingPaise === 0
                  ? 'FREE'
                  : formatPaise(pricingQuote.shippingPaise)}
            </span>
          </div>
          {pricingQuote && pricingQuote.codEnabled && pricingQuote.codFeePaise > 0 && (
            <div className={`${styles.summaryRow} ${styles.codHint}`}>
              <span>Cash on Delivery</span>
              <span>+ {formatPaise(pricingQuote.codFeePaise)} at checkout</span>
            </div>
          )}
          <div className={styles.summaryTotal}>
            <span>Total</span>
            <strong>
              {formatPaise(
                postDiscountSubtotal + (pricingQuote?.shippingPaise ?? 0),
              )}
            </strong>
          </div>
          {effectiveDiscountPaise > 0 && (
            <p className={styles.savings}>You save {formatPaise(effectiveDiscountPaise)}</p>
          )}
        </div>

        {cartInvalid && (
          <div
            role="alert"
            className={`${styles.banner} ${styles.bannerWarn}`}
            style={{ marginTop: 0 }}
          >
            <p className={styles.bannerTitle}>
              Please review your cart before proceeding.
            </p>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleCheckout}
          disabled={isValidating || isRouting || cartInvalid}
        >
          {isValidating || isRouting
            ? 'CHECKING STOCK…'
            : cartInvalid
              ? 'REVIEW CART TO CONTINUE'
              : `PROCEED TO CHECKOUT — ${formatPaise(totalPaise)}`}
        </button>
      </div>
    </div>
  );
}
