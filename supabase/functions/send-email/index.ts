import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendCoursePurchaseEmail, sendWelcomeEmail } from "../_shared/transactional-email.ts";

type EmailRequest = {
  action: "welcome" | "course_purchase";
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

function getEnv(name: string) {
  return (Deno.env.get(name) || "").trim();
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

  return { adminClient, user };
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
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

async function sendVerifiedPurchaseEmail(adminClient: any, email: string, payload: Record<string, unknown>) {
  const orderId = String(payload.razorpay_order_id || payload.order_id || "").trim();
  const paymentId = String(payload.razorpay_payment_id || payload.payment_id || "").trim();
  if (!orderId && !paymentId) {
    throw new Error("Payment reference is required");
  }

  let query = adminClient
    .from("payment_transactions")
    .select("student_email, status, folder_id, amount_inr, razorpay_order_id, razorpay_payment_id")
    .eq("student_email", email)
    .eq("status", "paid")
    .limit(1);

  if (orderId) {
    query = query.eq("razorpay_order_id", orderId);
  } else {
    query = query.eq("razorpay_payment_id", paymentId);
  }

  const { data: transactions, error } = await query;
  if (error) throw new Error(error.message);
  const transaction = Array.isArray(transactions) ? transactions[0] : null;
  if (!transaction) {
    throw new Error("Paid transaction was not found for this account");
  }

  const [studentName, courseName] = await Promise.all([
    getStudentName(adminClient, email),
    getCourseName(adminClient, transaction.folder_id || null),
  ]);

  return await sendCoursePurchaseEmail(adminClient, {
    email,
    name: studentName,
    courseName,
    amountInr: transaction.amount_inr,
    orderId: String(transaction.razorpay_order_id || orderId),
    paymentId: String(transaction.razorpay_payment_id || paymentId),
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const verified = await getVerifiedUser(req);
    if ("error" in verified) return verified.error;
    const { adminClient, user } = verified;
    const { action, payload = {} } = (await req.json()) as EmailRequest;

    if (action === "welcome") {
      const result = await sendWelcomeEmail(adminClient, {
        email: user.email || "",
        name: String(payload.name || user.email?.split("@")[0] || ""),
        examTarget: String(payload.exam_target || ""),
      });
      return json(result);
    }

    if (action === "course_purchase") {
      const result = await sendVerifiedPurchaseEmail(adminClient, normalizeEmail(user.email || ""), payload);
      return json(result);
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
