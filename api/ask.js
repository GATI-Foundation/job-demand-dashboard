/* Vercel serverless function - /api/ask
   Receives { question, context } from the dashboard and streams a response
   from the Gemini API. The GEMINI_API_KEY lives in Vercel env vars - never
   in client-side code.                                                      */

export const config = { runtime: "edge" };

/* gemini-2.0-flash-exp has been shut down by Google, so every call to it failed.
   Use a current stable Flash model. Override without a code change by setting
   GEMINI_MODEL in Vercel env vars.                                           */
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
/* If the main model is overloaded (503) or rate-limited (429), retry once and
   then fall back to these, in order. Override with GEMINI_FALLBACK_MODELS
   (comma-separated) in Vercel env vars.                                      */
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite")
  .split(",").map(function(m) { return m.trim(); }).filter(Boolean);
const RETRYABLE = [429, 500, 502, 503, 504];
const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response("API key not configured", { status: 500 });

  let body;
  try { body = await req.json(); }
  catch (e) { return new Response("Invalid JSON", { status: 400 }); }

  const { question, history = [] } = body;
  const context = body.context || {};
  if (!question) return new Response("No question provided", { status: 400 });

  /* Build a tight system prompt grounded in the dashboard's current state */
  const system = `You are a labour-market intelligence assistant embedded in the GATI (Global Access to Talent from India) dashboard. GATI facilitates ethical, circular global skills mobility, primarily placing Indian workers in Germany and Japan.

The user is viewing the ${context.sector || "sector"} dashboard${context.filters?.state && context.filters.state !== "ALL" ? ` filtered to ${context.filters.state}` : ""}${context.filters?.isic && context.filters.isic !== "ALL" ? `, employer sector: ${context.filters.isic}` : ""}.

CURRENT DASHBOARD SNAPSHOT:
${JSON.stringify(context, null, 2)}

RULES:
- Answer concisely. 2-4 sentences for simple questions, max 8 sentences for complex ones.
- Ground every claim in the numbers above. Never invent figures.
- If asked to show a chart, return ONLY a JSON block in this exact format and nothing else:
  \`\`\`chart
  {"type":"bar|horizontal_bar|line|pie","title":"...","labels":[...],"values":[...],"color":"teal|gold|multi"}
  \`\`\`
- If asked for a chart but you lack the data, say so and answer in text instead.
- When relevant, connect insights to GATI's mission: Indian worker placement, skills-mobility corridors, visa signals, employer demand.
- Be direct. No filler phrases.
- Never use em dashes or en dashes. Use commas, colons or full stops instead.`;

  /* Build conversation turns */
  const contents = [];
  history.forEach(function(turn) {
    if (!turn || !turn.text) return;
    contents.push({ role: turn.role === "model" ? "model" : "user", parts: [{ text: turn.text }] });
  });
  /* the client's history already ends with this question; do not send it twice */
  const last = contents[contents.length - 1];
  if (last && last.role === "user" && last.parts[0].text === question) contents.pop();
  contents.push({ role: "user", parts: [{ text: question }] });

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: contents,
    generationConfig: {
      /* Gemini 3.x thinks before answering and those tokens count against
         maxOutputTokens, so keep thinking low and leave room for the answer.
         Google advises leaving temperature at its default for 3.x models.   */
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  /* Try the main model (twice, with a short pause), then each fallback once.
     Stop at the first success, or at an error that retrying cannot fix
     (bad key, bad request).                                                 */
  const attempts = [MODEL, MODEL].concat(FALLBACKS.filter(function(m) { return m !== MODEL; }));
  let geminiRes = null, lastStatus = 502, lastErr = "";
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(i === 1 ? 800 : 300);
    const url = `${API_BASE}${attempts[i]}:streamGenerateContent?alt=sse`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      });
      if (res.ok) { geminiRes = res; break; }
      lastStatus = res.status;
      lastErr = await res.text();
      /* a fallback model the key cannot use (404) is skipped, not fatal */
      if (!RETRYABLE.includes(res.status) && !(res.status === 404 && i > 0)) break;
    } catch (e) {
      lastStatus = 502;
      lastErr = "Gemini API unreachable: " + e.message;
    }
  }
  if (!geminiRes) {
    return new Response("Gemini error: " + lastErr, { status: lastStatus });
  }

  /* Stream Gemini's SSE response straight back to the client */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          /* join every answer part; skip "thought" parts from the model's reasoning */
          const parts = parsed?.candidates?.[0]?.content?.parts || [];
          const text = parts.filter(function(p) { return p.text && !p.thought; })
                            .map(function(p) { return p.text; }).join("");
          if (text) {
            await writer.write(encoder.encode("data: " + JSON.stringify({ text }) + "\n\n"));
          }
        } catch (e) { /* skip malformed lines */ }
      }
    }
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
