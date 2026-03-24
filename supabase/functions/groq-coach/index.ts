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

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!groqKey) return json({ error: "Missing GROQ_API_KEY secret" }, 500);

    const { promptText } = await req.json();
    if (!promptText) return json({ error: "Missing promptText" }, 400);

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
            content: "You are an experienced Hindi-speaking teacher for UKPSC/UKSSSC competitive exams. Always respond in Hindi (Devanagari script). Be direct, specific and encouraging like a real mentor."
          },
          { role: "user", content: promptText }
        ],
        max_tokens: 500,
        temperature: 0.75
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
