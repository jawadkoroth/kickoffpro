/**
 * Pure Indian pincode delivery ETA estimator.
 *
 * Maps 6-digit Indian pincodes into metro / standard / remote transit bands
 * and formats a concrete estimated delivery date string (e.g. "Thu, 28 Nov").
 */

export interface PincodeEtaResult {
  valid: boolean;
  pincode: string;
  minDays: number;
  maxDays: number;
  estimatedDateLabel: string;
  windowLabel: string;
}

const METRO_PREFIXES = ['110', '400', '560', '600', '500', '700', '411', '380', '122', '201'];
const REMOTE_PREFIXES = ['79', '18', '19', '744'];

export function estimatePincodeDelivery(rawPincode: string, now: Date = new Date()): PincodeEtaResult | null {
  const pincode = (rawPincode || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) return null;

  let minDays = 3;
  let maxDays = 5;

  if (METRO_PREFIXES.some((p) => pincode.startsWith(p))) {
    minDays = 2;
    maxDays = 3;
  } else if (REMOTE_PREFIXES.some((p) => pincode.startsWith(p))) {
    minDays = 5;
    maxDays = 7;
  }

  const targetDate = new Date(now.getTime());
  targetDate.setDate(targetDate.getDate() + maxDays);

  const estimatedDateLabel = targetDate.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return {
    valid: true,
    pincode,
    minDays,
    maxDays,
    estimatedDateLabel,
    windowLabel: `${minDays}–${maxDays} business days`,
  };
}
