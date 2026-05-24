import { createClient } from "jsr:@supabase/supabase-js@2";

type ActionRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

function normalizeCouponCode(value = "") {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function toNonNegativeInt(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeOptionalDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildCouponPayload(payload: Record<string, unknown>) {
  const code = normalizeCouponCode(String(payload.code || ""));
  const discountType = String(payload.discount_type || "percent") === "fixed" ? "fixed" : "percent";
  const discountValue = toNonNegativeInt(payload.discount_value, 0);
  const maxDiscountInr = toNonNegativeInt(payload.max_discount_inr, 0);
  const minOrderInr = toNonNegativeInt(payload.min_order_inr, 0);
  const usageLimit = toNonNegativeInt(payload.usage_limit, 0);

  return {
    code,
    title: String(payload.title || "").trim() || null,
    discount_type: discountType,
    discount_value: discountType === "percent" ? Math.min(100, discountValue) : discountValue,
    max_discount_inr: maxDiscountInr,
    min_order_inr: minOrderInr,
    active: payload.active !== false,
    starts_at: normalizeOptionalDate(payload.starts_at),
    expires_at: normalizeOptionalDate(payload.expires_at),
    usage_limit: usageLimit,
    updated_at: new Date().toISOString(),
  };
}

function normalizeFolderIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function getVerifiedAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment configuration");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: json({ error: "Missing Authorization header" }, 401) };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: json({ error: "Missing bearer token" }, 401) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user?.email) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const { data: adminRow, error: adminLookupError } = await adminClient
    .from("admin_users")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (adminLookupError) {
    return { error: json({ error: adminLookupError.message }, 500) };
  }

  if (!adminRow) {
    return { error: json({ error: "Forbidden" }, 403) };
  }

  return { adminClient };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const verified = await getVerifiedAdmin(req);
    if ("error" in verified) return verified.error;
    const { adminClient } = verified;

    const { action, payload = {} } = (await req.json()) as ActionRequest;

    switch (action) {
      case "create_question": {
        const { data, error } = await adminClient
          .from("questions")
          .insert(payload)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      case "delete_question": {
        const id = String(payload.id || "");
        const { error } = await adminClient.from("questions").delete().eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "create_set_manual": {
        const setPayload = payload.set as Record<string, unknown>;
        const questionIds = Array.isArray(payload.question_ids) ? payload.question_ids : [];
        const { data: setRow, error: setError } = await adminClient
          .from("practice_sets")
          .insert(setPayload)
          .select("*")
          .single();
        if (setError) return json({ error: setError.message }, 400);

        if (questionIds.length > 0) {
          const links = questionIds.map((questionId) => ({
            set_id: setRow.id,
            question_id: questionId,
          }));
          const { error: linkError } = await adminClient.from("set_questions").insert(links);
          if (linkError) return json({ error: linkError.message }, 400);
        }

        return json({ data: setRow });
      }

      case "delete_set": {
        const id = String(payload.id || "");
        const { error: attemptError } = await adminClient.from("attempts").delete().eq("set_id", id);
        if (attemptError) return json({ error: attemptError.message }, 400);
        const { error: linkError } = await adminClient.from("set_questions").delete().eq("set_id", id);
        if (linkError) return json({ error: linkError.message }, 400);
        const { error } = await adminClient.from("practice_sets").delete().eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "create_set_from_csv": {
        const setPayload = payload.set as Record<string, unknown>;
        const questions = Array.isArray(payload.questions) ? payload.questions : [];

        const { data: setRow, error: setError } = await adminClient
          .from("practice_sets")
          .insert(setPayload)
          .select("*")
          .single();
        if (setError) return json({ error: setError.message }, 400);

        const { data: insertedQuestions, error: questionError } = await adminClient
          .from("questions")
          .insert(questions)
          .select("id");
        if (questionError) {
          await adminClient.from("practice_sets").delete().eq("id", setRow.id);
          return json({ error: questionError.message }, 400);
        }

        const links = (insertedQuestions || []).map((question) => ({
          set_id: setRow.id,
          question_id: question.id,
        }));
        const { error: linkError } = await adminClient.from("set_questions").insert(links);
        if (linkError) return json({ error: linkError.message }, 400);

        return json({
          data: {
            set: setRow,
            inserted_question_count: insertedQuestions?.length || 0,
          },
        });
      }

      case "create_folder": {
        const { data, error } = await adminClient
          .from("folders")
          .insert(payload)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      case "update_folder": {
        const id = String(payload.id || "");
        const name = payload.name;
        const { error } = await adminClient.from("folders").update({ name }).eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "update_folder_access": {
        const id = String(payload.id || "");
        const isPaid = Boolean(payload.is_paid);
        const { error } = await adminClient.from("folders").update({ is_paid: isPaid }).eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "update_folder_pricing": {
        const id = String(payload.id || "");
        const priceInr = Number.parseInt(String(payload.price_inr || "0"), 10) || 0;
        const discountPercent = Math.max(0, Math.min(100, Number.parseInt(String(payload.discount_percent || "0"), 10) || 0));
        const salePriceInr = Number.parseInt(String(payload.sale_price_inr || "0"), 10) || 0;
        const { error } = await adminClient
          .from("folders")
          .update({
            price_inr: priceInr,
            discount_percent: discountPercent,
            sale_price_inr: salePriceInr,
          })
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "list_coupons": {
        const { data: coupons, error } = await adminClient
          .from("coupon_codes")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 400);

        const couponIds = (coupons || []).map((coupon) => coupon.id);
        let links: Array<Record<string, unknown>> = [];
        if (couponIds.length > 0) {
          const { data: linkRows, error: linkError } = await adminClient
            .from("coupon_course_folders")
            .select("coupon_id, folder_id")
            .in("coupon_id", couponIds);
          if (linkError) return json({ error: linkError.message }, 400);
          links = linkRows || [];
        }

        const folderIdsByCoupon = links.reduce((acc, link) => {
          const couponId = String(link.coupon_id || "");
          const folderId = String(link.folder_id || "");
          if (!couponId || !folderId) return acc;
          acc[couponId] = [...(acc[couponId] || []), folderId];
          return acc;
        }, {} as Record<string, string[]>);

        return json({
          data: (coupons || []).map((coupon) => ({
            ...coupon,
            folder_ids: folderIdsByCoupon[coupon.id] || [],
          })),
        });
      }

      case "create_coupon": {
        const couponPayload = buildCouponPayload(payload);
        if (!couponPayload.code) return json({ error: "Coupon code is required" }, 400);
        if (couponPayload.discount_value <= 0) return json({ error: "Discount value must be greater than 0" }, 400);

        const { data, error } = await adminClient
          .from("coupon_codes")
          .insert(couponPayload)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);

        const folderIds = normalizeFolderIds(payload.folder_ids);
        if (folderIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_course_folders").insert(
            folderIds.map((folderId) => ({ coupon_id: data.id, folder_id: folderId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }

        return json({ data: { ...data, folder_ids: folderIds } });
      }

      case "update_coupon": {
        const id = String(payload.id || "");
        if (!id) return json({ error: "Coupon id is required" }, 400);
        const couponPayload = buildCouponPayload(payload);
        if (!couponPayload.code) return json({ error: "Coupon code is required" }, 400);
        if (couponPayload.discount_value <= 0) return json({ error: "Discount value must be greater than 0" }, 400);

        const { data, error } = await adminClient
          .from("coupon_codes")
          .update(couponPayload)
          .eq("id", id)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);

        const folderIds = normalizeFolderIds(payload.folder_ids);
        const { error: deleteLinkError } = await adminClient
          .from("coupon_course_folders")
          .delete()
          .eq("coupon_id", id);
        if (deleteLinkError) return json({ error: deleteLinkError.message }, 400);

        if (folderIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_course_folders").insert(
            folderIds.map((folderId) => ({ coupon_id: id, folder_id: folderId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }

        return json({ data: { ...data, folder_ids: folderIds } });
      }

      case "delete_coupon": {
        const id = String(payload.id || "");
        const { error } = await adminClient.from("coupon_codes").delete().eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "delete_folder": {
        const id = String(payload.id || "");
        const { error } = await adminClient.from("folders").delete().eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "move_set_to_folder": {
        const setId = String(payload.set_id || "");
        const folderId = payload.folder_id ?? null;
        const { error } = await adminClient
          .from("practice_sets")
          .update({ folder_id: folderId })
          .eq("id", setId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "update_set_access": {
        const id = String(payload.id || "");
        const isPaid = Boolean(payload.is_paid);
        const { error } = await adminClient
          .from("practice_sets")
          .update({ is_paid: isPaid })
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "schedule_daily_challenge": {
        const { data, error } = await adminClient
          .from("daily_challenges")
          .insert(payload)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      case "resolve_report": {
        const id = String(payload.id || "");
        const { error } = await adminClient
          .from("question_reports")
          .update({ status: "resolved" })
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unsupported action" }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
