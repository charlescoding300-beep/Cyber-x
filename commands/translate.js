const { askAI } = require("../lib/zenxAI");

module.exports = {
  name: "translate",
  aliases: ["smarttranslate", "aitranslate"],
  desc: "AI-powered natural language translator",
  usage: ".translate <language> <text>",
  category: "utility",

  async run({ sock, from, msg, args, text }) {
    let statusMessage = null;

    try {
      let request = String(
        text || args?.join(" ") || ""
      ).trim();

      let quotedText = "";

      const contextInfo =
        msg?.message?.extendedTextMessage?.contextInfo ||
        msg?.message?.imageMessage?.contextInfo ||
        msg?.message?.videoMessage?.contextInfo ||
        msg?.message?.documentMessage?.contextInfo;

      const quoted = contextInfo?.quotedMessage;

      if (quoted) {
        quotedText =
          quoted?.conversation ||
          quoted?.extendedTextMessage?.text ||
          quoted?.imageMessage?.caption ||
          quoted?.videoMessage?.caption ||
          quoted?.documentMessage?.caption ||
          "";
      }

      quotedText = String(quotedText || "").trim();

      if (!request && !quotedText) {
        return await sock.sendMessage(
          from,
          {
            text:
              `╭───〔 𓃦 𝗭Ξ𝗡 𝗫 〕───╮\n` +
              `│ 🤖 AI TRANSLATOR\n` +
              `╰────────────────────╯\n\n` +
              `Talk naturally to the translator.\n\n` +
              `Examples:\n` +
              `• .trt en Hello my friend\n` +
              `• .trt translate this to English: Bonjour\n` +
              `• .trt what does "abeg" mean in English?\n` +
              `• .trt translate this into French: I am coming\n` +
              `• Reply to a message: .trt en\n\n` +
              `𝗭Ξ𝗡 𝗫 understands slang, Pidgin,\n` +
              `abbreviations and normal conversation.`
          },
          { quoted: msg }
        );
      }

      if (!request && quotedText) {
        request =
          "Translate the following message naturally.";
      }

      statusMessage = await sock.sendMessage(
        from,
        {
          text:
            "🤖 𝗭Ξ𝗡 𝗫 AI is understanding and translating..."
        },
        { quoted: msg }
      );

      const system = `
You are the intelligent natural-language translation engine
inside 𝗭Ξ𝗡 𝗫 WhatsApp Bot.

Your job is to understand what the user MEANS, not merely
follow a rigid command format.

The user may speak to you naturally.

You must intelligently determine:

1. What text they want translated.
2. What target language they want.
3. Whether they are asking for a translation or asking
   what a word/phrase means.
4. The intended meaning when slang, abbreviations,
   texting language, Pidgin, dialect, or informal speech
   is used.

IMPORTANT:

- Understand Nigerian Pidgin.
- Understand common African English expressions.
- Understand internet slang.
- Understand abbreviations such as:
  u, ur, r, tmr, pls, btw, idk, imo, etc.
- Understand normal conversational English.
- Understand mixed languages.
- Understand spelling mistakes when the intended meaning
  is obvious from context.
- Preserve names and proper nouns.
- Translate naturally rather than word-for-word when
  literal translation would sound unnatural.
- If the user asks what a word means, give its meaning
  in the requested language.
- If the user explicitly asks for a literal translation,
  provide a literal translation.
- If the user specifies a target language, use it.
- If the user says "English", "French", "Yoruba",
  "Spanish", "German", etc., understand that as the
  target language.
- If the user uses the old syntax
  ".trt en hello", understand "en" as the target language.
- If the user uses natural language such as
  "translate this to English", understand the request.
- If a quoted WhatsApp message is supplied, it is the
  primary text to translate when the user's instruction
  refers to "this", "that", "the message", etc.

DO NOT complain about command formatting.

Return ONLY the useful final answer.

Do not return:
- analysis
- JSON
- programming code
- "Translation:"
- "Result:"
- explanations about how you interpreted the request

Unless the user specifically asks for an explanation,
return only the translation/meaning.
`;

      const prompt = `
USER REQUEST:
${request || "(no explicit request)"}

QUOTED WHATSAPP MESSAGE:
${quotedText || "(none)"}

Interpret the request naturally and perform the
translation/meaning task the user intended.
`;

      const translated = await askAI({
        prompt,
        system
      });

      if (!translated) {
        throw new Error(
          "AI returned an empty translation"
        );
      }

      const output =
        `╭───〔 𓃦 𝗭Ξ𝗡 𝗫 〕───╮\n` +
        `│ 🤖 AI TRANSLATION\n` +
        `╰────────────────────╯\n\n` +
        `╭─〔 📤 RESULT 〕\n` +
        `│ ${translated}\n` +
        `╰────────────────────\n` +
        `> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`;

      return await sock.sendMessage(
        from,
        {
          text: output,
          edit: statusMessage.key
        }
      );

    } catch (error) {
      console.error("[TRT] Error:", error);

      if (statusMessage?.key) {
        try {
          return await sock.sendMessage(
            from,
            {
              text:
                `❌ 𝗭Ξ𝗡 𝗫 AI translation failed.\n\n` +
                `${error?.message || "Unknown error"}`,
              edit: statusMessage.key
            }
          );
        } catch (editError) {
          console.error(
            "[TRT] Failed to edit status message:",
            editError
          );
        }
      }
    }
  }
};
