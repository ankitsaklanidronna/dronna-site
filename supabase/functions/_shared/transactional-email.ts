const DEFAULT_FROM = "Dronna Support <support@dronna.in>";
const DEFAULT_REPLY_TO = "support@dronna.in";

type SupabaseAdminClient = {
  from: (table: string) => any;
};

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  eventKey: string;
  eventType: string;
  metadata?: Record<string, unknown>;
};

type BatchEmailResult = {
  sent: number;
  skipped: number;
  failed: string[];
};

function getEnv(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildLayout(title: string, body: string, footer?: string) {
  return `
<!doctype html>
<html>
  <body style="margin:0;background:#f7f3ed;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3ed;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #eadfce;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#172033;color:#ffffff;padding:22px 26px;">
                <div style="font-size:22px;font-weight:800;letter-spacing:0;">Dronna</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 26px;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#172033;">${escapeHtml(title)}</h1>
                ${body}
                <p style="margin:26px 0 0;font-size:14px;line-height:1.7;color:#516070;">
                  Regards,<br />
                  Dronna Support
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px;background:#fbfaf8;color:#6b7280;font-size:12px;line-height:1.6;">
                ${footer || "This is an automated transactional email from Dronna. For help, reply to this email or contact support@dronna.in."}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeEmailHtml(value: unknown) {
  return escapeHtml(value);
}

async function createPendingEvent(adminClient: SupabaseAdminClient, payload: EmailPayload) {
  const { data: existingEvent, error: lookupError } = await adminClient
    .from("email_events")
    .select("status")
    .eq("event_key", payload.eventKey)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message || "Email event could not be checked");
  if (existingEvent?.status === "sent" || existingEvent?.status === "pending") {
    return { shouldSend: false, skipped: true };
  }
  if (existingEvent?.status === "failed") {
    const { error } = await adminClient
      .from("email_events")
      .update({
        status: "pending",
        recipient_email: normalizeEmail(payload.to),
        subject: payload.subject,
        error_message: null,
        metadata: payload.metadata || {},
        updated_at: new Date().toISOString(),
      })
      .eq("event_key", payload.eventKey);
    if (error) throw new Error(error.message || "Email event could not be prepared");
    return { shouldSend: true };
  }

  const { error } = await adminClient
    .from("email_events")
    .insert({
      event_key: payload.eventKey,
      event_type: payload.eventType,
      recipient_email: normalizeEmail(payload.to),
      subject: payload.subject,
      status: "pending",
      metadata: payload.metadata || {},
    });

  if (!error) return { shouldSend: true };
  if (error.code === "23505") return { shouldSend: false, skipped: true };
  throw new Error(error.message || "Email event could not be recorded");
}

async function updateEmailEvent(
  adminClient: SupabaseAdminClient,
  eventKey: string,
  updates: Record<string, unknown>,
) {
  await adminClient
    .from("email_events")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("event_key", eventKey);
}

export async function sendEmailOnce(adminClient: SupabaseAdminClient, payload: EmailPayload) {
  const resendApiKey = getEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const to = normalizeEmail(payload.to);
  if (!to) throw new Error("Recipient email is required");

  const pending = await createPendingEvent(adminClient, { ...payload, to });
  if (!pending.shouldSend) return { ok: true, skipped: true };

  if (!isValidEmail(to)) {
    const message = "Invalid recipient email format";
    await updateEmailEvent(adminClient, payload.eventKey, {
      status: "failed",
      error_message: message,
    });
    throw new Error(message);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEnv("EMAIL_FROM") || DEFAULT_FROM,
      to: [to],
      reply_to: getEnv("EMAIL_REPLY_TO") || DEFAULT_REPLY_TO,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.message || result?.error || "Email provider rejected the message";
    await updateEmailEvent(adminClient, payload.eventKey, {
      status: "failed",
      error_message: message,
    });
    throw new Error(message);
  }

  await updateEmailEvent(adminClient, payload.eventKey, {
    status: "sent",
    provider_message_id: result?.id || null,
    sent_at: new Date().toISOString(),
    error_message: null,
  });

  return { ok: true, id: result?.id || null };
}

export async function sendEmailBatchOnce(
  adminClient: SupabaseAdminClient,
  payloads: EmailPayload[],
  batchKey: string,
): Promise<BatchEmailResult> {
  const resendApiKey = getEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const prepared: EmailPayload[] = [];
  const failed: string[] = [];
  let skipped = 0;

  for (const payload of payloads) {
    const to = normalizeEmail(payload.to);
    if (!to || !isValidEmail(to)) {
      failed.push(to || String(payload.to || ""));
      continue;
    }

    const normalizedPayload = { ...payload, to };
    try {
      const pending = await createPendingEvent(adminClient, normalizedPayload);
      if (pending.shouldSend) prepared.push(normalizedPayload);
      else skipped += 1;
    } catch (_error) {
      failed.push(to);
    }
  }

  let sent = 0;
  for (let offset = 0; offset < prepared.length; offset += 100) {
    const chunk = prepared.slice(offset, offset + 100);
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${batchKey}:${Math.floor(offset / 100) + 1}`,
      },
      body: JSON.stringify(chunk.map((payload) => ({
        from: getEnv("EMAIL_FROM") || DEFAULT_FROM,
        to: [payload.to],
        reply_to: getEnv("EMAIL_REPLY_TO") || DEFAULT_REPLY_TO,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }))),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.message || result?.error || "Email provider rejected the batch";
      await Promise.all(chunk.map((payload) => updateEmailEvent(adminClient, payload.eventKey, {
        status: "failed",
        error_message: message,
      })));
      failed.push(...chunk.map((payload) => payload.to));
      continue;
    }

    const providerRows = Array.isArray(result?.data) ? result.data : [];
    await Promise.all(chunk.map((payload, index) => updateEmailEvent(adminClient, payload.eventKey, {
      status: "sent",
      provider_message_id: providerRows[index]?.id || null,
      sent_at: new Date().toISOString(),
      error_message: null,
    })));
    sent += chunk.length;
  }

  return { sent, skipped, failed };
}

export async function sendWelcomeEmail(
  adminClient: SupabaseAdminClient,
  details: { email: string; name?: string; examTarget?: string },
) {
  const email = normalizeEmail(details.email);
  const name = String(details.name || email.split("@")[0] || "Student").trim();
  const examTarget = String(details.examTarget || "your exam").trim();
  const subject = "Welcome to Dronna";
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">Dear ${escapeHtml(name)},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
      Thank you for creating your Dronna account. We are pleased to have you with us.
    </p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
      Your dashboard is now ready, and you can start exploring free practice sets, progress tracking, and available course material for ${escapeHtml(examTarget)} preparation.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#334155;">
      We wish you a focused and productive learning journey.
    </p>`;

  return await sendEmailOnce(adminClient, {
    to: email,
    subject,
    html: buildLayout(subject, body),
    text: `Dear ${name},\n\nThank you for creating your Dronna account. Your dashboard is now ready, and you can start exploring free practice sets, progress tracking, and available course material for ${examTarget} preparation.\n\nWe wish you a focused and productive learning journey.\n\nRegards,\nDronna Support`,
    eventKey: `welcome:${email}`,
    eventType: "welcome",
    metadata: { name, exam_target: examTarget },
  });
}

export async function sendCoursePurchaseEmail(
  adminClient: SupabaseAdminClient,
  details: {
    email: string;
    name?: string;
    courseName?: string;
    amountInr?: number | string | null;
    orderId?: string;
    paymentId?: string;
  },
) {
  const email = normalizeEmail(details.email);
  const name = String(details.name || email.split("@")[0] || "Student").trim();
  const courseName = String(details.courseName || "your course").trim();
  const amountValue = Number(details.amountInr || 0);
  const amountText = Number.isFinite(amountValue) && amountValue > 0 ? `Rs ${amountValue}` : "the paid amount";
  const orderId = String(details.orderId || "").trim();
  const paymentId = String(details.paymentId || "").trim();
  const subject = "Thank you for your purchase";
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">Dear ${escapeHtml(name)},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
      Thank you for purchasing ${escapeHtml(courseName)} on Dronna.
    </p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
      Your payment of ${escapeHtml(amountText)} has been received successfully, and your course access is now active.
    </p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
      You may log in to your dashboard and start learning immediately.
    </p>
    ${orderId ? `<p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">Order ID: ${escapeHtml(orderId)}${paymentId ? `<br />Payment ID: ${escapeHtml(paymentId)}` : ""}</p>` : ""}`;

  return await sendEmailOnce(adminClient, {
    to: email,
    subject,
    html: buildLayout(subject, body),
    text: `Dear ${name},\n\nThank you for purchasing ${courseName} on Dronna. Your payment of ${amountText} has been received successfully, and your course access is now active.\n\nYou may log in to your dashboard and start learning immediately.${orderId ? `\n\nOrder ID: ${orderId}${paymentId ? `\nPayment ID: ${paymentId}` : ""}` : ""}\n\nRegards,\nDronna Support`,
    eventKey: `course_purchase:${orderId || paymentId || `${email}:${courseName}`}`,
    eventType: "course_purchase",
    metadata: {
      name,
      course_name: courseName,
      amount_inr: Number.isFinite(amountValue) ? amountValue : null,
      order_id: orderId || null,
      payment_id: paymentId || null,
    },
  });
}
