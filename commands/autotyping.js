const fs = require("fs");
const path = require("path");

const dbPath = path.join(process.cwd(), "database", "autotyping.json");

module.exports = {
    name: "autotyping",
    aliases: ["atype"],

    async execute({ sock, m, args, isCreator }) {

        if (!isCreator)
            return m.reply("Owner Only!");

        const data = JSON.parse(fs.readFileSync(dbPath));

        if (!args[0])
            return m.reply(
                `AutoTyping: ${data.enabled ? "ON" : "OFF"}`
            );

        if (args[0].toLowerCase() === "on") {
            data.enabled = true;
            fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
            return m.reply("✅ Auto Typing Enabled");
        }

        if (args[0].toLowerCase() === "off") {
            data.enabled = false;
            fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
            return m.reply("❌ Auto Typing Disabled");
        }
    }
};
