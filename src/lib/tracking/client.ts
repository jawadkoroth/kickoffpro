'use client';

/**
 * KickoffPro Client-Side Tracking & Ad Attribution
 * Supports: Meta Pixel (fbq), Google Tag (gtag), Snapchat Pixel (snaptr)
 *
 * Implements strict event_id deduplication matching between browser pixels
 * and server-side Conversions API (CAPI).
 */

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    gtag?: (...args: any[]) => void;
    snaptr?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export interface TrackingProduct {
  id: string;
  name: string;
  category?: string;
  size?: string;
  price: number; // in rupees
  quantity?: number;
}

const CHECKOUT_EVENT_ID_KEY = 'kickoffpro_checkout_event_id';
const COOKIE_EVENT_ID_KEY = '_ko_eid';

/**
 * Generate standard UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Read cookie by name
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

/**
 * Set client cookie with SameSite=Lax
 */
export function setCookie(name: string, value: string, days = 7): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * Retrieve or generate a persistent event_id (UUID) for checkout session deduplication.
 * Persists in sessionStorage & cookies so both browser and server share identical ID.
 */
export function getOrCreateCheckoutEventId(forceNew = false): string {
  if (typeof window === 'undefined') return generateUUID();

  if (!forceNew) {
    const sessionVal = window.sessionStorage.getItem(CHECKOUT_EVENT_ID_KEY);
    if (sessionVal) return sessionVal;

    const cookieVal = getCookie(COOKIE_EVENT_ID_KEY);
    if (cookieVal) {
      window.sessionStorage.setItem(CHECKOUT_EVENT_ID_KEY, cookieVal);
      return cookieVal;
    }
  }

  const newId = generateUUID();
  try {
    window.sessionStorage.setItem(CHECKOUT_EVENT_ID_KEY, newId);
    setCookie(COOKIE_EVENT_ID_KEY, newId, 3);
  } catch {
    // Non-fatal if storage blocked
  }
  return newId;
}

/**
 * Clear the checkout event ID upon completed purchase
 */
export function clearCheckoutEventId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_EVENT_ID_KEY);
    setCookie(COOKIE_EVENT_ID_KEY, '', -1);
  } catch {
    // Non-fatal
  }
}

/**
 * Extract Meta _fbp cookie
 */
export function getFbp(): string | null {
  return getCookie('_fbp');
}

/**
 * Extract or derive Meta _fbc cookie from _fbc cookie or fbclid URL param
 */
export function getFbc(): string | null {
  const directFbc = getCookie('_fbc');
  if (directFbc) return directFbc;

  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const fbclid = urlParams.get('fbclid');
    if (fbclid) {
      // Standard Meta format: fb.1.{creationTimeInMs}.{fbclid}
      const formatted = `fb.1.${Date.now()}.${fbclid}`;
      setCookie('_fbc', formatted, 90);
      return formatted;
    }
  }
  return null;
}

/**
 * Extract Google Click ID (gclid)
 */
export function getGclid(): string | null {
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const gclid = urlParams.get('gclid');
    if (gclid) {
      window.sessionStorage.setItem('kickoffpro_gclid', gclid);
      return gclid;
    }
    return window.sessionStorage.getItem('kickoffpro_gclid') || getCookie('_gcl_aw');
  }
  return null;
}

export interface UtmParameters {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

const UTM_SESSION_KEY = 'kickoffpro_utm_params';

/**
 * Capture and persist UTM campaign parameters from URL into sessionStorage & cookie.
 */
export function captureUtmParameters(): UtmParameters {
  if (typeof window === 'undefined') return {};
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const source = urlParams.get('utm_source');
    const medium = urlParams.get('utm_medium');
    const campaign = urlParams.get('utm_campaign');
    const term = urlParams.get('utm_term');
    const content = urlParams.get('utm_content');

    if (source || medium || campaign) {
      const utms: UtmParameters = {
        utm_source: source ? source.toLowerCase().trim() : undefined,
        utm_medium: medium ? medium.toLowerCase().trim() : undefined,
        utm_campaign: campaign ? campaign.toLowerCase().trim() : undefined,
        utm_term: term ? term.trim() : undefined,
        utm_content: content ? content.trim() : undefined,
      };
      window.sessionStorage.setItem(UTM_SESSION_KEY, JSON.stringify(utms));
      setCookie('_ko_utm', JSON.stringify(utms), 30);
      return utms;
    }

    const saved = window.sessionStorage.getItem(UTM_SESSION_KEY) || getCookie('_ko_utm');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Non-fatal
  }
  return {};
}

export function getUtmParameters(): UtmParameters {
  return captureUtmParameters();
}

/**
 * Fire ViewContent / view_item across all configured ad pixels
 */
export function trackViewContent(product: TrackingProduct): void {
  if (typeof window === 'undefined') return;

  const eventId = generateUUID();

  // 1. Meta Pixel
  if (window.fbq) {
    window.fbq(
      'track',
      'ViewContent',
      {
        content_name: product.name,
        content_ids: [product.id],
        content_type: 'product',
        value: product.price,
        currency: 'INR',
      },
      { eventID: eventId },
    );
  }

  // 2. Google Tag (GA4 / Ads)
  if (window.gtag) {
    window.gtag('event', 'view_item', {
      currency: 'INR',
      value: product.price,
      items: [
        {
          item_id: product.id,
          item_name: product.name,
          item_category: product.category || 'Jerseys',
          price: product.price,
        },
      ],
    });
  }

  // 3. Snapchat Pixel
  if (window.snaptr) {
    window.snaptr('track', 'VIEW_CONTENT', {
      item_ids: [product.id],
      item_category: product.category || 'Jerseys',
      price: product.price,
      currency: 'INR',
      event_conversion_id: eventId,
    });
  }
}

/**
 * Fire AddToCart / add_to_cart across all configured ad pixels
 */
export function trackAddToCart(product: TrackingProduct): void {
  if (typeof window === 'undefined') return;

  const eventId = generateUUID();
  const qty = product.quantity || 1;
  const value = product.price * qty;

  // 1. Meta Pixel
  if (window.fbq) {
    window.fbq(
      'track',
      'AddToCart',
      {
        content_name: product.name,
        content_ids: [product.id],
        content_type: 'product',
        value,
        currency: 'INR',
      },
      { eventID: eventId },
    );
  }

  // 2. Google Tag (GA4 / Ads)
  if (window.gtag) {
    window.gtag('event', 'add_to_cart', {
      currency: 'INR',
      value,
      items: [
        {
          item_id: product.id,
          item_name: product.name,
          item_category: product.category || 'Jerseys',
          item_variant: product.size,
          price: product.price,
          quantity: qty,
        },
      ],
    });
  }

  // 3. Snapchat Pixel
  if (window.snaptr) {
    window.snaptr('track', 'ADD_CART', {
      item_ids: [product.id],
      item_category: product.category || 'Jerseys',
      price: value,
      currency: 'INR',
      number_items: qty,
      event_conversion_id: eventId,
    });
  }
}

/**
 * Fire InitiateCheckout / begin_checkout across all configured ad pixels
 */
export function trackInitiateCheckout(data: {
  items: TrackingProduct[];
  value: number; // in rupees
  eventId?: string;
}): string {
  if (typeof window === 'undefined') return '';

  const eventId = data.eventId || getOrCreateCheckoutEventId();
  const totalQty = data.items.reduce((s, i) => s + (i.quantity || 1), 0);

  // 1. Meta Pixel
  if (window.fbq) {
    window.fbq(
      'track',
      'InitiateCheckout',
      {
        content_ids: data.items.map((i) => i.id),
        content_type: 'product',
        num_items: totalQty,
        value: data.value,
        currency: 'INR',
      },
      { eventID: eventId },
    );
  }

  // 2. Google Tag (GA4 / Ads)
  if (window.gtag) {
    window.gtag('event', 'begin_checkout', {
      currency: 'INR',
      value: data.value,
      items: data.items.map((i) => ({
        item_id: i.id,
        item_name: i.name,
        item_category: i.category || 'Jerseys',
        item_variant: i.size,
        price: i.price,
        quantity: i.quantity || 1,
      })),
    });
  }

  // 3. Snapchat Pixel
  if (window.snaptr) {
    window.snaptr('track', 'START_CHECKOUT', {
      item_ids: data.items.map((i) => i.id),
      number_items: totalQty,
      price: data.value,
      currency: 'INR',
      event_conversion_id: eventId,
    });
  }

  return eventId;
}

/**
 * Fire Purchase / purchase across all configured ad pixels
 */
export function trackPurchase(data: {
  orderId: string;
  orderNumber: string;
  items: TrackingProduct[];
  value: number; // in rupees
  eventId: string;
  customer?: {
    email?: string;
    phone?: string;
    name?: string;
  };
}): void {
  if (typeof window === 'undefined') return;

  const totalQty = data.items.reduce((s, i) => s + (i.quantity || 1), 0);

  // 1. Meta Pixel
  if (window.fbq) {
    window.fbq(
      'track',
      'Purchase',
      {
        content_ids: data.items.map((i) => i.id),
        content_type: 'product',
        num_items: totalQty,
        value: data.value,
        currency: 'INR',
        order_id: data.orderNumber,
      },
      { eventID: data.eventId },
    );
  }

  // 2. Google Tag (GA4 / Ads Enhanced Conversions)
  if (window.gtag) {
    const gPayload: Record<string, any> = {
      transaction_id: data.orderNumber,
      value: data.value,
      currency: 'INR',
      items: data.items.map((i) => ({
        item_id: i.id,
        item_name: i.name,
        item_category: i.category || 'Jerseys',
        item_variant: i.size,
        price: i.price,
        quantity: i.quantity || 1,
      })),
    };

    if (data.customer?.email || data.customer?.phone) {
      gPayload.user_data = {
        email: data.customer.email || undefined,
        phone_number: data.customer.phone || undefined,
      };
    }

    window.gtag('event', 'purchase', gPayload);
  }

  // 3. Snapchat Pixel
  if (window.snaptr) {
    window.snaptr('track', 'PURCHASE', {
      transaction_id: data.orderNumber,
      item_ids: data.items.map((i) => i.id),
      number_items: totalQty,
      price: data.value,
      currency: 'INR',
      event_conversion_id: data.eventId,
    });
  }
}

