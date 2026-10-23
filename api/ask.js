/* Vercel serverless function — /api/ask
   Receives { question, context } from the dashboard and streams a response
   from the Gemini API. The GEMINI_API_KEY lives in Vercel env vars — never
   in client-side code.                                                      */

export const config = { runtime: "edge" };

const MODEL = "gemini-2.0-flash-exp";
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

  const { question, context, history = [] } = body;
  if (!question) return new Response("No question provided", { status: 400 });

  /* Build a tight system prompt grounded in the dashboard's current state */
  const system = `You are a labour-market intelligence assistant embedded in the GATI (Global Access to Talent from India) dashboard. GATI facilitates ethical, circular global skills mobility — primarily placing Indian workers in Germany and Japan.

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
- Be direct. No filler phrases.`;

  /* Build conversation turns */
  const contents = [];
  history.forEach(function(turn) {
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  });
  contents.push({ role: "user", parts: [{ text: question }] });

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      topP: 0.8,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  const url = `${API_BASE}${MODEL}:streamGenerateContent?alt=sse&key=${key}`;

  let geminiRes;
  try {
    geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return new Response("Gemini API unreachable: " + e.message, { status: 502 });
  }

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    return new Response("Gemini error: " + err, { status: geminiRes.status });
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
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
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
