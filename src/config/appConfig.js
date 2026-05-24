export const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  RAZORPAY_KEY_ID: import.meta.env.VITE_RAZORPAY_KEY_ID || import.meta.env.VITE_RAZORPAY_KEY || "",
  RAZORPAY_PLAN_AMOUNT_INR: Number(import.meta.env.VITE_RAZORPAY_PLAN_AMOUNT_INR || 99),
};

export const IS_DEMO = false;

export const FUNCTIONS_BASE = `${CONFIG.SUPABASE_URL}/functions/v1`;

export const AUTH_STORAGE_KEY = "dronna_user";

export const VISITOR_STORAGE_KEY = "dronna_vid";
