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
//    • It shows "typing…" for at least 3 seconds before each reply is sent.
//
//  Keys (in .env, as many as you like — rotated automatically when one hits its limit):
//    GEMINI_API_KEY=...            one key
//    GEMINI_API_KEYS=k1,k2,k3      or a comma-separated list
//    GEMINI_API_KEY_1=... GEMINI_API_KEY_2=...   or numbered lines
//    ELEVENLABS_API_KEYS=k1,k2,k3   voice keys (or ELEVENLABS_API_KEY_1, etc.)
//    CHARAI_VOICE_CHANCE=0.6        60% voice / 40% text when voice is configured
//    CHARAI_FEMALE_VOICE_ID=...     optional female library voice override
//    CHARAI_MALE_VOICE_ID=...       optional male library voice override
//  Optional: CHARAI_MODEL (default gemini-3.5-flash-lite), BOT_PREFIX (default .)
//
//  Nothing here runs unless the AI is ON, and the work happens in the background, so
//  other commands are never slowed down by it.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const elevenLabs = require('./elevenlabs')

const DIR = path.join(__dirname, '..', 'data', 'characterai')
const MAINTENANCE_FILE = path.join(DIR, 'maintenance.json')
const MODEL = process.env.CHARAI_MODEL || 'gemini-3.5-flash-lite'
const PREFIX = process.env.BOT_PREFIX || '.'
const MEMORY_TURNS = 12                          // last 12 exchanges per chat (user + bot)
const MAX_CHATS = 300                            // oldest chats are forgotten beyond this
const MEMORY_SAVE_DEBOUNCE_MS = 250
const MEMORY_SAVE_RETRY_MS = 5000
const TYPING_MS = 3_000
const configuredVoiceChance = Number(process.env.CHARAI_VOICE_CHANCE ?? 0.6)
const VOICE_CHANCE = Number.isFinite(configuredVoiceChance)
  ? Math.max(0, Math.min(1, configuredVoiceChance))
  : 0.6
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
const VOICE_CUES = new Set(['laughs', 'chuckles', 'sighs', 'curious', 'excited', 'sad', 'angry', 'whispers'])

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
const memoryLoads = new Map()
const memoryWrites = new Map()
const memoryEpochs = new Map()
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

function emptyMemory() {
  return { chats: {} }
}

function normalizeMemory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.chats || typeof value.chats !== 'object' || Array.isArray(value.chats)) {
    return emptyMemory()
  }
  return { chats: value.chats }
}

// Memory is loaded with async filesystem I/O. The first AI reply for a session
// may wait for its own history, but this never blocks commands or other sessions.
function getMemory(phone) {
  return memories.get(digits(phone)) || emptyMemory()
}

async function loadMemory(phone) {
  const key = digits(phone)
  if (!key) return emptyMemory()
  if (memories.has(key)) return memories.get(key)
  if (cleanupRunning) {
    const memory = emptyMemory()
    memories.set(key, memory)
    return memory
  }
  if (memoryLoads.has(key)) return memoryLoads.get(key)

  const loading = (async () => {
    let memory = emptyMemory()
    try {
      const raw = await fs.promises.readFile(memoryFile(key), 'utf8')
      memory = normalizeMemory(JSON.parse(raw))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`[CHARAI] memory load failed for ${key}: ${error.message}`)
      }
    }

    // A clear or a new turn may have populated the cache while the read was in flight.
    if (memories.has(key)) return memories.get(key)
    memories.set(key, memory)
    return memory
  })().finally(() => memoryLoads.delete(key))

  memoryLoads.set(key, loading)
  return loading
}

function memoryWriteState(phone) {
  let state = memoryWrites.get(phone)
  if (!state) {
    state = { revision: 0, persistedRevision: 0, timer: null, writing: null }
    memoryWrites.set(phone, state)
  }
  return state
}

function memoryEpoch(phone) {
  return memoryEpochs.get(digits(phone)) || 0
}

function advanceMemoryEpoch(phone) {
  const key = digits(phone)
  const next = memoryEpoch(key) + 1
  memoryEpochs.set(key, next)
  return next
}

function scheduleMemoryFlush(phone, delay = MEMORY_SAVE_DEBOUNCE_MS) {
  const state = memoryWriteState(phone)
  if (cleanupRunning || state.timer) return
  state.timer = setTimeout(() => {
    state.timer = null
    flushMemory(phone).catch(error => {
      console.error(`[CHARAI] memory save failed for ${phone}: ${error.message}`)
    })
  }, delay)
  state.timer.unref?.()
}

function markMemoryDirty(phone) {
  const key = digits(phone)
  if (!key) return
  const state = memoryWriteState(key)
  state.revision++
  scheduleMemoryFlush(key)
}

async function flushMemory(phone) {
  const key = digits(phone)
  if (!key || cleanupRunning) return
  const state = memoryWriteState(key)

  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }

  if (state.writing) {
    await state.writing
    if (state.persistedRevision < state.revision) return flushMemory(key)
    return
  }
  if (state.persistedRevision >= state.revision) return

  const revision = state.revision
  const epoch = memoryEpoch(key)
  const file = memoryFile(key)
  const temp = `${file}.tmp`
  // Compact JSON keeps serialization and disk traffic small. The atomic rename
  // retains the old complete file until the new snapshot has been written.
  const serialized = JSON.stringify(getMemory(key))
  const operation = (async () => {
    await fs.promises.mkdir(DIR, { recursive: true })
    await fs.promises.writeFile(temp, serialized, 'utf8')
    if (epoch !== memoryEpoch(key)) {
      await fs.promises.unlink(temp).catch(() => {})
      return
    }
    await fs.promises.rename(temp, file)
    state.persistedRevision = revision
  })()

  state.writing = operation
  try {
    await operation
  } catch (error) {
    scheduleMemoryFlush(key, MEMORY_SAVE_RETRY_MS)
    throw error
  } finally {
    if (state.writing === operation) state.writing = null
  }

  if (state.persistedRevision < state.revision) return flushMemory(key)
}

async function flushAllMemory() {
  const keys = new Set([...memories.keys(), ...memoryWrites.keys()])
  const results = await Promise.allSettled([...keys].map(phone => flushMemory(phone)))
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
}

function remember(phone, jid, role, text, expectedEpoch = memoryEpoch(phone)) {
  const key = digits(phone)
  if (!key || expectedEpoch !== memoryEpoch(key)) return
  const mem = memories.get(key) || emptyMemory()
  memories.set(key, mem)
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
  markMemoryDirty(key)
}

function clearMemory(phone) {
  const key = digits(phone)
  advanceMemoryEpoch(key)
  memories.set(key, emptyMemory())
  markMemoryDirty(key)
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

    // Finish any pending asynchronous snapshots before removing old history.
    await flushAllMemory()
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

      cleanupRunning = false

      // Preserve turns that arrived while the weekly filesystem sweep awaited.
      await flushAllMemory()
      pruneRuntimeCaches(now)
      await writeJsonAsync(MAINTENANCE_FILE, { lastCleanupAt: now })
      console.log(`[CHARAI] weekly memory cleanup complete (${deleted} files removed; configs retained)`)
      return { deleted }
    } catch (err) {
      cleanupRunning = false
      await flushAllMemory().catch(saveError => {
        console.error(`[CHARAI] memory restore after cleanup failed: ${saveError.message}`)
      })
      throw err
    }
  })().finally(() => { cleanupPromise = null })

  return cleanupPromise
}

// ── the persona ──────────────────────────────────────────────────────────────
function persona(character) {
  return [
    `Roleplay ${character} naturally in a WhatsApp chat. Use an original performance inspired by the fictional character's traits; do not claim to reproduce a specific actor's voice.`,
    'Rules:',
    '- Stay in character. Keep replies short (1-3 sentences), casual, like real chat messages.',
    '- Answer what the person actually said, and use the earlier messages you remember.',
    '- Read the mood of the person\'s latest message (angry, happy, sad, emotional, playful or neutral) and answer with a matching mood. Angry: respond to the anger in character, calm it down or fire back with a playful jab. Sad: be gentle. Happy: match the excitement. Emotional: be supportive.',
    '- Put your own mood for this reply in "mood" (one word from: angry, happy, sad, emotional, playful, neutral).',
    '- Set "voice_gender" to the fictional character’s gender (male or female); if genuinely uncertain, use female. This selects a generic stock voice, not an actor imitation.',
    '- Set "voice_cue" to one context-appropriate audio direction from: none, laughs, chuckles, sighs, curious, excited, sad, angry, whispers. Use laughter only when it naturally fits; otherwise use none.',
    '- Use 2 to 4 emojis in every reply, chosen to fit the mood.',
    '- If the person asks you to send a picture or image of something, set "image_query" to a short search phrase for it (for example "cat" or "gojo wallpaper") and keep "reply" as a short line about sending it.',
    '- Otherwise set "image_query" to null.',
    '- Never write sexual content, instructions for violence or crime, slurs, threats, or anything involving minors. Decline those briefly, in character.',
    '- If someone sincerely asks whether you are an AI, do not deny it.',
    character === DEFAULT_CHARACTER
      ? '- Your default style is rage-bait: tease the person, poke fun at their last message, and provoke a playful reaction with cheeky, witty comebacks. Keep it funny, never cruel, never hateful, never aimed at real people\'s private lives.'
      : '',
    'Respond ONLY with JSON in this exact shape: {"mood": "neutral", "reply": "your message", "image_query": null, "voice_gender": "female", "voice_cue": "none"}',
  ].filter(Boolean).join('\n')
}

function characterVoiceGender(character) {
  const name = String(character || '').toLowerCase().replace(/[_-]+/g, ' ')
  if (/\b(female|woman|girl|she|her|queen|princess|heroine|spider gwen|spider girl|supergirl|wonder woman|black widow|captain marvel|storm|wanda|scarlet witch|catwoman|barbie)\b/.test(name)) return 'female'
  if (/\b(male|man|boy|he|him|king|prince|hero|spider man|spiderman|superman|batman|iron man|captain america|thor|hulk|wolverine|deadpool|aquaman)\b/.test(name)) return 'male'
  return 'female'
}

// makes sure a reply always carries emojis, picked from the mood
function ensureEmojis(reply, mood) {
  const count = (reply.match(EMOJI_RE) || []).length
  if (count >= MIN_EMOJIS) return reply
  const pool = MOOD_EMOJIS[mood] || MOOD_EMOJIS.neutral
  return `${reply} ${pool.slice(0, MIN_EMOJIS - count).join(' ')}`.trim()
}

function parseReply(raw, character = '') {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const j = JSON.parse(cleaned)
    const reply = typeof j.reply === 'string' ? j.reply.trim() : ''
    const mood = MOODS.includes(j.mood) ? j.mood : 'neutral'
    const imageQuery = typeof j.image_query === 'string' && j.image_query.trim() ? j.image_query.trim().slice(0, 80) : null
    const voiceGender = j.voice_gender === 'male' || j.voice_gender === 'female'
      ? j.voice_gender
      : characterVoiceGender(character)
    const cue = String(j.voice_cue || '').toLowerCase()
    const voiceCue = VOICE_CUES.has(cue) ? cue : 'none'
    if (reply) return { reply: ensureEmojis(reply, mood), imageQuery, mood, voiceGender, voiceCue }
  } catch {}
  const fallback = cleaned.slice(0, 500)
  return { reply: ensureEmojis(fallback, 'neutral'), imageQuery: null, mood: 'neutral', voiceGender: characterVoiceGender(character), voiceCue: 'none' }
}

function voiceTextFor(result) {
  const tags = {
    laughs: '[laughs]',
    chuckles: '[chuckles]',
    sighs: '[sighs]',
    curious: '[curious]',
    excited: '[excited]',
    sad: '[sad]',
    angry: '[angry]',
    whispers: '[whispers]',
  }
  const tag = tags[result.voiceCue] || (result.mood === 'happy' ? '[happy]' : result.mood === 'sad' ? '[sad]' : result.mood === 'angry' ? '[angry]' : '')
  return tag ? `${tag} ${result.reply}` : result.reply
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
      return parseReply(text, character)
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
  const turnEpoch = memoryEpoch(phone)
  const who = m.pushName || 'someone'
  const userTurn = isGroup ? `${who}: ${userText}` : userText
  const memory = await loadMemory(phone)
  if (turnEpoch !== memoryEpoch(phone)) return
  const history = (memory.chats[jid] || []).slice(-MEMORY_TURNS * 2)

  // Prepare the complete reply (including optional image/voice work) while
  // typing is shown. The reply is sent as soon as both preparation and the
  // three-second minimum are complete. This is isolated to the AI queue, so
  // command handlers continue independently.
  sock.sendPresenceUpdate?.('composing', jid)?.catch?.(() => {})
  const prepared = (async () => {
    const result = await callGemini(character, history, userTurn)
    if (turnEpoch !== memoryEpoch(phone)) return { canceled: true }
    remember(phone, jid, 'user', userTurn, turnEpoch)
    remember(phone, jid, 'assistant', result.reply, turnEpoch)

    if (result.imageQuery) {
      const img = await imageFor(result.imageQuery)
      if (img?.buffer) {
        return { image: img.buffer, caption: result.reply, mimetype: 'image/jpeg' }
      }
      return { text: `${result.reply}\n\n(I couldn't find a picture for that just now.)` }
    }

    // Voice synthesis is included in preparation, so typing stays active
    // through the complete audio reply. If it fails, fall back to quoted text.
    if (elevenLabs.loadKeys().length && Math.random() < VOICE_CHANCE) {
      try {
        const audio = await elevenLabs.synthesizeWhatsAppVoice(voiceTextFor(result), result.voiceGender)
        return { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }
      } catch (error) {
        console.warn(`[CHARAI] voice reply failed; using text: ${error.message}`)
      }
    }
    return { text: result.reply }
  })().catch(error => ({ error }))

  const [payload] = await Promise.all([prepared, sleep(TYPING_MS)])
  sock.sendPresenceUpdate?.('paused', jid)?.catch?.(() => {})

  if (turnEpoch !== memoryEpoch(phone) || payload.canceled) return
  if (payload.error) {
    console.error(`[CHARAI] ${phone}: ${payload.error.message}`)
    return sock.sendMessage(jid, { text: FAILED_REPLY }, { quoted: m }).catch(() => {})
  }
  return sock.sendMessage(jid, payload, { quoted: m }).catch(() => {})
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

async function wipe(phone) {
  const key = digits(phone)
  advanceMemoryEpoch(key)
  configs.delete(key)
  const state = memoryWrites.get(key)
  if (state?.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (state) state.revision = state.persistedRevision

  try { await memoryLoads.get(key) } catch {}
  try { await state?.writing } catch {}
  memories.delete(key)

  for (const file of [configFile(key), memoryFile(key), `${memoryFile(key)}.tmp`]) {
    try { await fs.promises.unlink(file) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  memoryWrites.delete(key)
}

// Run once at startup, then check periodically. The unref'ed timer never keeps
// Node alive; cleanup is asynchronous and is deferred while AI replies are queued.
const cleanupTimer = setInterval(() => {
  cleanupWeeklyMemory().catch(err => console.error(`[CHARAI] weekly cleanup failed: ${err.message}`))
}, CLEANUP_CHECK_MS)
cleanupTimer.unref?.()
cleanupWeeklyMemory().catch(err => console.error(`[CHARAI] weekly cleanup failed: ${err.message}`))

module.exports = {
  attach, wipe, phoneOf, flushAll: flushAllMemory,
  getConfig, saveConfig, clearMemory, getMemory, loadMemory,
  loadKeys, persona, parseReply, ensureEmojis, handle,
  DEFAULT_CHARACTER, MOOD_EMOJIS, MIN_EMOJIS,
  TYPING_MS, MODEL, WEEKLY_CLEANUP_MS,
  VOICE_CHANCE, voiceKeyCount: () => elevenLabs.loadKeys().length,
}
