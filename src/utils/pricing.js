import { CONFIG } from '../config/appConfig.js';

export function toPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizeCouponCode(value = "") {
  return value.toString().trim().toUpperCase().replace(/\s+/g, "");
}

export function getCoursePricing(folder = {}) {
  const mrp = toPositiveInt(folder.price_inr, CONFIG.RAZORPAY_PLAN_AMOUNT_INR);
  const explicitSalePrice = toPositiveInt(folder.sale_price_inr, 0);
  const discountPercent = Math.min(100, Math.max(0, toPositiveInt(folder.discount_percent, 0)));
  const discountedPrice = discountPercent > 0 ? Math.max(1, Math.round(mrp - (mrp * discountPercent / 100))) : 0;
  const salePrice = explicitSalePrice || discountedPrice || mrp;
  const computedDiscount = mrp > salePrice ? Math.round(((mrp - salePrice) / mrp) * 100) : discountPercent;

  return {
    mrp,
    salePrice,
    discountPercent: computedDiscount,
    hasDiscount: mrp > salePrice || computedDiscount > 0
  };
}

export function getCoursePriceLabel(folder = {}) {
  const pricing = getCoursePricing(folder);
  return `Rs ${pricing.salePrice}`;
}

export function formatCouponDiscount(coupon = {}) {
  if (coupon.discount_type === "fixed") return `Rs ${coupon.discount_value || 0} OFF`;
  return `${coupon.discount_value || 0}% OFF`;
}
