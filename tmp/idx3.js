function extractBody(msg) {
  const m = msg?.message
  if (!m) return ""
  const inner =
    m.ephemeralMessage?.message  ||
    m.viewOnceMessage?.message   ||
    m.viewOnceMessageV2?.message ||
    m
  return (
    inner.conversation                                           ||
    inner.extendedTextMessage?.text                             ||
    inner.imageMessage?.caption                                 ||
    inner.videoMessage?.caption                                 ||
    inner.documentMessage?.caption                              ||
    inner.buttonsResponseMessage?.selectedButtonId              ||
    inner.listResponseMessage?.singleSelectReply?.selectedRowId ||
    inner.templateButtonReplyMessage?.selectedId               ||
    ""
  )
}

function checkIsOwner(sender) {
  const clean = (sender || "").split("@")[0].split(":")[0].replace(/\D/g, "")
  if (!clean) return false
  if (typeof settings.isOwner === "function") return settings.isOwner(sender)
  const owners = settings.owners || []
  if (owners.includes(clean)) return true
  const base = (settings.owner || "").replace(/\D/g, "")
  return !!base && clean === base
}

const helper = {
  async reply(sock, msg, text) {
    return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
  },
  async send(sock, jid, text) {
    return sock.sendMessage(jid, { text })
  },
  async react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } })
  },
  async sendImage(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { image: { url }, caption })
  },
  async sendVideo(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { video: { url }, caption })
  },
  async sendGif(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { video: { url }, gifPlayback: true, caption })
  },
  async sendAudio(sock, jid, buffer, ptt = false) {
    return sock.sendMessage(jid, { audio: buffer, ptt, mimetype: "audio/mpeg" })
  },
  async sendDoc(sock, jid, buffer, filename, mimetype = "application/octet-stream") {
    return sock.sendMessage(jid, { document: buffer, fileName: filename, mimetype })
  },
  box(title, lines = []) {
    const body = lines.map(l => `║  ${l}`).join("\n")
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n${body}\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
  },
  msToTime(ms) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`
  },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)) },
}

async function handleMessage(sock, msg, fromMe) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  // FIX 4 — always read prefix live from settings so .setprefix works instantly
  const prefix = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
  if (!body.startsWith(prefix)) return

  const from    = msg.key.remoteJid
  const sender  = msg.key.participant || from
  const isOwner = checkIsOwner(sender)
  const mode    = (typeof settings.get === "function"
    ? settings.get("mode") : settings.mode) || "public"

  // FIX 5 — private mode: allow owner AND bot's own messages (fromMe)
  if (mode === "private" && !isOwner && !fromMe) return

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = registry.aliases.get(rawCmd) || rawCmd
  const command   = registry.map.get(canonical)
  if (!command) { console.log(`[CMD] ? unknown: ${rawCmd}`); return }

  const isGroup = from.endsWith("@g.us")
  let isAdmin = false, isBotAdmin = false
  if (isGroup && groupCache[from]) {
    const botJid    = (sock.user?.id || "").replace(/:.*@/, "@")
    const senderJid = sender.replace(/:.*@/, "@")
    for (const p of (groupCache[from].participants || [])) {
      const pid = (p.id || "").replace(/:.*@/, "@")
      const adm = p.admin === "admin" || p.admin === "superadmin"
      if (pid === senderJid && adm) isAdmin    = true
      if (pid === botJid    && adm) isBotAdmin = true
    }
  }

  console.log(`[CMD] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} fromMe:${fromMe}`)
  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands:   registry.map,
      cmdList:    registry.list,
      cmdDetails: registry.details,
      settings, lib, helper,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache,
    })
  } catch (e) {
    console.error(`[RUN ERR] ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ *${rawCmd}* error: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}
