import type { Metadata } from 'next';
import LegalShell from '../_components/LegalShell';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbLd } from '@/lib/seo/jsonLd';
import { BRAND, CONTACT, canonicalUrl } from '@/lib/seo/site';

/**
 * RETURNS POLICY — DRAFT.
 *
 * Align final copy with Merchant Center policy rules and with the
 * actual operations capability (carrier pickup availability,
 * inspection window, refund turnaround).
 *
 * Merchant Center requires a return policy to surface on Shopping
 * listings — the stricter and clearer this is, the fewer manual
 * review escalations.
 */

export const metadata: Metadata = {
  title: 'Returns',
  description: `How to return or exchange an item purchased from ${BRAND.name}.`,
  alternates: { canonical: canonicalUrl('/legal/returns') },
};

const UPDATED = 'January 2026';

export default function ReturnsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Returns', path: '/legal/returns' },
        ])}
      />
      <LegalShell eyebrow="Legal" title="Size Exchange & Damage Protection Policy" updatedOn={UPDATED}>
        <p>
          We offer a strict <strong>7-Day Size Exchange</strong> and <strong>7-Day Damage Protection</strong> policy. Due to low business margins, we do not support general or blanket free returns/refunds for changes of mind.
        </p>

        <h2>Size Exchanges</h2>
        <p>
          If a jersey does not fit you properly, you can request a size exchange within <strong>7 days</strong> of delivery. The item must be unworn, unwashed, and in its original packaging with tags intact. Size exchanges are subject to stock availability.
        </p>

        <h2>Damage Protection Claims</h2>
        <p>
          In the rare event that your product arrives damaged or defective, please submit a claim within <strong>7 days</strong> of delivery. 
        </p>

        <h2>How to initiate a request</h2>
        <p>
          To request a size exchange or submit a damage claim, write directly to our customer support email at <strong>{CONTACT.email || 'support@kickoffpro.in'}</strong> with:
        </p>
        <ul style={{ paddingLeft: '20px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <li>Your order number</li>
          <li>Details of the size requested or description of the damage</li>
          <li>Clear photo/video proof of the damage (for damage claims)</li>
        </ul>

        <h2>Exceptions</h2>
        <p>
          Personalised jerseys (with custom name/number prints) and sale items are not eligible for size exchange or claims.
        </p>
      </LegalShell>
    </>
  );
}
