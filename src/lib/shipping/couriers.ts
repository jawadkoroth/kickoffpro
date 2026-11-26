/**
 * Shared courier partner metadata and tracking URL helpers
 * for both automated (Delhivery / Shiprocket) and manual
 * (India Post, DTDC, Blue Dart, Custom) shipments.
 */

export interface CourierPreset {
  key: string;
  label: string;
  placeholderTrackingId: string;
  buildTrackingUrl: (trackingId: string) => string;
}

export const MANUAL_COURIER_PRESETS: CourierPreset[] = [
  {
    key: 'india_post',
    label: 'India Post',
    placeholderTrackingId: 'e.g. EK123456789IN',
    buildTrackingUrl: () =>
      'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx',
  },
  {
    key: 'dtdc',
    label: 'DTDC',
    placeholderTrackingId: 'e.g. D12345678',
    buildTrackingUrl: () => 'https://www.dtdc.in/track-your-shipment/',
  },
  {
    key: 'bluedart',
    label: 'Blue Dart',
    placeholderTrackingId: 'e.g. 12345678901',
    buildTrackingUrl: () => 'https://www.bluedart.com/tracking',
  },
  {
    key: 'delhivery',
    label: 'Delhivery',
    placeholderTrackingId: 'e.g. 1234567890123',
    buildTrackingUrl: (id) =>
      `https://www.delhivery.com/track-v2/package/${encodeURIComponent(id.trim())}`,
  },
  {
    key: 'xpressbees',
    label: 'Xpressbees',
    placeholderTrackingId: 'e.g. XB1234567890',
    buildTrackingUrl: () => 'https://www.xpressbees.com/track',
  },
  {
    key: 'custom',
    label: 'Other Courier',
    placeholderTrackingId: 'Enter AWB / consignment number',
    buildTrackingUrl: () => '',
  },
];

export function formatCourierDisplayName(provider?: string | null): string {
  if (!provider) return 'Courier Partner';
  const raw = provider.trim();
  if (!raw) return 'Courier Partner';
  const lower = raw.toLowerCase();
  const preset = MANUAL_COURIER_PRESETS.find(
    (p) => p.key === lower || p.label.toLowerCase() === lower,
  );
  if (preset && preset.key !== 'custom') return preset.label;
  if (lower === 'shiprocket') return 'Shiprocket';
  if (lower === 'delhivery') return 'Delhivery';
  return raw;
}

export function isValidHttpUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves a safe tracking URL from explicit override or courier preset.
 */
export function resolveTrackingUrl(
  provider: string | null | undefined,
  trackingId: string | null | undefined,
  explicitUrl?: string | null,
): string | null {
  if (explicitUrl && explicitUrl.trim()) {
    return isValidHttpUrl(explicitUrl) ? explicitUrl.trim() : null;
  }

  const trimmedId = (trackingId || '').trim();
  const normalized = (provider || '').trim().toLowerCase();
  if (!normalized) return null;

  const preset = MANUAL_COURIER_PRESETS.find(
    (p) => p.key === normalized || p.label.toLowerCase() === normalized,
  );
  if (preset && preset.key !== 'custom') {
    const generated = preset.buildTrackingUrl(trimmedId);
    return generated || null;
  }

  if (normalized === 'shiprocket' && trimmedId) {
    return `https://shiprocket.co/tracking/${encodeURIComponent(trimmedId)}`;
  }

  return null;
}
