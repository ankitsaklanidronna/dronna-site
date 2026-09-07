import { createClient } from "jsr:@supabase/supabase-js@2";

type EbookAccessRequest = {
  ebook_id?: string;
};

type PurchaseRow = {
  id: string;
  student_email: string;
  ebook_id: string;
  status: string;
  download_password: string;
  protected_file_path?: string | null;
  generation_status?: string | null;
};

type EbookRow = {
  id: string;
  title: string;
  file_url?: string | null;
  source_bucket?: string | null;
  source_file_path?: string | null;
  protected_bucket?: string | null;
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

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function safeSegment(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
}

function getErrorMessage(error: unknown, fallback = "Unknown error") {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const nested = value.message || value.error || value.description || value.detail;
    if (typeof nested === "string") return nested;
    if (nested && typeof nested === "object") return getErrorMessage(nested, fallback);
    try {
      return JSON.stringify(value);
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function base64UrlEncode(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", key, encoder.encode(value));
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

  return { adminClient, email: normalizeEmail(user.email) };
}

async function ensureIlovePdfToken() {
  const publicKey = getEnv("ILOVEPDF_PUBLIC_KEY");
  const secretKey = getEnv("ILOVEPDF_SECRET_KEY");
  if (!publicKey) throw new Error("ILOVEPDF_PUBLIC_KEY is not configured");

  if (secretKey) {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      jti: publicKey,
      iss: "api.ilovepdf.com",
      iat: Math.floor(Date.now() / 1000) - 5,
    };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await hmacSha256(signingInput, secretKey);
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }

  const response = await fetch("https://api.ilovepdf.com/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) {
    throw new Error(getErrorMessage(data?.message || data?.error || data, "iLovePDF authentication failed"));
  }
  return String(data.token);
}

async function iloveJson(url: string, token: string, body?: Record<string, unknown>) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getErrorMessage(data?.message || data?.error || data, `iLovePDF request failed (${response.status})`));
  }
  return data;
}

async function startIloveTask(token: string, tool: string) {
  const regions = uniqueValues([getEnv("ILOVEPDF_REGION") || "in", "eu", "us"]);
  const errors: string[] = [];

  for (const region of regions) {
    try {
      return await iloveJson(`https://api.ilovepdf.com/v1/start/${tool}/${region}`, token);
    } catch (error) {
      errors.push(`${region}: ${getErrorMessage(error, "start failed")}`);
    }
  }

  throw new Error(`iLovePDF task could not be initialized (${errors.join("; ")})`);
}

async function fetchOriginalPdf(adminClient: any, ebook: EbookRow) {
  if (ebook.source_file_path) {
    const bucket = ebook.source_bucket || "ebook-originals";
    const { data, error } = await adminClient.storage
      .from(bucket)
      .download(ebook.source_file_path);
    if (error || !data) {
      throw new Error(error?.message || "Original ebook PDF could not be loaded from storage");
    }
    return await data.arrayBuffer();
  }

  if (ebook.file_url) {
    const response = await fetch(ebook.file_url);
    if (!response.ok) {
      throw new Error("Original ebook PDF could not be downloaded from file_url");
    }
    return await response.arrayBuffer();
  }

  throw new Error("Original PDF is not uploaded yet");
}

async function protectPdfWithIlovePdf(pdfBytes: ArrayBuffer, filename: string, password: string) {
  const token = await ensureIlovePdfToken();
  const start = await startIloveTask(token, "protect");
  const server = String(start.server || "");
  const task = String(start.task || "");
  if (!server || !task) throw new Error("iLovePDF did not return a processing task");

  const uploadForm = new FormData();
  uploadForm.append("task", task);
  uploadForm.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);

  const uploadResponse = await fetch(`https://${server}/v1/upload`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: uploadForm,
  });
  const upload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !upload?.server_filename) {
    throw new Error(getErrorMessage(upload?.message || upload?.error || upload, "iLovePDF upload failed"));
  }

  await iloveJson(`https://${server}/v1/process`, token, {
    task,
    tool: "protect",
    files: [{
      server_filename: upload.server_filename,
      filename,
    }],
    password,
    output_filename: filename.replace(/\.pdf$/i, "-protected"),
  });

  const downloadResponse = await fetch(`https://${server}/v1/download/${task}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!downloadResponse.ok) {
    const errorData = await downloadResponse.json().catch(() => ({}));
    throw new Error(getErrorMessage(errorData?.message || errorData?.error || errorData, "iLovePDF download failed"));
  }

  return await downloadResponse.arrayBuffer();
}

async function createSignedUrl(adminClient: any, bucket: string, path: string) {
  const { data, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Signed ebook URL could not be created");
  }
  return data.signedUrl;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const verified = await getVerifiedUser(req);
    if ("error" in verified) return verified.error;
    const { adminClient, email } = verified;
    const { ebook_id: ebookId = "" } = (await req.json().catch(() => ({}))) as EbookAccessRequest;
    if (!ebookId) return json({ error: "Missing ebook_id" }, 400);

    const { data: purchase, error: purchaseError } = await adminClient
      .from("ebook_purchases")
      .select("id, student_email, ebook_id, status, download_password, protected_file_path, generation_status")
      .eq("ebook_id", ebookId)
      .eq("student_email", email)
      .eq("status", "active")
      .maybeSingle();
    if (purchaseError) return json({ error: purchaseError.message }, 400);
    if (!purchase) return json({ error: "This ebook is not active on your account" }, 403);

    const { data: ebook, error: ebookError } = await adminClient
      .from("ebooks")
      .select("id, title, file_url, source_bucket, source_file_path, protected_bucket")
      .eq("id", ebookId)
      .maybeSingle();
    if (ebookError) return json({ error: ebookError.message }, 400);
    if (!ebook) return json({ error: "Ebook was not found" }, 404);

    const typedPurchase = purchase as PurchaseRow;
    const typedEbook = ebook as EbookRow;
    const protectedBucket = typedEbook.protected_bucket || "ebook-protected";

    if (typedPurchase.protected_file_path && typedPurchase.generation_status === "ready") {
      const signed_url = await createSignedUrl(adminClient, protectedBucket, typedPurchase.protected_file_path);
      return json({
        ok: true,
        status: "ready",
        signed_url,
        password: typedPurchase.download_password || email,
      });
    }

    await adminClient
      .from("ebook_purchases")
      .update({
        generation_status: "processing",
        generation_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", typedPurchase.id);

    try {
      const originalPdf = await fetchOriginalPdf(adminClient, typedEbook);
      const password = typedPurchase.download_password || email;
      const outputName = `${safeSegment(typedEbook.title)}.pdf`;
      const protectedPdf = await protectPdfWithIlovePdf(originalPdf, outputName, password);
      const protectedPath = `${typedEbook.id}/${safeSegment(email)}.pdf`;

      const { error: uploadError } = await adminClient.storage
        .from(protectedBucket)
        .upload(protectedPath, protectedPdf, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { error: updateError } = await adminClient
        .from("ebook_purchases")
        .update({
          protected_file_path: protectedPath,
          generation_status: "ready",
          generation_error: null,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", typedPurchase.id);
      if (updateError) throw new Error(updateError.message);

      const signed_url = await createSignedUrl(adminClient, protectedBucket, protectedPath);
      return json({
        ok: true,
        status: "ready",
        signed_url,
        password,
      });
    } catch (error) {
      const message = getErrorMessage(error, "Ebook generation failed");
      await adminClient
        .from("ebook_purchases")
        .update({
          generation_status: "failed",
          generation_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", typedPurchase.id);
      return json({ error: message, status: "failed" }, 500);
    }
  } catch (error) {
    return json({ error: getErrorMessage(error, "Unknown error") }, 500);
  }
});
