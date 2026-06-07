'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useEmblaCarousel from 'embla-carousel-react';
import { useCart } from '@/lib/cart';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import { Truck, ShieldCheck, RefreshCw, ShoppingCart, Check } from 'lucide-react';
import styles from './page.module.css';

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: string[];
  sizes: string[];
}

export interface InventoryItem {
  size: string;
  stock: number;
}

export default function ProductDetailClient({
  product,
  inventory,
  totalStock,
}: {
  product: ProductDetail;
  inventory: InventoryItem[];
  totalStock: number;
}) {
  const router = useRouter();
  const { addItem } = useCart();
  const [selectedSize, setSelectedSize] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);

  const isSoldOut = totalStock <= 0;

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

  // Pricing: sale price takes priority, coupon stacks on top
  const originalPrice = product.price_paise;
  const basePrice = product.sale_price_paise ?? originalPrice;
  const hasSalePrice = product.sale_price_paise != null && product.sale_price_paise < originalPrice;
  const discountAmount = Math.round(basePrice * couponDiscount / 100);
  const finalPrice = basePrice - discountAmount;

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
    if (!selectedSize || isSoldOut) return;
    const sizeStock = getStock(selectedSize);
    if (sizeStock <= 0) return;
    const images = getImages();
    addItem({
      product_id: product.id,
      name: product.name,
      slug: product.slug,
      size: selectedSize,
      price_paise: finalPrice,
      image: images[0],
      maxStock: sizeStock,
    });
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 2000);
  }

  function handleBuyNow() {
    if (!selectedSize || isSoldOut) return;
    const sizeStock = getStock(selectedSize);
    if (sizeStock <= 0) return;

    const images = getImages();
    addItem({
      product_id: product.id,
      name: product.name,
      slug: product.slug,
      size: selectedSize,
      price_paise: finalPrice,
      image: images[0],
      maxStock: sizeStock,
    });

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

  return (
    <div className={styles.page}>
      <div className={styles.desktopLayout}>
        {/* Embla Image Carousel — swipeable */}
        <div className={styles.galleryWrap}>
          <div className={styles.emblaViewport} ref={emblaRef}>
            <div className={styles.emblaContainer}>
              {images.map((img, idx) => (
               <div key={idx} className={styles.emblaSlide}>
                 <img src={img} alt={`${product.name} - ${idx + 1}`} />
               </div>
              ))}
            </div>
          </div>
          {images.length > 1 && (
            <div className={styles.dots}>
              {images.map((_, idx) => (
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
            {images.map((img, idx) => (
              <button
                key={idx}
                className={`${styles.thumb} ${idx === selectedSlide ? styles.thumbActive : ''}`}
                onClick={() => emblaApi?.scrollTo(idx)}
              >
                <img src={img} alt={`Thumb ${idx + 1}`} />
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

            <p className={styles.description}>{product.description}</p>

            {/* Size Selector */}
            <div className={styles.section}>
              <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Select Size</label>
              <div className="size-grid">
                {(product.sizes as string[]).map(size => {
                  const stock = getStock(size);
                  const outOfStock = stock <= 0;
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      className={`size-btn ${isSelected ? 'size-btn-selected' : ''} ${outOfStock ? 'size-btn-disabled' : ''}`}
                      onClick={() => !outOfStock && setSelectedSize(size)}
                      disabled={outOfStock}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {selectedSize && getStock(selectedSize) <= 3 && getStock(selectedSize) > 0 && (
                <p className={styles.lowStock}>Only {getStock(selectedSize)} left in stock</p>
              )}
            </div>

            {/* Trust Badges */}
            <div className={styles.trustBadges}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Truck size={16} /> <span>Free Shipping</span>
              </div>
              <span>·</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={16} /> <span>COD Available</span>
              </div>
              <span>·</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RefreshCw size={16} /> <span>Easy Returns</span>
              </div>
            </div>

            {/* Desktop CTAs */}
            <div className={styles.desktopCta}>
              <button
                className="btn btn-primary"
                disabled={!selectedSize || isSoldOut}
                onClick={handleBuyNow}
                style={{ width: '100%', marginBottom: '12px', fontSize: '1rem', textTransform: 'uppercase' }}
              >
                {isSoldOut
                  ? 'OUT OF STOCK'
                  : selectedSize
                    ? `BUY NOW — ${formatPaise(finalPrice)}`
                    : 'SELECT A SIZE'}
              </button>
              <button
                className={`btn btn-secondary ${addedToCart ? 'btn-success' : ''}`}
                disabled={!selectedSize || isSoldOut}
                onClick={handleAddToCart}
                style={{ width: '100%', fontSize: '0.875rem', textTransform: 'uppercase' }}
              >
                {addedToCart ? <><Check size={16} style={{marginRight:'8px'}}/> ADDED TO CART</> : <><ShoppingCart size={16} style={{marginRight:'8px'}}/> ADD TO CART</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky CTAs */}
      <div className={styles.mobileCta}>
        <div className={styles.mobileBtnRow}>
          <button
            className={`${styles.mobileCartBtn} ${addedToCart ? styles.mobileCartBtnDone : ''}`}
            disabled={!selectedSize || isSoldOut}
            onClick={handleAddToCart}
          >
            {addedToCart ? <Check size={20} /> : <ShoppingCart size={20} />}
          </button>
          <button
            className="btn btn-primary"
            disabled={!selectedSize || isSoldOut}
            onClick={handleBuyNow}
            style={{ flex: 1, textTransform: 'uppercase', fontSize: '0.875rem' }}
          >
            {isSoldOut
              ? 'OUT OF STOCK'
              : selectedSize
                ? `BUY NOW — ${formatPaise(finalPrice)}`
                : 'SELECT SIZE'}
          </button>
        </div>
      </div>
      <div className={styles.mobileCtaSpacer} />
    </div>
  );
}
