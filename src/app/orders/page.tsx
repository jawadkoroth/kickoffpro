import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPublicUrl } from '@/lib/media';
import styles from './orders.module.css';

export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  order_number: string;
  total_paise: number;
  order_status: string;
  payment_status: string;
  payment_method: string;
  created_at: string;
};

const ALLOWED_STATUSES = [
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
] as const;
type OrderStatus = (typeof ALLOWED_STATUSES)[number];

function badgeClass(status: string): string {
  const safe: OrderStatus = (ALLOWED_STATUSES as readonly string[]).includes(status)
    ? (status as OrderStatus)
    : 'pending';
  return `${styles.badge} ${styles[`badge_${safe}`]}`;
}

export function getHumanOrderStatus(status: string): string {
  const map: Record<string, string> = {
    pending: 'Placed',
    confirmed: 'Confirmed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  return map[status.toLowerCase()] || status;
}

const formatPrice = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN');

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export default async function OrdersPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth?next=/orders');
  }

  const { data: ordersData, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total_paise, order_status, payment_status, payment_method, created_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const orders: OrderRow[] = error || !ordersData ? [] : (ordersData as OrderRow[]);

  // Batch query order items to fetch product thumbnails for each card
  const orderIds = orders.map((o) => o.id);
  const itemsByOrderId: Record<string, { product_name: string; image_url: string | null }[]> = {};
  
  if (orderIds.length > 0) {
    const { data: itemsData } = await supabase
      .from('order_items')
      .select('order_id, product_name, image_url')
      .in('order_id', orderIds);
      
    if (itemsData) {
      for (const item of itemsData) {
        if (!itemsByOrderId[item.order_id]) {
          itemsByOrderId[item.order_id] = [];
        }
        itemsByOrderId[item.order_id].push({
          product_name: item.product_name,
          image_url: item.image_url,
        });
      }
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Your orders</h1>
        <p className={styles.subtitle}>
          {orders.length === 0
            ? 'You haven’t placed any orders yet.'
            : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {orders.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            When you place an order, it will appear here.
          </p>
          <Link href="/" className={styles.emptyLink}>
            Continue shopping
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {orders.map((order) => {
            const items = itemsByOrderId[order.id] || [];
            const firstItem = items[0];
            const otherItemsCount = items.length - 1;
            const imageUrl = firstItem?.image_url ? getPublicUrl(firstItem.image_url) : '';
            
            // ETA Calculation
            let etaLabel = 'Delivery in 3–5 business days';
            if (order.order_status === 'delivered') {
              etaLabel = `Delivered on ${formatDate(order.created_at)}`;
            } else if (order.order_status === 'cancelled') {
              etaLabel = 'Cancelled';
            } else if (order.order_status === 'shipped') {
              etaLabel = 'Out for delivery';
            }

            return (
              <div key={order.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.orderNumber}>{order.order_number}</span>
                  <span className={badgeClass(order.order_status)}>
                    {getHumanOrderStatus(order.order_status)}
                  </span>
                </div>
                
                <div className={styles.cardContent}>
                  <div className={styles.cardThumb}>
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={firstItem?.product_name || 'Product'}
                        fill
                        sizes="64px"
                        style={{ objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: '#F7FAFC' }} />
                    )}
                  </div>
                  
                  <div className={styles.cardDetails}>
                    <p className={styles.cardProductName}>
                      {firstItem?.product_name || 'Football Jersey'}
                      {otherItemsCount > 0 && ` + ${otherItemsCount} more`}
                    </p>
                    <div className={styles.cardMeta}>
                      <span>Date: {formatDate(order.created_at)}</span>
                      <span>Total: <strong className={styles.cardTotal}>{formatPrice(order.total_paise)}</strong></span>
                    </div>
                    <p className={styles.cardEta}>{etaLabel}</p>
                  </div>
                </div>

                <div className={styles.cardActions}>
                  <Link href={`/order/${order.id}`} className={styles.cardBtnSecondary}>
                    View Receipt
                  </Link>
                  <Link href={`/orders/${order.id}`} className={styles.cardBtnPrimary}>
                    Track Order
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
