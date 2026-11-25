import { NextRequest, NextResponse } from 'next/server';
import { getActiveProvider } from '@/lib/shipping/registry';
import {
  isValidIndianPincode,
  estimatePincodeDelivery,
  formatDeliveryEta,
} from '@/lib/shipping/pincodeEta';
import { apiError } from '@/lib/api-response';

export const runtime = 'nodejs';

/**
 * GET /api/shipping/eta?pincode=XXXXXX
 *
 * Queries the active courier provider (Shiprocket/Delhivery) from our origin
 * pincode in Kannur, Kerala (ORIGIN_PINCODE || '670001') with a 2.5s timeout,
 * falling back cleanly to Kannur-origin Indian postal zone transit estimates.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('pincode') || '';
  const pincode = raw.replace(/\D/g, '').slice(0, 6);

  if (!isValidIndianPincode(pincode)) {
    return apiError(400, 'Enter a valid 6-digit Indian pincode');
  }

  const fallback = estimatePincodeDelivery(pincode);
  if (!fallback || !fallback.valid) {
    return apiError(400, 'Enter a valid 6-digit Indian pincode');
  }

  try {
    const provider = await getActiveProvider();
    if (provider) {
      const checkPromise = provider.checkServiceability(pincode);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
      const serviceability = await Promise.race([checkPromise, timeoutPromise]);

      if (serviceability && serviceability.raw) {
        // Shiprocket includes estimated_delivery_days on available_courier_companies
        const rawData = (serviceability.raw as { data?: { available_courier_companies?: Array<{ estimated_delivery_days?: string | number }> } })?.data;
        const couriers = rawData?.available_courier_companies;
        if (Array.isArray(couriers) && couriers.length > 0) {
          const daysList = couriers
            .map((c) => Number(c.estimated_delivery_days))
            .filter((d) => Number.isFinite(d) && d >= 1 && d <= 15);
          if (daysList.length > 0) {
            const bestDays = Math.min(...daysList);
            const minDays = Math.max(1, bestDays - 1);
            const maxDays = Math.max(minDays + 1, bestDays);
            const courierEta = formatDeliveryEta(pincode, minDays, maxDays, 'courier');
            return NextResponse.json(
              { success: true, origin: process.env.ORIGIN_PINCODE || '670001', eta: courierEta },
              {
                status: 200,
                headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
              },
            );
          }
        }
      }
    }
  } catch {
    // Non-fatal: fall back to Kannur-origin zone estimate
  }

  return NextResponse.json(
    { success: true, origin: process.env.ORIGIN_PINCODE || '670001', eta: fallback },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    },
  );
}
