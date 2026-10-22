const fs = require("fs");
const path = require("path");

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
const GROQ_MODELS_URL = `${GROQ_BASE_URL}/models`;
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

function getEnvKeys(names) {
  const envPath = path.join(process.cwd(), ".env");
  const keys = [];
  const wanted = new Set(names);

  for (const name of names) {
    if (process.env[name]) keys.push(...String(process.env[name]).split(/[\s,]+/));
  }

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || !wanted.has(match[1])) continue;

      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) value = value.slice(1, -1).trim();

      if (value) keys.push(...value.split(/[\s,]+/));
    }
  }

  return [...new Set(keys.map(key => key.trim()).filter(Boolean))];
}

// ZENX_API_KEY is the user's Grok-key slot. The explicitly named Grok aliases
// are accepted too; Groq remains an independent fallback provider.
function getZenXKeys() {
  return getEnvKeys(["ZENX_API_KEY", "GROK_API_KEY", "XAI_API_KEY"]);
}

function getGroqKeys() {
  return getEnvKeys(["GROQ_API_KEY"]);
}

async function getGroqModel(apiKey) {
  const response = await fetch(GROQ_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  const raw = await response.text();

  let data = {};

  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.message ||
      raw ||
      `HTTP ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  const models = Array.isArray(data?.data)
    ? data.data
    : [];

  const preferred = [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant"
  ];

  for (const preferredModel of preferred) {
    const found = models.find(
      model =>
        model?.id === preferredModel &&
        model?.active !== false
    );

    if (found) {
      return found.id;
    }
  }

  const activeModel = models.find(
    model => model?.active !== false
  );

  if (activeModel?.id) {
    return activeModel.id;
  }

  throw new Error("Groq returned no usable models");
}

function extractText(data) {
  const content =
    data?.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map(part => {
        if (typeof part === "string") return part;
        return part?.text || "";
      })
      .join("")
      .trim();

    if (text) return text;
  }

  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  return "";
}

async function callGroq({
  apiKey,
  model,
  system,
  prompt
}) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      model,

      messages: [
        {
          role: "system",
          content: String(system || "")
        },
        {
          role: "user",
          content: String(prompt || "")
        }
      ],

      temperature: 0.2
    })
  });

  const raw = await response.text();

  let data = {};

  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.message ||
      raw ||
      `HTTP ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  const result = extractText(data);

  if (!result) {
    throw new Error("Groq returned an empty response");
  }

  return result;
}

async function callGrok({ apiKey, system, prompt }) {
  const model = process.env.GROK_MODEL || "grok-4.7";
  const response = await fetch(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: String(system || "") },
        { role: "user", content: String(prompt || "") }
      ],
      temperature: 0.2,
      max_tokens: 1200
    }),
    signal: AbortSignal.timeout(45000)
  });

  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || data?.message || raw || `HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const result = extractText(data);
  if (!result) throw new Error("Grok returned an empty response");
  return result;
}

async function askAI({
  prompt,
  system = ""
}) {
  const grokKeys = getZenXKeys();
  const groqKeys = getGroqKeys();
  const provider = grokKeys.length ? "grok" : "groq";
  const keys = provider === "grok" ? grokKeys : groqKeys;

  if (!keys.length) {
    throw new Error(
      "No Grok key (ZENX_API_KEY/GROK_API_KEY/XAI_API_KEY) or GROQ_API_KEY was found in .env"
    );
  }

  let lastError = null;

  console.log(
    `[ZENX-AI] ${provider === "grok" ? "Grok" : "Groq"} found ${keys.length} API key(s)`
  );

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];

    try {
      console.log(
        `[ZENX-AI] Trying ${provider} key ${i + 1}/${keys.length}`
      );

      let result;
      if (provider === "grok") {
        result = await callGrok({ apiKey, system, prompt });
      } else {
        const model = await getGroqModel(apiKey);
        console.log(`[ZENX-AI] Key ${i + 1} → model: ${model}`);
        result = await callGroq({ apiKey, model, system, prompt });
      }

      console.log(
        `[ZENX-AI] ${provider} key ${i + 1} succeeded`
      );

      return result;

    } catch (error) {
      lastError = error;

      console.error(
        `[ZENX-AI] ${provider} key ${i + 1} failed:`,
        error?.message || error
      );

      continue;
    }
  }

  throw new Error(
    `All ${keys.length} ${provider} API key(s) failed. ` +
    `${lastError?.message || "Unknown Groq API error"}`
  );
}

module.exports = {
  askAI,
  getZenXKeys
};
