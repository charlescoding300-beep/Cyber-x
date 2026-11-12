const fs = require("fs");
const path = require("path");
const { creditConfigurationHint } = require("./providerErrors");

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
const GROQ_MODELS_URL = `${GROQ_BASE_URL}/models`;
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const AI_TIMEOUT_MS = Math.max(8000, Math.min(60000, Number.parseInt(process.env.ZENX_AI_TIMEOUT_MS, 10) || 30000));
const AI_MAX_TOKENS = Math.max(512, Math.min(4096, Number.parseInt(process.env.ZENX_AI_MAX_TOKENS, 10) || 2048));

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
    },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
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
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b"
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

async function callGroq({ apiKey, model, system, prompt }) {
  const configuredModel = model || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  async function request(modelId, maxTokens) {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: String(system || "") },
          { role: "user", content: String(prompt || "") }
        ],
        temperature: 0.2,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || raw || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = extractText(data);
    if (!result) throw new Error("Groq returned an empty response");
    if (data?.choices?.[0]?.finish_reason === "length") {
      const error = new Error("Groq response reached its output limit");
      error.incomplete = true;
      throw error;
    }
    return result;
  }
  async function complete(modelId) {
    try { return await request(modelId, AI_MAX_TOKENS); }
    catch (error) {
      if (!error.incomplete || AI_MAX_TOKENS >= 4096) throw error;
      console.warn("[ZENX-AI] Groq output was truncated; retrying once with a larger token budget");
      return request(modelId, Math.min(4096, AI_MAX_TOKENS * 2));
    }
  }
  try { return await complete(configuredModel); }
  catch (error) {
    const modelRejected = (error.status === 400 || error.status === 404) && /model|deployment|not found|unsupported/i.test(error.message);
    if (!modelRejected) throw error;
    const availableModel = await getGroqModel(apiKey);
    if (availableModel === configuredModel) throw error;
    console.warn(`[ZENX-AI] Groq model unavailable; retrying with ${availableModel}`);
    return complete(availableModel);
  }
}

async function callGrok({ apiKey, system, prompt }) {
  const model = process.env.GROK_MODEL || "grok-4.7";
  async function request(maxTokens) {
    const response = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: String(system || "") },
          { role: "user", content: String(prompt || "") }
        ],
        temperature: 0.2,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || raw || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = extractText(data);
    if (!result) throw new Error("Grok returned an empty response");
    if (data?.choices?.[0]?.finish_reason === "length") {
      const error = new Error("Grok response reached its output limit");
      error.incomplete = true;
      throw error;
    }
    return result;
  }
  try { return await request(AI_MAX_TOKENS); }
  catch (error) {
    if (!error.incomplete || AI_MAX_TOKENS >= 4096) throw error;
    console.warn("[ZENX-AI] Grok output was truncated; retrying once with a larger token budget");
    return request(Math.min(4096, AI_MAX_TOKENS * 2));
  }
}

let grokKeyCursor = 0;
let groqKeyCursor = 0;

async function askAI({ prompt, system = "" }) {
  const plans = [
    { name: "Grok", keys: getZenXKeys(), call: callGrok, provider: "grok" },
    { name: "Groq", keys: getGroqKeys(), call: callGroq, provider: "groq" }
  ].filter(plan => plan.keys.length);
  if (!plans.length) {
    throw new Error("No Grok key (ZENX_API_KEY/GROK_API_KEY/XAI_API_KEY) or GROQ_API_KEY was found in .env");
  }

  let lastError = null;
  for (const plan of plans) {
    const cursor = plan.provider === "grok" ? grokKeyCursor : groqKeyCursor;
    if (plan.provider === "grok") grokKeyCursor = (cursor + 1) % plan.keys.length;
    else groqKeyCursor = (cursor + 1) % plan.keys.length;
    const keys = plan.keys.map((_, offset) => plan.keys[(cursor + offset) % plan.keys.length]);
    console.log(`[ZENX-AI] ${plan.name} available (${keys.length} key(s)); trying bounded failover`);

    for (let index = 0; index < keys.length; index++) {
      try {
        const result = await plan.call({ apiKey: keys[index], system, prompt });
        console.log(`[ZENX-AI] ${plan.name} request succeeded`);
        return result;
      } catch (error) {
        lastError = error;
        const detail = String(error?.message || error || "Unknown error").replace(/\s+/g, " ").slice(0, 180);
        console.warn(`[ZENX-AI] ${plan.name} key ${index + 1}/${keys.length} failed: ${detail}`);
        // A timeout or provider outage affects its other keys too; move directly
        // to the independent provider instead of waiting repeatedly.
        if (error?.name === "TimeoutError" || error?.name === "AbortError" || Number(error?.status) >= 500) break;
      }
    }
  }

  const service = plans.map(plan => plan.name).join("/") + " AI";
  const creditHint = creditConfigurationHint(lastError, service);
  if (creditHint) throw new Error(creditHint);
  throw new Error(`AI providers could not complete this response. ${String(lastError?.message || "Unknown API error").replace(/\s+/g, " ").slice(0, 240)}`);
}

module.exports = {
  askAI,
  getZenXKeys
};
