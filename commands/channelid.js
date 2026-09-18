'use strict'

module.exports = {
    pattern: 'channelid',
    alias: ['chid'],
    category: 'general',
    desc: 'Get ZEN X Channel JID',
    usage: '.channelid',

    run: async (ctx) => {
        try {
            const sock = ctx.sock || ctx.client || ctx.conn

            if (!sock) {
                throw new Error('Bot socket not found')
            }

            const info = await sock.newsletterMetadata(
                'invite',
                '0029Vb8U73N1yT211FynJ01n'
            )

            const chat = ctx.chat || ctx.from || ctx.jid

            if (!chat) {
                throw new Error('Chat JID not found')
            }

            await sock.sendMessage(chat, {
                text:
`𓃦 *ZEN X CHANNEL JID*

${info.id}

*Name:* ${info.name || 'ZEN X'}`
            })

            console.log('𓃦 ZEN X CHANNEL INFO:', info)

        } catch (err) {
            console.error('𓃦 CHANNEL ID ERROR:', err)

            const sock = ctx.sock || ctx.client || ctx.conn
            const chat = ctx.chat || ctx.from || ctx.jid

            if (sock && chat) {
                await sock.sendMessage(chat, {
                    text: `❌ *CHANNEL ID ERROR*\n\n${err.message}`
                })
            }
        }
    }
}
