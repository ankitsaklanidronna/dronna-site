import { CONFIG } from '../config/appConfig.js';
import { loadRazorpayCheckout } from './externalScripts.js';
import { supabase } from './supabaseClient.js';

export { loadRazorpayCheckout };

export function getRazorpayKeyId(order = {}) {
  return order.key_id || CONFIG.RAZORPAY_KEY_ID;
}

export function createRazorpayOrder(payload, accessToken) {
  return supabase.createRazorpayOrder(payload, accessToken);
}

export function verifyRazorpayPayment(payload, accessToken) {
  return supabase.verifyRazorpayPayment(payload, accessToken);
}

export function validateRazorpayCoupon(payload, accessToken) {
  return supabase.validateRazorpayCoupon(payload, accessToken);
}
