'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCart } from '@/lib/cart';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import { Truck, CheckCircle2, Zap } from 'lucide-react';
import {
  getOrCreateCheckoutEventId,
  getFbp,
  getFbc,
  getGclid,
  getUtmParameters,
  trackInitiateCheckout,
} from '@/lib/tracking/client';
import styles from './page.module.css';

/**
 * Checkout page (multi-line, since phase B3).
 *
 * Source-of-truth model:
 *
 *   - When `?product_id=X&size=Y` is present in the URL, this is a
 *     "Buy Now" intent from the PDP. Checkout submits ONLY that
 *     single line — even if the cart contains other items — and on
 *     success clears just that one line. Other cart lines are left
 *     intact for the user to come back to.
 *   - With no URL params, checkout submits EVERY line currently in
 *     the cart and clears the matching lines on success.
 *
 * Either path POSTs to `/api/orders` with an `items: [...]` array;
 * the server handler is identical in both shapes.
 *
 * The URL `coupon` param is still respected: a code carried over
 * from /cart or persisted in the PDP query string is preflighted
 * against the SUMMED subtotal here so the user never sees a
 * displayed discount that the order POST would silently drop.
 */

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items: cartItems, removeItem: removeCartItem } = useCart();

  // Race controls. AbortController for the in-flight `cart/validate`
  // request, and a token bumped on every submit so a slow-arriving
  // response never overrides a newer click.
  const validateAbortRef = useRef<AbortController | null>(null);
  const submitTokenRef = useRef(0);

  // Idempotency key for /api/orders.
  //
  // Generated lazily on the first submit attempt and PRESERVED
  // across transient retries (network errors, 5xx, payment-gateway
  // hiccups) so the server's UNIQUE(client_request_id) index turns
  // a retried POST into an idempotent replay returning the same
  // order_id instead of double-creating + double-decrementing stock.
  //
  // It is reset on:
  //   * successful order creation (online: after Razorpay handoff;
  //     COD: before the redirect to /order/[id]);
  //   * hard validation failures from the server (400) where the
  //     user must edit the form and resubmit — a different submit
  //     intent deserves a fresh idempotency window.
  const clientRequestIdRef = useRef<string | null>(null);

  // On unmount, abort any in-flight validate and bump the token so
  // any settled-but-not-yet-handled response is discarded.
  useEffect(() => {
    return () => {
      submitTokenRef.current++;
      validateAbortRef.current?.abort();
      validateAbortRef.current = null;
    };
  }, []);

  // URL params. `product_id` + `size` together signal a Buy Now
  // intent (PDP routed here after addItem). Absent params = full
  // cart checkout.
  const productId = searchParams.get('product_id') || '';
  const sizeParam = searchParams.get('size') || '';
  const isBuyNow = Boolean(productId && sizeParam);

  // Interactive coupon code state (synced with URL or manual entry on checkout)
  const [couponCode, setCouponCode] = useState(searchParams.get('coupon') || '');
  const [couponInput, setCouponInput] = useState(searchParams.get('coupon') || '');
  const [couponApplying, setCouponApplying] = useState(false);

  // Resolve the line set being submitted at this moment. For Buy
  // Now we filter the cart to the single matching (product_id, size)
  // pair; for cart checkout we use every line. The resolved array
  // drives the subtotal, the validate request, the order POST, and
  // the post-success cart-clear logic — single source of truth.
  const checkoutItems = useMemo(() => {
    if (isBuyNow) {
      const match = cartItems.find(
        (i) => i.product_id === productId && i.size === sizeParam,
      );
      return match ? [match] : [];
    }
    return cartItems;
  }, [isBuyNow, productId, sizeParam, cartItems]);

  // CAPI & Ad tracking event_id persistence (UUID)
  const trackingEventIdRef = useRef<string>('');
  const hasTrackedInitiateRef = useRef(false);

  useEffect(() => {
    if (!trackingEventIdRef.current) {
      trackingEventIdRef.current = getOrCreateCheckoutEventId();
    }
  }, []);

  useEffect(() => {
    if (checkoutItems.length > 0 && !hasTrackedInitiateRef.current) {
      hasTrackedInitiateRef.current = true;
      const subtotal = checkoutItems.reduce((s, i) => s + (i.price_paise * i.quantity), 0);
      trackInitiateCheckout({
        items: checkoutItems.map((i) => ({
          id: i.product_id,
          name: i.name,
          size: i.size,
          price: i.price_paise / 100,
          quantity: i.quantity,
        })),
        value: subtotal / 100,
        eventId: trackingEventIdRef.current,
      });
    }
  }, [checkoutItems]);

  // Server-authoritative coupon state. `discountPaise` is what
  // /api/coupons/validate returns for the CURRENT subtotal; it
  // already respects max_discount_paise, min_cart, expiry, and
  // per-user / global limits. `couponMessage` carries the reject
  // reason (if any) so the user sees *why* a code didn't apply.
  const [discountPaise, setDiscountPaise] = useState(0);
  const [couponMessage, setCouponMessage] = useState<string>('');
  const [couponOk, setCouponOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');
  const [orderError, setOrderError] = useState('');

  // Shipping settings sync with backend (mirrors Cart Drawer)
  const [shippingSettings, setShippingSettings] = useState({
    free_shipping_threshold_paise: 99900,
    default_shipping_charge_paise: 9900,
    cod_fee_paise: 5000,
    cod_enabled: true,
  });

  useEffect(() => {
    let active = true;
    fetch('/api/shipping/quote')
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data && active) {
          setShippingSettings({
            free_shipping_threshold_paise: Number(json.data.free_shipping_threshold_paise) || 99900,
            default_shipping_charge_paise: Number(json.data.default_shipping_charge_paise) || 9900,
            cod_fee_paise: Number(json.data.cod_fee_paise) || 5000,
            cod_enabled: json.data.cod_enabled !== false,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Auth state — non-null only for logged-in users.
  const [userId, setUserId] = useState<string | null>(null);

  // Saved addresses (logged-in users only).
  type SavedAddress = {
    id: string;
    label: string | null;
    full_name: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    is_default: boolean;
  };
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);

  // Shipping quote (refetched whenever subtotal or paymentMethod
  // changes). The server is still the final authority — this is a
  // display-only estimate so the user sees the real total before
  // clicking PLACE ORDER.
  const [quote, setQuote] = useState<{
    shippingPaise: number;
    codFeePaise: number;
    totalPaise: number;
    codAllowed: boolean;
    codEnabled: boolean;
    freeShippingThresholdPaise?: number;
    defaultShippingChargePaise?: number;
    codFeePaiseSetting?: number;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auth + saved addresses + profile prefill. Runs once on mount;
  // does NOT depend on cart contents (those are local-only and
  // already hydrated by the cart provider).
  useEffect(() => {
    let cancelled = false;
    async function fetchAuth() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (cancelled) return;

        setUserId(session.user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone, name, email')
          .eq('id', session.user.id)
          .single();

        if (cancelled) return;

        if (!profile?.phone) {
          router.replace('/profile/complete?next=/checkout');
          return;
        }

        if (profile.name) setName(profile.name);
        if (profile.phone) setPhone(profile.phone.replace('+91', ''));
        if (profile.email) setEmail(profile.email);

        // Pull saved addresses; RLS limits to this user.
        const { data: addrs } = await supabase
          .from('addresses')
          .select('id,label,full_name,phone,line1,line2,city,state,pincode,is_default')
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (addrs && addrs.length > 0) {
          const list = addrs as SavedAddress[];
          setSavedAddresses(list);
          const def = list.find((a) => a.is_default) ?? list[0];
          setSelectedSavedId(def.id);
          setLine1(def.line1);
          setLine2(def.line2 ?? '');
          setCity(def.city);
          setState(def.state);
          setPincode(def.pincode);
        }
      } catch (err) {
        console.error('[CHECKOUT_AUTH_LOAD]', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAuth();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-discount subtotal across every line being checked out.
  // Sale-aware via the price snapshot the cart already holds (cart
  // captures the displayed price at addItem time; the server
  // re-resolves per-line price authoritatively at /api/orders).
  const preDiscountSubtotal = useMemo(
    () => checkoutItems.reduce((s, i) => s + i.price_paise * i.quantity, 0),
    [checkoutItems],
  );
  const subtotalForQuote = Math.max(0, preDiscountSubtotal - discountPaise);

  // Server-authoritative coupon re-evaluation whenever the
  // subtotal changes. Uses /api/coupons/validate with subtotalPaise
  // so min_cart, max_discount, expiry, and usage limits are all
  // enforced for the *displayed* number.
  useEffect(() => {
    if (!couponCode) {
      setDiscountPaise(0);
      setCouponMessage('');
      setCouponOk(false);
      return;
    }
    if (preDiscountSubtotal <= 0) return;
    let cancelled = false;
    setCouponApplying(true);
    (async () => {
      try {
        const res = await fetch('/api/coupons/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: couponCode,
            subtotalPaise: preDiscountSubtotal,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setDiscountPaise(Number(data.discount_paise) || 0);
          setCouponOk(true);
          setCouponMessage('');
        } else {
          setDiscountPaise(0);
          setCouponOk(false);
          setCouponMessage(data.error || 'Coupon could not be applied.');
        }
      } catch {
        if (cancelled) return;
        setDiscountPaise(0);
        setCouponOk(false);
        // Silent on transport errors — orders API re-validates anyway.
      } finally {
        if (!cancelled) setCouponApplying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [couponCode, preDiscountSubtotal]);

  const handleApplyCoupon = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = couponInput.trim().toUpperCase();
    if (!trimmed) return;
    setCouponCode(trimmed);
  };

  const handleRemoveCoupon = () => {
    setCouponCode('');
    setCouponInput('');
    setDiscountPaise(0);
    setCouponOk(false);
    setCouponMessage('');
  };

  useEffect(() => {
    if (preDiscountSubtotal <= 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    fetch('/api/shipping/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtotalPaise: subtotalForQuote,
        paymentMethod,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success) {
          setQuote({
            shippingPaise: data.shippingPaise ?? 0,
            codFeePaise: data.codFeePaise ?? 0,
            totalPaise: data.totalPaise ?? subtotalForQuote,
            codAllowed: data.codAllowed !== false,
            codEnabled: data.codEnabled !== false,
            freeShippingThresholdPaise: data.freeShippingThresholdPaise ?? 99900,
            defaultShippingChargePaise: data.defaultShippingChargePaise ?? 9900,
            codFeePaiseSetting: data.codFeePaiseSetting ?? 5000,
          });
        }
      })
      .catch(() => { /* display falls back to subtotal */ })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preDiscountSubtotal, subtotalForQuote, paymentMethod]);

  // If the server tells us COD is disabled but the user has it
  // selected, flip back to online automatically. Prevents the
  // order POST from racing into a 400 for disallowed payment.
  useEffect(() => {
    if (quote && !quote.codEnabled && paymentMethod === 'cod') {
      setPaymentMethod('online');
    }
  }, [quote, paymentMethod]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <span className={styles.back}>← Back</span>
          <span className={styles.title}>Checkout</span>
          <span />
        </div>
        <div className={styles.content}>
          <div className="skeleton" style={{ width: '100%', height: '80px', borderRadius: '10px' }} />
        </div>
      </div>
    );
  }

  // Empty checkout. Two paths:
  //   - Buy Now URL but the matching cart line is missing (PDP
  //     skipped addItem, or the user manually crafted the URL).
  //   - Cart-driven checkout but the cart is empty.
  // In both cases the appropriate next step is to send the user
  // back to where they can pick something to buy.
  if (checkoutItems.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Home</Link>
          <span className={styles.title}>Checkout</span>
          <span />
        </div>
        <div className={styles.errorState}>
          <p>{isBuyNow ? 'Invalid checkout. Please go back and select a product.' : 'Your cart is empty.'}</p>
          <Link
            href={isBuyNow ? '/' : '/cart'}
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 'var(--space-4)', width: 'auto' }}
          >
            {isBuyNow ? '← Back to Shop' : '← Back to Cart'}
          </Link>
        </div>
      </div>
    );
  }

  const discountAmount = Math.min(discountPaise, preDiscountSubtotal);
  const subtotal = preDiscountSubtotal - discountAmount;
  const shippingPaise = quote?.shippingPaise ?? 0;
  const codFeePaise = quote?.codFeePaise ?? 0;
  const total = quote ? quote.totalPaise : subtotal;

  const threshold = quote?.freeShippingThresholdPaise ?? shippingSettings.free_shipping_threshold_paise;
  const hasFreeShipping = threshold > 0 && subtotalForQuote >= threshold;
  const remainingForFreeShipping = Math.max(0, threshold - subtotalForQuote);
  const progressPercent = threshold > 0 ? Math.min(100, Math.round((subtotalForQuote / threshold) * 100)) : 100;
  const codFeePaiseSetting = quote?.codFeePaiseSetting ?? shippingSettings.cod_fee_paise;

  const formatPrice = (paise: number) => formatPaise(paise);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) e.name = 'Name is required';
    if (!/^[6-9]\d{9}$/.test(phone)) e.phone = 'Enter a valid 10-digit phone number';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email';
    if (!line1.trim() || line1.trim().length < 5) e.line1 = 'Address is required';
    if (!city.trim()) e.city = 'City is required';
    if (!state.trim()) e.state = 'State is required';
    if (!/^\d{6}$/.test(pincode)) e.pincode = 'Enter a valid 6-digit pincode';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /**
   * Clear every line that was just submitted from the cart. Called
   * after a confirmed success path (COD pre-redirect, or Razorpay
   * handler post-verify). Pure local-state mutation — never throws.
   */
  function clearSubmittedLines(submitted: Array<{ product_id: string; size: string }>) {
    try {
      for (const line of submitted) {
        removeCartItem(line.product_id, line.size);
      }
    } catch (err) {
      console.error('[CART_CLEAR_AFTER_ORDER]', err);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    if (checkoutItems.length === 0) return;
    if (!validate()) return;
    setSubmitting(true);
    setOrderError('');

    // Snapshot the lines we're submitting NOW. Capturing here (not
    // inside the handler closure) protects against the user adding
    // or removing items between the click and the response.
    const submittedLines = checkoutItems.map((i) => ({
      product_id: i.product_id,
      size: i.size,
      quantity: i.quantity,
    }));

    // Final stock revalidation immediately before order POST.
    //
    // Same race controls as the single-line variant: cancel any
    // prior in-flight validate, bump the submit token, drop stale
    // responses. The validate route accepts the same items[] shape
    // we'll send to /api/orders.
    if (validateAbortRef.current) {
      validateAbortRef.current.abort();
    }
    const controller = new AbortController();
    validateAbortRef.current = controller;
    const myToken = ++submitTokenRef.current;

    type ValidateOutcome =
      | { ok: true }
      | { ok: false; reason: 'unavailable' | 'verify-failed' };
    let validateOutcome: ValidateOutcome = { ok: false, reason: 'verify-failed' };

    try {
      const validateRes = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: submittedLines }),
        signal: controller.signal,
      });
      if (myToken !== submitTokenRef.current) return;
      if (!validateRes.ok) {
        console.error('[CHECKOUT_VALIDATE_FAILED]', validateRes.status);
        validateOutcome = { ok: false, reason: 'verify-failed' };
      } else {
        const validateData = (await validateRes.json()) as {
          items: Array<{
            product_id: string;
            size: string;
            maxStock: number;
            clampedQuantity: number;
            removed: boolean;
          }>;
        };
        if (myToken !== submitTokenRef.current) return;
        const entries = validateData.items ?? [];
        const anyUnavailable = entries.some(
          (entry) => entry.removed || entry.maxStock < 1,
        );
        const anyClampedDown = submittedLines.some((line) => {
          const entry = entries.find(
            (e) => e.product_id === line.product_id && e.size === line.size,
          );
          return entry ? entry.clampedQuantity < line.quantity : true;
        });
        if (anyUnavailable || anyClampedDown) {
          validateOutcome = { ok: false, reason: 'unavailable' };
        } else if (entries.length === 0) {
          validateOutcome = { ok: false, reason: 'verify-failed' };
        } else {
          validateOutcome = { ok: true };
        }
      }
    } catch (err) {
      if (myToken !== submitTokenRef.current) return;
      if ((err as { name?: string })?.name === 'AbortError') return;
      console.error('[CHECKOUT_VALIDATE_ERROR]', err);
      validateOutcome = { ok: false, reason: 'verify-failed' };
    } finally {
      if (validateAbortRef.current === controller) {
        validateAbortRef.current = null;
      }
    }

    if (!validateOutcome.ok) {
      setOrderError(
        validateOutcome.reason === 'unavailable'
          ? 'Some items in your order are no longer available. Please review your cart.'
          : 'Unable to verify stock. Please try again.',
      );
      setSubmitting(false);
      return;
    }

    // Reuse the same client_request_id across retries within a
    // submit session so the server can dedupe via UNIQUE index.
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    }
    const clientRequestId = clientRequestIdRef.current;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: submittedLines,
          customer: { name: name.trim(), phone, email: email || undefined },
          shipping_address: {
            line1: line1.trim(),
            line2: line2.trim() || undefined,
            city: city.trim(),
            state: state.trim(),
            pincode,
          },
          payment_method: paymentMethod,
          coupon_code: couponCode || undefined,
          client_request_id: clientRequestId,
          tracking_event_id: trackingEventIdRef.current || undefined,
          fbp: getFbp() || undefined,
          fbc: getFbc() || undefined,
          gclid: getGclid() || undefined,
          ...getUtmParameters(),
        }),
      });

      const data = await res.json();

      if (!data.success) {
        console.error('[ORDER_FAILED]', data.error, data.details);
        if (res.status === 400) {
          clientRequestIdRef.current = null;
        }
        setOrderError(data.error || 'Failed to place order. Please try again.');
        setSubmitting(false);
        return;
      }

      // Persist to the address book if the user opted in (manual
      // mode + checkbox). Fire-and-forget: never blocks the order.
      if (userId && selectedSavedId === null && saveToBook) {
        const supabase = createClient();
        supabase
          .from('addresses')
          .insert({
            user_id: userId,
            label: null,
            full_name: name.trim(),
            phone,
            line1: line1.trim(),
            line2: line2.trim() || null,
            city: city.trim(),
            state: state.trim(),
            pincode,
            country: 'India',
          })
          .select('id')
          .single()
          .then(({ data: row, error }) => {
            if (error || !row) return;
            if (savedAddresses.length === 0) {
              supabase.rpc('set_default_address', { p_id: row.id }).then(() => { });
            }
          });
      }

      if (paymentMethod === 'online') {
        // Hand off to Razorpay; the cart is NOT cleared until
        // payment is verified inside the Razorpay handler. A user
        // who dismisses the modal or whose payment fails keeps
        // their cart intact for a retry.
        clientRequestIdRef.current = null;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('kickoffpro_checkout_email', email || '');
          window.sessionStorage.setItem('kickoffpro_checkout_phone', phone || '');
        }
        await openRazorpay(data, submittedLines);
      } else {
        // COD: order is "placed" the moment the row exists. Clear
        // every submitted line now, before navigation.
        clientRequestIdRef.current = null;
        clearSubmittedLines(submittedLines);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('kickoffpro_checkout_email', email || '');
          window.sessionStorage.setItem('kickoffpro_checkout_phone', phone || '');
        }
        const queryParams = new URLSearchParams();
        if (email) queryParams.set('email', email);
        if (phone) queryParams.set('phone', phone);
        if (trackingEventIdRef.current) queryParams.set('event_id', trackingEventIdRef.current);
        const queryStr = queryParams.toString();
        router.push(`/order/${data.order_id}${queryStr ? '?' + queryStr : ''}`);
      }
    } catch (err) {
      console.error('[ORDER_ERROR]', err);
      setOrderError('Network error. Please check your connection and try again.');
      setSubmitting(false);
    }
  }

  async function openRazorpay(
    orderData: {
      razorpay_order_id: string;
      amount: number;
      key_id: string;
      order_id: string;
      customer: { name: string; phone: string; email?: string };
    },
    submittedLines: Array<{ product_id: string; size: string }>,
  ) {
    if (!orderData.razorpay_order_id || !orderData.key_id) {
      console.error('[RAZORPAY_INIT] Missing order_id or key_id:', orderData);
      setOrderError('Payment could not be initialized. Please try COD or contact support.');
      setSubmitting(false);
      return;
    }

    try {
      if (!(window as unknown as { Razorpay: unknown }).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load payment SDK'));
          document.body.appendChild(script);
        });
      }
    } catch (err) {
      console.error('[RAZORPAY_SDK_LOAD]', err);
      setOrderError('Could not load payment gateway. Please try COD or check your internet connection.');
      setSubmitting(false);
      return;
    }

    const RazorpayClass = (window as unknown as { Razorpay: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;

    // Build a brief description for the Razorpay modal. Single-line
    // orders show product/size; multi-line orders show line count.
    const description =
      submittedLines.length === 1
        ? `${checkoutItems[0].name} — Size ${checkoutItems[0].size}`
        : `${submittedLines.length} items`;

    const rzp = new RazorpayClass({
      key: orderData.key_id,
      amount: orderData.amount,
      currency: 'INR',
      name: 'KickoffPro',
      description,
      order_id: orderData.razorpay_order_id,
      prefill: {
        name: orderData.customer.name,
        contact: orderData.customer.phone,
        email: orderData.customer.email || '',
      },
      theme: { color: '#1A1A1A' },
      handler: async function (response: { razorpay_payment_id: string; razorpay_signature: string }) {
        const queryParams = new URLSearchParams();
        if (orderData.customer.email) queryParams.set('email', orderData.customer.email);
        if (orderData.customer.phone) queryParams.set('phone', orderData.customer.phone);
        if (trackingEventIdRef.current) queryParams.set('event_id', trackingEventIdRef.current);

        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order_id: orderData.order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            // Verified: clear EVERY submitted line. Closure
            // captures `submittedLines` so a user adding new
            // items between submit and verify keeps those.
            clearSubmittedLines(submittedLines);
            const successQuery = new URLSearchParams(queryParams);
            const queryStr = successQuery.toString();
            router.push(`/order/${orderData.order_id}${queryStr ? '?' + queryStr : ''}`);
          } else {
            const failQuery = new URLSearchParams(queryParams);
            failQuery.set('payment', 'failed');
            router.push(`/order/${orderData.order_id}?${failQuery.toString()}`);
          }
        } catch {
          const failQuery = new URLSearchParams(queryParams);
          failQuery.set('payment', 'failed');
          router.push(`/order/${orderData.order_id}?${failQuery.toString()}`);
        }
      },
      modal: {
        ondismiss: function () {
          setSubmitting(false);
          const queryParams = new URLSearchParams();
          if (orderData.customer.email) queryParams.set('email', orderData.customer.email);
          if (orderData.customer.phone) queryParams.set('phone', orderData.customer.phone);
          const pendingQuery = new URLSearchParams(queryParams);
          pendingQuery.set('payment', 'pending');
          router.push(`/order/${orderData.order_id}?${pendingQuery.toString()}`);
        },
      },
    });

    rzp.open();
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => router.back()}>← Back</button>
        <span className={styles.title}>Checkout</span>
        <span />
      </div>

      <div className={styles.content}>
        {/* Error Banner */}
        {orderError && (
          <div className={styles.errorBanner}>
            <span>⚠</span>
            <span>{orderError}</span>
            <button onClick={() => setOrderError('')} className={styles.errorClose}>✕</button>
          </div>
        )}

        {/* Order Summary & Cart Synchronization */}
        <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
          {/* Free Shipping Progress Tracker (mirrors Cart Drawer) */}
          <div className={styles.shippingBarContainer}>
            <div className={styles.shippingText}>
              {hasFreeShipping ? (
                <>
                  <CheckCircle2 size={16} className={styles.shippingUnlocked} />
                  <span className={styles.shippingUnlocked}>
                    You unlocked FREE Standard Shipping!
                  </span>
                </>
              ) : (
                <>
                  <Truck size={16} className={styles.shippingHighlight} />
                  <span>
                    Add{' '}
                    <span className={styles.shippingHighlight}>
                      {formatPaise(remainingForFreeShipping)}
                    </span>{' '}
                    more to unlock <strong>FREE SHIPPING</strong>
                  </span>
                </>
              )}
            </div>
            <div className={styles.progressBarTrack}>
              <div
                className={`${styles.progressBarFill} ${
                  hasFreeShipping ? styles.progressBarFillUnlocked : ''
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Product Items Breakdown with Thumbnails & Sizes */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            {checkoutItems.map((line) => (
              <div
                key={`${line.product_id}::${line.size}`}
                className={styles.checkoutItemRow}
              >
                <div className={styles.itemThumbWrap}>
                  {line.image ? (
                    <img
                      src={getPublicUrl(line.image)}
                      alt={line.name}
                      className={styles.itemThumb}
                    />
                  ) : (
                    <div className={styles.itemThumbPlaceholder}>👕</div>
                  )}
                  <span className={styles.qtyBadge}>{line.quantity}</span>
                </div>
                <div className={styles.itemMeta}>
                  <span className={styles.itemName}>{line.name}</span>
                  <span className={styles.itemSubtext}>Size: {line.size}</span>
                </div>
                <span className={styles.itemPrice}>
                  {formatPaise(line.price_paise * line.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* Interactive Coupon Code Entry & Synchronization */}
          <div className={styles.couponSection}>
            {couponCode && couponOk ? (
              <div className={styles.couponAppliedBadge}>
                <div className={styles.couponAppliedLeft}>
                  <span className={styles.couponTagIcon}>🏷️</span>
                  <div>
                    <span className={styles.couponCodeText}>{couponCode}</span>
                    <span className={styles.couponSavingsText}>
                      Save {formatPaise(discountAmount)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.couponRemoveBtn}
                  onClick={handleRemoveCoupon}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className={styles.couponInputGroup}>
                <input
                  type="text"
                  className={styles.couponInputField}
                  placeholder="Enter coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplyCoupon();
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.couponApplyBtn}
                  disabled={!couponInput.trim() || couponApplying}
                  onClick={handleApplyCoupon}
                >
                  {couponApplying ? 'APPLYING…' : 'APPLY'}
                </button>
              </div>
            )}
            {couponCode && !couponOk && couponMessage && (
              <div className={styles.couponErrorText}>
                <span>⚠️ {couponMessage}</span>
              </div>
            )}
          </div>

          {/* Subtotal Breakdown */}
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{formatPaise(preDiscountSubtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className={styles.summaryRow}>
              <span>Discount{couponCode ? ` (${couponCode})` : ''}</span>
              <span className={styles.discountText}>− {formatPaise(discountAmount)}</span>
            </div>
          )}
          <div className={styles.summaryRow}>
            <span>Shipping</span>
            <span className={shippingPaise === 0 ? styles.freeShippingText : undefined}>
              {quoteLoading && !quote
                ? '…'
                : shippingPaise === 0
                ? 'FREE'
                : formatPaise(shippingPaise)}
            </span>
          </div>
          {paymentMethod === 'cod' && quote && !quote.codEnabled && (
            <div className={styles.summaryRow} style={{ color: 'var(--warning)' }}>
              <span>Cash on Delivery unavailable</span>
            </div>
          )}
          {codFeePaise > 0 && (
            <div
              className={`${styles.summaryRow} ${styles.codFeeRow}`}
              key={`cod-${codFeePaise}`}
            >
              <span>Cash on Delivery fee</span>
              <span>+ {formatPaise(codFeePaise)}</span>
            </div>
          )}
          <div className={styles.summaryTotal}>
            Total: <strong key={`total-${total}`} className={styles.totalAmount}>{formatPaise(total)}</strong>
          </div>
        </div>

        {/* Customer Details */}
        <div className={styles.formSection}>
          <label className="input-label">Your Details</label>
          <div className="input-group">
            <input className={`input-field ${errors.name ? 'input-error' : ''}`} placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} />
            {errors.name && <span className="input-error-text">{errors.name}</span>}
          </div>
          <div className="input-group">
            <input className={`input-field ${errors.phone ? 'input-error' : ''}`} placeholder="Phone Number" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" maxLength={10} />
            {errors.phone && <span className="input-error-text">{errors.phone}</span>}
          </div>
          <div className="input-group">
            <input className={`input-field ${errors.email ? 'input-error' : ''}`} placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} type="email" />
            {errors.email && <span className="input-error-text">{errors.email}</span>}
          </div>
        </div>

        {/* Shipping Address */}
        <div className={styles.formSection}>
          <label className="input-label">Shipping Address</label>

          {savedAddresses.length > 0 && selectedSavedId !== null && (
            <>
              <div className={styles.savedPicker} role="radiogroup" aria-label="Saved addresses">
                {savedAddresses.map(a => {
                  const active = a.id === selectedSavedId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`${styles.savedRow} ${active ? styles.savedRowActive : ''}`}
                      onClick={() => {
                        setSelectedSavedId(a.id);
                        setLine1(a.line1);
                        setLine2(a.line2 ?? '');
                        setCity(a.city);
                        setState(a.state);
                        setPincode(a.pincode);
                        setErrors({});
                      }}
                    >
                      <input
                        type="radio"
                        className={styles.savedRadio}
                        checked={active}
                        readOnly
                        tabIndex={-1}
                      />
                      <span className={styles.savedRowMeta}>
                        <span className={styles.savedRowName}>
                          {a.label || a.full_name}
                          {a.is_default && <span className={styles.defaultPill}>Default</span>}
                        </span>
                        <span className={styles.savedRowAddr}>
                          {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} — {a.pincode}
                        </span>
                      </span>
                      <span />
                    </button>
                  );
                })}
              </div>
              <div className={styles.usingBanner}>
                <span>Using saved address</span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setSelectedSavedId(null);
                    setLine1('');
                    setLine2('');
                    setCity('');
                    setState('');
                    setPincode('');
                    setErrors({});
                  }}
                >
                  Use a different address
                </button>
              </div>
            </>
          )}

          {savedAddresses.length > 0 && selectedSavedId === null && (
            <button
              type="button"
              className={styles.savedToggle}
              onClick={() => {
                const def = savedAddresses.find(a => a.is_default) ?? savedAddresses[0];
                if (!def) return;
                setSelectedSavedId(def.id);
                setLine1(def.line1);
                setLine2(def.line2 ?? '');
                setCity(def.city);
                setState(def.state);
                setPincode(def.pincode);
                setErrors({});
              }}
            >
              ← Use a saved address
            </button>
          )}

          <div className="input-group">
            <input className={`input-field ${errors.line1 ? 'input-error' : ''}`} placeholder="Address Line 1" value={line1} onChange={e => setLine1(e.target.value)} readOnly={selectedSavedId !== null} />
            {errors.line1 && <span className="input-error-text">{errors.line1}</span>}
          </div>
          <div className="input-group">
            <input className="input-field" placeholder="Address Line 2 (optional)" value={line2} onChange={e => setLine2(e.target.value)} readOnly={selectedSavedId !== null} />
          </div>
          <div className="input-row">
            <div className="input-group">
              <input className={`input-field ${errors.city ? 'input-error' : ''}`} placeholder="City" value={city} onChange={e => setCity(e.target.value)} readOnly={selectedSavedId !== null} />
              {errors.city && <span className="input-error-text">{errors.city}</span>}
            </div>
            <div className="input-group">
              <input className={`input-field ${errors.state ? 'input-error' : ''}`} placeholder="State" value={state} onChange={e => setState(e.target.value)} readOnly={selectedSavedId !== null} />
              {errors.state && <span className="input-error-text">{errors.state}</span>}
            </div>
          </div>
          <div className="input-group">
            <input className={`input-field ${errors.pincode ? 'input-error' : ''}`} placeholder="Pincode" value={pincode} onChange={e => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} readOnly={selectedSavedId !== null} />
            {errors.pincode && <span className="input-error-text">{errors.pincode}</span>}
          </div>

          {userId && selectedSavedId === null && (
            <label className={styles.saveBookRow}>
              <input
                type="checkbox"
                checked={saveToBook}
                onChange={e => setSaveToBook(e.target.checked)}
              />
              Save to my address book
            </label>
          )}
        </div>

        {/* Conversion Nudge: Highlight UPI Savings vs COD Fees */}
        <div className={styles.checkoutNudgeCard}>
          <div className={styles.nudgeIconWrap}>
            <Zap size={18} />
          </div>
          <div className={styles.nudgeContent}>
            <div className={styles.nudgeTitle}>
              <span>Pay with UPI &amp; Save {formatPaise(codFeePaiseSetting)}</span>
              <span className={styles.nudgeBadge}>LOWEST PRICE</span>
            </div>
            <p className={styles.nudgeText}>
              Instant UPI avoids the <strong>{formatPaise(codFeePaiseSetting)} COD handling charge</strong> and guarantees <strong>Priority Dispatch</strong> within 24 hours.
            </p>
          </div>
        </div>

        {/* Payment Method */}
        <div className={styles.formSection}>
          <label className="input-label">Payment</label>
          <div className="payment-toggle">
            <button
              type="button"
              className={`payment-option ${paymentMethod === 'cod' ? 'payment-option-selected' : ''}`}
              onClick={() => {
                if (quote && !quote.codEnabled) return;
                setPaymentMethod('cod');
                setOrderError('');
              }}
              disabled={quote ? !quote.codEnabled : false}
              aria-disabled={quote ? !quote.codEnabled : false}
              title={quote && !quote.codEnabled ? 'Cash on Delivery is currently unavailable' : undefined}
            >
              💰 COD
            </button>
            <button
              type="button"
              className={`payment-option ${paymentMethod === 'online' ? 'payment-option-selected' : ''}`}
              onClick={() => { setPaymentMethod('online'); setOrderError(''); }}
            >
              💳 Online
            </button>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 'var(--space-2)' }}>
            {quote && !quote.codEnabled
              ? 'COD is unavailable right now — please use Online payment.'
              : paymentMethod === 'online'
                ? 'UPI · Cards · Wallets · Net Banking'
                : 'Pay when your order arrives'}
          </p>
        </div>

        {/* Submit */}
        <button
          id="place-order-btn"
          className={`btn btn-primary ${submitting ? 'btn-loading' : ''}`}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {paymentMethod === 'cod' && codFeePaise > 0 ? (
            <span className={styles.ctaStack}>
              <span className={styles.ctaPrimary}>PLACE ORDER — {formatPrice(total)}</span>
              <span
                key={`cta-cod-${codFeePaise}`}
                className={styles.ctaBadge}
              >
                INCL. +{formatPrice(codFeePaise)} COD FEE
              </span>
            </span>
          ) : (
            <>PLACE ORDER — {formatPrice(total)}</>
          )}
        </button>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="animate-pulse text-muted">Loading checkout...</div>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
