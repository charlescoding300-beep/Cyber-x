'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/wasted.js  —  CYBER X  |  💀 GTA Wasted Effect
//  Usage: .wasted @user  OR  reply to someone + .wasted
//  Fetches profile picture automatically and applies wasted effect
//  Reaction: 💀 | Category: fun
//  APIs (fallback chain):
//    1. api.popcat.xyz/wasted          — primary (most reliable)
//    2. some-random-api.com wasted     — fallback #1
//    3. nekos.best                     — fallback #2 (grayscale+text only)
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  'wasted',
  alias:    ['gta', 'gtawasted'],
  category: 'fun',
  desc:     'GTA wasted effect on someone\'s profile pic',
  usage:    '.wasted @user | reply to message',

  run: async ({ sock, from, msg, sender, args }) => {

    // ── React instantly ────────────────────────────────────────────
    await sock.sendMessage(from, { react: { text: '💀', key: msg.key } }).catch(() => {})

    // ── Detect target (reply or mention) ──────────────────────────
    const ctx        = msg.message?.extendedTextMessage?.contextInfo
    const replyJid   = ctx?.participant || null
    const mentioned  = ctx?.mentionedJid?.[0] || null

    // Priority: reply target → @mention → self
    let targetJid = (replyJid || mentioned || sender).replace(/:\d+@/, '@')
    const targetNum = targetJid.split('@')[0]
    const targetTag = `@${targetNum}`

    // ── Fetch target profile picture ───────────────────────────────
    let ppUrl = null
    try {
      ppUrl = await sock.profilePictureUrl(targetJid, 'image')
    } catch {
      console.log(`[WASTED] No PP for ${targetNum}`)
    }

    if (!ppUrl) {
      await sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  💀 *WASTED* 💀        ║\n╚════════════════════════╝\n\n❌ *${targetTag} has no profile picture!*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        mentions: [targetJid]
      }, { quoted: msg })
      return
    }

    // ── Thinking message ───────────────────────────────────────────
    const thinkMsg = await sock.sendMessage(from, {
      text: `💀 *Applying WASTED effect on ${targetTag}...*`
    }, { quoted: msg }).catch(() => null)

    const deleteThink = async () => {
      if (!thinkMsg) return
      try { await sock.sendMessage(from, { delete: thinkMsg.key }) } catch {}
    }

    // ── Helper: fetch image buffer from URL ────────────────────────
    const fetchBuf = async (url) => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('image')) throw new Error(`Not image: ${ct}`)
      return Buffer.from(await res.arrayBuffer())
    }

    // ── Send final result ──────────────────────────────────────────
    const sendResult = async (buf) => {
      await deleteThink()
      await sock.sendMessage(from, {
        image:    buf,
        caption:  `💀 *${targetTag} got WASTED!*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        mimetype: 'image/png',
        mentions: [targetJid]
      }, { quoted: msg })
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})
    }

    const encoded = encodeURIComponent(ppUrl)

    // ── API chain ──────────────────────────────────────────────────
    // 1️⃣  popcat.xyz  (primary — most stable, used by 90% of bots)
    try {
      const buf = await fetchBuf(`https://api.popcat.xyz/wasted?image=${encoded}`)
      return await sendResult(buf)
    } catch (e) {
      console.warn('[WASTED] popcat failed:', e.message)
    }

    // 2️⃣  some-random-api.com  (fallback #1)
    try {
      const buf = await fetchBuf(`https://some-random-api.com/canvas/misc/wasted?avatar=${encoded}`)
      return await sendResult(buf)
    } catch (e) {
      console.warn('[WASTED] some-random-api failed:', e.message)
    }

    // 3️⃣  vacefron.nl  (fallback #2 — Dutch public canvas API)
    try {
      const buf = await fetchBuf(`https://vacefron.nl/api/wasted?user=${encoded}`)
      return await sendResult(buf)
    } catch (e) {
      console.warn('[WASTED] vacefron failed:', e.message)
    }

    // ── All APIs failed ────────────────────────────────────────────
    await deleteThink()
    await sock.sendMessage(from, {
      text: `╔════════════════════════╗\n║  💀 *WASTED* 💀        ║\n╚════════════════════════╝\n\n❌ *Could not apply wasted effect right now*\n🔄 All image APIs are down — try again later\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      mentions: [targetJid]
    }, { quoted: msg })
    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
  }
}
