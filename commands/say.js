// commands/say.js
const { say } = require("../lib/say");

module.exports = {
    name: "say",
    description: "Convert text to voice",

    async execute(sock, msg, args) {
        const text = args.join(" ");

        if (!text) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: "❌ Provide text: .say hello world"
            });
        }

        try {
            const audioPath = await say(text);

            await sock.sendMessage(msg.key.remoteJid, {
                audio: { url: audioPath },
                mimetype: "audio/mpeg",
                ptt: true
            });

        } catch (err) {
            console.error(err);

            sock.sendMessage(msg.key.remoteJid, {
                text: "❌ Voice generation failed. Check API key or limit."
            });
        }
    }
};
