let retries = 0
function getDelay(n) { return Math.min(1000 * Math.pow(2, n), 30000) }

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
    const { version }          = await fetchLatestBaileysVersion()
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })),
      },
      logger:              Pino({ level: "silent" }),
      printQRInTerminal:   false,
      markOnlineOnConnect: false,
      syncFullHistory:     false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs:    60000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount:    5,
      cachedGroupMetadata: async (jid) => groupCache[jid],
    })

    sock.ev.on("groups.upsert", gs => {
      for (const g of gs) groupCache[g.id] = { ...g, _cachedAt: Date.now() }
    })
    sock.ev.on("groups.update", us => {
      for (const u of us) {
        groupCache[u.id] = groupCache[u.id]
          ? Object.assign(groupCache[u.id], u, { _cachedAt: Date.now() })
          : { ...u, _cachedAt: Date.now() }
      }
    })
    sock.ev.on("group-participants.update", async ({ id }) => {
      try { groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() } } catch {}
    })

    if (!state.creds.registered) {
      const raw    = process.env.PAIRING_NUMBER || process.env.PHONE_NUMBER || settings.owner
      const number = (raw || "").replace(/\D/g, "")
      if (!number || number.length < 7) {
        console.error("[PAIR] ✗ Set PAIRING_NUMBER in .env"); process.exit(1)
      }
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(number)
          console.log(`\n╔══════════════════════════════╗`)
          console.log(`║  PAIRING CODE: ${code}      ║`)
          console.log(`╚══════════════════════════════╝\n`)
        } catch (e) { console.error("[PAIR] ✗", e.message) }
      }, 3000)
    }

    await loadCommands()
    watchCommands()

    if (typeof lib.setSocket      === "function") lib.setSocket(sock)
    if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)
    if (typeof lib.initAdminCache === "function") lib.initAdminCache(groupCache)
    try { require("./lib/welcome").setStore({ groupMetadata: groupCache }) } catch {}
