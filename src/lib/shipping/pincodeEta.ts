/**
 * Indian pincode validation & delivery ETA estimator.
 *
 * Origin: Kannur, Kerala (670001).
 */

export interface PincodeEtaValid {
  valid: true;
  pincode: string;
  minDays: number;
  maxDays: number;
  estimatedDateLabel: string;
  windowLabel: string;
  source?: 'courier' | 'zone';
}

export interface PincodeEtaInvalid {
  valid: false;
  pincode: string;
  error: string;
}

export type PincodeEtaResult = PincodeEtaValid | PincodeEtaInvalid;

export function isValidIndianPincode(rawPincode: string): boolean {
  const pincode = (rawPincode || '').replace(/\D/g, '').slice(0, 6);
  if (!/^[1-8]\d{5}$/.test(pincode)) return false;
  // Reject obvious dummy pincodes like 100000, 300000, or all-same digits 111111
  if (/^\d00000$/.test(pincode)) return false;
  if (/^(\d)\1{5}$/.test(pincode)) return false;
  return true;
}

export function formatDeliveryEta(
  pincode: string,
  minDays: number,
  maxDays: number,
  source: 'courier' | 'zone' = 'zone',
  now: Date = new Date(),
): PincodeEtaValid {
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
    source,
  };
}

export function estimatePincodeDelivery(
  rawPincode: string,
  now: Date = new Date(),
): PincodeEtaResult | null {
  const pincode = (rawPincode || '').replace(/\D/g, '').slice(0, 6);
  if (pincode.length < 6) return null;

  if (!isValidIndianPincode(pincode)) {
    return {
      valid: false,
      pincode,
      error: 'Enter a valid 6-digit Indian pincode',
    };
  }

  const prefix2 = Number(pincode.slice(0, 2));
  let minDays = 5;
  let maxDays = 7;

  if (pincode.startsWith('744') || prefix2 === 18 || prefix2 === 19 || prefix2 === 78 || prefix2 === 79) {
    // North-East, J&K, Ladakh & Islands
    minDays = 7;
    maxDays = 9;
  } else if (prefix2 >= 67 && prefix2 <= 69) {
    // Kerala (origin: Kannur 670xxx)
    minDays = 1;
    maxDays = 3;
  } else if (prefix2 >= 50 && prefix2 <= 66) {
    // South India (KA, TN, AP, TS)
    minDays = 2;
    maxDays = 4;
  } else if (prefix2 >= 40 && prefix2 <= 49) {
    // West & Central (MH, GA, MP, CG)
    minDays = 4;
    maxDays = 6;
  } else {
    // North & East (11-39, 70-85)
    minDays = 5;
    maxDays = 7;
  }

  return formatDeliveryEta(pincode, minDays, maxDays, 'zone', now);
}
