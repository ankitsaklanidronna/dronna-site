import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildLayout, escapeEmailHtml, sendEmailBatchOnce } from "../_shared/transactional-email.ts";

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
  const rawProductScope = String(payload.product_scope || "all");
  const productScope = ["all", "course", "ebook"].includes(rawProductScope) ? rawProductScope : "all";

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
    product_scope: productScope,
    updated_at: new Date().toISOString(),
  };
}

function normalizeFolderIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

function normalizeEbookIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

async function getRegisteredPromotionAudience(adminClient: any) {
  const emails = new Set<string>();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message || "Registered users could not be loaded");

    const users = data?.users || [];
    users.forEach((user: any) => {
      const email = String(user?.email || "").trim().toLowerCase();
      if (email) emails.add(email);
    });

    if (users.length < perPage) break;
    page += 1;
  }

  return Array.from(emails);
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
        let ebookLinks: Array<Record<string, unknown>> = [];
        if (couponIds.length > 0) {
          const { data: linkRows, error: linkError } = await adminClient
            .from("coupon_course_folders")
            .select("coupon_id, folder_id")
            .in("coupon_id", couponIds);
          if (linkError) return json({ error: linkError.message }, 400);
          links = linkRows || [];

          const { data: ebookLinkRows, error: ebookLinkError } = await adminClient
            .from("coupon_ebooks")
            .select("coupon_id, ebook_id")
            .in("coupon_id", couponIds);
          if (ebookLinkError) return json({ error: ebookLinkError.message }, 400);
          ebookLinks = ebookLinkRows || [];
        }

        const folderIdsByCoupon = links.reduce((acc, link) => {
          const couponId = String(link.coupon_id || "");
          const folderId = String(link.folder_id || "");
          if (!couponId || !folderId) return acc;
          acc[couponId] = [...(acc[couponId] || []), folderId];
          return acc;
        }, {} as Record<string, string[]>);
        const ebookIdsByCoupon = ebookLinks.reduce((acc, link) => {
          const couponId = String(link.coupon_id || "");
          const ebookId = String(link.ebook_id || "");
          if (!couponId || !ebookId) return acc;
          acc[couponId] = [...(acc[couponId] || []), ebookId];
          return acc;
        }, {} as Record<string, string[]>);

        return json({
          data: (coupons || []).map((coupon) => ({
            ...coupon,
            folder_ids: folderIdsByCoupon[coupon.id] || [],
            ebook_ids: ebookIdsByCoupon[coupon.id] || [],
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
        const ebookIds = normalizeEbookIds(payload.ebook_ids);
        if (folderIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_course_folders").insert(
            folderIds.map((folderId) => ({ coupon_id: data.id, folder_id: folderId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }
        if (ebookIds.length > 0) {
          const { error: ebookLinkError } = await adminClient.from("coupon_ebooks").insert(
            ebookIds.map((ebookId) => ({ coupon_id: data.id, ebook_id: ebookId })),
          );
          if (ebookLinkError) return json({ error: ebookLinkError.message }, 400);
        }

        return json({ data: { ...data, folder_ids: folderIds, ebook_ids: ebookIds } });
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
        const ebookIds = normalizeEbookIds(payload.ebook_ids);
        const { error: deleteLinkError } = await adminClient
          .from("coupon_course_folders")
          .delete()
          .eq("coupon_id", id);
        if (deleteLinkError) return json({ error: deleteLinkError.message }, 400);
        const { error: deleteEbookLinkError } = await adminClient
          .from("coupon_ebooks")
          .delete()
          .eq("coupon_id", id);
        if (deleteEbookLinkError) return json({ error: deleteEbookLinkError.message }, 400);

        if (folderIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_course_folders").insert(
            folderIds.map((folderId) => ({ coupon_id: id, folder_id: folderId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }
        if (ebookIds.length > 0) {
          const { error: ebookLinkError } = await adminClient.from("coupon_ebooks").insert(
            ebookIds.map((ebookId) => ({ coupon_id: id, ebook_id: ebookId })),
          );
          if (ebookLinkError) return json({ error: ebookLinkError.message }, 400);
        }

        return json({ data: { ...data, folder_ids: folderIds, ebook_ids: ebookIds } });
      }

      case "delete_coupon": {
        const id = String(payload.id || "");
        const { error } = await adminClient.from("coupon_codes").delete().eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "list_ebook_discounts": {
        const { data, error } = await adminClient
          .from("ebooks")
          .select("id, title, subtitle, cover_url, price_inr, mrp_inr, discount_percent, is_active, sort_order, updated_at")
          .order("sort_order", { ascending: true })
          .order("title", { ascending: true });
        if (error) return json({ error: error.message }, 400);
        return json({ data: data || [] });
      }

      case "update_ebook_discount": {
        const id = String(payload.id || "");
        if (!id) return json({ error: "Ebook id is required" }, 400);

        const priceInr = Number.parseInt(String(payload.price_inr || "0"), 10) || 0;
        const mrpInr = Number.parseInt(String(payload.mrp_inr || "0"), 10) || priceInr;
        if (priceInr <= 0) return json({ error: "Final price must be greater than 0" }, 400);
        if (mrpInr < priceInr) return json({ error: "MRP cannot be lower than final price" }, 400);

        const discountPercent = mrpInr > priceInr
          ? Math.round(((mrpInr - priceInr) / mrpInr) * 100)
          : 0;
        const { data, error } = await adminClient
          .from("ebooks")
          .update({
            price_inr: priceInr,
            mrp_inr: mrpInr,
            discount_percent: discountPercent,
            is_active: payload.is_active !== false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id, title, subtitle, cover_url, price_inr, mrp_inr, discount_percent, is_active, sort_order, updated_at")
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      case "preview_ebook_promotion": {
        const ebookId = String(payload.ebook_id || "");
        if (!ebookId) return json({ error: "Ebook id is required" }, 400);
        const { data: ebook, error } = await adminClient
          .from("ebooks")
          .select("id, title, subtitle, description, cover_url, price_inr, mrp_inr, discount_percent, is_active")
          .eq("id", ebookId)
          .single();
        if (error) return json({ error: error.message }, 400);
        const audience = await getRegisteredPromotionAudience(adminClient);
        return json({ data: { ebook, recipient_count: audience.length, audience_type: "registered_users" } });
      }

      case "send_ebook_promotion": {
        const ebookId = String(payload.ebook_id || "");
        const campaignId = String(payload.campaign_id || "").trim();
        if (!ebookId || !campaignId) return json({ error: "Ebook and campaign id are required" }, 400);

        const { data: ebook, error } = await adminClient
          .from("ebooks")
          .select("id, title, subtitle, description, cover_url, price_inr, mrp_inr, discount_percent, is_active")
          .eq("id", ebookId)
          .eq("is_active", true)
          .single();
        if (error) return json({ error: error.message }, 400);

        const audience = await getRegisteredPromotionAudience(adminClient);
        const price = toNonNegativeInt(ebook.price_inr, 0);
        const mrp = toNonNegativeInt(ebook.mrp_inr, price);
        const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
        const ebookTitle = String(ebook.title || "Dronna Ebook").trim();
        const ebookSubtitle = String(ebook.subtitle || "").trim();
        const ebookDescription = String(ebook.description || "").trim();
        const coverUrl = String(ebook.cover_url || "").trim();
        const subject = `नई ईबुक लॉन्च: ${ebookTitle} - ${discount}% OFF`;
        const shopUrl = `https://dronna.in/#/ebooks?ebook=${encodeURIComponent(ebook.id)}`;
        const safeTitle = escapeEmailHtml(ebookTitle);
        const safeSubtitle = escapeEmailHtml(ebookSubtitle);
        const safeDescription = escapeEmailHtml(ebookDescription);
        const safeCoverUrl = escapeEmailHtml(coverUrl);
        const safeShopUrl = escapeEmailHtml(shopUrl);
        const body = `
          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">प्रिय विद्यार्थी,</p>
          <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#172033;"><strong>Dronna पर नई ईबुक “${safeTitle}” अब उपलब्ध है।</strong></p>
          ${safeSubtitle ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">${safeSubtitle}</p>` : ""}
          ${safeCoverUrl ? `<p style="margin:20px 0;text-align:center;"><img src="${safeCoverUrl}" alt="${safeTitle}" width="220" style="display:inline-block;width:220px;max-width:70%;height:auto;border-radius:6px;border:1px solid #e2e8f0;box-shadow:0 16px 30px rgba(15,23,42,0.18);" /></p>` : ""}
          ${safeDescription ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">${safeDescription}</p>` : ""}
          <div style="margin:20px 0;padding:18px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;text-align:center;">
            <div style="font-size:13px;font-weight:800;color:#9a3412;">LAUNCHING OFFER</div>
            <div style="margin-top:6px;font-size:28px;font-weight:800;color:#172033;">₹${price} ${mrp > price ? `<span style="font-size:16px;color:#94a3b8;text-decoration:line-through;">₹${mrp}</span>` : ""}</div>
            <div style="margin-top:4px;font-size:16px;font-weight:800;color:#15803d;">${discount}% OFF</div>
          </div>
          <div style="margin:0 0 20px;padding:14px 16px;border-radius:8px;background:#f0fdfa;color:#115e59;font-size:14px;line-height:1.8;">
            <strong>PDF Ebook</strong><br />
            खरीद के बाद तुरंत एक्सेस<br />
            आपकी PDF आपके Dronna login email से password-protected रहेगी
          </div>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155;">Launch offer का लाभ उठाएं और उत्तराखंड के प्राचीन, मध्यकालीन तथा आधुनिक इतिहास की अपनी तैयारी को मजबूत बनाएं।</p>
          <p style="margin:0;text-align:center;"><a href="${safeShopUrl}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:7px;">अभी ईबुक खरीदें - ₹${price}</a></p>
          <p style="margin:14px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#64748b;">Button न खुले तो यह लिंक इस्तेमाल करें:<br /><a href="${safeShopUrl}" style="color:#c2410c;word-break:break-all;">${safeShopUrl}</a></p>`;
        const html = buildLayout(
          `${ebookTitle} अब उपलब्ध है`,
          body,
          "आपको यह promotional email इसलिए मिली क्योंकि आपका Dronna account registered है। Promotional emails बंद करवाने के लिए इस email का reply “UNSUBSCRIBE” लिखकर करें या support@dronna.in पर संपर्क करें।",
        );
        const text = `प्रिय विद्यार्थी,\n\nDronna पर नई ईबुक “${ebookTitle}” अब उपलब्ध है।\n\n${ebookSubtitle ? `${ebookSubtitle}\n\n` : ""}${ebookDescription ? `${ebookDescription}\n\n` : ""}Launching offer: Rs ${price}${mrp > price ? ` (MRP Rs ${mrp})` : ""} - ${discount}% OFF.\n\nPDF Ebook | खरीद के बाद तुरंत एक्सेस | Login email से password-protected PDF.\n\nअभी ईबुक खरीदें: ${shopUrl}\n\nRegards,\nDronna Support\n\nआपको यह promotional email इसलिए मिली क्योंकि आपका Dronna account registered है। Promotional emails बंद करवाने के लिए इस email का reply “UNSUBSCRIBE” लिखकर करें या support@dronna.in पर संपर्क करें।`;
        const emailPayloads = audience.map((email) => ({
          to: email,
          subject,
          html,
          text,
          eventKey: `ebook_promotion:${campaignId}:${email}`,
          eventType: "ebook_promotion",
          metadata: {
            campaign_id: campaignId,
            audience_type: "registered_users",
            ebook_id: ebookId,
            price_inr: price,
            mrp_inr: mrp,
            discount_percent: discount,
          },
        }));
        const sendResult = await sendEmailBatchOnce(
          adminClient,
          emailPayloads,
          `ebook-promotion:${campaignId}`,
        );
        return json({
          data: {
            recipient_count: audience.length,
            sent: sendResult.sent,
            skipped: sendResult.skipped,
            failed_count: sendResult.failed.length,
          },
        });
      }

      case "list_ebook_coupons": {
        const { data: coupons, error } = await adminClient
          .from("coupon_codes")
          .select("*")
          .eq("product_scope", "ebook")
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 400);

        const couponIds = (coupons || []).map((coupon) => coupon.id);
        let links: Array<Record<string, unknown>> = [];
        if (couponIds.length > 0) {
          const { data: linkRows, error: linkError } = await adminClient
            .from("coupon_ebooks")
            .select("coupon_id, ebook_id")
            .in("coupon_id", couponIds);
          if (linkError) return json({ error: linkError.message }, 400);
          links = linkRows || [];
        }

        const ebookIdsByCoupon = links.reduce((acc, link) => {
          const couponId = String(link.coupon_id || "");
          const ebookId = String(link.ebook_id || "");
          if (!couponId || !ebookId) return acc;
          acc[couponId] = [...(acc[couponId] || []), ebookId];
          return acc;
        }, {} as Record<string, string[]>);

        return json({
          data: (coupons || []).map((coupon) => ({
            ...coupon,
            ebook_ids: ebookIdsByCoupon[coupon.id] || [],
          })),
        });
      }

      case "create_ebook_coupon": {
        const couponPayload = {
          ...buildCouponPayload(payload),
          product_scope: "ebook",
        };
        if (!couponPayload.code) return json({ error: "Coupon code is required" }, 400);
        if (couponPayload.discount_value <= 0) return json({ error: "Discount value must be greater than 0" }, 400);

        const { data, error } = await adminClient
          .from("coupon_codes")
          .insert(couponPayload)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);

        const ebookIds = normalizeEbookIds(payload.ebook_ids);
        if (ebookIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_ebooks").insert(
            ebookIds.map((ebookId) => ({ coupon_id: data.id, ebook_id: ebookId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }

        return json({ data: { ...data, ebook_ids: ebookIds } });
      }

      case "update_ebook_coupon": {
        const id = String(payload.id || "");
        if (!id) return json({ error: "Coupon id is required" }, 400);
        const couponPayload = {
          ...buildCouponPayload(payload),
          product_scope: "ebook",
        };
        if (!couponPayload.code) return json({ error: "Coupon code is required" }, 400);
        if (couponPayload.discount_value <= 0) return json({ error: "Discount value must be greater than 0" }, 400);

        const { data, error } = await adminClient
          .from("coupon_codes")
          .update(couponPayload)
          .eq("id", id)
          .select("*")
          .single();
        if (error) return json({ error: error.message }, 400);

        const ebookIds = normalizeEbookIds(payload.ebook_ids);
        const { error: deleteLinkError } = await adminClient
          .from("coupon_ebooks")
          .delete()
          .eq("coupon_id", id);
        if (deleteLinkError) return json({ error: deleteLinkError.message }, 400);

        if (ebookIds.length > 0) {
          const { error: linkError } = await adminClient.from("coupon_ebooks").insert(
            ebookIds.map((ebookId) => ({ coupon_id: id, ebook_id: ebookId })),
          );
          if (linkError) return json({ error: linkError.message }, 400);
        }

        return json({ data: { ...data, ebook_ids: ebookIds } });
      }

      case "delete_ebook_coupon": {
        const id = String(payload.id || "");
        const { error } = await adminClient
          .from("coupon_codes")
          .delete()
          .eq("id", id)
          .eq("product_scope", "ebook");
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
