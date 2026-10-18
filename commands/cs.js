// commands/cs.js
// .cs — publish replied content to a WhatsApp CHANNEL you own or administer.
//   Reply to text / image / video / audio with:
//     .cs <channel link | invite code | JID | name>
//     .cs all            (every channel you administer)
//     .cs all stop       (cancel a running .cs all job)
//     .cs check <link>   (diagnostics: role, linked number, engine readiness)
//   Flags: --plain  (never auto-upgrade a link to an image post)
//          --lib    (use Baileys' own sendMessage for media instead of the direct engine)
//
// HOW CHANNEL MEDIA REALLY WORKS (why earlier versions "sent" but nothing showed):
//   Channels are NOT end-to-end encrypted. The official client:
//     1. uploads the RAW file to  /newsletter/newsletter-<type>  (not /mms/*)  with
//        server_thumb_gen=1 (+ server_transcode=1 for video)  -> server answers with
//        a direct_path that starts with /m1/ (an /o1/ path = wrong upload route)
//     2. sends a <message type="media"> whose <plaintext> child carries a
//        mediatype="image|video|gif|ptt|audio" attribute and a protobuf with
//        directPath + fileSha256 + fileLength but NO url / mediaKey / fileEncSha256
//   Baileys currently drops the mediatype attribute on the plaintext node
//   (WhiskeySockets/Baileys PR #2836) and uses the wrong CDN path (PR #2434), so the
//   server accepts the stanza but never publishes it. This file does both steps itself,
//   so it does not depend on any library patch, and it reads the server's ack so
//   "sent" really means "accepted".

const axios = require("axios")
const Pino = require("pino")
const crypto = require("crypto")
const os = require("os")
const path = require("path")
const fs = require("fs")
const { spawn } = require("child_process")

const baileys = require("@whiskeysockets/baileys")
const { downloadMediaMessage } = baileys

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const SUPPORTED_MEDIA = new Set(["image", "video", "audio"])
const ACK_TIMEOUT_MS = 20000

// ── quoted-message helpers ───────────────────────────────────────────────────
function getQuotedInfo(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo

  if (!ctx?.quotedMessage) return null
  return { quotedMessage: ctx.quotedMessage, participant: ctx.participant, stanzaId: ctx.stanzaId }
}

function unwrap(message) {
  let current = message
  for (let i = 0; i < 8 && current; i++) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message
    if (!next) break
    current = next
  }
  return current
}

function getContent(message) {
  const m = unwrap(message)
  if (m?.conversation) return { type: "text", node: { text: m.conversation } }
  if (m?.extendedTextMessage) return { type: "text", node: m.extendedTextMessage }
  if (m?.imageMessage) return { type: "image", node: m.imageMessage }
  if (m?.videoMessage) return { type: "video", node: m.videoMessage }
  if (m?.audioMessage) return { type: "audio", node: m.audioMessage }
  return null
}

async function downloadMedia(sock, node, quoted, from) {
  const fakeMsg = {
    key: { remoteJid: from, id: quoted.stanzaId, participant: quoted.participant, fromMe: false },
    message: unwrap(quoted.quotedMessage),
  }
  const buffer = await downloadMediaMessage(fakeMsg, "buffer", {}, {
    logger: Pino({ level: "silent" }),
    reuploadRequest: sock.updateMediaMessage,
  })
  if (!buffer || buffer.length < 10) throw new Error("Downloaded media is empty")
  return buffer
}

// ── channel resolution ───────────────────────────────────────────────────────
function extractInviteCode(raw) {
  const s = String(raw || "").trim()
  const m = s.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/i)
  if (m) return m[1]
  if (/^[A-Za-z0-9]{10,}$/.test(s)) return s
  return null
}

function roleOf(meta) {
  if (!meta) return null
  const vm = meta.viewer_metadata || meta.viewerMetadata || meta.thread_metadata?.viewer_metadata || {}
  const raw =
    vm.role ?? vm.view_role ?? vm.viewRole ??
    meta.role ?? meta.view_role ?? meta.viewRole ?? null
  return raw ? String(raw).toUpperCase() : null
}
const isAdminRole = role => role === "ADMIN" || role === "OWNER"

function rawViewer(meta) {
  try {
    const vm = meta?.viewer_metadata || meta?.viewerMetadata || meta?.thread_metadata?.viewer_metadata
    return vm ? JSON.stringify(vm) : "none returned"
  } catch { return "unreadable" }
}

async function fetchMetadata(sock, { code, jid }) {
  if (jid) return await sock.newsletterMetadata("jid", jid)
  return await sock.newsletterMetadata("invite", code)
}

async function resolveRole(sock, meta) {
  let role = roleOf(meta)
  if (isAdminRole(role)) return role
  const id = meta?.id
  if (!id) return role

  // These are independent fallbacks; run them together so a missing role in
  // invite metadata doesn't add two serial network round trips to every post.
  const [jidResult, participatingResult] = await Promise.allSettled([
    Promise.resolve().then(() => sock.newsletterMetadata("jid", id)),
    Promise.resolve().then(() => sock.newsletterFetchAllParticipating()),
  ])

  if (jidResult.status === "fulfilled") {
    const jidRole = roleOf(jidResult.value)
    if (jidRole) role = jidRole
    if (isAdminRole(jidRole)) return jidRole
  }

  if (participatingResult.status === "fulfilled") {
    const all = participatingResult.value
    const hit = Object.values(all || {}).find(c => c?.id === id)
    if (hit) {
      const participatingRole = roleOf(hit)
      if (participatingRole) role = participatingRole
      if (isAdminRole(participatingRole)) return participatingRole
    }
  }

  return role
}

async function findChannel(sock, destination) {
  const raw = String(destination || "").trim()
  if (!raw) return null

  if (raw.endsWith("@newsletter")) {
    const meta = await fetchMetadata(sock, { jid: raw })
    return meta?.id ? meta : null
  }

  const code = extractInviteCode(raw)
  if (code) {
    const meta = await fetchMetadata(sock, { code })
    if (meta?.id) return meta
    throw new Error("That invite link/code didn't resolve to a channel.")
  }

  const mine = await listMyChannels(sock)
  const exact = mine.find(c => String(c.name || "").trim().toLowerCase() === raw.toLowerCase())
  if (exact) return exact
  const partial = mine.filter(c => String(c.name || "").toLowerCase().includes(raw.toLowerCase()))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) throw new Error(`More than one channel matches "${raw}". Use its link instead.`)
  return null
}

function metaName(meta) {
  return meta?.name || meta?.thread_metadata?.name?.text || meta?.thread_metadata?.name || meta?.id
}

async function listMyChannels(sock) {
  const all = await sock.newsletterFetchAllParticipating()
  const list = Object.values(all || {})
  const out = []
  for (const c of list) {
    let role = roleOf(c)
    if (!role && c?.id) {
      try { role = roleOf(await sock.newsletterMetadata("jid", c.id)) } catch {}
    }
    if (isAdminRole(role)) out.push({ ...c, _role: role })
  }
  return out
}

const sessionNumber = sock => String(sock.user?.id || "").replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "") || "unknown"

// ── link-to-image upgrade for text posts ─────────────────────────────────────
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/i
const extractFirstUrl = text => String(text || "").match(URL_RE)?.[1]?.replace(/[)\].,;:!?]+$/, "") || null
const toFetchUrl = u => (/^https?:\/\//i.test(u) ? u : `https://${u}`)

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}
function readMeta(html, names) {
  for (const name of names) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) ||
              html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i"))
    if (m?.[1]) return decodeEntities(m[1])
  }
  return null
}

async function fetchHeroImage(url) {
  const res = await axios.get(toFetchUrl(url), {
    timeout: 8000, maxRedirects: 5, maxContentLength: 3 * 1024 * 1024, responseType: "text",
    headers: { "User-Agent": "facebookexternalhit/1.1", Accept: "text/html,*/*" },
    validateStatus: s => s >= 200 && s < 400,
  })
  const html = String(res.data || "")
  let image = readMeta(html, ["og:image", "og:image:url", "twitter:image"])
  if (!image) return null
  const finalUrl = res.request?.res?.responseUrl || toFetchUrl(url)
  try { image = new URL(image, finalUrl).href } catch { return null }
  const img = await axios.get(image, {
    responseType: "arraybuffer", timeout: 8000, maxContentLength: 8 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  const buf = Buffer.from(img.data)
  return buf.length > 500 ? buf : null
}

// ── audio: channel voice notes need ogg/opus ─────────────────────────────────
function runFfmpeg(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "ignore" })
    const timer = setTimeout(() => { try { p.kill("SIGKILL") } catch {} ; reject(new Error("ffmpeg timeout")) }, timeoutMs)
    p.on("error", e => { clearTimeout(timer); reject(e) })
    p.on("close", code => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    })
  })
}

async function prepareAudio(buffer, mimetype) {
  const mt = String(mimetype || "")
  if (/ogg/i.test(mt) && /opus/i.test(mt)) return { buffer, mimetype: "audio/ogg; codecs=opus" }

  const id = crypto.randomBytes(6).toString("hex")
  const inPath = path.join(os.tmpdir(), `cs-${id}.in`)
  const outPath = path.join(os.tmpdir(), `cs-${id}.ogg`)
  try {
    await fs.promises.writeFile(inPath, buffer)
    await runFfmpeg(["-y", "-i", inPath, "-vn", "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1", "-f", "ogg", outPath])
    const out = await fs.promises.readFile(outPath)
    if (out.length < 100) throw new Error("ffmpeg produced an empty file")
    return { buffer: out, mimetype: "audio/ogg; codecs=opus" }
  } catch (e) {
    console.warn(`[CS] audio conversion skipped (${e.message}) — sending original`)
    return { buffer, mimetype: mt || "audio/mpeg" }
  } finally {
    await fs.promises.unlink(inPath).catch(() => {})
    await fs.promises.unlink(outPath).catch(() => {})
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DIRECT CHANNEL ENGINE
// ═════════════════════════════════════════════════════════════════════════════
const NL_PATHS = {
  image: "/newsletter/newsletter-image",
  video: "/newsletter/newsletter-video",
  gif:   "/newsletter/newsletter-gif",
  ptt:   "/newsletter/newsletter-ptt",
  audio: "/newsletter/newsletter-audio",
}
const NL_TRANSCODE = new Set(["video", "gif"])

// same url-safe encoding Baileys uses for the upload path / token
const encodeForUpload = b64 => encodeURIComponent(String(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))

// what WhatsApp calls the media: image | video | gif | ptt | audio
function channelKind(type, node) {
  if (type === "video" && node?.gifPlayback) return "gif"
  if (type === "audio") return node?.ptt ? "ptt" : "audio"
  return type
}

function toBuf(v) {
  if (!v) return undefined
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v)
  if (typeof v === "string") return Buffer.from(v, "base64")
  return undefined
}

// STEP 1 — raw (unencrypted) upload to the newsletter CDN path
async function uploadRaw(sock, kind, buffer) {
  if (typeof sock.refreshMediaConn !== "function") throw new Error("this Baileys build has no sock.refreshMediaConn")

  const sha = crypto.createHash("sha256").update(buffer).digest()
  const token = encodeForUpload(sha.toString("base64"))
  let conn = await sock.refreshMediaConn(false)
  let lastErr = "no upload hosts returned"

  for (let round = 0; round < 2; round++) {
    for (const h of conn?.hosts || []) {
      const hostname = h?.hostname || h
      let url = `https://${hostname}${NL_PATHS[kind]}/${token}?auth=${encodeURIComponent(conn.auth)}&token=${token}&server_thumb_gen=1`
      if (NL_TRANSCODE.has(kind)) url += "&server_transcode=1"
      try {
        const res = await axios.post(url, buffer, {
          headers: { "Content-Type": "application/octet-stream", Origin: "https://web.whatsapp.com" },
          maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000,
          validateStatus: () => true,
        })
        const data = res.data
        const directPath = data?.direct_path || data?.directPath
        if (res.status >= 200 && res.status < 300 && directPath) {
          // Channel media must come from the newsletter CDN route (/m1/).
          // A regular-media path (/o1/) can be accepted by upload but won't
          // render in a channel, so try another host instead of claiming success.
          if (String(directPath).startsWith("/m1/")) {
            return { directPath, raw: data, sha, host: hostname, status: res.status }
          }
          const route = String(directPath).match(/^\/[^/]+\//)?.[0] || "unknown"
          lastErr = `HTTP ${res.status} returned ${route}; expected /m1/`
          continue
        }
        lastErr = `HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`
      } catch (e) { lastErr = e.message }
    }
    if (round === 0) conn = await sock.refreshMediaConn(true)   // stale auth? get a fresh one and retry
  }
  throw new Error(`channel upload failed: ${lastErr}`)
}

// thumbnail info the server may return when server_thumb_gen=1 is set
function pickServerThumb(raw) {
  const t = raw?.thumbnail_info || raw?.thumbnailInfo || raw || {}
  const dp = t.thumbnail_direct_path || t.thumbnailDirectPath
  if (!dp) return null
  return {
    thumbnailDirectPath: dp,
    thumbnailSha256: toBuf(t.thumbnail_sha256 || t.thumbnailSha256),
    thumbnailEncSha256: toBuf(t.thumbnail_enc_sha256 || t.thumbnailEncSha256),
    thumbnailHeight: t.thumbnail_height || t.thumbnailHeight || undefined,
    thumbnailWidth: t.thumbnail_width || t.thumbnailWidth || undefined,
  }
}

function strip(o) {
  const out = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v
  return out
}

// STEP 2 — the message body: directPath + sha + length. NO url, NO mediaKey, NO fileEncSha256.
function buildChannelMessage(kind, type, up, buffer, node, mimetype) {
  const common = {
    directPath: up.directPath,
    fileSha256: up.sha,
    fileLength: buffer.length,
    mimetype,
    ...(pickServerThumb(up.raw) || {}),
  }
  if (type === "image") {
    return { imageMessage: strip({ ...common, caption: node.caption, width: node.width, height: node.height, jpegThumbnail: toBuf(node.jpegThumbnail) }) }
  }
  if (type === "video") {
    return { videoMessage: strip({ ...common, caption: node.caption, seconds: node.seconds, width: node.width, height: node.height, gifPlayback: kind === "gif" ? true : undefined, jpegThumbnail: toBuf(node.jpegThumbnail) }) }
  }
  return { audioMessage: strip({ ...common, seconds: node.seconds, ptt: kind === "ptt" ? true : undefined }) }
}

function newMsgId(sock) {
  try {
    if (typeof baileys.generateMessageIDV2 === "function") return baileys.generateMessageIDV2(sock.user?.id)
    if (typeof baileys.generateMessageID === "function") return baileys.generateMessageID()
  } catch {}
  return "3EB0" + crypto.randomBytes(9).toString("hex").toUpperCase()
}

// STEP 3 — send the stanza ourselves, with the mediatype attribute Baileys drops,
// and wait for the server's ack so we know whether it was really accepted.
async function relayChannelMedia(sock, jid, message, kind) {
  if (typeof sock.sendNode !== "function") throw new Error("this Baileys build has no sock.sendNode")
  const { proto } = baileys
  const bytes = proto.Message.encode(proto.Message.fromObject(message)).finish()
  const id = newMsgId(sock)

  const stanza = {
    tag: "message",
    attrs: { to: jid, id, type: "media" },
    content: [{ tag: "plaintext", attrs: { mediatype: kind }, content: bytes }],
  }

  let ackPromise = null
  if (typeof sock.waitForMessage === "function") {
    ackPromise = Promise.resolve(sock.waitForMessage(id, ACK_TIMEOUT_MS)).catch(e => ({ _err: e }))
  }

  await sock.sendNode(stanza)

  let ack = null
  if (ackPromise) {
    const res = await ackPromise
    if (res?._err) ack = { timedOut: true }
    else ack = { attrs: res?.attrs || {} }
  }

  if (ack?.attrs?.error) {
    throw new Error(`WhatsApp rejected the post (server error ${ack.attrs.error})`)
  }
  return { key: { id }, ack }
}

async function sendMediaDirect(sock, channelJid, type, buffer, node) {
  let mimetype = node.mimetype || (type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : "audio/mpeg")
  let data = buffer

  if (type === "audio" && node.ptt) {
    const a = await prepareAudio(buffer, node.mimetype)
    data = a.buffer
    mimetype = a.mimetype
  }

  const kind = channelKind(type, node)
  const up = await uploadRaw(sock, kind, data)
  console.log(`[CS] uploaded ${kind} ${data.length}B via ${up.host} -> directPath ${up.directPath}`)

  const message = buildChannelMessage(kind, type, up, data, node, mimetype)
  const res = await relayChannelMedia(sock, channelJid, message, kind)
  console.log(`[CS] stanza sent (mediatype=${kind}) id=${res.key.id} ack=${JSON.stringify(res.ack)}`)
  return { ...res, directPath: up.directPath, kind }
}

// OLD engine, kept behind --lib for comparison
async function sendMediaLib(sock, channelJid, type, buffer, node) {
  const input = { mimetype: node.mimetype, [type]: buffer }
  if (node.caption) input.caption = node.caption
  if (type === "video" && node.gifPlayback) input.gifPlayback = true
  if (type === "audio") input.ptt = !!node.ptt
  const st = await sock.sendMessage(channelJid, input)
  return { key: st?.key || {}, ack: null, directPath: null, kind: type }
}

function sendMedia(sock, channelJid, type, buffer, node, useLib = false) {
  return useLib
    ? sendMediaLib(sock, channelJid, type, buffer, node)
    : sendMediaDirect(sock, channelJid, type, buffer, node)
}

async function sendText(sock, channelJid, text) {
  return await sock.sendMessage(channelJid, { text })
}

async function sendTextSmart(sock, channelJid, text, plain, useLib) {
  if (!plain) {
    const link = extractFirstUrl(text)
    if (link) {
      try {
        const img = await fetchHeroImage(link)
        if (img) return await sendMedia(sock, channelJid, "image", img, { mimetype: "image/jpeg", caption: text }, useLib)
      } catch (e) {
        console.warn(`[CS] hero-image upgrade skipped: ${e.message}`)
      }
    }
  }
  return await sendText(sock, channelJid, text)
}

function describeResult(res) {
  if (!res?.kind) return ""
  const lines = []
  if (res.directPath) {
    const good = String(res.directPath).startsWith("/m1/")
    lines.push(`> Upload route: ${good ? "✅" : "⚠️"} ${String(res.directPath).slice(0, 24)}…${good ? "" : " (expected /m1/)"}`)
  }
  if (res.ack === null || res.ack === undefined) lines.push("> Server ack: ➖ not checked")
  else if (res.ack.timedOut) lines.push("> Server ack: ⚠️ none within 20s")
  else lines.push(`> Server ack: ✅ accepted`)
  return lines.join("\n")
}

// ── .cs all ──────────────────────────────────────────────────────────────────
const bulkJobs = new Map()
const MAX_CONSECUTIVE_FAILS = 5
const sleep = ms => new Promise(r => setTimeout(r, ms))
const allDelayMs = () => { const n = parseInt(process.env.CS_ALL_DELAY_MS, 10); return Number.isFinite(n) && n >= 0 ? n : 2500 }
const allJitterMs = () => { const n = parseInt(process.env.CS_ALL_JITTER_MS, 10); return Number.isFinite(n) && n >= 0 ? n : 800 }

async function runAllChannels({ sock, from, msg, helper, sub, plain, useLib }) {
  const key = sessionNumber(sock)
  const running = bulkJobs.get(key)

  if (sub === "stop") {
    if (!running) return helper.reply(sock, msg, "> ℹ️ *No bulk channel post is running.*")
    running.cancel = true
    return helper.reply(sock, msg, `> 🛑 *Stopping after the current channel…*\n> Done so far: *${running.done}/${running.total}*`)
  }
  if (running) {
    return helper.reply(sock, msg, `> ⏳ *A bulk channel post is already running* (${running.done}/${running.total}).\n> Send *.cs all stop* to cancel it.`)
  }

  const quoted = getQuotedInfo(msg)
  if (!quoted) return helper.reply(sock, msg, "> ❌ *Reply to the content you want to post, then send .cs all*")
  const content = getContent(quoted.quotedMessage)
  if (!content) return helper.reply(sock, msg, "> ❌ *Unsupported quoted message.*")
  if (content.type !== "text" && !SUPPORTED_MEDIA.has(content.type)) {
    return helper.reply(sock, msg, `> ❌ *${content.type} isn't supported.*\n> Supported: image, video, audio, text`)
  }

  let channels
  try { channels = await listMyChannels(sock) } catch (e) {
    return helper.reply(sock, msg, `> ❌ *Couldn't fetch your channels.*\n> ${e.message}`)
  }
  if (!channels.length) {
    return helper.reply(sock, msg, `> ❌ *This bot's number (+${sessionNumber(sock)}) doesn't own or administer any channels.*\n> Make this number an admin of your channel (Channel → Invite admins), then try again.`)
  }

  let publish
  try {
    if (content.type === "text") {
      const textValue = content.node?.text || content.node?.caption || ""
      if (!textValue.trim()) throw new Error("The quoted text message is empty.")
      publish = (c) => sendTextSmart(sock, c.id, textValue, plain, useLib)
    } else {
      const buffer = await downloadMedia(sock, content.node, quoted, from)
      publish = (c) => sendMedia(sock, c.id, content.type, buffer, content.node, useLib)
    }
  } catch (e) {
    return helper.reply(sock, msg, `> ❌ *Couldn't prepare the content.*\n> ${e.message}`)
  }

  const job = { cancel: false, total: channels.length, done: 0 }
  bulkJobs.set(key, job)
  const delay = allDelayMs()
  const etaMin = Math.max(1, Math.round((channels.length * (delay + allJitterMs() / 2 + 1500)) / 60000))

  await helper.reply(sock, msg,
    `> 📤 *Posting to ALL your channels…*\n>\n> Channels: *${channels.length}*\n> Type: *${content.type}*\n> Estimated time: ~${etaMin} min\n>\n> Send *.cs all stop* to cancel.\n>\n${CREDIT}`
  ).catch(() => {})

  ;(async () => {
    const ok = [], failed = []
    let streak = 0, aborted = false
    try {
      for (const c of channels) {
        if (job.cancel) break
        try { await publish(c); ok.push(c); streak = 0 }
        catch (e) { failed.push({ c, reason: e.message }); streak++; console.error(`[CS ALL] ✗ ${metaName(c)}: ${e.message}`) }
        job.done++
        if (streak >= MAX_CONSECUTIVE_FAILS) { aborted = true; break }
        if (job.done % 20 === 0 && job.done < channels.length && !job.cancel) {
          helper.reply(sock, msg, `> ⏳ *Progress:* ${job.done}/${job.total}  (✅ ${ok.length}  ❌ ${failed.length})`).catch(() => {})
        }
        if (job.done < channels.length && !job.cancel) await sleep(delay + Math.floor(Math.random() * (allJitterMs() + 1)))
      }
    } finally { bulkJobs.delete(key) }

    const head = job.cancel ? "🛑 *Bulk post cancelled.*" : aborted ? `⚠️ *Stopped — ${MAX_CONSECUTIVE_FAILS} failures in a row.*` : "✅ *Bulk post finished.*"
    const failLines = failed.slice(0, 8).map(f => `> • ${metaName(f.c)} — ${String(f.reason).slice(0, 60)}`)
    const more = failed.length > 8 ? `\n> …and ${failed.length - 8} more` : ""
    const summary = `> ${head}\n>\n> Type: *${content.type}*\n> Posted: *${ok.length}* / ${job.total}\n> Failed: *${failed.length}*` +
      (failLines.length ? `\n>\n${failLines.join("\n")}${more}` : "") + `\n>\n${CREDIT}`
    await helper.reply(sock, msg, summary).catch(() => {})
  })().catch(e => console.error("[CS ALL] crashed:", e))
}

// ── diagnostics ──────────────────────────────────────────────────────────────
function engineReadiness(sock) {
  const has = (v) => v ? "✅" : "❌"
  return `refreshMediaConn ${has(typeof sock.refreshMediaConn === "function")}  sendNode ${has(typeof sock.sendNode === "function")}  waitForMessage ${has(typeof sock.waitForMessage === "function")}  proto.Message ${has(!!baileys.proto?.Message)}`
}

// ── the command ──────────────────────────────────────────────────────────────
module.exports = {
  name: "cs",
  aliases: ["channelstatus"],
  heavy: true,
  media: true,
  desc: "Publish replied content (text, image, video, audio) to a WhatsApp Channel you own or administer.",
  usage: ".cs <channel link|code|JID|name> | .cs all | .cs all stop | .cs check <link>  (flags: --plain; Baileys native channel media is the default)",
  category: "owner",

  // exported for offline tests
  _internals: { roleOf, resolveRole, uploadRaw, buildChannelMessage, relayChannelMedia, sendMediaDirect, channelKind, encodeForUpload, describeResult },

  run: async ({ sock, from, msg, text, isOwner, helper }) => {
    if (!isOwner) return helper.reply(sock, msg, "> ❌ *Owner only.*")

    let destination = String(text || "").trim()
    const plain = /(^|\s)--plain(?=\s|$)/i.test(destination)
    const useLib = true // Use Baileys rc14 native newsletter upload and message encoding.
    destination = destination.replace(/(^|\s)--(?:plain|lib|alt)(?=\s|$)/gi, " ").trim()

    const words = destination.split(/\s+/).filter(Boolean)
    if (words[0] && words[0].toLowerCase() === "all") {
      return runAllChannels({ sock, from, msg, helper, sub: (words[1] || "").toLowerCase(), plain, useLib })
    }

    if (words[0] && words[0].toLowerCase() === "check") {
      const link = words[1]
      if (!link) return helper.reply(sock, msg, "> ❌ *Usage:* .cs check <channel link>")
      let meta
      try { meta = await findChannel(sock, link) } catch (e) { return helper.reply(sock, msg, `> ❌ *${e.message}*`) }
      if (!meta) return helper.reply(sock, msg, "> ❌ *Channel not found.*")
      const role = await resolveRole(sock, meta)
      const canPost = isAdminRole(role) ? "✅ yes" : role ? "❌ no — this number is not an admin/owner" : "❓ unknown — posting will be attempted anyway"
      return helper.reply(sock, msg,
        `> 🔎 *Channel check*\n>\n> Name: *${metaName(meta)}*\n> JID: ${meta.id}\n> Bot is logged in as: *+${sessionNumber(sock)}*\n> Role of THIS number: *${role || "unknown"}*\n> Raw role data: ${rawViewer(meta)}\n> Can post: ${canPost}\n>\n> Direct engine: ${engineReadiness(sock)}`
      )
    }

    const quoted = getQuotedInfo(msg)
    if (!quoted) return helper.reply(sock, msg, "> ❌ *Reply to the content you want to publish with .cs.*")
    if (!destination) return helper.reply(sock, msg, "> ❌ *Give me a channel link, invite code, JID, or name.*\n> Or use *.cs all* for every channel you administer.")

    let meta
    try { meta = await findChannel(sock, destination) } catch (e) { return helper.reply(sock, msg, `> ❌ *${e.message}*`) }
    if (!meta?.id) return helper.reply(sock, msg, "> ❌ *Channel not found.*\n> Use *.cs check <link>* to verify a link first.")

    const role = await resolveRole(sock, meta)
    if (role && !isAdminRole(role)) {
      return helper.reply(sock, msg,
        `> 🚫 *This bot's number is not an admin of this channel.*\n>\n> Bot number: *+${sessionNumber(sock)}*\n> Its role there: *${role}*\n>\n> Open the channel → *Invite admins* → add *+${sessionNumber(sock)}*, accept it on that number, then retry.`
      )
    }

    const content = getContent(quoted.quotedMessage)
    if (!content) return helper.reply(sock, msg, "> ❌ *Unsupported quoted message.*")

    try {
      let res
      if (content.type === "text") {
        const textValue = content.node?.text || content.node?.caption || ""
        if (!textValue.trim()) throw new Error("The quoted text message is empty.")
        res = await sendTextSmart(sock, meta.id, textValue, plain, useLib)
      } else {
        if (!SUPPORTED_MEDIA.has(content.type)) {
          return helper.reply(sock, msg, `> ❌ *${content.type} isn't supported.*\n> Supported: image, video, audio, text`)
        }
        const buffer = await downloadMedia(sock, content.node, quoted, from)
        res = await sendMedia(sock, meta.id, content.type, buffer, content.node, useLib)
      }
      const detail = describeResult(res)
      const mediaUnconfirmed = !!res?.kind && (!res?.ack || res?.ack?.timedOut)
      const timedOut = !!res?.ack?.timedOut
      const heading = res?.kind && !res?.ack
        ? "> 📤 *Media sent through Baileys; verify it in the Channel Updates feed.*"
        : mediaUnconfirmed
          ? "> ⚠️ *Media sent, but WhatsApp did not confirm the channel post.*"
          : "> ✅ *Posted to channel.*"
      const followUp = timedOut
        ? "\n> Check the channel before retrying to avoid a duplicate."
        : ""
      return helper.reply(sock, msg,
        `${heading}\n>\n> Channel: *${metaName(meta)}*\n> Type: *${content.type}*\n> Message ID: ${res?.key?.id || "unknown"}${detail ? "\n" + detail : ""}${followUp}\n>\n${CREDIT}`
      )
    } catch (e) {
      console.error("[CS FAILED]", e)
      return helper.reply(sock, msg,
        `> ❌ *Post failed.*\n> ${e.message}\n>\n> Bot number: +${sessionNumber(sock)} (role: ${role || "unknown"}).`
      )
    }
  },
}
