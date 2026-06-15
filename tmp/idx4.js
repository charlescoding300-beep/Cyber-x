let pingCount = 0, lastPing = null
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0]
  if (url === "/ping" || url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" })
    return res.end(JSON.stringify({
      status:   "online",
      bot:      settings.botName,
      uptime:   Math.floor(process.uptime()),
      memory:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      commands: registry.map.size,
      groups:   Object.keys(groupCache).length,
      pings:    pingCount,
    }))
  }
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("⚡ CYBER X ONLINE")
})
server.keepAliveTimeout = 120000
server.headersTimeout   = 125000
server.listen(PORT, "0.0.0.0", () => console.log(`[WEB] ⚡ Port ${PORT}`))

function ping() {
  const url  = `${SELF_URL}/ping`
  const lib2 = url.startsWith("https") ? https : http
  const req  = lib2.get(url, () => {
    pingCount++
    lastPing = new Date().toISOString()
    console.log(`[PING] ✔ #${pingCount}`)
  })
  req.on("error", () => {})
  req.setTimeout(10000, () => { req.destroy() })
}
setTimeout(() => { ping(); setInterval(ping, 4 * 60 * 1000) }, 15000)

setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const jid of Object.keys(groupCache)) {
    if (groupCache[jid]._cachedAt && now - groupCache[jid]._cachedAt > 30 * 60 * 1000) {
      delete groupCache[jid]; cleaned++
    }
  }
  if (global.gc) { global.gc(); console.log("[CLEAN] ♻️ GC ran") }
  const mem = process.memoryUsage()
  console.log(`[CLEAN] Heap:${Math.round(mem.heapUsed/1024/1024)}MB RSS:${Math.round(mem.rss/1024/1024)}MB cleaned:${cleaned}`)
}, 15 * 60 * 1000)
