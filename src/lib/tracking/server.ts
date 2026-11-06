import crypto from 'crypto';
import { logEvent } from '@/lib/log';

/**
 * Server-Side Conversions API (CAPI) & Ad Attribution Engine
 * Handles Meta CAPI, Google Enhanced Conversions, and Snapchat CAPI.
 *
 * Implements strict SHA-256 hashing conforming to ad platform specifications:
 * - Emails: lowercased, whitespace trimmed, sha256 hex
 * - Phone numbers: digits only with country code (e.g. 919876543210), sha256 hex
 * - Names & addresses: normalized and hashed
 * - fbp, fbc, IP, User Agent: passed as raw match parameters
 */

export interface ServerOrderItem {
  product_id: string;
  product_name: string;
  size?: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
}

export interface ServerPurchaseEventData {
  orderId: string;
  orderNumber: string;
  totalPaise: number;
  eventId: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  shippingAddress?: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  items: ServerOrderItem[];
  attribution?: {
    fbp?: string | null;
    fbc?: string | null;
    gclid?: string | null;
    clientIp?: string | null;
    clientUserAgent?: string | null;
  };
}

export function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(email: string): string {
  return hashSha256(email.trim().toLowerCase());
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If 10 digits (standard Indian mobile), prepend 91
  const fullNumber = digits.length === 10 ? `91${digits}` : digits;
  return hashSha256(fullNumber);
}

export function normalizeString(str: string): string {
  return hashSha256(str.trim().toLowerCase());
}

/**
 * Meta Conversions API (CAPI)
 */
export async function sendMetaCapiPurchase(data: ServerPurchaseEventData): Promise<boolean> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    logEvent('tracking.capi_meta_skipped', {
      reason: !pixelId ? 'NEXT_PUBLIC_META_PIXEL_ID missing' : 'META_CAPI_ACCESS_TOKEN missing',
    });
    return false;
  }

  try {
    const userData: Record<string, any> = {};

    if (data.customer.email) {
      userData.em = [normalizeEmail(data.customer.email)];
    }
    if (data.customer.phone) {
      userData.ph = [normalizePhone(data.customer.phone)];
    }
    if (data.customer.name) {
      const parts = data.customer.name.trim().split(' ');
      userData.fn = [normalizeString(parts[0])];
      if (parts.length > 1) {
        userData.ln = [normalizeString(parts.slice(1).join(' '))];
      }
    }

    if (data.shippingAddress?.city) {
      userData.ct = [normalizeString(data.shippingAddress.city)];
    }
    if (data.shippingAddress?.state) {
      userData.st = [normalizeString(data.shippingAddress.state)];
    }
    if (data.shippingAddress?.pincode) {
      userData.zp = [normalizeString(data.shippingAddress.pincode)];
    }
    userData.country = [hashSha256('in')];

    // Raw matching parameters
    if (data.attribution?.fbp) userData.fbp = data.attribution.fbp;
    if (data.attribution?.fbc) userData.fbc = data.attribution.fbc;
    if (data.attribution?.clientIp) userData.client_ip_address = data.attribution.clientIp;
    if (data.attribution?.clientUserAgent) userData.client_user_agent = data.attribution.clientUserAgent;

    const valueRupees = data.totalPaise / 100;
    const contents = data.items.map((item) => ({
      id: item.product_id,
      quantity: item.quantity,
      item_price: item.unit_price_paise / 100,
    }));

    const payload = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: data.eventId,
          event_source_url: `${process.env.NEXT_PUBLIC_URL || 'https://kickoffpro.in'}/order/${data.orderId}`,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            currency: 'INR',
            value: valueRupees,
            order_id: data.orderNumber,
            content_type: 'product',
            contents,
            num_items: data.items.reduce((s, i) => s + i.quantity, 0),
          },
        },
      ],
    };

    const res = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const resJson = await res.json();
    if (!res.ok) {
      logEvent('tracking.capi_meta_error', {
        order_id: data.orderId,
        status: res.status,
        response: resJson,
      });
      return false;
    }

    logEvent('tracking.capi_meta_success', {
      order_id: data.orderId,
      event_id: data.eventId,
      events_received: resJson.events_received,
    });
    return true;
  } catch (err) {
    logEvent('tracking.capi_meta_exception', {
      order_id: data.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Google Enhanced Conversions / GA4 Measurement Protocol
 */
export async function sendGoogleEnhancedConversion(data: ServerPurchaseEventData): Promise<boolean> {
  const measurementId = process.env.NEXT_PUBLIC_GOOGLE_TAG_ID || process.env.NEXT_PUBLIC_GA_ID;
  const apiSecret = process.env.GA_API_SECRET;

  if (!measurementId || !apiSecret) {
    logEvent('tracking.capi_google_skipped', {
      reason: !measurementId ? 'NEXT_PUBLIC_GOOGLE_TAG_ID missing' : 'GA_API_SECRET missing',
    });
    return false;
  }

  try {
    const valueRupees = data.totalPaise / 100;
    const items = data.items.map((item) => ({
      item_id: item.product_id,
      item_name: item.product_name,
      item_variant: item.size,
      price: item.unit_price_paise / 100,
      quantity: item.quantity,
    }));

    const userData: Record<string, any> = {};
    if (data.customer.email) {
      userData.sha256_email_address = [normalizeEmail(data.customer.email)];
    }
    if (data.customer.phone) {
      userData.sha256_phone_number = [normalizePhone(data.customer.phone)];
    }

    const payload = {
      client_id: data.attribution?.fbp || data.orderId,
      user_data: userData,
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: data.orderNumber,
            value: valueRupees,
            currency: 'INR',
            items,
          },
        },
      ],
    };

    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      logEvent('tracking.capi_google_error', {
        order_id: data.orderId,
        status: res.status,
      });
      return false;
    }

    logEvent('tracking.capi_google_success', {
      order_id: data.orderId,
      order_number: data.orderNumber,
    });
    return true;
  } catch (err) {
    logEvent('tracking.capi_google_exception', {
      order_id: data.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Snapchat Conversions API (CAPI)
 */
export async function sendSnapchatCapiPurchase(data: ServerPurchaseEventData): Promise<boolean> {
  const pixelId = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID;
  const token = process.env.SNAPCHAT_CAPI_TOKEN;

  if (!pixelId || !token) {
    logEvent('tracking.capi_snap_skipped', {
      reason: !pixelId ? 'NEXT_PUBLIC_SNAP_PIXEL_ID missing' : 'SNAPCHAT_CAPI_TOKEN missing',
    });
    return false;
  }

  try {
    const payload = {
      pixel_id: pixelId,
      event_type: 'PURCHASE',
      event_conversion_type: 'WEB',
      event_tag: 'purchase',
      timestamp: String(Math.floor(Date.now() / 1000)),
      hashed_email: data.customer.email ? normalizeEmail(data.customer.email) : undefined,
      hashed_phone_number: data.customer.phone ? normalizePhone(data.customer.phone) : undefined,
      event_conversion_id: data.eventId,
      price: (data.totalPaise / 100).toFixed(2),
      currency: 'INR',
      transaction_id: data.orderNumber,
      item_ids: data.items.map((i) => i.product_id),
      number_items: data.items.reduce((s, i) => s + i.quantity, 0),
      user_agent: data.attribution?.clientUserAgent || undefined,
      ip_address: data.attribution?.clientIp || undefined,
    };

    const res = await fetch('https://tr.snapchat.com/v2/conversion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const resJson = await res.json().catch(() => null);
    if (!res.ok) {
      logEvent('tracking.capi_snap_error', {
        order_id: data.orderId,
        status: res.status,
        response: resJson,
      });
      return false;
    }

    logEvent('tracking.capi_snap_success', {
      order_id: data.orderId,
      event_id: data.eventId,
    });
    return true;
  } catch (err) {
    logEvent('tracking.capi_snap_exception', {
      order_id: data.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Unified background dispatcher for all CAPI providers
 */
export async function dispatchServerPurchaseTracking(data: ServerPurchaseEventData): Promise<void> {
  logEvent('tracking.capi_dispatch_start', {
    order_id: data.orderId,
    event_id: data.eventId,
  });

  await Promise.allSettled([
    sendMetaCapiPurchase(data),
    sendGoogleEnhancedConversion(data),
    sendSnapchatCapiPurchase(data),
  ]);
}

