'use strict'

const axios = require('axios')
const cheerio = require('cheerio')

const {
    downloadMediaMessage
} = require('@whiskeysockets/baileys')

module.exports = {
    pattern: 'gcstatus',
    alias: ['groupstatus', 'gstatus'],
    category: 'owner',
    desc: 'Post text, media or website links as a WhatsApp Group Status',
    usage: 'Reply to text/media/link with .gcstatus OR use .gcstatus <link>',

    run: async ({
        sock,
        from,
        msg,
        sender,
        isOwner,
        isAdmin,
        isGroup
    }) => {

        // ==============================
        // GROUP ONLY
        // ==============================

        if (!isGroup) {
            return sock.sendMessage(
                from,
                {
                    text: '❌ *This command only works inside a group.*'
                },
                { quoted: msg }
            )
        }

        // ==============================
        // ADMIN / OWNER ONLY
        // ==============================

        if (!isOwner && !isAdmin) {
            return sock.sendMessage(
                from,
                {
                    text:
                        '❌ *Only the bot owner or group admins can use this command.*'
                },
                { quoted: msg }
            )
        }

        // ==============================
        // GET COMMAND TEXT
        // ==============================

        const commandText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ''

        const commandArgument = commandText
            .replace(
                /^(\.gcstatus|\.groupstatus|\.gstatus)\s*/i,
                ''
            )
            .trim()

        // ==============================
        // FIND QUOTED MESSAGE
        // ==============================

        const ctx =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.audioMessage?.contextInfo

        const quotedMsg = ctx?.quotedMessage

        // ==============================
        // EXTRACT TEXT FROM MESSAGE
        // ==============================

        function getMessageText(message) {

            if (!message) return ''

            return (
                message.conversation ||
                message.extendedTextMessage?.text ||
                message.imageMessage?.caption ||
                message.videoMessage?.caption ||
                message.documentMessage?.caption ||
                ''
            )
        }

        // ==============================
        // URL DETECTION
        // ==============================

        function extractUrl(text) {

            if (!text) return null

            const match = text.match(
                /https?:\/\/[^\s<>"']+/i
            )

            if (!match) return null

            return match[0]
                .replace(/[),.!?]+$/, '')
                .trim()
        }

        // ==============================
        // CHECK COMMAND URL FIRST
        // THEN CHECK QUOTED MESSAGE
        // ==============================

        let url = extractUrl(commandArgument)

        if (!url && quotedMsg) {
            url = extractUrl(
                getMessageText(quotedMsg)
            )
        }

        // ==============================
        // WEBSITE LINK STATUS
        // ==============================

        if (url) {

            try {

                console.log(
                    '[ZEN X GCSTATUS] Fetching:',
                    url
                )

                const response = await axios.get(
                    url,
                    {
                        timeout: 20000,
                        maxRedirects: 5,
                        responseType: 'text',
                        validateStatus: status =>
                            status >= 200 &&
                            status < 400,
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                            'Accept':
                                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
                        }
                    }
                )

                const html = response.data
                const $ = cheerio.load(html)

                // ==============================
                // WEBSITE TITLE
                // ==============================

                const title =
                    $('meta[property="og:title"]').attr('content') ||
                    $('meta[name="twitter:title"]').attr('content') ||
                    $('title').text() ||
                    ''

                // ==============================
                // WEBSITE DESCRIPTION
                // ==============================

                const description =
                    $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="twitter:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') ||
                    ''

                // ==============================
                // WEBSITE PREVIEW IMAGE
                // ==============================

                let imageUrl =
                    $('meta[property="og:image"]').attr('content') ||
                    $('meta[property="og:image:url"]').attr('content') ||
                    $('meta[property="og:image:secure_url"]').attr('content') ||
                    $('meta[name="twitter:image"]').attr('content') ||
                    $('meta[name="twitter:image:src"]').attr('content') ||
                    ''

                // ==============================
                // CONVERT RELATIVE IMAGE URL
                // ==============================

                if (imageUrl) {

                    try {

                        imageUrl = new URL(
                            imageUrl,
                            response.request?.res?.responseUrl ||
                            url
                        ).href

                    } catch (error) {

                        console.log(
                            '[ZEN X GCSTATUS] Invalid preview URL:',
                            imageUrl
                        )

                        imageUrl = ''
                    }
                }

                let previewImage = null

                // ==============================
                // DOWNLOAD PREVIEW IMAGE
                // ==============================

                if (imageUrl) {

                    try {

                        console.log(
                            '[ZEN X GCSTATUS] Preview image:',
                            imageUrl
                        )

                        const imageResponse =
                            await axios.get(
                                imageUrl,
                                {
                                    timeout: 20000,
                                    maxRedirects: 5,
                                    responseType: 'arraybuffer',
                                    headers: {
                                        'User-Agent':
                                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                                        'Referer': url
                                    }
                                }
                            )

                        const contentType =
                            imageResponse.headers[
                                'content-type'
                            ] || ''

                        if (
                            contentType.startsWith(
                                'image/'
                            )
                        ) {

                            previewImage =
                                Buffer.from(
                                    imageResponse.data
                                )

                        } else {

                            console.log(
                                '[ZEN X GCSTATUS] Preview URL did not return an image:',
                                contentType
                            )
                        }

                    } catch (imageError) {

                        console.error(
                            '[ZEN X GCSTATUS] Preview image error:',
                            imageError.message
                        )
                    }
                }

                // ==============================
                // BUILD CAPTION
                // ==============================

                const captionParts = []

                if (title.trim()) {
                    captionParts.push(
                        `*${title.trim()}*`
                    )
                }

                if (description.trim()) {
                    captionParts.push(
                        description.trim()
                    )
                }

                captionParts.push(
                    `🔗 ${url}`
                )

                captionParts.push(
                    '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
                )

                const caption =
                    captionParts.join('\n\n')

                // ==============================
                // POST REAL GROUP STATUS
                // ==============================

                if (previewImage) {

                    await sock.sendMessage(
                        from,
                        {
                            image: previewImage,
                            caption,
                            groupStatus: true
                        }
                    )

                } else {

                    // If no preview image exists,
                    // still post the link as a REAL
                    // Group Status.

                    await sock.sendMessage(
                        from,
                        {
                            text: caption,
                            groupStatus: true
                        }
                    )
                }

                // ==============================
                // SUCCESS
                // ==============================

                return sock.sendMessage(
                    from,
                    {
                        text:
                            '✅ *GROUP STATUS POSTED SUCCESSFULLY*\n\n' +
                            '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
                    },
                    { quoted: msg }
                )

            } catch (error) {

                console.error(
                    '[ZEN X GCSTATUS LINK]',
                    error
                )

                return sock.sendMessage(
                    from,
                    {
                        text:
                            '❌ *GROUP STATUS FAILED*\n\n' +
                            `Reason: ${error?.message || error}`
                    },
                    { quoted: msg }
                )
            }
        }

        // ==============================
        // NO URL
        // ==============================

        if (!quotedMsg) {

            return sock.sendMessage(
                from,
                {
                    text:
                        '❌ *Reply to a text, image, video, audio or website link.*\n\n' +
                        'Example:\n' +
                        'Reply to a link → `.gcstatus`'
                },
                { quoted: msg }
            )
        }

        // ==============================
        // QUOTED SENDER
        // ==============================

        const quotedSender =
            ctx.participant || sender

        // ==============================
        // RECREATE QUOTED MESSAGE
        // ==============================

        const quotedFull = {
            key: {
                remoteJid: from,
                id: ctx.stanzaId,
                participant: quotedSender,
                fromMe: false
            },
            message: quotedMsg
        }

        try {

            let content

            // ==============================
            // TEXT
            // ==============================

            if (
                quotedMsg.conversation ||
                quotedMsg.extendedTextMessage?.text
            ) {

                content = {
                    text:
                        quotedMsg.conversation ||
                        quotedMsg.extendedTextMessage.text,
                    groupStatus: true
                }

            // ==============================
            // IMAGE
            // ==============================

            } else if (quotedMsg.imageMessage) {

                const buffer =
                    await downloadMediaMessage(
                        quotedFull,
                        'buffer',
                        {}
                    )

                content = {
                    image: buffer,
                    caption:
                        '👑 *Posted by the Boss*\n\n' +
                        '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦',
                    groupStatus: true
                }

            // ==============================
            // VIDEO
            // ==============================

            } else if (quotedMsg.videoMessage) {

                const buffer =
                    await downloadMediaMessage(
                        quotedFull,
                        'buffer',
                        {}
                    )

                content = {
                    video: buffer,
                    caption:
                        '👑 *Posted by the Boss*\n\n' +
                        '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦',
                    groupStatus: true
                }

            // ==============================
            // AUDIO
            // ==============================

            } else if (quotedMsg.audioMessage) {

                const buffer =
                    await downloadMediaMessage(
                        quotedFull,
                        'buffer',
                        {}
                    )

                content = {
                    audio: buffer,
                    mimetype:
                        quotedMsg.audioMessage.mimetype ||
                        'audio/mp4',
                    ptt:
                        !!quotedMsg.audioMessage.ptt,
                    groupStatus: true
                }

            } else {

                return sock.sendMessage(
                    from,
                    {
                        text:
                            '❌ *Unsupported message type.*'
                    },
                    { quoted: msg }
                )
            }

            // ==============================
            // REAL GROUP STATUS
            // ==============================

            await sock.sendMessage(
                from,
                content
            )

            // ==============================
            // SUCCESS
            // ==============================

            return sock.sendMessage(
                from,
                {
                    text:
                        '✅ *GROUP STATUS POSTED SUCCESSFULLY*\n\n' +
                        '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
                },
                { quoted: msg }
            )

        } catch (error) {

            console.error(
                '[ZEN X GCSTATUS]',
                error
            )

            return sock.sendMessage(
                from,
                {
                    text:
                        '❌ *GROUP STATUS FAILED*\n\n' +
                        `Reason: ${error?.message || error}`
                },
                { quoted: msg }
            )
        }
    }
}
