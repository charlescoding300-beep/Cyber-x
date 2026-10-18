'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/characterai.js — ZEN X | Character AI (multi-session, Gemini)
//
//  The bot owner turns it on with  .characterai set <character>
//  and off with  .characterai off  (see commands/characterai.js).
//
//  While it is ON:
//    • Direct messages to the session get a reply, always, quoted to their message.
//    • Group messages get a reply only when someone mentions the bot or replies to
//      one of its messages. Otherwise the bot stays silent in the group.
//    • Each chat keeps a short memory on disk, so it survives restarts.
//    • Chat history and expired runtime caches are cleaned weekly; AI settings stay.
//    • If the person asks for a picture, the bot searches Pinterest and sends one.
//    • It shows "typing…" for CHARAI_TYPING_SECONDS (default 3) before each reply.
//
//  Keys (in .env, as many as you like — rotated automatically when one hits its limit):
//    GEMINI_API_KEY=...            one key
//    GEMINI_API_KEYS=k1,k2,k3      or a comma-separated list
//    GEMINI_API_KEY_1=... GEMINI_API_KEY_2=...   or numbered lines
//  Optional: CHARAI_MODEL (default gemini-3.5-flash-lite), BOT_PREFIX (default .)
//
//  Nothing here runs unless the AI is ON, and the work happens in the background, so
//  other commands are never slowed down by it.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'data', 'characterai')
const MAINTENANCE_FILE = path.join(DIR, 'maintenance.json')
const MODEL = process.env.CHARAI_MODEL || 'gemini-3.5-flash-lite'
const PREFIX = process.env.BOT_PREFIX || '.'
const MEMORY_TURNS = 12                          // last 12 exchanges per chat (user + bot)
const MAX_CHATS = 300                            // oldest chats are forgotten beyond this
const TYPING_MS = Math.max(0, Number(process.env.CHARAI_TYPING_SECONDS ?? 3)) * 1000
const SEEN_TTL_MS = 10 * 60 * 1000
const WEEKLY_CLEANUP_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_CHECK_MS = 6 * 60 * 60 * 1000
const FAILED_REPLY = "I can't reply right now, please try again in a moment."
const DEFAULT_CHARACTER = 'a playful rage-bait troll'
const MIN_EMOJIS = 2
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const MOOD_EMOJIS = {
  angry: ['😤', '🔥', '😡'],
  happy: ['😄', '🎉', '✨'],
  sad: ['😢', '💔', '🥺'],
  emotional: ['🥹', '💭', '🫶'],
  playful: ['😏', '😜', '🤭'],
  neutral: ['🙂', '👀', '😌'],
}
const MOODS = Object.keys(MOOD_EMOJIS)

// ── identity helpers ─────────────────────────────────────────────────────────
const bare = jid => String(jid || '').replace(/:\d+(?=@)/, '')
const digits = v => String(v || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
const sleep = ms => new Promise(r => setTimeout(r, ms))

function phoneOf(sock, fallback) {
  return digits(fallback || sock?.__zenxCharAiPhone || sock?.user?.id)
}

// ── .env keys ────────────────────────────────────────────────────────────────
function loadKeys() {
  const list = []
  for (const v of [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY]) {
    if (v) list.push(...String(v).split(/[\s,]+/))
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (/^GEMINI_API_KEY_\d+$/.test(k) && v) list.push(v)
  }
  return [...new Set(list.map(s => s.trim()).filter(Boolean))]
}

const keyCooldown = new Map()   // key → time it may be used again
let keyCursor = 0

function nextUsableKey(keys) {
  const now = Date.now()
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(keyCursor + i) % keys.length]
    if ((keyCooldown.get(key) || 0) <= now) {
      keyCursor = (keyCursor + i + 1) % keys.length
      return key
    }
  }
  return null
}

// ── files (small JSON, written atomically) ───────────────────────────────────
function writeJson(file, data) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
  fs.renameSync(file + '.tmp', file)
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

const configFile = phone => path.join(DIR, `config-${digits(phone) || 'unknown'}.json`)
const memoryFile = phone => path.join(DIR, `memory-${digits(phone) || 'unknown'}.json`)

const configs = new Map()   // phone → { enabled, character, updatedAt }
const memories = new Map()  // phone → { chats: { jid: [{ role, text, t }] } }
let cleanupRunning = false
let cleanupPromise = null

function getConfig(phone) {
  const key = digits(phone)
  if (!configs.has(key)) configs.set(key, readJson(configFile(key), { enabled: false, character: '' }))
  return configs.get(key)
}

function saveConfig(phone, cfg) {
  configs.set(digits(phone), cfg)
  writeJson(configFile(phone), cfg)
}

function getMemory(phone) {
  const key = digits(phone)
  if (!memories.has(key)) {
    memories.set(key, cleanupRunning ? { chats: {} } : readJson(memoryFile(key), { chats: {} }))
  }
  return memories.get(key)
}

function remember(phone, jid, role, text) {
  const mem = getMemory(phone)
  const list = mem.chats[jid] || []
  list.push({ role, text: String(text).slice(0, 1000), t: Date.now() })
  mem.chats[jid] = list.slice(-MEMORY_TURNS * 2)

  const keys = Object.keys(mem.chats)
  if (keys.length > MAX_CHATS) {
    keys
      .sort((a, b) => (mem.chats[a].at(-1)?.t || 0) - (mem.chats[b].at(-1)?.t || 0))
      .slice(0, keys.length - MAX_CHATS)
      .forEach(k => delete mem.chats[k])
  }
  // During the weekly disk sweep, keep new turns in memory and flush them after
  // old history is gone. This prevents both lost replies and reloading old data.
  if (!cleanupRunning) writeJson(memoryFile(phone), mem)
}

function clearMemory(phone) {
  memories.set(digits(phone), { chats: {} })
  if (!cleanupRunning) writeJson(memoryFile(phone), { chats: {} })
}

async function writeJsonAsync(file, data) {
  await fs.promises.mkdir(DIR, { recursive: true })
  const temp = `${file}.tmp`
  await fs.promises.writeFile(temp, JSON.stringify(data, null, 2))
  await fs.promises.rename(temp, file)
}

function pruneRuntimeCaches(now = Date.now()) {
  for (const [id, seenAt] of seen) {
    if (now - seenAt > SEEN_TTL_MS) seen.delete(id)
  }
  for (const [key, usableAt] of keyCooldown) {
    if (usableAt <= now) keyCooldown.delete(key)
  }
}

async function cleanupWeeklyMemory(now = Date.now()) {
  if (cleanupPromise) return cleanupPromise

  cleanupPromise = (async () => {
    const state = readJson(MAINTENANCE_FILE, null)
    const lastCleanupAt = Number(state?.lastCleanupAt)

    // Start the seven-day clock without deleting existing history on first boot.
    if (!Number.isFinite(lastCleanupAt) || lastCleanupAt <= 0) {
      await writeJsonAsync(MAINTENANCE_FILE, { lastCleanupAt: now })
      return { initialized: true, deleted: 0 }
    }
    if (now - lastCleanupAt < WEEKLY_CLEANUP_MS) return { skipped: true, deleted: 0 }

    // Let active replies finish. The periodic checker will retry later.
    if (queues.size > 0) return { deferred: true, deleted: 0 }

    cleanupRunning = true
    memories.clear()
    let deleted = 0
    try {
      let names = []
      try {
        names = await fs.promises.readdir(DIR)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }

      // Only remove Character AI conversation-history files and stale atomic-write
      // leftovers. Config files, maintenance state, auth, and other databases stay.
      const memoryFiles = names.filter(name => /^memory-(?:\d+|unknown)\.json(?:\.tmp)?$/.test(name))
      const failures = []
      await Promise.all(memoryFiles.map(async name => {
        const file = path.join(DIR, name)
        try {
          const stat = await fs.promises.lstat(file)
          if (!stat.isFile()) return
          if (name.endsWith('.tmp') && now - stat.mtimeMs < CLEANUP_CHECK_MS) return
          await fs.promises.unlink(file)
          deleted++
        } catch (err) {
          if (err.code !== 'ENOENT') failures.push(err)
        }
      }))
      if (failures.length) throw failures[0]

      pruneRuntimeCaches(now)
      await writeJsonAsync(MAINTENANCE_FILE, { lastCleanupAt: now })
      cleanupRunning = false

      // Preserve any conversations that arrived while filesystem cleanup awaited.
      for (const [phone, memory] of memories) writeJson(memoryFile(phone), memory)
      console.log(`[CHARAI] weekly memory cleanup complete (${deleted} files removed; configs retained)`)
      return { deleted }
    } catch (err) {
      cleanupRunning = false
      for (const [phone, memory] of memories) writeJson(memoryFile(phone), memory)
      throw err
    }
  })().finally(() => { cleanupPromise = null })

  return cleanupPromise
}

// ── the persona ──────────────────────────────────────────────────────────────
function persona(character) {
  return [
    `You are ${character}. Roleplay this character naturally in a WhatsApp chat, the way ${character} would really talk.`,
    'Rules:',
    '- Stay in character. Keep replies short (1-3 sentences), casual, like real chat messages.',
    '- Answer what the person actually said, and use the earlier messages you remember.',
    '- Read the mood of the person\'s latest message (angry, happy, sad, emotional, playful or neutral) and answer with a matching mood. Angry: respond to the anger in character, calm it down or fire back with a playful jab. Sad: be gentle. Happy: match the excitement. Emotional: be supportive.',
    '- Put your own mood for this reply in "mood" (one word from: angry, happy, sad, emotional, playful, neutral).',
    '- Use 2 to 4 emojis in every reply, chosen to fit the mood.',
    '- If the person asks you to send a picture or image of something, set "image_query" to a short search phrase for it (for example "cat" or "gojo wallpaper") and keep "reply" as a short line about sending it.',
    '- Otherwise set "image_query" to null.',
    '- Never write sexual content, instructions for violence or crime, slurs, threats, or anything involving minors. Decline those briefly, in character.',
    '- If someone sincerely asks whether you are an AI, do not deny it.',
    character === DEFAULT_CHARACTER
      ? '- Your default style is rage-bait: tease the person, poke fun at their last message, and provoke a playful reaction with cheeky, witty comebacks. Keep it funny, never cruel, never hateful, never aimed at real people\'s private lives.'
      : '',
    'Respond ONLY with JSON in this exact shape: {"mood": "neutral", "reply": "your message", "image_query": null}',
  ].filter(Boolean).join('\n')
}

// makes sure a reply always carries emojis, picked from the mood
function ensureEmojis(reply, mood) {
  const count = (reply.match(EMOJI_RE) || []).length
  if (count >= MIN_EMOJIS) return reply
  const pool = MOOD_EMOJIS[mood] || MOOD_EMOJIS.neutral
  return `${reply} ${pool.slice(0, MIN_EMOJIS - count).join(' ')}`.trim()
}

function parseReply(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const j = JSON.parse(cleaned)
    const reply = typeof j.reply === 'string' ? j.reply.trim() : ''
    const mood = MOODS.includes(j.mood) ? j.mood : 'neutral'
    const imageQuery = typeof j.image_query === 'string' && j.image_query.trim() ? j.image_query.trim().slice(0, 80) : null
    if (reply) return { reply: ensureEmojis(reply, mood), imageQuery, mood }
  } catch {}
  const fallback = cleaned.slice(0, 500)
  return { reply: ensureEmojis(fallback, 'neutral'), imageQuery: null, mood: 'neutral' }
}

// ── Gemini (rotates through every key you have) ──────────────────────────────
async function callGemini(character, history, userText) {
  const keys = loadKeys()
  if (!keys.length) throw new Error('no GEMINI_API_KEY in .env')

  const contents = [
    ...history.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: userText }] },
  ]
  const body = {
    system_instruction: { parts: [{ text: persona(character) }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 400 },
  }

  let lastErr = null
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = nextUsableKey(keys)
    if (!key) break
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
      if (res.status === 429) { keyCooldown.set(key, Date.now() + 60000); lastErr = new Error('rate limit reached on one key'); continue }
      if (res.status === 401 || res.status === 403) { keyCooldown.set(key, Date.now() + 10 * 60000); lastErr = new Error(`one key was rejected (HTTP ${res.status})`); continue }
      if (res.status === 400) throw new Error(`bad request — check CHARAI_MODEL (${MODEL})`)
      if (!res.ok) throw new Error(`Gemini answered HTTP ${res.status}`)

      const data = await res.json()
      const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
      if (!text.trim()) throw new Error('Gemini sent an empty answer')
      return parseReply(text)
    } catch (e) {
      lastErr = e
      if (/bad request/.test(e.message)) break
    }
  }
  throw lastErr || new Error('no usable Gemini key')
}

// ── Pinterest (the same free search the .pinterest command uses) ─────────────
async function imageFor(query) {
  try {
    const pinterest = require('../commands/pinterest')
    const found = await pinterest._internals.findImages(query)
    if (!found.images.length) return null
    const url = found.images[Math.floor(Math.random() * found.images.length)]
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { url }
    return { buffer: Buffer.from(await res.arrayBuffer()), url }
  } catch (e) {
    console.warn(`[CHARAI] image search failed: ${e.message}`)
    return null
  }
}

// ── message reading ──────────────────────────────────────────────────────────
function textOf(message) {
  let m = message || {}
  for (let i = 0; i < 3; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message
    if (!inner) break
    m = inner
  }
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim()
}

function contextOf(message) {
  const m = message || {}
  for (const k of Object.keys(m)) {
    if (m[k]?.contextInfo) return m[k].contextInfo
  }
  return {}
}

function botJids(sock) {
  return [sock?.user?.id, sock?.user?.lid].filter(Boolean).map(bare)
}

// ── per-chat queue, so two messages to one chat are answered in order ────────
const queues = new Map()
function enqueue(jid, task) {
  const prev = queues.get(jid) || Promise.resolve()
  const next = prev.then(task).catch(e => console.error(`[CHARAI] ${e.message}`))
  queues.set(jid, next)
  next.then(() => { if (queues.get(jid) === next) queues.delete(jid) })
}

const seen = new Map()
function alreadySeen(id) {
  const now = Date.now()
  pruneRuntimeCaches(now)
  if (seen.has(id)) return true
  seen.set(id, now)
  return false
}

// ── the reply itself ─────────────────────────────────────────────────────────
async function respond(sock, phone, character, m, jid, userText, isGroup) {
  const who = m.pushName || 'someone'
  const userTurn = isGroup ? `${who}: ${userText}` : userText
  const history = (getMemory(phone).chats[jid] || []).slice(-MEMORY_TURNS * 2)

  // generate the answer while the typing indicator runs; send when both are done
  sock.sendPresenceUpdate?.('composing', jid)?.catch?.(() => {})
  const answer = callGemini(character, history, userTurn).catch(e => ({ error: e.message }))
  await Promise.all([answer, sleep(TYPING_MS)])
  sock.sendPresenceUpdate?.('paused', jid)?.catch?.(() => {})

  const result = await answer
  if (result.error) {
    console.error(`[CHARAI] ${phone}: ${result.error}`)
    return sock.sendMessage(jid, { text: FAILED_REPLY }, { quoted: m }).catch(() => {})
  }

  remember(phone, jid, 'user', userTurn)
  remember(phone, jid, 'assistant', result.reply)

  if (result.imageQuery) {
    const img = await imageFor(result.imageQuery)
    if (img?.buffer) {
      return sock.sendMessage(jid, { image: img.buffer, caption: result.reply, mimetype: 'image/jpeg' }, { quoted: m }).catch(() => {})
    }
    return sock.sendMessage(jid, { text: `${result.reply}\n\n(I couldn't find a picture for that just now.)` }, { quoted: m }).catch(() => {})
  }
  return sock.sendMessage(jid, { text: result.reply }, { quoted: m }).catch(() => {})
}

// ── decides, for each incoming message, whether to answer ────────────────────
async function handle(sock, phone, m) {
  const key = m?.key
  if (!key || key.fromMe) return
  const jid = key.remoteJid
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return

  const cfg = getConfig(phone)
  if (!cfg.enabled || !cfg.character) return

  const text = textOf(m.message)
  if (!text || text.startsWith(PREFIX)) return          // empty, or a command → never the AI's job

  const isGroup = jid.endsWith('@g.us')
  if (isGroup) {
    const ctx = contextOf(m.message)
    const me = botJids(sock)
    const mentioned = (ctx.mentionedJid || []).map(bare).some(j => me.includes(j))
    const repliedToBot = !!ctx.participant && me.includes(bare(ctx.participant))
    if (!mentioned && !repliedToBot) return              // a normal group chat: stay silent

    // strip the bot's own @mention so the model reads the actual request
    const cleaned = me.reduce((t, j) => t.replace(new RegExp(`@${digits(j)}\\b`, 'g'), ''), text).trim()
    if (!cleaned) return
    if (alreadySeen(key.id)) return
    enqueue(jid, () => respond(sock, phone, cfg.character, m, jid, cleaned, true))
    return
  }

  if (alreadySeen(key.id)) return
  enqueue(jid, () => respond(sock, phone, cfg.character, m, jid, text, false))
}

// ── attach to a session socket (index.js calls this for every session) ───────
function attach(state, sock) {
  if (!sock || sock.__zenxCharAi) return
  sock.__zenxCharAi = true
  const phone = phoneOf(sock, state?.phone)
  sock.__zenxCharAiPhone = phone

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages || []) {
      // not awaited: the other commands never wait for the AI
      handle(sock, phone, m).catch(e => console.error(`[CHARAI] ${e.message}`))
    }
  })
  console.log(`[CHARAI:${phone}] ✔ listening (${getConfig(phone).enabled ? 'ON' : 'OFF'})`)
}

function wipe(phone) {
  const key = digits(phone)
  configs.delete(key)
  memories.delete(key)
  for (const f of [configFile(key), memoryFile(key)]) {
    try { fs.unlinkSync(f) } catch {}
  }
}

// Run once at startup, then check periodically. The unref'ed timer never keeps
// Node alive; cleanup is asynchronous and is deferred while AI replies are queued.
const cleanupTimer = setInterval(() => {
  cleanupWeeklyMemory().catch(err => console.error(`[CHARAI] weekly cleanup failed: ${err.message}`))
}, CLEANUP_CHECK_MS)
cleanupTimer.unref?.()
cleanupWeeklyMemory().catch(err => console.error(`[CHARAI] weekly cleanup failed: ${err.message}`))

module.exports = {
  attach, wipe, phoneOf,
  getConfig, saveConfig, clearMemory, getMemory,
  loadKeys, persona, parseReply, ensureEmojis, handle,
  DEFAULT_CHARACTER, MOOD_EMOJIS, MIN_EMOJIS,
  TYPING_MS, MODEL, WEEKLY_CLEANUP_MS,
}
