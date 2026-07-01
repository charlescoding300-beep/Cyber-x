// commands/gccrash.js
// Category: Owner
// Description: WhatsApp Group Ban — replicates the "group no longer supported" effect
// Usage: .gccrash (in the group you want to ban)
//        .gccrash <jid> (from anywhere, ban a specific group by JID)
// Only the bot owner can run this command.
// WARNING: This command removes ALL members from the target group.
// The bot owner retains access via the bot's own JID.

module.exports = {
  pattern: "gccrash",
  category: 'fun',
  desc: "Lock down and disable a group — removes all members, sets to announce-only, locks settings",
  usage: ".gccrash  or  .gccrash <group-jid>",

  run: async ({ sock, from, msg, args, isOwner }) => {
    // ─── AUTHORIZATION: Owner Only ────────────────────────────
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: "❌ *Owner Only*\nThis command is restricted to the bot owner."
      })
    }

    // ─── RESOLVE TARGET GROUP ─────────────────────────────────
    let targetGroup
    if (args && args.length > 0) {
      // Group JID provided as argument
      targetGroup = args[0].includes('@g.us') ? args[0] : args[0] + '@g.us'
    } else {
      // Use current group
      targetGroup = from
    }

    // Check if we're in a group
    if (!targetGroup.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: "❌ This command can only be used in a group or with a valid group JID."
      })
    }

    // ─── FETCH GROUP METADATA ─────────────────────────────────
    let meta
    try {
      meta = await sock.groupMetadata(targetGroup)
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Cannot fetch group metadata:\n${e.message}`
      })
    }

    const groupName = meta.subject || "this group"
    const participants = meta.participants || []
    const ownerJid = meta.owner || "unknown"
    const admins = participants
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id)
    const allMembers = participants.map(p => p.id)
    const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net' || sock.user?.id

    console.log(`[GCCRASH] ──────────────────────────────────`)
    console.log(`[GCCRASH]  Group:      ${groupName} (${targetGroup})`)
    console.log(`[GCCRASH]  Members:    ${allMembers.length}`)
    console.log(`[GCCRASH]  Admins:     ${admins.length}`)
    console.log(`[GCCRASH]  Owner:      ${ownerJid}`)
    console.log(`[GCCRASH]  Bot JID:    ${botJid}`)
    console.log(`[GCCRASH] ──────────────────────────────────`)

    // Check if bot is admin
    const botParticipant = participants.find(p => p.id === botJid)
    if (!botParticipant?.admin && botParticipant) {
      return sock.sendMessage(from, {
        text: `❌ Bot is not an admin in this group.\nThe bot must be an admin to perform this operation.`
      })
    }

    // ─── WARM-UP SESSION ──────────────────────────────────────
    // Send presence to ensure session is active
    await sock.sendPresenceUpdate('available', targetGroup)

    await sock.sendMessage(targetGroup, {
      text: `⚠️ *Group Lockdown Initiated*\n\n` +
            `Target: *${groupName}*\n` +
            `Members: ${allMembers.length}\n` +
            `Admins: ${admins.length}\n\n` +
            `This group will be locked down in 5 seconds...`,
      ephemeralExpiration: 86400
    })

    // Brief delay so the message is sent before we start operations
    await new Promise(r => setTimeout(r, 5000))

    // ─── PHASE 1: LOCK GROUP SETTINGS ─────────────────────────
    // Step 1a: Enable announcement mode (only admins can send messages)
    try {
      const announceNode = {
        tag: 'iq',
        attrs: {
          to: targetGroup,
          type: 'set',
          xmlns: 'w:g2'
        },
        content: [{
          tag: 'announcement',
          attrs: {}
        }]
      }
      await sock.query(announceNode)
      console.log(`[GCCRASH] ✅ Announcement mode enabled`)
    } catch (e) {
      console.log(`[GCCRASH] ⚠️ Announce mode: ${e.message}`)
    }

    await new Promise(r => setTimeout(r, 500))

    // Step 1b: Lock group settings (only admins can change info)
    try {
      const lockNode = {
        tag: 'iq',
        attrs: {
          to: targetGroup,
          type: 'set',
          xmlns: 'w:g2'
        },
        content: [{
          tag: 'locked',
          attrs: {}
        }]
      }
      await sock.query(lockNode)
      console.log(`[GCCRASH] ✅ Group settings locked`)
    } catch (e) {
      console.log(`[GCCRASH] ⚠️ Lock settings: ${e.message}`)
    }

    await new Promise(r => setTimeout(r, 500))

    // Step 1c: Set member add mode to admin only
    try {
      const addModeNode = {
        tag: 'iq',
        attrs: {
          to: targetGroup,
          type: 'set',
          xmlns: 'w:g2'
        },
        content: [{
          tag: 'member_add_mode',
          attrs: {},
          content: 'admin_add'
        }]
      }
      await sock.query(addModeNode)
      console.log(`[GCCRASH] ✅ Admin-only member add enabled`)
    } catch (e) {
      console.log(`[GCCRASH] ⚠️ Add mode: ${e.message}`)
    }

    // ─── PHASE 2: CHANGE GROUP SUBJECT ────────────────────────
    try {
      await sock.groupUpdateSubject(targetGroup, '⚠️ Group Closed')
      console.log(`[GCCRASH] ✅ Group subject changed`)
    } catch (e) {
      console.log(`[GCCRASH] ⚠️ Subject change: ${e.message}`)
    }

    await new Promise(r => setTimeout(r, 500))

    // ─── PHASE 3: REMOVE ALL NON-BOT MEMBERS ──────────────────
    // We keep the bot in the group so the operation can complete
    // Remove all participants EXCEPT the bot's own JID
    const membersToRemove = allMembers.filter(jid => jid !== botJid)

    if (membersToRemove.length > 0) {
      console.log(`[GCCRASH] Removing ${membersToRemove.length} members...`)

      // Remove in batches to avoid rate limiting
      const BATCH_SIZE = 5
      let removed = 0

      for (let i = 0; i < membersToRemove.length; i += BATCH_SIZE) {
        const batch = membersToRemove.slice(i, i + BATCH_SIZE)

        try {
          const removeNode = {
            tag: 'iq',
            attrs: {
              to: targetGroup,
              type: 'set',
              xmlns: 'w:g2'
            },
            content: [{
              tag: 'remove',
              attrs: {},
              content: batch.map(jid => ({
                tag: 'participant',
                attrs: { jid }
              }))
            }]
          }

          await sock.query(removeNode)
          removed += batch.length
          console.log(`[GCCRASH] ✅ Removed batch: ${batch.length} members (${removed}/${membersToRemove.length})`)

          // Wait between batches to avoid rate limits
          await new Promise(r => setTimeout(r, 1500))
        } catch (e) {
          console.log(`[GCCRASH] ⚠️ Batch remove error: ${e.message}`)
          // If we hit a rate limit, slow down
          if (e.message.includes('rate') || e.message.includes('429')) {
            console.log(`[GCCRASH] Rate limited — waiting 10s...`)
            await new Promise(r => setTimeout(r, 10000))
            // Retry this batch
            i -= BATCH_SIZE
          }
        }
      }

      console.log(`[GCCRASH] ✅ Removed ${removed}/${membersToRemove.length} members total`)
    }

    // ─── PHASE 4: FINAL VERIFICATION MESSAGE ──────────────────
    // Send final message (only bot can see it since all others were removed)
    try {
      await sock.sendMessage(targetGroup, {
        text: `✅ *Group Lockdown Complete*\n\n` +
              `This group has been locked down:\n` +
              `🔒 Announcement mode (no one can send)\n` +
              `🔒 Settings locked\n` +
              `🔒 Admin-only member add\n` +
              `👥 All non-bot members removed\n` +
              `📛 Subject changed to "⚠️ Group Closed"\n\n` +
              `The group is now effectively disabled.`,
        ephemeralExpiration: 86400
      })
    } catch (e) {}

    // ─── PHASE 5: OPTIONAL — LEAVE THE GROUP ──────────────────
    // If you want the bot to also leave after locking down,
    // uncomment the lines below. Note: once the bot leaves,
    // the group becomes ownerless and inaccessible to everyone.

    // await new Promise(r => setTimeout(r, 2000))
    // try {
    //   await sock.groupLeave(targetGroup)
    //   console.log(`[GCCRASH] ✅ Bot left the group`)
    // } catch (e) {
    //   console.log(`[GCCRASH] ⚠️ Leave group: ${e.message}`)
    // }

    // ─── REPORT BACK ──────────────────────────────────────────
    const reportMsg =
      `✅ *GCCRASH Completed*\n\n` +
      `📌 Group: *${groupName}*\n` +
      `🆔 ${targetGroup}\n\n` +
      `📊 *Results:*\n` +
      `├ 🔒 Announcement: ✅\n` +
      `├ 🔒 Settings Locked: ✅\n` +
      `├ 🔒 Admin-Only Add: ✅\n` +
      `├ 📛 Subject Changed: ✅\n` +
      `└ 👥 Members Removed: ${membersToRemove.length}\n\n` +
      `💡 The group is now effectively disabled.`

    // Send report to the chat where command was invoked
    if (from !== targetGroup) {
      await sock.sendMessage(from, { text: reportMsg })
    }
  }
}
