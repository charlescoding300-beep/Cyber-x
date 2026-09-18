const fs = require("fs");
const path = require("path");

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
const GROQ_MODELS_URL = `${GROQ_BASE_URL}/models`;

function getZenXKeys() {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return [];
  }

  const content = fs.readFileSync(envPath, "utf8");
  const keys = [];

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^\s*ZENX_API_KEY\s*=\s*(.*?)\s*$/
    );

    if (!match) continue;

    let value = match[1].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }

    value = value.replace(/^,+/, "").trim();

    if (value) {
      keys.push(value);
    }
  }

  return [...new Set(keys)];
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

async function askAI({
  prompt,
  system = ""
}) {
  const keys = getZenXKeys();

  if (!keys.length) {
    throw new Error(
      "No ZENX_API_KEY entries were found in .env"
    );
  }

  let lastError = null;

  console.log(
    `[ZENX-AI] Groq gateway found ${keys.length} API key(s)`
  );

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];

    try {
      console.log(
        `[ZENX-AI] Testing Groq key ${i + 1}/${keys.length}`
      );

      const model = await getGroqModel(apiKey);

      console.log(
        `[ZENX-AI] Key ${i + 1} → model: ${model}`
      );

      const result = await callGroq({
        apiKey,
        model,
        system,
        prompt
      });

      console.log(
        `[ZENX-AI] Groq key ${i + 1} succeeded`
      );

      return result;

    } catch (error) {
      lastError = error;

      console.error(
        `[ZENX-AI] Groq key ${i + 1} failed:`,
        error?.message || error
      );

      continue;
    }
  }

  throw new Error(
    `All ${keys.length} ZENX_API_KEY entries failed. ` +
    `${lastError?.message || "Unknown Groq API error"}`
  );
}

module.exports = {
  askAI,
  getZenXKeys
};
