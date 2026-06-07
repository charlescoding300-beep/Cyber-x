// ═══════════════════════════════════════════════════════════════
// lib/groupCache.js — Group metadata cache
// Stops bot from fetching group metadata on every single command
// Cache expires after 5 minutes per group
// ═══════════════════════════════════════════════════════════════

const cache = new Map()
const TTL   = 5 * 60 * 1000 // 5 minutes

async function getGroupMeta(sock, jid) {
  const now    = Date.now()
  const cached = cache.get(jid)

  // Return cached if still fresh
  if (cached && (now - cached.time) < TTL) {
    return cached.meta
  }

  // Fetch fresh and cache it
  const meta = await sock.groupMetadata(jid)
  cache.set(jid, { meta, time: now })
  return meta
}

// Call this when group settings change so cache refreshes
function invalidate(jid) {
  cache.delete(jid)
}

// Clear all cache (rarely needed)
function clearAll() {
  cache.clear()
}

module.exports = { getGroupMeta, invalidate, clearAll }
