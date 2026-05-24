import { createClient } from "jsr:@supabase/supabase-js@2";

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

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function getEnv(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function normalizeCoachLanguage(value: unknown) {
  return String(value || "").trim().toLowerCase() === "english" ? "english" : "hindi";
}

function buildSystemPrompt(coachLanguage: string) {
  const languageRule = normalizeCoachLanguage(coachLanguage) === "english"
    ? "Always respond in English."
    : "Always respond in Hindi using Devanagari script.";

  return `You are an experienced UKPSC/UKSSSC competitive exam teacher. ${languageRule} Use only the facts given by the user and never invent missing details. Be direct, specific, concise, and diagnostic. Explicitly call out the exact mistake pattern, weakest topic or subject, numerical weakness if present, and whether the student is attempting too fast. Avoid generic motivation, filler, or repetitive praise. Prefer one sharp summary line followed by short numbered action points.`;
}

async function getVerifiedProStudent(req: Request) {
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

  const { data: profile, error: profileError } = await adminClient
    .from("students")
    .select("subscription_plan, ai_coach_language")
    .eq("email", normalizeEmail(user.email))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (profileError) return { error: json({ error: profileError.message }, 400) };
  const { data: purchases, error: purchaseError } = await adminClient
    .from("course_purchases")
    .select("id")
    .eq("student_email", normalizeEmail(user.email))
    .eq("status", "active")
    .limit(1);

  if (purchaseError) return { error: json({ error: purchaseError.message }, 400) };
  if (profile?.subscription_plan !== "pro" && (!Array.isArray(purchases) || purchases.length === 0)) {
    return { error: json({ error: "AI support is available only for Pro students" }, 403) };
  }

  return { user, profile };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const verified = await getVerifiedProStudent(req);
    if ("error" in verified) return verified.error;

    const groqKey = getEnv("GROQ_API_KEY");
    if (!groqKey) return json({ error: "Missing GROQ_API_KEY secret" }, 500);

    const { promptText, coachLanguage } = await req.json();
    if (!promptText) return json({ error: "Missing promptText" }, 400);
    const responseLanguage = normalizeCoachLanguage(coachLanguage || verified.profile?.ai_coach_language);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(responseLanguage)
          },
          { role: "user", content: promptText }
        ],
        max_tokens: 280,
        temperature: 0.2
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return json({ error: data?.error?.message || "Groq request failed" }, response.status);
    }

    return json({
      content: data?.choices?.[0]?.message?.content || null,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
