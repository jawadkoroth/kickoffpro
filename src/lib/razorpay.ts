import Razorpay from 'razorpay';
import crypto from 'crypto';

let razorpayInstance: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error('[RAZORPAY_CONFIG] Missing keys:', {
      hasKeyId: !!keyId,
      hasKeySecret: !!keySecret,
    });
    throw new Error('Razorpay API keys not configured. Check RAZORPAY_KEY_ID / NEXT_PUBLIC_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return razorpayInstance;
}

/**
 * Verify Razorpay payment signature using HMAC-SHA256.
 * This is CRITICAL for payment security — never skip this.
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    console.error('[RAZORPAY_VERIFY] RAZORPAY_KEY_SECRET not set');
    return false;
  }

  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const trimmedSig = signature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trimmedSig)) {
    return false;
  }

  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const signatureBuffer = Buffer.from(trimmedSig, 'hex');

  if (expectedBuffer.length !== signatureBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Verify Cashfree webhook signature using HMAC-SHA256.
 * Supports standard timestamp + rawBody HMAC-SHA256 base64 or hex digest.
 */
export function verifyCashfreeWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret || !timestamp) {
    return false;
  }

  const payload = `${timestamp}${rawBody}`;
  const expectedBase64 = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64');
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(signature.trim());
  const expBase64Buf = Buffer.from(expectedBase64);
  const expHexBuf = Buffer.from(expectedHex);

  if (sigBuf.length === expBase64Buf.length && crypto.timingSafeEqual(sigBuf, expBase64Buf)) {
    return true;
  }
  if (sigBuf.length === expHexBuf.length && crypto.timingSafeEqual(sigBuf, expHexBuf)) {
    return true;
  }

  return false;
}
