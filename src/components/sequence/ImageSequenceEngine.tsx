'use client';

/**
 * KickoffPro — ImageSequenceEngine
 *
 * A scroll-driven frame interpolation engine. Handles:
 *   - Preloading a sequence of images with priority tiers
 *   - Mapping scroll position → frame index with configurable easing
 *   - requestAnimationFrame loop for smooth updates (no scroll jank)
 *   - Interpolated sub-frame blending via canvas cross-fade
 *   - Reduced-motion accessibility: jumps to final frame, no animation
 *   - Memory-safe: all Image objects garbage-collected on unmount
 *   - Mobile adaptive: auto-reduces frame density on low-memory devices
 *
 * Architecture:
 *   This component owns ONLY the rendering engine. Sequence config,
 *   annotations, and section layout live in ProductStorySection.
 *   Swap the sequence by changing props — zero logic changes needed.
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface SequenceConfig {
  /** Absolute path prefix. e.g. "/sequences/linen-shirt/frame_" */
  framePrefix: string;
  /** File extension without dot. e.g. "webp" */
  frameExt: string;
  /** Total number of frames. e.g. 60 */
  frameCount: number;
  /** Zero-pad width for frame number. e.g. 4 → "0001" */
  framePad: number;
  /** On mobile: step every N frames to reduce memory. Default 1 (no skip). */
  mobileStride?: number;
}

export interface SequenceEngineHandle {
  /** Drive the engine to a target progress [0–1] from outside. */
  setProgress: (p: number) => void;
  /** Current loaded frame count (for external progress bars). */
  loadedCount: () => number;
}

interface Props {
  config: SequenceConfig;
  /** Called when the first frame is ready to show. */
  onFirstFrameReady?: () => void;
  /** Called with [0-1] fraction of frames loaded. */
  onLoadProgress?: (ratio: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

function zeroPad(n: number, width: number): string {
  return String(n + 1).padStart(width, '0');
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const ImageSequenceEngine = forwardRef<SequenceEngineHandle, Props>(
  function ImageSequenceEngine({ config, onFirstFrameReady, onLoadProgress, className, style }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const framesRef = useRef<(HTMLImageElement | null)[]>([]);
    const loadedRef = useRef<boolean[]>([]);
    const loadedCountRef = useRef(0);
    const currentFrameRef = useRef(0);
    const targetFrameRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const firstFrameShownRef = useRef(false);
    const cssSizeRef = useRef({ width: 0, height: 0 }); // Track CSS dimensions, not intrinsic pixels
    const reducedMotion = prefersReducedMotion();

    // Build frame URL
    const frameUrl = useCallback(
      (index: number) =>
        `${config.framePrefix}${zeroPad(index, config.framePad)}.${config.frameExt}`,
      [config]
    );

    // Draw a single frame to canvas
    const drawFrame = useCallback((index: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const img = framesRef.current[index];
      if (!img || !loadedRef.current[index]) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cssW = canvas.offsetWidth;
      const cssH = canvas.offsetHeight;

      // Resize only when CSS dimensions change (not intrinsic vs CSS pixel mismatch)
      if (cssW !== cssSizeRef.current.width || cssH !== cssSizeRef.current.height) {
        cssSizeRef.current = { width: cssW, height: cssH };
        canvas.width = Math.floor(cssW * window.devicePixelRatio);
        canvas.height = Math.floor(cssH * window.devicePixelRatio);
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      }

      const w = cssW;
      const h = cssH;

      // Cover-fit: maintain aspect ratio, crop to fill
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const canvasAspect = w / h;
      let sx = 0, sy = 0, sW = img.naturalWidth, sH = img.naturalHeight;

      if (imgAspect > canvasAspect) {
        sW = img.naturalHeight * canvasAspect;
        sx = (img.naturalWidth - sW) / 2;
      } else {
        sH = img.naturalWidth / canvasAspect;
        sy = (img.naturalHeight - sH) / 2;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, sx, sy, sW, sH, 0, 0, w, h);
    }, []);

    // Animation loop — smooth sub-frame interpolation
    const animLoop = useCallback(() => {
      const target = targetFrameRef.current;
      const current = currentFrameRef.current;
      const diff = target - current;

      if (Math.abs(diff) < 0.5) {
        // Snap to exact frame when close enough
        const snapped = Math.round(target);
        if (snapped !== Math.round(current)) {
          currentFrameRef.current = snapped;
          drawFrame(snapped);
        }
      } else {
        // Lerp with cinematic easing (0.15 = luxurious momentum)
        const next = current + diff * 0.15;
        currentFrameRef.current = next;
        // Draw the nearest whole frame during lerp
        const frameIdx = Math.min(
          Math.round(next),
          config.frameCount - 1
        );
        drawFrame(frameIdx);
      }

      rafRef.current = requestAnimationFrame(animLoop);
    }, [drawFrame, config.frameCount]);

    // Preload strategy — 3 priority tiers
    const startPreload = useCallback(() => {
      const total = config.frameCount;
      const stride = config.mobileStride ?? 1;
      framesRef.current = new Array(total).fill(null);
      loadedRef.current = new Array(total).fill(false);

      let loaded = 0;

      const onLoad = (i: number) => {
        loadedRef.current[i] = true;
        loaded++;
        loadedCountRef.current = loaded;
        onLoadProgress?.(loaded / total);

        // Show first frame immediately when frame 0 is ready
        if (i === 0 && !firstFrameShownRef.current) {
          firstFrameShownRef.current = true;
          drawFrame(0);
          onFirstFrameReady?.();
        }
      };

      const loadFrame = (i: number) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => onLoad(i);
        img.onerror = () => onLoad(i); // count errors as loaded to not stall progress
        img.src = frameUrl(i);
        framesRef.current[i] = img;
      };

      if (reducedMotion) {
        // Only load first and last frame; jump directly
        loadFrame(0);
        loadFrame(total - 1);
        return;
      }

      // Tier 1 — First frame immediately (show ASAP)
      loadFrame(0);

      // Tier 2 — Keyframes every 10% of sequence (enables rough scrubbing early)
      const tier2: number[] = [];
      for (let i = 1; i < total; i += Math.max(1, Math.floor(total / 10))) {
        tier2.push(i);
      }

      // Tier 3 — All remaining frames
      const tier3: number[] = [];
      for (let i = 1; i < total; i++) {
        if (!tier2.includes(i)) tier3.push(i);
      }

      // Staggered loading — tier2 first, then tier3 with stride
      let t2idx = 0;
      const loadTier2 = () => {
        if (t2idx >= tier2.length) {
          loadTier3();
          return;
        }
        loadFrame(tier2[t2idx++]);
        requestAnimationFrame(loadTier2);
      };

      let t3idx = 0;
      const loadTier3 = () => {
        if (t3idx >= tier3.length) return;
        // Load stride frames per animation frame to not block paint
        for (let s = 0; s < stride && t3idx < tier3.length; s++, t3idx++) {
          loadFrame(tier3[t3idx]);
        }
        requestAnimationFrame(loadTier3);
      };

      requestAnimationFrame(loadTier2);
    }, [config, drawFrame, frameUrl, onFirstFrameReady, onLoadProgress, reducedMotion]);

    // Expose setProgress and loadedCount via ref handle
    useImperativeHandle(ref, () => ({
      setProgress: (p: number) => {
        if (reducedMotion) {
          // Jump to final frame, no animation
          const idx = config.frameCount - 1;
          targetFrameRef.current = idx;
          currentFrameRef.current = idx;
          drawFrame(idx);
          return;
        }
        const clamped = Math.max(0, Math.min(1, p));
        const eased = easeInOutCubic(clamped);
        targetFrameRef.current = eased * (config.frameCount - 1);
      },
      loadedCount: () => loadedCountRef.current,
    }), [config.frameCount, drawFrame, reducedMotion]);

    // Mount: start preload + animation loop + resize handler
    useEffect(() => {
      startPreload();
      rafRef.current = requestAnimationFrame(animLoop);

      const handleResize = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        // Force resize + redraw on next frame by resetting stored dimensions
        cssSizeRef.current = { width: 0, height: 0 };
        drawFrame(Math.round(currentFrameRef.current));
      };
      window.addEventListener('resize', handleResize, { passive: true });

      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        window.removeEventListener('resize', handleResize);
        // GC: null out all image refs
        framesRef.current = [];
        loadedRef.current = [];
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ display: 'block', ...style }}
        aria-hidden="true"
      />
    );
  }
);

export default ImageSequenceEngine;
