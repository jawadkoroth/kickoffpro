import { formatPaise } from '@/lib/format';

export type PromoRewardType =
  | 'free_shipping'
  | 'threshold_percentage'
  | 'buy_x_get_specific_free'
  | 'buy_x_get_cheapest_free';

export interface CartOfferSettings {
  promo_banner_enabled?: boolean;
  promo_reward_type?: PromoRewardType | string;
  promo_goal_type?: 'amount' | 'item_count' | string;
  promo_goal_threshold_paise?: number;
  promo_goal_item_count?: number;
  promo_progress_template?: string;
  promo_unlocked_text?: string;
  promo_nudge_enabled?: boolean;
  promo_nudge_title?: string;
  promo_nudge_badge?: string;
  promo_nudge_text?: string;
  free_shipping_threshold_paise?: number;
  default_shipping_charge_paise?: number;
  cod_fee_paise?: number;
  // Advanced Cart Offers
  reward_percentage?: number;
  reward_product_id?: string | null;
  buy_x_quantity?: number;
  get_y_quantity?: number;
}

export interface CartLineItemSummary {
  product_id: string;
  size?: string;
  quantity: number;
  price_paise: number;
  name?: string;
  image?: string;
}

export interface AutoOfferResult {
  promoRewardType: PromoRewardType;
  hasUnlockedGoal: boolean;
  autoDiscountPaise: number;
  remainingGoalPaise: number;
  remainingGoalItems: number;
  goalProgressPercent: number;
  inProgressMessage: string;
  unlockedMessage: string;
  rewardBadge: string;
  discountedItemKeys: string[];
}

/**
 * Pure, deterministic calculation of cart drawer rewards and automated discounts.
 * Consumed symmetrically by both client-side cart hooks and server-side order validation.
 */
export function calcAutoOfferDiscount(
  settings: CartOfferSettings | null | undefined,
  subtotalPaise: number,
  items: CartLineItemSummary[],
): AutoOfferResult {
  const safeSettings = settings || {};
  const isEnabled = safeSettings.promo_banner_enabled !== false;
  const rewardType: PromoRewardType = (safeSettings.promo_reward_type as PromoRewardType) || 'free_shipping';

  const totalItems = items.reduce((acc, it) => acc + Math.max(0, it.quantity || 0), 0);
  const rewardPercentage = Math.max(0, Math.min(100, Number(safeSettings.reward_percentage) || 10));
  const buyX = Math.max(1, Number(safeSettings.buy_x_quantity) || 2);
  const getY = Math.max(1, Number(safeSettings.get_y_quantity) || 1);
  const targetThresholdPaise = Math.max(
    0,
    safeSettings.promo_goal_threshold_paise ?? safeSettings.free_shipping_threshold_paise ?? 99900,
  );

  let hasUnlockedGoal = false;
  let autoDiscountPaise = 0;
  let remainingGoalPaise = 0;
  let remainingGoalItems = 0;
  let goalProgressPercent = 100;
  const discountedItemKeys: string[] = [];

  let defaultInProgress = 'Add {remaining} more to unlock FREE SHIPPING';
  let defaultUnlocked = 'You unlocked FREE Standard Shipping!';
  let rewardBadge = 'FREE SHIPPING';

  if (!isEnabled) {
    return {
      promoRewardType: rewardType,
      hasUnlockedGoal: false,
      autoDiscountPaise: 0,
      remainingGoalPaise: 0,
      remainingGoalItems: 0,
      goalProgressPercent: 0,
      inProgressMessage: '',
      unlockedMessage: '',
      rewardBadge: '',
      discountedItemKeys: [],
    };
  }

  switch (rewardType) {
    case 'threshold_percentage': {
      rewardBadge = `${rewardPercentage}% OFF`;
      defaultInProgress = `Add {remaining} more to get ${rewardPercentage}% OFF your order!`;
      defaultUnlocked = `🎉 ${rewardPercentage}% OFF automatically applied!`;

      hasUnlockedGoal = targetThresholdPaise > 0 && subtotalPaise >= targetThresholdPaise;
      remainingGoalPaise = Math.max(0, targetThresholdPaise - subtotalPaise);
      goalProgressPercent = targetThresholdPaise > 0
        ? Math.min(100, Math.round((subtotalPaise / targetThresholdPaise) * 100))
        : 100;

      if (hasUnlockedGoal) {
        autoDiscountPaise = Math.round(subtotalPaise * (rewardPercentage / 100));
      }
      break;
    }

    case 'buy_x_get_cheapest_free': {
      rewardBadge = `BUY ${buyX} GET ${getY} FREE`;
      const requiredItems = buyX + getY;
      defaultInProgress = `Add {remaining_items} more to get your lowest-priced item FREE!`;
      defaultUnlocked = `⚡ 1 Item FREE automatically applied!`;

      hasUnlockedGoal = totalItems >= requiredItems;
      remainingGoalItems = Math.max(0, requiredItems - totalItems);
      goalProgressPercent = Math.min(100, Math.round((totalItems / requiredItems) * 100));

      if (hasUnlockedGoal && items.length > 0) {
        // Expand items into single units sorted by price ascending
        const unitItems: Array<{ key: string; price_paise: number }> = [];
        for (const item of items) {
          const key = `${item.product_id}::${item.size || 'std'}`;
          for (let i = 0; i < item.quantity; i++) {
            unitItems.push({ key, price_paise: item.price_paise });
          }
        }
        unitItems.sort((a, b) => a.price_paise - b.price_paise);

        // Calculate how many free items qualify (at least getY, plus proportional tiers if scaled)
        const freeUnitsCount = Math.min(getY, unitItems.length);
        const freeUnits = unitItems.slice(0, freeUnitsCount);
        autoDiscountPaise = freeUnits.reduce((sum, u) => sum + u.price_paise, 0);
        for (const u of freeUnits) {
          discountedItemKeys.push(u.key);
        }
      }
      break;
    }

    case 'buy_x_get_specific_free': {
      rewardBadge = 'FREE GIFT';
      defaultInProgress = `Add {remaining_items} more to unlock your FREE gift!`;
      defaultUnlocked = `🎁 Free gift unlocked with your order!`;

      hasUnlockedGoal = totalItems >= buyX;
      remainingGoalItems = Math.max(0, buyX - totalItems);
      goalProgressPercent = Math.min(100, Math.round((totalItems / buyX) * 100));

      if (hasUnlockedGoal && safeSettings.reward_product_id) {
        // Find if the reward product is in the cart line items
        const matchingRewardItem = items.find(
          (it) => it.product_id === safeSettings.reward_product_id,
        );
        if (matchingRewardItem) {
          // Discount 1 unit of this item to free
          autoDiscountPaise = matchingRewardItem.price_paise;
          discountedItemKeys.push(`${matchingRewardItem.product_id}::${matchingRewardItem.size || 'std'}`);
        }
      }
      break;
    }

    case 'free_shipping':
    default: {
      rewardBadge = 'FREE SHIPPING';
      const isItemCount = safeSettings.promo_goal_type === 'item_count';
      const targetItemCount = Math.max(1, safeSettings.promo_goal_item_count || 2);

      hasUnlockedGoal = isItemCount
        ? totalItems >= targetItemCount
        : targetThresholdPaise > 0 && subtotalPaise >= targetThresholdPaise;

      remainingGoalPaise = Math.max(0, targetThresholdPaise - subtotalPaise);
      remainingGoalItems = Math.max(0, targetItemCount - totalItems);

      goalProgressPercent = isItemCount
        ? Math.min(100, Math.round((totalItems / targetItemCount) * 100))
        : targetThresholdPaise > 0
        ? Math.min(100, Math.round((subtotalPaise / targetThresholdPaise) * 100))
        : 100;

      autoDiscountPaise = 0; // Handled directly via free shipping 0 charge
      defaultInProgress = 'Add {remaining} more to unlock FREE SHIPPING';
      defaultUnlocked = 'You unlocked FREE Standard Shipping!';
      break;
    }
  }

  // Format message templates
  const template = safeSettings.promo_progress_template || defaultInProgress;
  const unlockedTpl = safeSettings.promo_unlocked_text || defaultUnlocked;

  const inProgressMessage = template
    .replace(/\{remaining\}/g, formatPaise(remainingGoalPaise))
    .replace(/\{remaining_items\}/g, `${remainingGoalItems} ${remainingGoalItems === 1 ? 'more item' : 'more items'}`)
    .replace(/\{item_count\}/g, String(safeSettings.promo_goal_item_count || 2))
    .replace(/\{threshold\}/g, formatPaise(targetThresholdPaise))
    .replace(/\{reward_percentage\}/g, `${rewardPercentage}%`)
    .replace(/\{buy_x\}/g, String(buyX))
    .replace(/\{get_y\}/g, String(getY));

  const unlockedMessage = unlockedTpl
    .replace(/\{reward_percentage\}/g, `${rewardPercentage}%`)
    .replace(/\{buy_x\}/g, String(buyX))
    .replace(/\{get_y\}/g, String(getY));

  return {
    promoRewardType: rewardType,
    hasUnlockedGoal,
    autoDiscountPaise,
    remainingGoalPaise,
    remainingGoalItems,
    goalProgressPercent,
    inProgressMessage,
    unlockedMessage,
    rewardBadge,
    discountedItemKeys,
  };
}

