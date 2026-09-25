/**
 * Universal Offer & Delivery Calculation Utilities
 *
 * Implements industry-standard calculations for:
 * 1. Product Offers (MRP vs Selling Price, Percentage Discounts, Savings)
 * 2. Per-Seller Delivery Partner Fee & Free Delivery Thresholds (e.g. Orders >= ₹200)
 * 3. Cart Total Savings on MRP
 */

/**
 * Calculates discount, savings, and offer badge for a product or variant.
 * Standard e-commerce logic: MRP (Maximum Retail Price) vs Selling Price.
 *
 * @param {object} product - Product record
 * @param {object|null} selectedVariant - Selected variant combination (optional)
 * @returns {object} Offer details
 */
export const calculateProductOffer = (product, selectedVariant = null) => {
  if (!product) {
    return {
      hasOffer: false,
      sellingPrice: 0,
      mrp: null,
      savings: 0,
      discountPercentage: 0,
      badgeText: null,
    };
  }

  // 1. Resolve selling price
  const sellingPrice = Number(
    selectedVariant?.price !== undefined && selectedVariant?.price !== null && selectedVariant?.price !== ''
      ? selectedVariant.price
      : (product?.amount || 0)
  );

  // 2. Resolve MRP (Original price)
  let rawMrp =
    selectedVariant?.mrp !== undefined && selectedVariant?.mrp !== null && selectedVariant?.mrp !== ''
      ? selectedVariant.mrp
      : (product?.mrp || product?.original_price || product?.compare_at_price || null);

  const mrp = rawMrp !== null && rawMrp !== undefined ? Number(rawMrp) : null;

  // 3. Check if valid offer exists (MRP must be strictly higher than selling price)
  if (mrp && mrp > sellingPrice && sellingPrice > 0) {
    const savings = Math.max(0, Math.round((mrp - sellingPrice) * 100) / 100);
    const discountPercentage = Math.min(99, Math.max(1, Math.round((savings / mrp) * 100)));

    return {
      hasOffer: true,
      sellingPrice,
      mrp,
      savings,
      discountPercentage,
      badgeText: `${discountPercentage}% OFF`,
    };
  }

  return {
    hasOffer: false,
    sellingPrice,
    mrp: null,
    savings: 0,
    discountPercentage: 0,
    badgeText: null,
  };
};

/**
 * Calculates delivery partner fee and free delivery status for a cart or order.
 *
 * Industry Standard (Blinkit / Zepto / Swiggy):
 * - If order subtotal >= freeDeliveryThreshold (default: ₹200), delivery is FREE for buyer.
 * - If order subtotal < freeDeliveryThreshold, charge default delivery fee (default: ₹30).
 *
 * @param {number} subtotal - Cart or order item subtotal
 * @param {object} sellerDeliveryConfig - Seller specific delivery configuration
 * @returns {object} Delivery fee details
 */
export const calculateOrderDeliveryFee = (subtotal = 0, sellerDeliveryConfig = {}) => {
  const cleanSubtotal = Math.max(0, Number(subtotal || 0));
  const isDeliveryEnabled = sellerDeliveryConfig?.enable_delivery !== false;
  
  // Default threshold: ₹200 (per-seller configurable)
  const freeThreshold = Number(
    sellerDeliveryConfig?.free_delivery_threshold !== undefined && sellerDeliveryConfig?.free_delivery_threshold !== null
      ? sellerDeliveryConfig.free_delivery_threshold
      : 200
  );

  // Default delivery fee: ₹30 (per-seller configurable)
  const baseDeliveryFee = Number(
    sellerDeliveryConfig?.default_delivery_fee !== undefined && sellerDeliveryConfig?.default_delivery_fee !== null
      ? sellerDeliveryConfig.default_delivery_fee
      : 30
  );

  if (!isDeliveryEnabled || cleanSubtotal === 0) {
    return {
      deliveryFee: 0,
      isFreeDelivery: true,
      amountNeededForFree: 0,
      freeThreshold,
      baseDeliveryFee,
      partnerPayout: 0,
    };
  }

  if (cleanSubtotal >= freeThreshold) {
    return {
      deliveryFee: 0,
      isFreeDelivery: true,
      amountNeededForFree: 0,
      freeThreshold,
      baseDeliveryFee,
      partnerPayout: baseDeliveryFee, // Partner still receives full payout funded by seller
    };
  }

  const amountNeededForFree = Math.max(0, Math.round((freeThreshold - cleanSubtotal) * 100) / 100);

  return {
    deliveryFee: baseDeliveryFee,
    isFreeDelivery: false,
    amountNeededForFree,
    freeThreshold,
    baseDeliveryFee,
    partnerPayout: baseDeliveryFee,
  };
};

/**
 * Calculates cumulative cart savings against MRP for all items in the cart.
 *
 * @param {Array} cartItems - Array of cart items
 * @returns {object} Savings breakdown
 */
export const calculateCartSavings = (cartItems = []) => {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return {
      totalSubtotal: 0,
      totalMrp: 0,
      totalSavings: 0,
      hasSavings: false,
    };
  }

  let totalSubtotal = 0;
  let totalMrp = 0;

  cartItems.forEach((item) => {
    const qty = Number(item?.quantity || 1);
    const sellingPrice = Number(
      item?.product_variant_combinations?.price !== undefined
        ? item.product_variant_combinations.price
        : (item?.price || 0)
    );

    const rawMrp =
      item?.product_variant_combinations?.mrp !== undefined && item?.product_variant_combinations?.mrp !== null
        ? item.product_variant_combinations.mrp
        : (item?.mrp || item?.product_variant_combinations?.products?.mrp || null);

    const mrp = (rawMrp !== null && !isNaN(Number(rawMrp)) && Number(rawMrp) > sellingPrice)
      ? Number(rawMrp)
      : sellingPrice;

    totalSubtotal += sellingPrice * qty;
    totalMrp += mrp * qty;
  });

  const totalSavings = Math.max(0, Math.round((totalMrp - totalSubtotal) * 100) / 100);

  return {
    totalSubtotal: Math.round(totalSubtotal * 100) / 100,
    totalMrp: Math.round(totalMrp * 100) / 100,
    totalSavings,
    hasSavings: totalSavings > 0,
  };
};
