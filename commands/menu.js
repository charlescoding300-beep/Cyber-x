'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Owner WhatsApp profile picture cached on first use
//  ✅ Cache refreshes every 30 mins in background
//  ✅ Falls back to static image if owner pic unavailable
//  ✅ Greets the person who triggered menu with @tag
//  ✅ Auto-categorizes commands from category: field
//  ✅ Instant 🤖 reaction on trigger
//  ✅ ├◈ bullet category boxes
// ════════════════════════════════════════════════════════════════════

const FALLBACK_IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]

const HIDDEN = new Set([
  'slot', 'pokedex', 'buy', 'mycard', 'active', 'battle',
  'accept', 'forfeit', 'pokemon', 'pikachu',
])

const CATEGORY_ORDER = [
  'general', 'owner', 'group/admin', 'media', 'fun', 'ai', 'utility',
]

const CATEGORY_LABELS = {
  general:      '🌐 GENERAL',
  owner:        '👑 OWNER',
  'group/admin':'👥 GROUP/ADMIN👮',
  media:        '🎵 MEDIA',
  fun:          '🎮 FUN',
  ai:           '🤖 AI',
  utility:      '🛠️ UTILITY',
}

const PAIR_URL = process.env.PAIR_URL || 'https://cyber-x-y8yv.onrender.com/pair'

// ── Owner pic cache ───────────────────────────────────────────
let cachedOwnerPicBuffer = null
let cacheTimestamp       = 0
const CACHE_TTL          = 30 * 60 * 1000  // 30 minutes
let fallbackIdx          = 0

async function fetchOwnerPic(sock) {
    const ownerNumber = (process.env.OWNER_NUMBER || '').replace(/\D/g, '')
    if (!ownerNumber) return null
    const ownerJid = `${ownerNumber}@s.whatsapp.net`
    try {
        const url = await sock.profilePictureUrl(ownerJid, 'image')
        if (!url) return null
        const res = await fetch(url, { timeout: 10000 })
        if (!res.ok) return null
        const buf = Buffer.from(await res.arrayBuffer())
        cachedOwnerPicBuffer = buf
        cacheTimestamp = Date.now()
        return buf
    } catch {
        return null
    }
}

async function getOwnerPic(sock) {
    // Return cache if still fresh
    if (cachedOwnerPicBuffer && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        return cachedOwnerPicBuffer
    }
    // Try to fetch fresh
    const buf = await fetchOwnerPic(sock)
    if (buf) return buf
    // Return stale cache if fetch failed
    if (cachedOwnerPicBuffer) return cachedOwnerPicBuffer
    return null
}

// Background cache refresh every 30 mins
function startCacheRefresh(sock) {
    setInterval(async () => {
        await fetchOwnerPic(sock).catch(() => {})
    }, CACHE_TTL)
}

let refreshStarted = false

// ── Helpers ───────────────────────────────────────────────────
function formatUp(sec) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
    return `${m}m ${String(s).padStart(2, '0')}s`
}

module.exports = {
    pattern:  'menu',
    category: 'general',
    desc:     'CYBER X command menu',
    usage:    '.menu',

    run: async ({ sock, from, msg, sender, commands, cmdDetails, settings, isOwner }) => {

        // ── Start background refresh once ──────────────────────────
        if (!refreshStarted) {
            refreshStarted = true
            startCacheRefresh(sock)
            // Pre-warm cache immediately on first menu trigger
            fetchOwnerPic(sock).catch(() => {})
        }

        // ── 1. React instantly ─────────────────────────────────────
        sock.sendMessage(from, {
            react: { text: '🤖', key: msg.key }
        }).catch(() => {})

        const prefix  = settings?.prefix  || '.'
        const botName = settings?.botName || 'CYBER X'
        const mode    = (settings?.mode || 'public').toUpperCase()

        const now  = new Date()
        const time = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        })

        const upSec      = Math.floor(process.uptime())
        const mem        = process.memoryUsage()
        const ramUsedGB  = (mem.heapUsed  / 1024 / 1024 / 1024).toFixed(2)
        const ramTotalGB = (mem.heapTotal / 1024 / 1024 / 1024).toFixed(2)

        // ── 2. Owner & sender tags ─────────────────────────────────
        const ownerNumber = (process.env.OWNER_NUMBER || '').replace(/\D/g, '')
        const ownerJid    = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : null
        const ownerTag    = ownerJid ? `@${ownerNumber}` : 'Owner'

        const senderJid = sender || from
        const senderNum = senderJid.split('@')[0]
        const senderTag = `@${senderNum}`

        // ── 3. Group commands by category ──────────────────────────
        const grouped  = new Map()
        let totalCmds  = 0

        if (Array.isArray(cmdDetails) && cmdDetails.length) {
            for (const cmd of cmdDetails) {
                const name = (cmd.pattern || '').replace(/^\./, '')
                if (HIDDEN.has(name)) continue
                const cat = (cmd.category || 'general').toLowerCase()
                if (!grouped.has(cat)) grouped.set(cat, [])
                grouped.get(cat).push(name)
                totalCmds++
            }
        } else if (commands instanceof Map) {
            for (const [key] of commands) {
                if (HIDDEN.has(key)) continue
                if (!grouped.has('general')) grouped.set('general', [])
                grouped.get('general').push(key)
                totalCmds++
            }
        }

        for (const [, cmds] of grouped) cmds.sort()

        const allCats = [...new Set([
            ...CATEGORY_ORDER.filter(c => grouped.has(c)),
            ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
        ])]

        // ── 4. Build category sections ─────────────────────────────
        const sections = allCats.map(cat => {
            const label = CATEGORY_LABELS[cat] || cat.toUpperCase()
            const cmds  = grouped.get(cat) || []
            const lines = cmds.map((c, i) => {
                const isLast = i === cmds.length - 1
                return ` *${isLast ? '┕' : '├'}◈ ${c}*`
            }).join('\n')
            return ` *╭────❒ ${label} ❒*\n${lines}\n *┕──────────────────❒*`
        }).join('\n\n')

        // ── 5. Build header ────────────────────────────────────────
        const header =
`*╭══ ✕-${botName} ⚡*
*┃🌸 ʀᴜɴ       :* ${formatUp(upSec)}
*┃🛡️ ᴍᴏᴅᴇ      :* ${mode}
*┃👀 ᴘʀᴇғɪx    :* ${prefix}
*┃🚀 ʀᴀᴍ       :* ${ramUsedGB} / ${ramTotalGB} GB
*┃🌨️ ᴛɪᴍᴇ      :* ${time}
*┃🫂 ʙᴏᴛ ᴏᴡɴᴇʀ :* ${ownerTag}
*┃🕊️ ᴘᴀɪʀ      :* ${PAIR_URL}
*┃🛡️ ᴄʀᴇᴅɪᴛ    :* © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™
*╰═════════════════⊷*`

        const caption =
`${header}

*Hey 👋🏻 ${senderTag}*

*♡︎•━━━━━${botName}━━━━━•♡*

${sections}

*~_${botName} — every command, one menu_~*`

        // ── 6. Get owner pic (cached, zero delay if warm) ──────────
        const ownerPicBuf = await getOwnerPic(sock)

        // ── 7. Send ────────────────────────────────────────────────
        const mentions = [senderJid]
        if (ownerJid) mentions.push(ownerJid)

        if (ownerPicBuf) {
            try {
                await sock.sendMessage(from, {
                    image:   ownerPicBuf,
                    caption,
                    mimetype: 'image/jpeg',
                    mentions,
                }, { quoted: msg })
                return
            } catch {}
        }

        // Fallback to static image
        const imgUrl = FALLBACK_IMAGES[fallbackIdx % FALLBACK_IMAGES.length]
        fallbackIdx++
        try {
            await sock.sendMessage(from, {
                image:   { url: imgUrl },
                caption,
                mimetype: 'image/jpeg',
                mentions,
            }, { quoted: msg })
        } catch {
            await sock.sendMessage(from, {
                text: caption,
                mentions,
            }, { quoted: msg })
        }
    },
}
