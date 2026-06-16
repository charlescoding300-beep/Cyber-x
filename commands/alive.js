module.exports = {
    name: 'alive',
    aliases: ['ping', 'status'],
    category: 'general',
    description: 'Check if the bot is online and view status info',

    async execute(sock, msg, args, context) {
        const { chatId } = context;

        // React with 🟢 on the trigger message
        try {
            await sock.sendMessage(chatId, {
                react: {
                    text: '🟢',
                    key: msg.key
                }
            });
        } catch (err) {
            console.error('Failed to send reaction:', err);
        }

        // Calculate real uptime
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);
        const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;

        // Real RAM usage
        const memUsage = process.memoryUsage();
        const ramUsedMB = (memUsage.rss / 1024 / 1024).toFixed(2);

        // Real ping (measure roundtrip of sending the message itself)
        const startTime = Date.now();

        // Send initial message
        const sentMsg = await sock.sendMessage(chatId, {
            text: '🔄 *Pinging CYBER X...*\n\n[░░░░░░░░░░] 0%'
        }, { quoted: msg });

        const pingMs = Date.now() - startTime;

        // Animation frames - 10 frames over 2 seconds (200ms each)
        const frames = [
            '[█░░░░░░░░░] 10%',
            '[██░░░░░░░░] 20%',
            '[███░░░░░░░] 30%',
            '[████░░░░░░] 40%',
            '[█████░░░░░] 50%',
            '[██████░░░░] 60%',
            '[███████░░░] 70%',
            '[████████░░] 80%',
            '[█████████░] 90%',
            '[██████████] 100%'
        ];

        for (const frame of frames) {
            await new Promise(resolve => setTimeout(resolve, 200));

            try {
                await sock.sendMessage(chatId, {
                    text: `🔄 *Pinging CYBER X...*\n\n${frame}`,
                    edit: sentMsg.key
                });
            } catch (err) {
                console.error('Failed to edit message:', err);
            }
        }

        // Final fancy status card with real data
        const aliveText = `
╭━━━『 *𝐂𝐘𝐁𝐄𝐑 𝐗* 』━━━╮
┃
┃  ✅  *STATUS:* Online
┃  🟢  *Bot is Active!*
┃
┃  ⏱️  *Uptime:* ${uptimeString}
┃  📡  *Ping:* ${pingMs}ms
┃  💾  *RAM:* ${ramUsedMB} MB
┃  🖥️  *Platform:* ${process.platform}
┃  🔧  *Node:* ${process.version}
┃
╰━━━━━━━━━━━━━━━━━━╯
> © *HeIsGoated*`
> _Type *.menu* to see all commands_
        `.trim();

        try {
            await sock.sendMessage(chatId, {
                text: aliveText,
                edit: sentMsg.key
            });
        } catch (err) {
            console.error('Failed to send final edit:', err);
        }
    }
};
