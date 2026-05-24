import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-razorpay-signature, x-razorpay-event-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function getEnv(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function getPaymentEntity(event: any) {
  return event?.payload?.payment?.entity || {};
}

async function markPaymentCaptured(adminClient: any, payment: any) {
  const orderId = String(payment.order_id || "");
  const paymentId = String(payment.id || "");
  if (!orderId || !paymentId) return json({ error: "Missing Razorpay payment/order id" }, 400);

  const { data: transaction, error: lookupError } = await adminClient
    .from("payment_transactions")
    .select("id, student_email, status, folder_id, razorpay_order_id, coupon_id")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();

  if (lookupError) return json({ error: lookupError.message }, 400);
  if (!transaction) return json({ ok: true, ignored: true, reason: "Unknown order" });

  const email = normalizeEmail(transaction.student_email || "");
  if (!email) return json({ error: "Transaction is missing student email" }, 400);

  if (transaction.status !== "paid") {
    const { error: updateError } = await adminClient
      .from("payment_transactions")
      .update({
        status: "paid",
        razorpay_payment_id: paymentId,
        verified_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("razorpay_order_id", orderId);
    if (updateError) return json({ error: updateError.message }, 400);

    if (transaction.coupon_id) {
      const { data: couponRow } = await adminClient
        .from("coupon_codes")
        .select("used_count")
        .eq("id", transaction.coupon_id)
        .maybeSingle();
      await adminClient
        .from("coupon_codes")
        .update({ used_count: Number(couponRow?.used_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", transaction.coupon_id);
    }
  }

  const { data: existingProfile, error: profileLookupError } = await adminClient
    .from("students")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (profileLookupError) return json({ error: profileLookupError.message }, 400);

  const profileQuery = existingProfile?.id
    ? adminClient
        .from("students")
        .update({ subscription_plan: "pro" })
        .eq("id", existingProfile.id)
    : adminClient
        .from("students")
        .insert({
          email,
          full_name: email.split("@")[0],
          exam_target: "UKPSC",
          subscription_plan: "pro",
        });
  const { error: profileError } = await profileQuery;
  if (profileError) return json({ error: profileError.message }, 400);

  if (transaction.folder_id) {
    const { error: purchaseError } = await adminClient
      .from("course_purchases")
      .upsert(
        {
          student_email: email,
          folder_id: transaction.folder_id,
          status: "active",
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
        },
        { onConflict: "student_email,folder_id" },
      );
    if (purchaseError) return json({ error: purchaseError.message }, 400);
  }

  return json({ ok: true, status: "paid", order_id: orderId, payment_id: paymentId });
}

async function markPaymentFailed(adminClient: any, payment: any) {
  const orderId = String(payment.order_id || "");
  const paymentId = String(payment.id || "");
  if (!orderId) return json({ ok: true, ignored: true, reason: "Missing order id" });

  const errorDescription =
    String(payment.error_description || "") ||
    String(payment.error_reason || "") ||
    String(payment.error_code || "") ||
    "Payment failed";

  const { error } = await adminClient
    .from("payment_transactions")
    .update({
      status: "failed",
      razorpay_payment_id: paymentId || null,
      error_message: errorDescription,
    })
    .eq("razorpay_order_id", orderId)
    .neq("status", "paid");

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, status: "failed", order_id: orderId });
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const webhookSecret = getEnv("RAZORPAY_WEBHOOK_SECRET");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
      return json({ error: "Webhook environment is not configured" }, 500);
    }

    const rawBody = await req.text();
    const receivedSignature = req.headers.get("x-razorpay-signature") || "";
    const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody);
    if (!timingSafeEqual(expectedSignature, receivedSignature)) {
      return json({ error: "Invalid webhook signature" }, 400);
    }

    const event = JSON.parse(rawBody);
    const eventName = String(event?.event || "");
    const payment = getPaymentEntity(event);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (eventName === "payment.captured") {
      return await markPaymentCaptured(adminClient, payment);
    }

    if (eventName === "payment.failed") {
      return await markPaymentFailed(adminClient, payment);
    }

    return json({ ok: true, ignored: true, event: eventName });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
