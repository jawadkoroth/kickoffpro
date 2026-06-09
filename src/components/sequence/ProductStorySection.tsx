'use client';

/**
 * KickoffPro — ProductStorySection
 *
 * An immersive scroll-driven product storytelling section that inserts
 * BELOW the existing hero/video. It does NOT modify any existing landing
 * page sections.
 *
 * Architecture:
 *   - Sticky viewport panel: the inner <div> is `position:sticky; height:100dvh`
 *     while the outer scroll container drives progress via scrollY.
 *   - ImageSequenceEngine handles all rendering via canvas.
 *   - Scroll → progress mapping is done in a passive scroll listener fed
 *     into rAF to prevent main-thread blocking.
 *   - Annotations are positioned as absolute overlays synced to frame ranges.
 *   - Entire section is lazily mounted via IntersectionObserver — zero cost
 *     until user scrolls to it.
 *
 * To swap the sequence in future:
 *   1. Replace /public/sequences/<folder>/ with new WebP renders.
 *   2. Update the SEQUENCE_CONFIG constant below.
 *   3. Update ANNOTATIONS with new hotspot positions/copy.
 *   4. Nothing else changes.
 *
 * Frame naming convention:
 *   /public/sequences/linen-shirt/frame_0001.webp
 *   /public/sequences/linen-shirt/frame_0002.webp
 *   etc.
 *
 * Placeholder:
 *   When frame images are not yet present (i.e. real renders not ready),
 *   the engine falls back to a minimal SVG shirt silhouette with a
 *   "Sequence coming soon" watermark. The layout and annotations are
 *   fully functional regardless — producers can drop frames at any time.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import ImageSequenceEngine, {
  SequenceConfig,
  SequenceEngineHandle,
} from './ImageSequenceEngine';
import styles from './ProductStorySection.module.css';

/* ─────────────────────────────────────────────────────────────────────
   SEQUENCE CONFIGURATION
   To replace the sequence: update framePrefix, frameExt, frameCount.
   ───────────────────────────────────────────────────────────────────── */
const SEQUENCE_CONFIG: SequenceConfig = {
  framePrefix: '/sequences/linen-shirt/frame_',
  frameExt: 'webp',
  frameCount: 60,
  framePad: 4,
  mobileStride: 2,
};

/* ─────────────────────────────────────────────────────────────────────
   ANNOTATION CONFIGURATION
   Each annotation has:
     - frameStart / frameEnd: the frame range in which it is visible
     - dotX / dotY: position of the anchor dot as % of canvas [0–100]
     - cardSide: 'left' | 'right' — which side the text card appears
     - cardOffsetX/Y: distance from dot to card in % units
     - primary: main label (serif)
     - secondary: descriptor (caps, muted)
   ───────────────────────────────────────────────────────────────────── */
export interface AnnotationDef {
  id: string;
  frameStart: number;
  frameEnd: number;
  dotX: number;
  dotY: number;
  cardSide: 'left' | 'right';
  cardOffsetX: number;
  cardOffsetY: number;
  lineLength: number;
  primary: string;
  secondary: string;
}

const ANNOTATIONS: AnnotationDef[] = [
  {
    id: 'fabric',
    frameStart: 5,
    frameEnd: 18,
    dotX: 58,
    dotY: 38,
    cardSide: 'right',
    cardOffsetX: 5,
    cardOffsetY: -4,
    lineLength: 48,
    primary: 'Premium Dot-Knit Fabric',
    secondary: 'Premium Dot-Knit Fabric designed for all-day comfort and match-day wear.',
  },
  {
    id: 'fit',
    frameStart: 18,
    frameEnd: 32,
    dotX: 44,
    dotY: 55,
    cardSide: 'left',
    cardOffsetX: -5,
    cardOffsetY: -4,
    lineLength: 52,
    primary: 'Athletic Fit',
    secondary: 'Tailored silhouette for movement and comfort',
  },
  {
    id: 'stitch',
    frameStart: 32,
    frameEnd: 46,
    dotX: 62,
    dotY: 66,
    cardSide: 'right',
    cardOffsetX: 5,
    cardOffsetY: 2,
    lineLength: 44,
    primary: 'Reinforced Stitching',
    secondary: 'Durable construction built for pitch and street',
  },
  {
    id: 'collar',
    frameStart: 46,
    frameEnd: 59,
    dotX: 50,
    dotY: 22,
    cardSide: 'right',
    cardOffsetX: 5,
    cardOffsetY: -6,
    lineLength: 56,
    primary: 'Ribbed Crewneck Collar',
    secondary: 'Lightweight profile prevents chafing',
  },
];

/* ─────────────────────────────────────────────────────────────────────
   SCROLL → PROGRESS MAPPING
   scrollRange: how many px of scroll = full sequence (default: 3 × vp).
   ───────────────────────────────────────────────────────────────────── */
const SCROLL_MULTIPLIER = 3; // section height = SCROLL_MULTIPLIER × 100dvh

/* ─────────────────────────────────────────────────────────────────────
   ANNOTATION OVERLAY
   ───────────────────────────────────────────────────────────────────── */
interface AnnotationOverlayProps {
  annotations: AnnotationDef[];
  currentFrame: number;
}

function AnnotationOverlay({ annotations, currentFrame }: AnnotationOverlayProps) {
  return (
    <div className={styles.annotationsLayer} aria-hidden="true">
      {annotations.map((ann) => {
        const visible =
          currentFrame >= ann.frameStart && currentFrame <= ann.frameEnd;

        // Dot position
        const dotStyle: React.CSSProperties = {
          left: `${ann.dotX}%`,
          top: `${ann.dotY}%`,
          transform: 'translate(-50%, -50%)',
        };

        // Connector line: horizontal, from dot toward card
        const lineDir = ann.cardSide === 'right' ? 1 : -1;
        const lineStyle: React.CSSProperties = {
          position: 'absolute',
          left: ann.cardSide === 'right'
            ? `calc(${ann.dotX}% + 3px)`
            : `calc(${ann.dotX}% - ${ann.lineLength}px - 3px)`,
          top: `${ann.dotY}%`,
          width: `${ann.lineLength}px`,
          height: '1px',
          background: `linear-gradient(${lineDir > 0 ? '90deg' : '270deg'}, rgba(212,175,55,0.5), transparent)`,
          transform: 'translateY(-50%)',
        };

        // Card position
        const cardLeft = ann.cardSide === 'right'
          ? `calc(${ann.dotX}% + ${ann.lineLength + 8}px)`
          : undefined;
        const cardRight = ann.cardSide === 'left'
          ? `calc(${100 - ann.dotX}% + ${ann.lineLength + 8}px)`
          : undefined;

        const cardStyle: React.CSSProperties = {
          position: 'absolute',
          top: `calc(${ann.dotY}% + ${ann.cardOffsetY}%)`,
          left: cardLeft,
          right: cardRight,
          transform: 'translateY(-50%)',
        };

        return (
          <div
            key={ann.id}
            className={`${styles.annotation} ${visible ? styles.visible : ''}`}
          >
            {/* Dot */}
            <div className={styles.annotationDot} style={dotStyle} />
            {/* Line */}
            <div style={lineStyle} />
            {/* Card */}
            <div
              className={`${styles.annotationCard} ${styles[ann.cardSide]}`}
              style={cardStyle}
            >
              <p className={styles.annotationPrimary}>{ann.primary}</p>
              <p className={styles.annotationSecondary}>{ann.secondary}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PLACEHOLDER SHIRT SVG (shown when no frames loaded yet)
   A minimal flat silhouette — no distraction, maintains KickoffPro mood.
   ───────────────────────────────────────────────────────────────────── */
function PlaceholderShirt() {
  return (
    <div className={styles.placeholderShirt} aria-hidden="true">
      <svg viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Body */}
        <path
          d="M55 60 L20 90 L35 100 L30 240 L170 240 L165 100 L180 90 L145 60 C140 70 130 78 120 80 L100 85 L80 80 C70 78 60 70 55 60Z"
          fill="white"
          fillOpacity="0.08"
          stroke="white"
          strokeOpacity="0.12"
          strokeWidth="1"
        />
        {/* Collar V */}
        <path
          d="M80 60 L100 85 L120 60"
          fill="none"
          stroke="white"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
        {/* Button placket */}
        <line x1="100" y1="85" x2="100" y2="230" stroke="white" strokeOpacity="0.1" strokeWidth="0.5" />
        {/* Shoulder seams */}
        <line x1="55" y1="60" x2="20" y2="90" stroke="white" strokeOpacity="0.12" strokeWidth="0.5" />
        <line x1="145" y1="60" x2="180" y2="90" stroke="white" strokeOpacity="0.12" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ───────────────────────────────────────────────────────────────────── */
export default function ProductStorySection() {
  const outerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SequenceEngineHandle>(null);

  const [mounted, setMounted] = useState(false);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [scrollStarted, setScrollStarted] = useState(false);

  const rafScrollRef = useRef<number | null>(null);
  const latestScrollRef = useRef(0);

  // Lazy-mount: only initialise when section enters viewport
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll → progress
  const handleScroll = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const rect = outer.getBoundingClientRect();
    const sectionTop = -rect.top; // px scrolled into section
    const scrollRange = outer.offsetHeight - window.innerHeight;

    if (scrollRange <= 0) return;

    const raw = sectionTop / scrollRange;
    const clamped = Math.max(0, Math.min(1, raw));

    latestScrollRef.current = clamped;

    if (!scrollStarted && clamped > 0.01) setScrollStarted(true);
  }, [scrollStarted]);

  // rAF flush loop — keep scroll handler off the hot path
  useEffect(() => {
    let scheduled = false;

    const onScroll = () => {
      handleScroll();
      if (!scheduled) {
        scheduled = true;
        rafScrollRef.current = requestAnimationFrame(() => {
          scheduled = false;
          const p = latestScrollRef.current;
          setScrollProgress(p);

          const frame = Math.round(p * (SEQUENCE_CONFIG.frameCount - 1));
          setCurrentFrame(frame);

          engineRef.current?.setProgress(p);
        });
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
    };
  }, [handleScroll]);

  const sectionHeight = `${(SCROLL_MULTIPLIER + 1) * 100}dvh`;

  return (
    <div
      ref={outerRef}
      className={styles.sectionOuter}
      style={{ height: sectionHeight }}
    >
      <div className={styles.sticky}>
        {/* Vignette */}
        <div className={styles.vignette} />

        {/* Section header — fades out as user scrolls into sequence */}
        <div className={`${styles.sectionHeader} ${scrollStarted ? styles.hidden : ''}`}>
          <p className={styles.eyebrow}>The Garment</p>
          <h2 className={styles.sectionTitle}>
            Every detail,<br />examined.
          </h2>
        </div>

        {/* Placeholder shirt (shown before frames load) */}
        {!firstFrameReady && <PlaceholderShirt />}

        {/* Canvas — only mounted after section enters viewport */}
        {mounted && (
          <ImageSequenceEngine
            ref={engineRef}
            config={SEQUENCE_CONFIG}
            className={styles.canvas}
            onFirstFrameReady={() => setFirstFrameReady(true)}
            onLoadProgress={(r) => setLoadProgress(r)}
          />
        )}

        {/* Loading overlay */}
        {mounted && (
          <div className={`${styles.loadingOverlay} ${firstFrameReady ? styles.fadeOut : ''}`}>
            <span className={styles.loadingWordmark}>KickoffPro</span>
            <div className={styles.loadingTrack}>
              <div
                className={styles.loadingFill}
                style={{ width: `${loadProgress * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Annotations — synced to current frame */}
        {firstFrameReady && (
          <AnnotationOverlay
            annotations={ANNOTATIONS}
            currentFrame={currentFrame}
          />
        )}

        {/* Progress bar */}
        <div className={styles.progressBar}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${scrollProgress * 100}%` }}
            />
          </div>
          <span className={styles.progressLabel}>
            {Math.round(scrollProgress * 100)}%
          </span>
        </div>

        {/* Scroll hint arrow */}
        <div className={`${styles.scrollHint} ${scrollStarted ? styles.hidden : ''}`}>
          <div className={styles.scrollHintLine} />
          <span className={styles.scrollHintText}>Scroll</span>
        </div>
      </div>
    </div>
  );
}
