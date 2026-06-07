'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatPaise } from '@/lib/format';
import { getPublicUrl } from '@/lib/media';
import { useCart } from '@/lib/cart';
import styles from './ProductCard.module.css';

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  price_paise: number;
  sale_price_paise: number | null;
  images: string[];
  totalStock: number;
  category?: string;
  sizes?: string[];
}

export default function ProductCard({ product }: { product: ProductCardData }) {
  const { addItem } = useCart();
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  const outOfStock = product.totalStock <= 0;
  const cover = getPublicUrl(product.images?.[0]) || '/product-1.png';
  const originalPrice = product.price_paise;
  const finalPrice = product.sale_price_paise ?? originalPrice;
  const hasSale = product.sale_price_paise !== null && product.sale_price_paise < originalPrice;

  // Default sizes if none in DB
  const sizesList = product.sizes && product.sizes.length > 0
    ? product.sizes
    : ['S', 'M', 'L', 'XL'];

  const handleQuickAdd = (size: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    addItem({
      product_id: product.id,
      name: product.name,
      slug: product.slug,
      size: size,
      price_paise: finalPrice,
      image: cover,
      maxStock: 10, // Default fallback
    });

    setSelectedSize(size);
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      setSelectedSize(null);
      setShowSizes(false);
    }, 1500);
  };

  const toggleSizeMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) return;
    setShowSizes(!showSizes);
  };

  return (
    <div className={`${styles.card} ${outOfStock ? styles.cardDisabled : ''}`}>
      <Link href={`/product/${product.slug}`} className={styles.linkWrapper}>
        <div className={styles.imageWrap}>
          <img
            src={cover}
            alt={product.name}
            className={`${styles.image} ${outOfStock ? styles.imageDisabled : ''}`}
            loading="lazy"
          />
          {hasSale && (
            <span className={styles.saleBadge}>
              SALE
            </span>
          )}
          {outOfStock ? (
            <span className={styles.outOfStockPill} aria-hidden>
              SOLD OUT
            </span>
          ) : (
            product.totalStock <= 5 && (
              <span className={styles.lowStockPill}>
                {product.totalStock} LEFT
              </span>
            )
          )}
        </div>

        <div className={styles.body}>
          <div className={styles.categoryLine}>
            {product.category || 'FOOTBALL JERSEY'}
          </div>
          <h3 className={styles.name}>{product.name}</h3>
          
          <div className={styles.priceRow}>
            {hasSale ? (
              <>
                <span className={styles.price}>{formatPaise(finalPrice)}</span>
                <span className={styles.priceStrike}>{formatPaise(originalPrice)}</span>
              </>
            ) : (
              <span className={styles.price}>{formatPaise(originalPrice)}</span>
            )}
          </div>
        </div>
      </Link>

      {/* Sporty Quick Actions */}
      <div className={styles.actionsContainer}>
        {!outOfStock && (
          <div className={styles.actionBlock}>
            {showSizes ? (
              <div className={styles.sizeSelector}>
                <span className={styles.sizeLabel}>SELECT SIZE:</span>
                <div className={styles.sizesRow}>
                  {sizesList.map((size) => (
                    <button
                      key={size}
                      className={`${styles.sizeBtn} ${selectedSize === size ? styles.sizeBtnActive : ''}`}
                      onClick={(e) => handleQuickAdd(size, e)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button
                className={`${styles.addToCartBtn} ${added ? styles.addedBtn : ''}`}
                onClick={toggleSizeMenu}
                disabled={added}
              >
                {added ? '✓ ADDED TO CART' : '⚡ QUICK ADD'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
