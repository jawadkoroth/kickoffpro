'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useEmblaCarousel from 'embla-carousel-react';
import { useCart } from '@/lib/cart';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { estimatePincodeDelivery, type PincodeEtaResult } from '@/lib/shipping/pincodeEta';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import { trackViewContent, trackAddToCart } from '@/lib/tracking/client';
import type { QualityHighlightRow } from '@/lib/catalog/qualityTemplates';
import { getSwatchBackground, type ColorSwatchItem } from '@/lib/catalog/colorSwatches';
import { Truck, ShieldCheck, RefreshCw, ShoppingCart, Check, Tag } from 'lucide-react';
import styles from './page.module.css';

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: string[];
  videos?: string[];
  sizes: string[];
  category?: string | null;
  variety?: string | null;
  gsm?: string | null;
  fabric?: string | null;
  fit?: string | null;
  model_info?: string | null;
  quality_highlights?: QualityHighlightRow[];
  style_group?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  color_secondary_hex?: string | null;
}

export interface InventoryItem {
  size: string;
  stock: number;
  low_stock_alert?: boolean;
}

export interface PdpBestOffer {
  badge: string;
  bestPricePaise: number;
  savingsPaise: number;
  headline: string;
  subline?: string | null;
  couponCode?: string | null;
  discountType?: 'percent' | 'flat';
  discountPercent?: number;
  discountPaiseFlat?: number | null;
  maxDiscountPaise?: number | null;
  minCartPaise?: number | null;
}

const SIZE_GUIDE_DATA = [
  { size: 'S', chest: '38"', length: '27"' },
  { size: 'M', chest: '40"', length: '28"' },
  { size: 'L', chest: '42"', length: '29"' },
  { size: 'XL', chest: '44"', length: '30"' },
  { size: 'XXL', chest: '46"', length: '31"' },
];

export default function ProductDetailClient({
  product,
  inventory,
  totalStock,
  bestOffer = null,
  colorSiblings = [],
}: {
  product: ProductDetail;
  inventory: InventoryItem[];
  totalStock: number;
  bestOffer?: PdpBestOffer | null;
  colorSiblings?: ColorSwatchItem[];
}) {
  const router = useRouter();
  const { addItem, applyCoupon, appliedCoupon } = useCart();
  const [selectedSize, setSelectedSize] = useState('');
  const [sizeError, setSizeError] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [tryOnNotice, setTryOnNotice] = useState<string | null>(null);
  const [etaPincode, setEtaPincode] = useState('');
  const [liveEta, setLiveEta] = useState<PincodeEtaResult | null>(null);

  const localEta = useMemo(
    () => (FEATURE_FLAGS.PINCODE_ETA ? estimatePincodeDelivery(etaPincode) : null),
    [etaPincode],
  );

  useEffect(() => {
    if (!FEATURE_FLAGS.PINCODE_ETA || !localEta || !localEta.valid) {
      setLiveEta(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/shipping/eta?pincode=${encodeURIComponent(localEta.pincode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && data?.eta?.valid) {
          setLiveEta(data.eta);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [localEta]);

  const pincodeEta = liveEta ?? localEta;

  const fabricSpecs = useMemo(() => {
    if (!FEATURE_FLAGS.FABRIC_SPECS) return [];
    return [product.gsm, product.fabric, product.fit, product.model_info].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
  }, [product.gsm, product.fabric, product.fit, product.model_info]);

  // Guarantee that returning to a product page never restores an open virtual try-on session
  useEffect(() => {
    try {
      sessionStorage.removeItem('_decart_open');
      sessionStorage.removeItem('_decart_pane');
    } catch {}
  }, []);

  const handleOpenTryOn = useCallback(() => {
    interface DecartWindow extends Window {
      DecartWidget?: { open: (opts?: Record<string, unknown>) => void };
    }
    const decart = (window as unknown as DecartWindow).DecartWidget;
    if (decart && typeof decart.open === 'function') {
      try {
        decart.open();
        setTryOnNotice(null);
      } catch (err) {
        console.error('[ANYWEAR] Failed to open widget:', err);
        setTryOnNotice('Unable to open Virtual Try-On. Please refresh the page or try again.');
      }
    } else {
      const injectedBtn = document.querySelector<HTMLElement>(
        '.vton-btn, #__decart-pill-btn, [data-decart-trigger], #__decart-imgbtn',
      );
      if (injectedBtn) {
        injectedBtn.click();
        setTryOnNotice(null);
      } else {
        console.warn('[ANYWEAR] Widget not yet ready or blocked by browser/extension.');
        setTryOnNotice(
          'Virtual Try-On is initializing. If it does not appear, please verify content/ad blockers are disabled and refresh.'
        );
      }
    }
  }, []);

  const sizeSelectorRef = useRef<HTMLDivElement>(null);

  const isSoldOut = totalStock <= 0;

  // Scroll to top on mount and track ViewContent
  useEffect(() => {
    window.scrollTo(0, 0);
    trackViewContent({
      id: product.id,
      name: product.name,
      price: (product.sale_price_paise ?? product.price_paise) / 100,
    });
  }, [product.id, product.name, product.price_paise, product.sale_price_paise]);

  // Auto-select size from URL search parameter (e.g. from Google/Meta feed links)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const querySize = params.get('size');
      if (querySize && product.sizes?.includes(querySize)) {
        setSelectedSize(querySize);
      }
    }
  }, [product.sizes]);

  // Embla Carousel
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, dragFree: false });
  const [selectedSlide, setSelectedSlide] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedSlide(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on('select', onSelect);
    onSelect();
  }, [emblaApi, onSelect]);

  const getStock = useCallback((size: string) => {
    return inventory.find(i => i.size === size)?.stock ?? 0;
  }, [inventory]);

  const isLowStockFlagged = useCallback((size: string) => {
    return Boolean(inventory.find(i => i.size === size)?.low_stock_alert);
  }, [inventory]);

  // Pricing: sale price takes priority, coupon stacks on top
  const originalPrice = product.price_paise;
  const basePrice = product.sale_price_paise ?? originalPrice;
  const hasSalePrice = product.sale_price_paise != null && product.sale_price_paise < originalPrice;
  const isBestOfferApplied = Boolean(
    bestOffer?.couponCode &&
      (appliedCoupon?.code === bestOffer.couponCode ||
        (couponApplied && couponCode.toUpperCase() === bestOffer.couponCode)),
  );
  const discountAmount = isBestOfferApplied
    ? Math.min(bestOffer!.savingsPaise, basePrice)
    : Math.round((basePrice * couponDiscount) / 100);
  const finalPrice = Math.max(0, basePrice - discountAmount);

  async function handleValidateCoupon() {
    if (!couponCode.trim()) return;
    setCouponError('');

    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.toUpperCase() }),
      });
      const data = await res.json();
      if (data.success) {
        setCouponDiscount(data.discount_percent);
        setCouponApplied(true);
        setCouponError('');
      } else {
        setCouponError(data.error || 'Invalid coupon');
        setCouponDiscount(0);
        setCouponApplied(false);
      }
    } catch {
      setCouponError('Failed to validate coupon');
    }
  }

  function handleAddToCart() {
    if (!selectedSize) {
      setSizeError(true);
      sizeSelectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (isSoldOut) return;
    const sizeStock = getStock(selectedSize);
    if (sizeStock <= 0) return;
    const images = getImages();
    addItem(
      {
        product_id: product.id,
        name: product.name,
        slug: product.slug,
        size: selectedSize,
        price_paise: finalPrice,
        image: images[0],
        maxStock: sizeStock,
      },
      1,
      { openDrawer: true },
    );
    trackAddToCart({
      id: product.id,
      name: product.name,
      size: selectedSize,
      price: finalPrice / 100,
      quantity: 1,
    });
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 2000);
  }

  function handleBuyNow() {
    if (!selectedSize) {
      setSizeError(true);
      sizeSelectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (isSoldOut) return;
    const sizeStock = getStock(selectedSize);
    if (sizeStock <= 0) return;

    const images = getImages();
    addItem(
      {
        product_id: product.id,
        name: product.name,
        slug: product.slug,
        size: selectedSize,
        price_paise: finalPrice,
        image: images[0],
        maxStock: sizeStock,
      },
      1,
      { openDrawer: false },
    );

    const params = new URLSearchParams({
      product_id: product.id,
      size: selectedSize,
      ...(couponApplied && couponCode ? { coupon: couponCode.toUpperCase() } : {}),
    });

    router.push(`/checkout?${params.toString()}`);
  }

  function getImages() {
    const hasImages = product.images && product.images.length > 0 && product.images[0] !== '';
    return hasImages
      ? product.images.map((img) => getPublicUrl(img))
      : ['/product-1.png', '/product-2.png', '/product-3.png'];
  }

  const images = getImages();
  const videoUrls = useMemo(
    () =>
      (product.videos || [])
        .map((v) => getPublicUrl(v))
        .filter((v): v is string => Boolean(v)),
    [product.videos],
  );
  const mediaSlides = useMemo(
    () => [
      ...images.map((url) => ({ type: 'image' as const, url, poster: undefined })),
      ...videoUrls.map((url) => ({ type: 'video' as const, url, poster: images[0] })),
    ],
    [images, videoUrls],
  );

  return (
    <div className={styles.page}>
      <div className={styles.desktopLayout}>
        {/* Embla Media Carousel — swipeable images + lazy-loaded product videos */}
        <div className={styles.galleryWrap}>
          <div className={styles.emblaViewport} ref={emblaRef}>
            <div className={styles.emblaContainer}>
              {mediaSlides.map((slide, idx) => (
                <div key={`${slide.type}-${idx}`} className={styles.emblaSlide}>
                  {slide.type === 'video' ? (
                    <video
                      src={slide.url}
                      poster={slide.poster}
                      controls
                      playsInline
                      muted
                      loop
                      preload="none"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        background: '#000',
                      }}
                    />
                  ) : (
                    <img
                      src={slide.url}
                      alt={`${product.name} - ${idx + 1}`}
                      loading={idx === 0 ? 'eager' : 'lazy'}
                      decoding={idx === 0 ? 'sync' : 'async'}
                      fetchPriority={idx === 0 ? 'high' : 'auto'}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {mediaSlides.length > 1 && (
            <div className={styles.dots}>
              {mediaSlides.map((_, idx) => (
                <button
                  key={idx}
                  className={`${styles.dot} ${idx === selectedSlide ? styles.dotActive : ''}`}
                  onClick={() => emblaApi?.scrollTo(idx)}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          )}

          {/* Desktop thumbnails */}
          <div className={styles.thumbnails}>
            {mediaSlides.map((slide, idx) => (
              <button
                key={idx}
                className={`${styles.thumb} ${idx === selectedSlide ? styles.thumbActive : ''}`}
                onClick={() => emblaApi?.scrollTo(idx)}
                style={{ position: 'relative' }}
                aria-label={slide.type === 'video' ? `Play product video ${idx + 1}` : `View image ${idx + 1}`}
              >
                {slide.type === 'video' ? (
                  <>
                    <img src={slide.poster || '/product-1.png'} alt={`Video ${idx + 1}`} />
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.42)',
                        color: '#fff',
                        fontSize: '0.875rem',
                        fontWeight: 700,
                      }}
                    >
                      ▶
                    </span>
                  </>
                ) : (
                  <img src={slide.url} alt={`Thumb ${idx + 1}`} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Product Info */}
        <div className={styles.content}>
          <div className="animate-fade-in-up">
            <h1 className={styles.productName}>{product.name}</h1>
            <div className={styles.priceRow}>
              <span className={styles.price}>{formatPaise(finalPrice)}</span>
              {(hasSalePrice || discountAmount > 0) && (
                <span className={styles.originalPrice}>{formatPaise(hasSalePrice && discountAmount > 0 ? originalPrice : (hasSalePrice ? originalPrice : basePrice))}</span>
              )}
            </div>

            {bestOffer && (
              <div className={styles.bestOfferStrip}>
                <div className={styles.bestOfferMain}>
                  <span className={styles.bestOfferBadge}>
                    <Tag size={12} /> {bestOffer.badge}
                  </span>
                  <div className={styles.bestOfferHeadline}>{bestOffer.headline}</div>
                  {bestOffer.subline && (
                    <div className={styles.bestOfferSubline}>{bestOffer.subline}</div>
                  )}
                </div>
                {bestOffer.couponCode && bestOffer.savingsPaise > 0 && (
                  <button
                    type="button"
                    className={`${styles.bestOfferApplyBtn} ${
                      appliedCoupon?.code === bestOffer.couponCode || couponApplied
                        ? styles.bestOfferAppliedBtn
                        : ''
                    }`}
                    onClick={() => {
                      const code = bestOffer.couponCode!;
                      setCouponCode(code);
                      setCouponDiscount(bestOffer.discountPercent ?? 0);
                      setCouponApplied(true);
                      applyCoupon({
                        code,
                        discountPaise: bestOffer.savingsPaise,
                        discountPercent: bestOffer.discountPercent ?? 0,
                        discountType: bestOffer.discountType ?? 'percent',
                        discountPaiseFlat: bestOffer.discountPaiseFlat ?? null,
                        minCartPaise: bestOffer.minCartPaise ?? null,
                        maxDiscountPaise: bestOffer.maxDiscountPaise ?? null,
                      });
                    }}
                  >
                    {appliedCoupon?.code === bestOffer.couponCode || couponApplied
                      ? 'Applied ✓'
                      : 'Tap to Apply'}
                  </button>
                )}
              </div>
            )}

            <p className={styles.description}>{product.description}</p>

            {/* Structured Fabric & Fit Spec Strip (hidden gracefully if no metadata populated) */}
            {fabricSpecs.length > 0 && (
              <div className={styles.specStrip}>
                {fabricSpecs.join('  •  ')}
              </div>
            )}

            {/* Colorway Switcher (shown when product has color_hex & sibling colorways exist) */}
            {product.color_hex && colorSiblings.length >= 2 && (
              <div className={styles.section}>
                <div className={styles.colorHeader}>
                  <span className="input-label" style={{ margin: 0 }}>Color:</span>
                  <span className={styles.colorNameValue}>
                    {product.color_name || 'Selected Colorway'}
                  </span>
                </div>
                <div className={styles.colorSwatchRow} role="list" aria-label="Available colorways">
                  {colorSiblings.map((swatch) => {
                    const isCurrent = swatch.id === product.id;
                    const label = swatch.color_name || swatch.name;
                    return (
                      <Link
                        key={swatch.id}
                        href={`/product/${swatch.slug}`}
                        role="listitem"
                        title={swatch.in_stock ? label : `${label} (Out of stock)`}
                        aria-label={swatch.in_stock ? label : `${label}, out of stock`}
                        aria-current={isCurrent ? 'true' : undefined}
                        className={[
                          styles.colorSwatch,
                          isCurrent ? styles.colorSwatchActive : '',
                          !swatch.in_stock ? styles.colorSwatchOos : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          background: getSwatchBackground(
                            swatch.color_hex,
                            swatch.color_secondary_hex,
                          ),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Size Selector */}
            <div ref={sizeSelectorRef} className={styles.section}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <label className="input-label" style={{ margin: 0 }}>Select Size</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    className={styles.tryOnLink}
                    onClick={handleOpenTryOn}
                    aria-label="Try this outfit virtually"
                  >
                    ✨ Virtual Try-On
                  </button>
                  <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: '0.75rem' }}>·</span>
                  <button
                    type="button"
                    className={styles.sizeGuideLink}
                    onClick={() => setShowSizeGuide(true)}
                  >
                    📏 View Size Guide
                  </button>
                </div>
              </div>
              {tryOnNotice && (
                <div className={styles.tryOnNotice} role="status">
                  <span>ℹ️ {tryOnNotice}</span>
                  <button
                    type="button"
                    onClick={() => setTryOnNotice(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      color: 'inherit',
                      padding: '0 4px',
                      lineHeight: 1,
                    }}
                    aria-label="Dismiss notice"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className={`size-grid ${sizeError ? styles.sizeGridError : ''}`}>
                {(product.sizes as string[]).map(size => {
                  const stock = getStock(size);
                  const outOfStock = stock <= 0;
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      className={`size-btn ${isSelected ? 'size-btn-selected' : ''} ${outOfStock ? 'size-btn-disabled' : ''}`}
                      onClick={() => {
                        if (!outOfStock) {
                          setSelectedSize(size);
                          setSizeError(false);
                        }
                      }}
                      disabled={outOfStock}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {selectedSize && getStock(selectedSize) > 0 && (getStock(selectedSize) <= 3 || isLowStockFlagged(selectedSize)) && (
                <p className={styles.lowStock}>
                  {getStock(selectedSize) <= 3
                    ? `Only ${getStock(selectedSize)} left in ${selectedSize}`
                    : `Only a few left in ${selectedSize}`}
                </p>
              )}
              {sizeError && (
                <p className={styles.sizeErrorMsg}>Please select a size before continuing.</p>
              )}
            </div>

            {/* Clean 2-Row Delivery Estimate Card */}
            <div className={styles.shippingStrip}>
              <div className={styles.shippingHeaderRow}>
                <div className={styles.shippingItem}>
                  <Truck size={16} className={styles.shippingIcon} />
                  <span>Delivery Estimate</span>
                </div>
                {FEATURE_FLAGS.PINCODE_ETA && (
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter pincode"
                    value={etaPincode}
                    onChange={(e) => setEtaPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={styles.pincodeInput}
                    aria-label="Check delivery date by pincode"
                  />
                )}
              </div>
              <div className={styles.shippingSubRow}>
                {pincodeEta ? (
                  pincodeEta.valid ? (
                    <span className={styles.pincodeResult}>
                      Estimated delivery by {pincodeEta.estimatedDateLabel} ({pincodeEta.windowLabel})
                    </span>
                  ) : (
                    <span className={styles.pincodeError}>{pincodeEta.error}</span>
                  )
                ) : (
                  <span className={styles.shippingDefaultText}>
                    Dispatched from Kerala · Delivery in 2–5 business days
                  </span>
                )}
              </div>
            </div>

            {/* Trust Badges */}
            <div className={styles.trustBadges}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>📦</span> <span>COD Available</span>
              </div>
              <span>·</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RefreshCw size={14} /> <span>7-Day Size Exchange</span>
              </div>
              <span>·</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={14} /> <span>Damage Protection</span>
              </div>
            </div>

            {/* Desktop CTAs */}
            <div className={styles.desktopCta}>
              <button
                className="btn btn-primary"
                data-action="buy-now"
                data-testid="buy-now-button"
                disabled={isSoldOut}
                onClick={handleBuyNow}
                style={{ width: '100%', marginBottom: '12px', fontSize: '1rem', textTransform: 'uppercase' }}
              >
                {isSoldOut
                  ? 'OUT OF STOCK'
                  : selectedSize
                    ? `BUY NOW — ${formatPaise(finalPrice)}`
                    : 'BUY NOW'}
              </button>
              <button
                className={`btn btn-secondary ${addedToCart ? 'btn-success' : ''}`}
                data-action="add-to-cart"
                data-testid="add-to-cart-button"
                disabled={isSoldOut}
                onClick={handleAddToCart}
                style={{ width: '100%', fontSize: '0.875rem', textTransform: 'uppercase' }}
              >
                {addedToCart ? <><Check size={16} style={{marginRight:'8px'}}/> ADDED TO CART</> : <><ShoppingCart size={16} style={{marginRight:'8px'}}/> ADD TO CART</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Below-the-Fold Fabric & Quality Showcase (Hidden cleanly if empty) */}
      {(product.quality_highlights?.length ?? 0) > 0 && (
        <section className={styles.qualitySection} aria-label="Fabric Quality and Craftsmanship">
          <div className={styles.qualityHeader}>
            <span className={styles.qualityEyebrow}>CRAFTED FOR DAILY ROTATION</span>
            <h2 className={styles.qualityHeading}>Fabric, Fit &amp; Durability Details</h2>
          </div>
          <div className={styles.qualityRows}>
            {product.quality_highlights!.map((row, idx) => (
              <div
                key={`${row.title}-${idx}`}
                className={`${styles.qualityRow} ${row.image ? styles.qualityRowWithImg : ''}`}
              >
                {row.image && (
                  <div className={styles.qualityImgWrap}>
                    <img
                      src={getPublicUrl(row.image)}
                      alt={row.title || 'Fabric detail'}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
                <div className={styles.qualityTextCol}>
                  <span className={styles.qualityBadge}>{row.badge}</span>
                  <div className={styles.qualityCopy}>
                    <h3 className={styles.qualityTitle}>{row.title}</h3>
                    {row.subtitle && <p className={styles.qualitySubtitle}>{row.subtitle}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mobile Sticky CTAs */}
      <div className={styles.mobileCta}>
        <div className={styles.mobileBtnRow}>
          <button
            className={`${styles.mobileCartBtn} ${addedToCart ? styles.mobileCartBtnDone : ''}`}
            data-action="add-to-cart"
            data-testid="mobile-add-to-cart-button"
            disabled={isSoldOut}
            onClick={handleAddToCart}
          >
            {addedToCart ? <Check size={20} /> : <ShoppingCart size={20} />}
          </button>
          <button
            className="btn btn-primary"
            data-action="buy-now"
            data-testid="mobile-buy-now-button"
            disabled={isSoldOut}
            onClick={handleBuyNow}
            style={{ flex: 1, textTransform: 'uppercase', fontSize: '0.875rem' }}
          >
            {isSoldOut
              ? 'OUT OF STOCK'
              : selectedSize
                ? `BUY NOW — ${formatPaise(finalPrice)}`
                : 'BUY NOW'}
          </button>
        </div>
      </div>
      <div className={styles.mobileCtaSpacer} />

      {/* Global Size Chart Modal */}
      {showSizeGuide && (
        <div 
          className={styles.modalOverlay}
          onClick={() => setShowSizeGuide(false)}
        >
          <div 
            className={styles.modalContent}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Size Guide</h3>
              <button 
                type="button"
                className={styles.modalClose}
                onClick={() => setShowSizeGuide(false)}
              >
                ✕
              </button>
            </div>
            <p className={styles.modalSubtitle}>All measurements are in inches. Standard fit.</p>
            <table className={styles.sizeTable}>
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Chest</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {SIZE_GUIDE_DATA.map((row) => (
                  <tr key={row.size}>
                    <td><strong>{row.size}</strong></td>
                    <td>{row.chest}</td>
                    <td>{row.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
