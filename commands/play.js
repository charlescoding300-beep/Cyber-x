const yts = require('yt-search');
const axios = require('axios');

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™';

function fmtViews(n) {
    if (!n) return 'N/A';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toLocaleString();
}

async function playCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const searchQuery = text.split(' ').slice(1).join(' ').trim();

        if (!searchQuery) {
            return await sock.sendMessage(chatId, {
                text: `❌ What song do you want to download?\n\n${CREDIT}`
            }, { quoted: message });
        }

        // Reaction
        sock.sendMessage(chatId, { react: { text: '🎧', key: message.key } }).catch(() => {});

        // Search for the song
        const { videos } = await yts(searchQuery);
        if (!videos || videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ No songs found!\n\n${CREDIT}`
            }, { quoted: message });
        }

        // Get the first video result
        const video = videos[0];
        const urlYt = video.url;

        // Card
        const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${video.title}
🎤 *Artist*   » ${video.author?.name || 'Unknown'}
⏱️ *Duration* » ${video.timestamp || 'N/A'}
👁️ *Views*    » ${fmtViews(video.views)}
📅 *Uploaded* » ${video.ago || 'N/A'}
📺 *Platform* » YouTube
🔗 *Link*     » ${urlYt}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading audio...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`;

        // Send thumbnail + card, quoted to trigger message
        const infoMsg = await (async () => {
            try {
                if (video.thumbnail) {
                    return await sock.sendMessage(chatId, {
                        image: { url: video.thumbnail },
                        caption: card
                    }, { quoted: message });
                }
            } catch {}
            return sock.sendMessage(chatId, { text: card }, { quoted: message });
        })();

        // Fetch audio data from API
        const response = await axios.get(`https://apis-keith.vercel.app/download/dlmp3?url=${urlYt}`);
        const data = response.data;

        if (!data || !data.status || !data.result || !data.result.downloadUrl) {
            return await sock.sendMessage(chatId, {
                text: `❌ Failed to fetch audio from the API. Please try again later.\n\n${CREDIT}`
            }, { quoted: infoMsg });
        }

        const audioUrl = data.result.downloadUrl;
        const title = data.result.title;

        // Send the audio, quoted to the card message
        await sock.sendMessage(chatId, {
            audio: { url: audioUrl },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, { quoted: infoMsg });

    } catch (error) {
        console.error('Error in play command:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Download failed. Please try again later.\n\n${CREDIT}`
        }, { quoted: message });
    }
}

module.exports = playCommand;

/*Powered by KNIGHT-BOT*
*Credits to Keith MD*`*/
