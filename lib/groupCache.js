// ─────────────────────────────────────────────────────────
// lib/groupCache.js  —  CYBER X Group Metadata Cache
// ─────────────────────────────────────────────────────────
// • Caches group metadata with a 5-minute TTL
// • Auto-invalidates the moment participants join / leave /
//   get promoted or demoted — so data is never stale
// • Commands receive getGroupMeta(sock, jid) in their ctx
//   and call it only when they actually need it
// ─────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000          // 5 minutes

const _cache    = new Map()               // jid → { meta, ts }

// ── Internal helpers ──────────────────────────────────────

function _store(jid, meta) {
  _cache.set(jid, { meta, ts: Date.now() })
}

function _drop(jid) {
  if (_cache.delete(jid)) {
    console.log(`[GRP CACHE] ↺ invalidated → ${jid}`)
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * Returns cached metadata if fresh, otherwise fetches once
 * and stores it.  Fast as a Map lookup on every repeat call.
 *
 * @param {object} sock  — Baileys socket
 * @param {string} jid   — group JID (ends with @g.us)
 * @returns {Promise<object>} groupMetadata
 */
async function getGroupMeta(sock, jid) {
  const entry = _cache.get(jid)
  if (entry && (Date.now() - entry.ts) < CACHE_TTL) {
    return entry.meta                     // ⚡ instant — no network call
  }
  const meta = await sock.groupMetadata(jid)
  _store(jid, meta)
  return meta
}

/**
 * Pre-warm the cache for a specific group right now.
 * Useful to call when the bot starts up or joins a group.
 */
async function warmGroup(sock, jid) {
  try {
    const meta = await sock.groupMetadata(jid)
    _store(jid, meta)
  } catch {}
}

/**
 * Call this once inside startBot() right after the socket is
 * created.  Hooks the Baileys events that keep the cache clean.
 */
function initGroupCache(sock) {
  // Participant list changed → cached admin list is now wrong → drop it
  sock.ev.on("group-participants.update", ({ id }) => {
    _drop(id)
  })

  // Name / description / settings changed → patch in-place (no full refetch)
  sock.ev.on("groups.update", updates => {
    for (const u of updates) {
      const entry = _cache.get(u.id)
      if (entry) {
        _cache.set(u.id, {
          meta: { ...entry.meta, ...u },
          ts:   entry.ts                  // keep original timestamp
        })
      }
    }
  })

  console.log("[GRP CACHE] ✔ ready (TTL 5 min, auto-invalidate on participant updates)")
}

// ── Exports ───────────────────────────────────────────────

module.exports = { initGroupCache, getGroupMeta, warmGroup }
