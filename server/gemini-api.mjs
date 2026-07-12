import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json({ limit: "256kb" }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const PORT = Number(process.env.GEMINI_PROXY_PORT ?? 8787);

app.post("/api/voice/gemini", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Missing GEMINI_API_KEY. Set it in your local .env file.",
    });
  }

  const transcript = String(req.body?.transcript ?? "").trim();
  const context = req.body?.context ?? {};

  if (!transcript) {
    return res.status(400).json({ error: "Missing transcript." });
  }

  const prompt = [
    "You are a voice-command resolver for a rehabilitation controller UI.",
    "Return JSON only with keys: action, response.",
    'action must be one of: "NONE","STOP","PLUS","MINUS","EMG_ON","EMG_OFF","CONNECT","DISCONNECT","NAVIGATE_HOME","NAVIGATE_STIMULATION","NAVIGATE_DIAGNOSTIC","NAVIGATE_GRIPAID".',
    "Use NONE for general Q&A.",
    "If user asks unsafe medical/health advice, keep response cautious and brief.",
    `Context: connected=${Boolean(context.connected)}, emgEnabled=${Boolean(context.emgEnabled)}, level=${Number(context.level) || 0}.`,
    `User transcript: ${transcript}`,
  ].join("\n");

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const details = await geminiResponse.text();
      return res.status(502).json({ error: "Gemini request failed.", details });
    }

    const data = await geminiResponse.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = safeParseJson(text);

    if (!parsed || typeof parsed.action !== "string" || typeof parsed.response !== "string") {
      return res.status(502).json({ error: "Gemini returned invalid format.", raw: text });
    }

    return res.json({
      action: parsed.action,
      response: parsed.response,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Gemini proxy error.",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gemini proxy listening on http://localhost:${PORT}`);
});

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
