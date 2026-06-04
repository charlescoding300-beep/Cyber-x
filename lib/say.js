// lib/say.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const API_KEY = process.env.GEMINI_API_KEY;

async function say(text) {
    if (!text) throw new Error("No text provided");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`;

    const payload = {
        contents: [
            {
                parts: [{ text }]
            }
        ],
        generationConfig: {
            responseModalities: ["AUDIO"]
        }
    };

    const res = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" }
    });

    const audioData =
        res.data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

    if (!audioData) throw new Error("No audio returned from Gemini");

    const buffer = Buffer.from(audioData, "base64");

    const fileName = `${uuidv4()}.mp3`;
    const filePath = path.join(__dirname, "..", "temp", fileName);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);

    return filePath;
}

module.exports = { say };
