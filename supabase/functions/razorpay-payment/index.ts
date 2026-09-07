import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendCoursePurchaseEmail } from "../_shared/transactional-email.ts";

type PaymentRequest = {
  action: "create_order" | "verify_payment" | "validate_coupon";
  payload?: Record<string, unknown>;
};

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function normalizeCouponCode(value = "") {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function getEnv(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function toInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCourseAmountInr(folder: Record<string, unknown>, fallback: number) {
  const priceInr = toInt(String(folder.price_inr || ""), fallback);
  const salePriceInr = toInt(String(folder.sale_price_inr || ""), 0);
  const discountPercent = Math.max(0, Math.min(100, Number.parseInt(String(folder.discount_percent || "0"), 10) || 0));
  if (salePriceInr > 0) return salePriceInr;
  if (discountPercent > 0) {
    return Math.max(1, Math.round(priceInr - (priceInr * discountPercent / 100)));
  }
  return priceInr;
}

function getEbookAmountInr(ebook: Record<string, unknown>) {
  return toInt(String(ebook.price_inr || ""), 0);
}

function calculateCouponDiscountInr(coupon: Record<string, unknown>, amountInr: number) {
  const discountType = String(coupon.discount_type || "percent");
  const discountValue = Number.parseInt(String(coupon.discount_value || "0"), 10) || 0;
  const maxDiscountInr = Number.parseInt(String(coupon.max_discount_inr || "0"), 10) || 0;
  let discountInr = 0;

  if (discountType === "fixed") {
    discountInr = discountValue;
  } else {
    discountInr = Math.round(amountInr * Math.min(100, Math.max(0, discountValue)) / 100);
  }

  if (maxDiscountInr > 0) discountInr = Math.min(discountInr, maxDiscountInr);
  return Math.max(0, Math.min(discountInr, Math.max(0, amountInr - 1)));
}

async function validateCoupon(adminClient: any, couponCode: string, folderId: string | null, ebookId: string | null, amountInr: number, productType = "course") {
  const code = normalizeCouponCode(couponCode);
  if (!code) {
    return {
      coupon: null,
      discountInr: 0,
      finalAmountInr: amountInr,
    };
  }

  const { data: coupon, error } = await adminClient
    .from("coupon_codes")
    .select("id, code, title, discount_type, discount_value, max_discount_inr, min_order_inr, active, starts_at, expires_at, usage_limit, used_count, product_scope")
    .eq("code", code)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!coupon) return { error: "Coupon code is not valid" };
  if (!coupon.active) return { error: "Coupon code is not active" };

  const now = Date.now();
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) {
    return { error: "Coupon code is not active yet" };
  }
  if (coupon.expires_at && Date.parse(coupon.expires_at) < now) {
    return { error: "Coupon code has expired" };
  }
  if (Number(coupon.usage_limit || 0) > 0 && Number(coupon.used_count || 0) >= Number(coupon.usage_limit || 0)) {
    return { error: "Coupon usage limit has been reached" };
  }
  if (Number(coupon.min_order_inr || 0) > 0 && amountInr < Number(coupon.min_order_inr || 0)) {
    return { error: `Coupon requires minimum order of Rs ${coupon.min_order_inr}` };
  }

  const productScope = String(coupon.product_scope || "all");
  if (productScope === "ebook" && productType !== "ebook") {
    return { error: "Coupon is only applicable on ebooks" };
  }
  if (productScope === "course" && productType === "ebook") {
    return { error: "Coupon is not applicable on ebooks" };
  }

  const { data: links, error: linksError } = await adminClient
    .from("coupon_course_folders")
    .select("folder_id")
    .eq("coupon_id", coupon.id);
  if (linksError) return { error: linksError.message };

  const { data: ebookLinks, error: ebookLinksError } = await adminClient
    .from("coupon_ebooks")
    .select("ebook_id")
    .eq("coupon_id", coupon.id);
  if (ebookLinksError) return { error: ebookLinksError.message };

  if (productType !== "ebook" && Array.isArray(links) && links.length > 0) {
    if (!folderId || !links.some((link) => String(link.folder_id) === folderId)) {
      return { error: "Coupon is not applicable on this course" };
    }
  }

  if (productType === "ebook" && Array.isArray(ebookLinks) && ebookLinks.length > 0) {
    if (!ebookId || !ebookLinks.some((link) => String(link.ebook_id) === ebookId)) {
      return { error: "Coupon is not applicable on this ebook" };
    }
  }

  const discountInr = calculateCouponDiscountInr(coupon, amountInr);
  if (discountInr <= 0) return { error: "Coupon does not reduce this order amount" };

  return {
    coupon,
    discountInr,
    finalAmountInr: Math.max(1, amountInr - discountInr),
  };
}

async function isPaidMaterialFolder(adminClient: any, folderId: string) {
  const { data, error } = await adminClient.rpc("is_paid_material_folder", {
    folder_id_value: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: Boolean(data), error: "" };
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

async function getVerifiedUser(req: Request) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: json({ error: "Missing Supabase environment configuration" }, 500) };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Missing bearer token" }, 401) };

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const {
    data: { user },
    error,
  } = await adminClient.auth.getUser(token);

  if (error || !user?.email) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  return { adminClient, user, email: normalizeEmail(user.email) };
}

async function getStudentName(adminClient: any, email: string) {
  const { data } = await adminClient
    .from("students")
    .select("full_name")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return String(data?.full_name || "").trim();
}

async function getCourseName(adminClient: any, folderId: string | null) {
  if (!folderId) return "";
  const { data } = await adminClient
    .from("folders")
    .select("name")
    .eq("id", folderId)
    .maybeSingle();
  return String(data?.name || "").trim();
}

async function sendPurchaseEmailSafely(adminClient: any, details: {
  email: string;
  folderId?: string | null;
  amountInr?: number | string | null;
  orderId?: string;
  paymentId?: string;
}) {
  try {
    const [studentName, courseName] = await Promise.all([
      getStudentName(adminClient, details.email),
      getCourseName(adminClient, details.folderId || null),
    ]);
    await sendCoursePurchaseEmail(adminClient, {
      email: details.email,
      name: studentName,
      courseName,
      amountInr: details.amountInr,
      orderId: details.orderId,
      paymentId: details.paymentId,
    });
  } catch (error) {
    console.error("Purchase email failed", error);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const verified = await getVerifiedUser(req);
    if ("error" in verified) return verified.error;
    const { adminClient, email } = verified;
    const { action, payload = {} } = (await req.json()) as PaymentRequest;

    if (action === "create_order" || action === "validate_coupon") {
      const plan = String(payload.plan || "pro");
      const productType = String(payload.product_type || (payload.ebook_id ? "ebook" : "course"));

      if (productType === "ebook" || plan === "ebook") {
        const ebookId = payload.ebook_id ? String(payload.ebook_id) : "";
        const couponCode = normalizeCouponCode(String(payload.coupon_code || ""));
        if (!ebookId) return json({ error: "Missing ebook for this payment" }, 400);

        const { data: ebookRow, error: ebookLookupError } = await adminClient
          .from("ebooks")
          .select("id, title, price_inr, mrp_inr, is_active")
          .eq("id", ebookId)
          .maybeSingle();

        if (ebookLookupError) return json({ error: ebookLookupError.message }, 400);
        if (!ebookRow || !ebookRow.is_active) return json({ error: "Ebook was not found" }, 400);

        const alreadyOwned = await adminClient
          .from("ebook_purchases")
          .select("id")
          .eq("ebook_id", ebookId)
          .eq("student_email", email)
          .eq("status", "active")
          .maybeSingle();
        if (alreadyOwned.error) return json({ error: alreadyOwned.error.message }, 400);
        if (alreadyOwned.data?.id) {
          return json({ error: "This ebook is already active on your account" }, 400);
        }

        const amountInr = getEbookAmountInr(ebookRow);
        if (amountInr <= 0) return json({ error: "Ebook price is not configured" }, 400);

        const couponValidation: any = await validateCoupon(adminClient, couponCode, null, ebookId, amountInr, "ebook");
        if ("error" in couponValidation && couponValidation.error) {
          return json({ error: couponValidation.error }, 400);
        }

        const finalAmountInr = couponValidation.finalAmountInr;
        const discountInr = couponValidation.discountInr;
        const coupon = couponValidation.coupon;

        if (action === "validate_coupon") {
          return json({
            ok: true,
            ebook_id: ebookId,
            original_amount_inr: amountInr,
            discount_inr: discountInr,
            final_amount_inr: finalAmountInr,
            coupon: coupon ? {
              id: coupon.id,
              code: coupon.code,
              title: coupon.title,
              discount_type: coupon.discount_type,
              discount_value: coupon.discount_value,
            } : null,
          });
        }

        const razorpayKeyId = getEnv("RAZORPAY_KEY_ID");
        const razorpayKeySecret = getEnv("RAZORPAY_KEY_SECRET");
        if (!razorpayKeyId || !razorpayKeySecret) {
          return json({ error: "Razorpay keys are not configured" }, 500);
        }

        const receipt = `dronna_ebook_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: finalAmountInr * 100,
            currency: "INR",
            receipt,
            notes: {
              student_email: email,
              plan: "ebook",
              product_type: "ebook",
              ebook_id: ebookId,
              ebook_title: String(ebookRow.title || ""),
              ebook_price_inr: String(amountInr || ""),
              coupon_code: coupon ? String(coupon.code || "") : "",
              coupon_discount_inr: String(discountInr || ""),
            },
          }),
        });

        const order = await orderResponse.json().catch(() => ({}));
        if (!orderResponse.ok) {
          return json({ error: order?.error?.description || "Razorpay order could not be created" }, 400);
        }

        const { error: transactionError } = await adminClient.from("payment_transactions").insert({
          student_email: email,
          plan: "ebook",
          amount_inr: finalAmountInr,
          original_amount_inr: amountInr,
          discount_inr: discountInr,
          coupon_id: coupon?.id || null,
          coupon_code: coupon?.code || null,
          currency: "INR",
          status: "created",
          razorpay_order_id: order.id,
          ebook_id: ebookId,
        });
        if (transactionError) {
          return json({ error: transactionError.message }, 400);
        }

        return json({
          order_id: order.id,
          amount: order.amount,
          currency: order.currency,
          key_id: razorpayKeyId,
          plan: "ebook",
          product_type: "ebook",
          ebook_id: ebookId,
          original_amount_inr: amountInr,
          discount_inr: discountInr,
          final_amount_inr: finalAmountInr,
          coupon: coupon ? {
            code: coupon.code,
            title: coupon.title,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
          } : null,
        });
      }

      if (plan !== "pro") {
        return json({ error: "Unsupported payment plan" }, 400);
      }
      const setId = payload.set_id ? String(payload.set_id) : null;
      let folderId = payload.folder_id ? String(payload.folder_id) : null;
      const couponCode = normalizeCouponCode(String(payload.coupon_code || ""));

      if (!folderId && setId) {
        const { data: setRow, error: setLookupError } = await adminClient
          .from("practice_sets")
          .select("folder_id")
          .eq("id", setId)
          .maybeSingle();

        if (setLookupError) return json({ error: setLookupError.message }, 400);
        folderId = setRow?.folder_id ? String(setRow.folder_id) : null;
      }

      if (!folderId) {
        return json({ error: "Missing course folder for this payment" }, 400);
      }
      const folderCheck = await isPaidMaterialFolder(adminClient, folderId);
      if (folderCheck.error) return json({ error: folderCheck.error }, 400);
      if (!folderCheck.ok) {
        return json({ error: "This folder is not a paid course item" }, 400);
      }
      const { data: folderRow, error: folderLookupError } = await adminClient
        .from("folders")
        .select("id, name, price_inr, discount_percent, sale_price_inr")
        .eq("id", folderId)
        .maybeSingle();

      if (folderLookupError) return json({ error: folderLookupError.message }, 400);
      if (!folderRow) return json({ error: "Course folder was not found" }, 400);

      const amountInr = getCourseAmountInr(folderRow, toInt(getEnv("RAZORPAY_PLAN_AMOUNT_INR"), 99));
      const couponValidation: any = await validateCoupon(adminClient, couponCode, folderId, null, amountInr, "course");
      if ("error" in couponValidation && couponValidation.error) {
        return json({ error: couponValidation.error }, 400);
      }

      const finalAmountInr = couponValidation.finalAmountInr;
      const discountInr = couponValidation.discountInr;
      const coupon = couponValidation.coupon;

      if (action === "validate_coupon") {
        return json({
          ok: true,
          folder_id: folderId,
          original_amount_inr: amountInr,
          discount_inr: discountInr,
          final_amount_inr: finalAmountInr,
          coupon: coupon ? {
            id: coupon.id,
            code: coupon.code,
            title: coupon.title,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
          } : null,
        });
      }

      const razorpayKeyId = getEnv("RAZORPAY_KEY_ID");
      const razorpayKeySecret = getEnv("RAZORPAY_KEY_SECRET");
      if (!razorpayKeyId || !razorpayKeySecret) {
        return json({ error: "Razorpay keys are not configured" }, 500);
      }

      const amountPaise = finalAmountInr * 100;
      const receipt = `dronna_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

      const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt,
          notes: {
            student_email: email,
            plan,
            folder_id: folderId,
            course_name: String(folderRow.name || ""),
            course_price_inr: String(folderRow.price_inr || ""),
            course_discount_percent: String(folderRow.discount_percent || ""),
            course_sale_price_inr: String(folderRow.sale_price_inr || ""),
            coupon_code: coupon ? String(coupon.code || "") : "",
            coupon_discount_inr: String(discountInr || ""),
            set_id: setId || "",
          },
        }),
      });

      const order = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) {
        return json({ error: order?.error?.description || "Razorpay order could not be created" }, 400);
      }

      const { error: transactionError } = await adminClient.from("payment_transactions").insert({
        student_email: email,
        plan,
        amount_inr: finalAmountInr,
        original_amount_inr: amountInr,
        discount_inr: discountInr,
        coupon_id: coupon?.id || null,
        coupon_code: coupon?.code || null,
        currency: "INR",
        status: "created",
        razorpay_order_id: order.id,
        set_id: setId,
        folder_id: folderId,
      });
      if (transactionError) {
        return json({ error: transactionError.message }, 400);
      }

      return json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: razorpayKeyId,
        plan,
        folder_id: folderId,
        original_amount_inr: amountInr,
        discount_inr: discountInr,
        final_amount_inr: finalAmountInr,
        coupon: coupon ? {
          code: coupon.code,
          title: coupon.title,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
        } : null,
      });
    }

    if (action === "verify_payment") {
      const orderId = String(payload.razorpay_order_id || "");
      const paymentId = String(payload.razorpay_payment_id || "");
      const signature = String(payload.razorpay_signature || "");
      const razorpayKeySecret = getEnv("RAZORPAY_KEY_SECRET");
      if (!razorpayKeySecret) {
        return json({ error: "Razorpay keys are not configured" }, 500);
      }

      if (!orderId || !paymentId || !signature) {
        return json({ error: "Missing Razorpay payment details" }, 400);
      }

      const { data: transaction, error: transactionLookupError } = await adminClient
        .from("payment_transactions")
        .select("id, student_email, status, folder_id, ebook_id, razorpay_order_id, coupon_id, amount_inr")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();

      if (transactionLookupError) {
        return json({ error: transactionLookupError.message }, 400);
      }
      if (!transaction || normalizeEmail(transaction.student_email || "") !== email) {
        return json({ error: "Payment order does not belong to this account" }, 403);
      }
      if (transaction.status === "paid") {
        if (transaction.ebook_id) {
          await adminClient
            .from("ebook_purchases")
            .upsert(
              {
                student_email: email,
                ebook_id: transaction.ebook_id,
                status: "active",
                download_password: email,
                generation_status: "pending",
                generation_error: null,
                razorpay_order_id: orderId,
                razorpay_payment_id: paymentId,
              },
              { onConflict: "student_email,ebook_id" },
            );
          return json({ ok: true, already_verified: true, ebook_id: transaction.ebook_id });
        } else if (transaction.folder_id) {
          await adminClient
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
        }
        await sendPurchaseEmailSafely(adminClient, {
          email,
          folderId: transaction.folder_id,
          amountInr: transaction.amount_inr,
          orderId,
          paymentId,
        });
        return json({ ok: true, already_verified: true, folder_id: transaction.folder_id });
      }

      const expectedSignature = await hmacSha256Hex(razorpayKeySecret, `${orderId}|${paymentId}`);
      if (!timingSafeEqual(expectedSignature, signature)) {
        await adminClient
          .from("payment_transactions")
          .update({
            status: "signature_failed",
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            error_message: "Signature mismatch",
          })
          .eq("razorpay_order_id", orderId)
          .eq("student_email", email);
        return json({ error: "Payment signature verification failed" }, 400);
      }

      await adminClient
        .from("payment_transactions")
        .update({
          status: "paid",
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
          verified_at: new Date().toISOString(),
        })
        .eq("razorpay_order_id", orderId)
        .eq("student_email", email);

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

      if (transaction.ebook_id) {
        const { error: purchaseError } = await adminClient
          .from("ebook_purchases")
          .upsert(
            {
              student_email: email,
              ebook_id: transaction.ebook_id,
              status: "active",
              download_password: email,
              generation_status: "pending",
              generation_error: null,
              razorpay_order_id: orderId,
              razorpay_payment_id: paymentId,
            },
            { onConflict: "student_email,ebook_id" },
          );

        if (purchaseError) {
          return json({ error: purchaseError.message }, 400);
        }

        return json({ ok: true, ebook_id: transaction.ebook_id });
      }

      const { data: existingProfile, error: lookupError } = await adminClient
        .from("students")
        .select("id")
        .eq("email", email)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        return json({ error: lookupError.message }, 400);
      }

      const profileQuery = existingProfile?.id
        ? adminClient
            .from("students")
            .update({ subscription_plan: "pro" })
            .eq("id", existingProfile.id)
            .select("*")
            .single()
        : adminClient
            .from("students")
            .insert({
              email,
              full_name: email.split("@")[0],
              exam_target: "UKPSC",
              subscription_plan: "pro",
            })
            .select("*")
            .single();

      const { data: profile, error: profileError } = await profileQuery;

      if (profileError) {
        return json({ error: profileError.message }, 400);
      }

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

        if (purchaseError) {
          return json({ error: purchaseError.message }, 400);
        }
      }

      await sendPurchaseEmailSafely(adminClient, {
        email,
        folderId: transaction.folder_id,
        amountInr: transaction.amount_inr,
        orderId,
        paymentId,
      });

      return json({ ok: true, profile, folder_id: transaction.folder_id });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
