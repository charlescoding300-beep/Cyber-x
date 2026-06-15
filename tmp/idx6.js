sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        const fromMe = m.key.fromMe === true
        const ts     = Number(m.messageTimestamp) || 0
        if (ts < BOT_START - 15) continue
        if (!fromMe) {
          if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
          if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
        }
        handleMessage(sock, m, fromMe).catch(e => console.error("[MSG ERR]", e.message))
      }
    })

    sock.ev.on("group-participants.update", async update => {
      if (typeof lib.handleGroupUpdate === "function")
        lib.handleGroupUpdate(sock, update).catch(() => {})
    })

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        retries = 0
        const currentPrefix = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
        console.log(`\n╔══════════════════════════════╗`)
        console.log(`║  ⚡ ${settings.botName} ONLINE         ║`)
        console.log(`║  Prefix: "${currentPrefix}"                ║`)
        console.log(`╚══════════════════════════════╝\n`)
        try {
          const all = await sock.groupFetchAllParticipating()
          let n = 0
          for (const [jid, meta] of Object.entries(all)) {
            groupCache[jid] = { ...meta, _cachedAt: Date.now() }; n++
          }
          console.log(`[CACHE] ✔ ${n} groups warmed`)
        } catch {}
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          console.log("[BOT] Logged out — delete session/ and re-pair")
          return process.exit(0)
        }
        try { sock.ev.removeAllListeners() } catch {}
        if (retries < MAX_RETRIES) {
          const delay = getDelay(retries)
          console.log(`[BOT] ↺ Retry ${++retries}/${MAX_RETRIES} in ${delay}ms`)
          setTimeout(startBot, delay)
        } else { console.log("[BOT] Max retries"); process.exit(1) }
      }
    })

    sock.ev.on("creds.update", saveCreds)

  } catch (e) {
    console.error("[BOOT ERR]", e.message)
    setTimeout(startBot, getDelay(retries++))
  }
}

startBot()
