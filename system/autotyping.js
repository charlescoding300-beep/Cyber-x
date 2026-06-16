const fs = require("fs");
const path = require("path");

const dbPath = path.join(process.cwd(), "database", "autotyping.json");

module.exports = async (sock, m) => {
    try {

        if (!fs.existsSync(dbPath)) return;

        const settings = JSON.parse(
            fs.readFileSync(dbPath)
        );

        if (!settings.enabled) return;

        if (m.key.fromMe) return;

        const text =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text;

        if (!text) return;

        await sock.sendPresenceUpdate(
            "composing",
            m.key.remoteJid
        );

        setTimeout(async () => {
            try {
                await sock.sendPresenceUpdate(
                    "paused",
                    m.key.remoteJid
                );
            } catch {}
        }, 5000);

    } catch (e) {
        console.log("AutoTyping Error:", e);
    }
};
