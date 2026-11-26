/**
 * Shared types & one-click Indian D2C quality storytelling presets
 * for Below-the-Fold PDP Fabric & Craftsmanship Showcase.
 */

export interface QualityHighlightRow {
  badge: string;
  title: string;
  subtitle: string;
  image?: string | null;
}

export interface QualityPresetTemplate {
  id: string;
  label: string;
  gsm: string;
  fabric: string;
  fit: string;
  modelInfo: string;
  rows: QualityHighlightRow[];
}

export const QUALITY_PRESET_TEMPLATES: QualityPresetTemplate[] = [
  {
    id: '220-gsm-combed-tee',
    label: '220 GSM Combed Cotton Tee',
    gsm: '220 GSM',
    fabric: '100% Super Combed Cotton',
    fit: 'Regular Everyday Fit',
    modelInfo: "Model is 5'10\" wearing size L",
    rows: [
      {
        badge: 'FABRIC',
        title: '100% Super Combed Bio-Washed Cotton',
        subtitle:
          'Long-staple Indian cotton combed to remove short fibres and enzyme bio-washed for an ultra-soft, zero-pilling handfeel.',
        image: null,
      },
      {
        badge: 'BREATHABILITY',
        title: '220 GSM All-Season Weight',
        subtitle:
          'Heavy enough to drape cleanly without clinging or transparency, yet breathable for humid Indian summers.',
        image: null,
      },
      {
        badge: 'NO SHRINKAGE',
        title: 'Pre-Shrunk & Colorfast Finish',
        subtitle:
          'Compacted and heat-set prior to stitching so chest and length stay true within 1% after 30+ home washes.',
        image: null,
      },
      {
        badge: 'CONSTRUCTION',
        title: 'Lycra-Reinforced Collar & Double-Needle Seams',
        subtitle:
          'High-recovery 1x1 ribbed neckband prevents bacon-neck sagging; twin-needle hem and shoulder taping lock shape in.',
        image: null,
      },
      {
        badge: 'WASH & CARE',
        title: 'Easy Cold Machine Wash',
        subtitle:
          'Machine wash cold with mild detergent. Dry inside-out in shade; do not bleach or tumble dry high.',
        image: null,
      },
    ],
  },
  {
    id: '280-gsm-oversize-tee',
    label: '280 GSM Heavyweight Oversize Tee',
    gsm: '280 GSM',
    fabric: '100% Heavyweight French Cotton',
    fit: 'Drop-Shoulder Oversize',
    modelInfo: "Model is 5'11\" wearing size L",
    rows: [
      {
        badge: 'HEAVYWEIGHT',
        title: '280 GSM Dense Loop-Knit Jersey',
        subtitle:
          'Structured heavyweight knit that holds an architectural oversized silhouette all day without losing shape.',
        image: null,
      },
      {
        badge: 'PRE-SHRUNK',
        title: 'Zero-Twist & Enzyme Washed',
        subtitle:
          'Pre-shrunk, fade-resistant dye bath with zero torque so side seams never twist after washing.',
        image: null,
      },
      {
        badge: 'COLLAR & STITCH',
        title: 'Thick 2.5cm Ribbed Crewneck',
        subtitle:
          'High-density cotton/elastane collar stays flat and snug around the neck alongside reinforced bar-tack stress points.',
        image: null,
      },
      {
        badge: 'CARE',
        title: 'Low-Maintenance Care',
        subtitle:
          'Cold gentle cycle with similar colours. Steam or warm iron inside-out.',
        image: null,
      },
    ],
  },
  {
    id: 'french-terry-tracks',
    label: '320 GSM French Terry Tracks / Shorts',
    gsm: '320 GSM',
    fabric: 'Cotton-Rich Loopback Terry',
    fit: 'Relaxed Tapered Fit',
    modelInfo: "Model is 5'10\" wearing size M",
    rows: [
      {
        badge: 'FABRIC',
        title: '320 GSM Breathable Loopback Terry',
        subtitle:
          'Unbrushed moisture-wicking cotton loops inside keep air circulating during workouts, travel, and lounging.',
        image: null,
      },
      {
        badge: 'HARDWARE',
        title: 'Metal-Tipped Drawcord & Deep Pockets',
        subtitle:
          'Wide elastic waistband that never rolls plus deep reinforced side pockets built to secure large smartphones.',
        image: null,
      },
      {
        badge: 'DURABILITY',
        title: 'Anti-Pilling & Shape Recovery',
        subtitle:
          'Engineered to resist knee bagging and wash shrinkage even under heavy weekly rotation.',
        image: null,
      },
    ],
  },
];

export function normalizeQualityHighlights(raw: unknown): QualityHighlightRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: QualityHighlightRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const subtitle = typeof obj.subtitle === 'string' ? obj.subtitle.trim() : '';
    const badge = typeof obj.badge === 'string' ? obj.badge.trim() : 'DETAIL';
    const image = typeof obj.image === 'string' && obj.image.trim() ? obj.image.trim() : null;
    if (title || subtitle) {
      rows.push({ badge: badge || 'DETAIL', title, subtitle, image });
    }
  }
  return rows;
}
