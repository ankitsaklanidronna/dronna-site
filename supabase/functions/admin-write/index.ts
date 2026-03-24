import { createClient } from "jsr:@supabase/supabase-js@2";

type ActionRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Missing Supabase environment configuration");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: json({ error: "Missing Authorization header" }, 401) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user?.email) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: adminRow, error: adminError } = await adminClient
    .from("admins")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (adminError) return { error: json({ error: adminError.message }, 500) };
  if (!adminRow) return { error: json({ error: "Forbidden" }, 403) };

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
