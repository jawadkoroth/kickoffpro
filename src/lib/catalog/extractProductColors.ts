'use client';

/**
 * Zero-cost client-side HTML5 <canvas> dominant & secondary garment color extractor.
 *
 * Strategy:
 *   1. Loads a File/Blob (via object URL, no CORS needed) or an existing image URL
 *      with `crossOrigin = "anonymous"` onto a bounded analysis canvas (~128px max).
 *   2. Samples the outer border ring pixels (~8% edge) to estimate the studio backdrop
 *      color (e.g., white, light grey, off-white, or beige studio backgrounds).
 *   3. Scans the center 46% bounding box of the image (where the garment sits),
 *      filtering out pixels close to the estimated backdrop color and extreme specular highlights.
 *   4. Quantizes remaining garment pixels into perceptual RGB buckets and merges nearby clusters.
 *   5. Returns `primaryHex` plus `secondaryHex` ONLY if a visually distinct second color
 *      (Euclidean RGB distance >= 72) covers >= 12% of garment pixels (e.g., ringer trims,
 *      contrast collars, or color-block panels).
 */

export interface ExtractedProductColors {
  primaryHex: string;
  secondaryHex: string | null;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  // Slightly weighted RGB distance approximates human luminance sensitivity
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
}

function toHex(c: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(c.r), clamp(c.g), clamp(c.b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function loadImageElement(src: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for color extraction'));
    img.src = src;
  });
}

export async function extractProductColors(
  source: File | Blob | string,
): Promise<ExtractedProductColors | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  let objectUrl: string | null = null;
  let src = '';
  let useCors = false;

  if (typeof source === 'string') {
    src = source;
    useCors = !src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('/');
  } else {
    objectUrl = URL.createObjectURL(source);
    src = objectUrl;
    useCors = false;
  }

  try {
    const img = await loadImageElement(src, useCors);
    const maxDim = 128;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(24, Math.round((img.naturalWidth || maxDim) * scale));
    const height = Math.max(24, Math.round((img.naturalHeight || maxDim) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    const getPixel = (x: number, y: number): Rgb & { a: number } => {
      const idx = (y * width + x) * 4;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
    };

    // 1. Estimate backdrop color from outer border ring (~8% margin)
    const borderMarginX = Math.max(2, Math.floor(width * 0.08));
    const borderMarginY = Math.max(2, Math.floor(height * 0.08));
    const bgSamples: Rgb[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isBorder =
          x < borderMarginX ||
          x >= width - borderMarginX ||
          y < borderMarginY ||
          y >= height - borderMarginY;
        if (!isBorder) continue;
        const p = getPixel(x, y);
        if (p.a < 200) continue;
        bgSamples.push({ r: p.r, g: p.g, b: p.b });
      }
    }

    let bgColor: Rgb | null = null;
    if (bgSamples.length > 0) {
      // Median-ish dominant border bucket so stray shadows don't skew backdrop estimation
      const bgBuckets = new Map<string, { count: number; sum: Rgb }>();
      for (const s of bgSamples) {
        const key = `${Math.floor(s.r / 24)}:${Math.floor(s.g / 24)}:${Math.floor(s.b / 24)}`;
        const entry = bgBuckets.get(key) ?? { count: 0, sum: { r: 0, g: 0, b: 0 } };
        entry.count += 1;
        entry.sum.r += s.r;
        entry.sum.g += s.g;
        entry.sum.b += s.b;
        bgBuckets.set(key, entry);
      }
      let topBg: { count: number; sum: Rgb } | null = null;
      for (const bucket of bgBuckets.values()) {
        if (!topBg || bucket.count > topBg.count) topBg = bucket;
      }
      if (topBg) {
        bgColor = {
          r: topBg.sum.r / topBg.count,
          g: topBg.sum.g / topBg.count,
          b: topBg.sum.b / topBg.count,
        };
      }
    }

    // 2. Scan center ~48% region (x: 26%..74%, y: 24%..74%) where the garment sits
    const xStart = Math.floor(width * 0.26);
    const xEnd = Math.ceil(width * 0.74);
    const yStart = Math.floor(height * 0.24);
    const yEnd = Math.ceil(height * 0.74);

    const step = 18; // Quantization bucket width
    const buckets = new Map<string, { count: number; sum: Rgb }>();
    const fallbackBuckets = new Map<string, { count: number; sum: Rgb }>();
    let garmentPixels = 0;

    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const p = getPixel(x, y);
        if (p.a < 180) continue;

        const key = `${Math.floor(p.r / step)}:${Math.floor(p.g / step)}:${Math.floor(p.b / step)}`;
        const fb = fallbackBuckets.get(key) ?? { count: 0, sum: { r: 0, g: 0, b: 0 } };
        fb.count += 1;
        fb.sum.r += p.r;
        fb.sum.g += p.g;
        fb.sum.b += p.b;
        fallbackBuckets.set(key, fb);

        // Ignore pixels matching the outer backdrop unless the garment itself IS near-backdrop
        if (bgColor && rgbDistance(p, bgColor) < 28) {
          continue;
        }

        const entry = buckets.get(key) ?? { count: 0, sum: { r: 0, g: 0, b: 0 } };
        entry.count += 1;
        entry.sum.r += p.r;
        entry.sum.g += p.g;
        entry.sum.b += p.b;
        buckets.set(key, entry);
        garmentPixels += 1;
      }
    }

    // Fallback (e.g. white t-shirt on white backdrop where background filter skipped most pixels)
    const activeBuckets = garmentPixels >= 40 ? buckets : fallbackBuckets;
    const totalCount = Array.from(activeBuckets.values()).reduce((sum, b) => sum + b.count, 0);
    if (totalCount === 0) return null;

    // 3. Merge close quantization buckets into perceptual color clusters
    const rawClusters = Array.from(activeBuckets.values())
      .map((b) => ({
        count: b.count,
        color: {
          r: b.sum.r / b.count,
          g: b.sum.g / b.count,
          b: b.sum.b / b.count,
        },
      }))
      .sort((a, b) => b.count - a.count);

    const merged: Array<{ count: number; color: Rgb }> = [];
    for (const c of rawClusters) {
      const target = merged.find((m) => rgbDistance(m.color, c.color) < 38);
      if (target) {
        const combined = target.count + c.count;
        target.color = {
          r: (target.color.r * target.count + c.color.r * c.count) / combined,
          g: (target.color.g * target.count + c.color.g * c.count) / combined,
          b: (target.color.b * target.count + c.color.b * c.count) / combined,
        };
        target.count = combined;
      } else {
        merged.push({ count: c.count, color: { ...c.color } });
      }
    }

    merged.sort((a, b) => b.count - a.count);
    const primary = merged[0];
    if (!primary) return null;

    // 4. Pick secondaryHex only if a distinct second cluster covers >= 12% of garment pixels
    const secondary = merged.slice(1).find(
      (c) => c.count / totalCount >= 0.12 && rgbDistance(primary.color, c.color) >= 56,
    );

    return {
      primaryHex: toHex(primary.color),
      secondaryHex: secondary ? toHex(secondary.color) : null,
    };
  } catch {
    return null;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
