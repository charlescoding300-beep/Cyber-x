/**
 * Antilink Command - Toggle antilink protection with delete/kick options
 * + a real, self-contained detection engine (this was missing before —
 *   the old file only flipped a database flag; nothing ever actually
 *   scanned incoming messages, which is why it "did nothing").
 */

const database = require('../../database');

let downloadMediaMessage, downloadContentFromMessage
try { ({ downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys')) } catch {}

let Pino = null
try { Pino = require('pino') } catch {}

let Tesseract = null
try { Tesseract = require('tesseract.js') } catch {}
const OCR_AVAILABLE = !!Tesseract && !!downloadContentFromMessage

// ─────────────────────────────────────────────────────────────────────────────
// Obfuscation-resistant link matching. People beat weak antilinks by:
//   - zero-width / invisible characters between letters
//   - "example [dot] com" / "example dot com"
//   - "e x a m p l e . c o m" letter-spacing
// This strips all of that BEFORE running the patterns below.
// ─────────────────────────────────────────────────────────────────────────────
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

function normalize(text) {
  if (!text) return ''
  let t = text.replace(HIDDEN_CHARS, '')
  t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, '.')
       .replace(/\s+dot\s+/gi, '.')
       .replace(/\s*[\(\[]\s*at\s*[\)\]]\s*/gi, '@')
  t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ''))
  return t
}

const LINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`\[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /whatsapp\.com\/channel\/[A-Za-z0-9]{10,}/gi,   // WhatsApp Channel invite links
  /wa\.me\/[^\s]{2,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /discord(?:\.gg|\.com\/invite)\/[^\s]{2,}/gi,
  // Known-abused URL shorteners — hide the real destination behind a "clean"
  // domain; many use TLDs (.ly, .gd, .do, .cc, .gy, .vc) the generic pattern
  // below doesn't cover, so they need explicit matching.
  /\b(?:bit\.ly|bit\.do|tinyurl\.com|cutt\.ly|rebrand\.ly|is\.gd|t\.co|ow\.ly|tiny\.cc|shorturl\.at|rb\.gy|s\.id|lnkd\.in|buff\.ly|t\.ly|soo\.gd|bc\.vc|x\.co|goo\.gl|migre\.me|clicky\.me|budurl\.com|alturl\.com|app\.link|9qr\.de|bitly\.ws|minm\.xyz|s2r\.co|shrtco\.de|lc\.chat|linki\.la)\/[^\s]*/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  /\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|xyz|top|info|biz|me|link|click|shop|store|online|site|app|dev|tv|ng|gg)\b(?:\/[^\s]*)?/gi,
]

function containsLink(text) {
  if (!text) return false
  const norm = normalize(text)
  return LINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(norm) })
}

// Pulls text from EVERY message shape that can carry a link, not just plain
// text — including button/template/interactive messages, which is exactly
// how "image with a button that links out" posts are built.
function extractAllText(msg) {
  const m = msg.message
  if (!m) return []
  const out = []
  const add = v => { if (v && typeof v === 'string') out.push(v) }

  // plain text / captions
  add(m.conversation)
  add(m.extendedTextMessage?.text)
  add(m.imageMessage?.caption)
  add(m.videoMessage?.caption)
  add(m.documentMessage?.caption)

  // quoted message
  const ctx = m.extendedTextMessage?.contextInfo
  if (ctx) {
    add(ctx.quotedMessage?.conversation)
    add(ctx.quotedMessage?.extendedTextMessage?.text)
  }

  // buttonsMessage (image/text + reply buttons)
  if (m.buttonsMessage) {
    add(m.buttonsMessage.contentText)
    add(m.buttonsMessage.footerText)
    add(m.buttonsMessage.imageMessage?.caption)
    for (const b of m.buttonsMessage.buttons || []) add(b.buttonText?.displayText)
  }

  // templateMessage / hydratedTemplate (image + urlButton — the classic
  // "picture with a button that opens a link" post)
  const hydrated = m.templateMessage?.hydratedTemplate || m.templateMessage?.hydratedFourRowTemplate
  if (hydrated) {
    add(hydrated.hydratedContentText)
    add(hydrated.hydratedFooterText)
    add(hydrated.imageMessage?.caption)
    for (const b of hydrated.hydratedButtons || []) {
      add(b.urlButton?.url)
      add(b.urlButton?.displayText)
    }
  }

  // interactiveMessage (native flow buttons, e.g. "cta_url") + header image
  if (m.interactiveMessage) {
    add(m.interactiveMessage.body?.text)
    add(m.interactiveMessage.footer?.text)
    add(m.interactiveMessage.header?.imageMessage?.caption)
    for (const b of m.interactiveMessage.nativeFlowMessage?.buttons || []) {
      add(b.buttonParamsJson) // raw JSON string — url text still matches the regex
    }
  }

  // listMessage
  if (m.listMessage) {
    add(m.listMessage.description)
    add(m.listMessage.buttonText)
    for (const s of m.listMessage.sections || []) {
      for (const r of s.rows || []) { add(r.title); add(r.description) }
    }
  }

  return out
}

// Every place an image can hide inside a button/template/interactive
// message, collected so OCR can scan all of them, not just a plain photo.
function collectImageCandidates(msg) {
  const m = msg.message
  if (!m) return []
  const candidates = []
  if (m.imageMessage)   candidates.push({ media: m.imageMessage, type: 'image' })
  if (m.stickerMessage) candidates.push({ media: m.stickerMessage, type: 'sticker' })
  if (m.buttonsMessage?.imageMessage) candidates.push({ media: m.buttonsMessage.imageMessage, type: 'image' })
  const hydrated = m.templateMessage?.hydratedTemplate || m.templateMessage?.hydratedFourRowTemplate
  if (hydrated?.imageMessage) candidates.push({ media: hydrated.imageMessage, type: 'image' })
  if (m.interactiveMessage?.header?.imageMessage) {
    candidates.push({ media: m.interactiveMessage.header.imageMessage, type: 'image' })
  }
  return candidates
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function scanImageOcr(sock, msg) {
  if (!OCR_AVAILABLE) return false
  const candidates = collectImageCandidates(msg)
  if (!candidates.length) return false
  for (const { media, type } of candidates) {
    try {
      const stream = await downloadContentFromMessage(media, type)
      const buffer = await streamToBuffer(stream)
      if (!buffer || buffer.length < 100) continue
      const { data: { text } } = await Tesseract.recognize(buffer, 'eng', { logger: () => {} })
      if (containsLink(text)) return true
    } catch (e) {
      console.error('[ANTILINK OCR]', e.message)
    }
  }
  return false
}

function normNum(jid = '') {
  return String(jid).replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// scanMessage — THE PART THAT WAS MISSING.
// Call this for every incoming group message from your main handler:
//
//   const antilink = require('./commands/admin/antilink')
//   sock.ev.on('messages.upsert', async ({ messages }) => {
//     for (const m of messages) {
//       antilink.scanMessage(sock, m).catch(e => console.error('[ANTILINK]', e.message))
//       // ... your existing command dispatch continues as normal
//     }
//   })
//
// It's fully self-contained: reads settings straight from database.js,
// checks admin status itself via groupMetadata, and takes action —
// no dependency on your command dispatcher's "extra" object.
// ─────────────────────────────────────────────────────────────────────────────
async function scanMessage(sock, msg) {
  try {
    if (!msg?.message) return false
    const chatId = msg.key.remoteJid
    const isGroup   = chatId?.endsWith('@g.us')
    const isChannel = chatId?.endsWith('@newsletter')
    if (!isGroup && !isChannel) return false
    if (msg.key.fromMe) return false

    const settings = database.getGroupSettings(chatId)
    if (!settings.antilink) return false

    const sender = msg.key.participant || chatId
    const texts  = extractAllText(msg)
    let hit    = texts.some(t => containsLink(t))
    let viaOcr = false
    if (!hit) {
      viaOcr = await scanImageOcr(sock, msg)
      hit = viaOcr
    }
    if (!hit) return false

    const ocrNote = viaOcr ? '\n🔍 _Detected via image/button scan (OCR)_' : ''

    // ── CHANNELS (@newsletter) — no group-style participant/admin list to
    // check; best-effort delete only. Channel moderation support in
    // Baileys varies by version, so this is wrapped defensively and logs
    // clearly if the delete call isn't supported on your current version.
    if (isChannel) {
      try {
        await sock.sendMessage(chatId, { delete: msg.key })
        console.log(`[ANTILINK] 🗑️ Deleted link/invite post in channel ${chatId}${ocrNote ? ' (via OCR)' : ''}`)
        try { database.addWarning(chatId, normNum(sender), 'Posted a link in channel') } catch {}
        return true
      } catch (e) {
        console.error(`[ANTILINK] channel delete failed (may be unsupported on this Baileys version):`, e.message)
        return false
      }
    }

    // ── GROUPS (@g.us) — normal admin-aware flow ───────────────────────
    let groupMeta
    try { groupMeta = await sock.groupMetadata(chatId) } catch (e) {
      console.error('[ANTILINK] metadata fetch failed:', e.message)
      return false
    }

    const senderNorm = normNum(sender)
    const isSenderAdmin = groupMeta.participants?.some(p =>
      normNum(p.id) === senderNorm && (p.admin === 'admin' || p.admin === 'superadmin'))
    if (isSenderAdmin) return false // admins are exempt

    const botNorm = normNum(sock.user?.id || '')
    const botIsAdmin = groupMeta.participants?.some(p =>
      normNum(p.id) === botNorm && (p.admin === 'admin' || p.admin === 'superadmin'))
    if (!botIsAdmin) {
      console.log(`[ANTILINK] link from ${senderNorm} in ${chatId} but bot isn't admin — cannot delete/kick`)
      return false
    }

    const action = settings.antilinkAction || 'delete'

    try { await sock.sendMessage(chatId, { delete: msg.key }) } catch (e) {
      console.error('[ANTILINK] delete failed:', e.message)
    }

    try {
      database.addWarning(chatId, senderNorm, action === 'kick' ? 'Posted a link (auto-kick)' : 'Posted a link')
    } catch {}

    if (action === 'kick') {
      try {
        await sock.sendMessage(chatId, {
          text: `👢 *ANTILINK — USER REMOVED*\n\n@${senderNorm} was removed for posting a link.${ocrNote}`,
          mentions: [sender],
        })
        await sock.groupParticipantsUpdate(chatId, [sender], 'remove')
      } catch (e) {
        console.error('[ANTILINK] kick failed:', e.message)
      }
    } else {
      try {
        await sock.sendMessage(chatId, {
          text: `🔗 *ANTILINK*\n\n@${senderNorm}, links aren't allowed here. Message deleted.${ocrNote}`,
          mentions: [sender],
        })
      } catch {}
    }

    return true
  } catch (err) {
    console.error('[ANTILINK] scan error:', err.message)
    return false
  }
}

module.exports = {
  name: 'antilink',
  aliases: [],
  category: 'admin',
  description: 'Configure antilink protection (delete/kick)',
  usage: '.antilink <on/off/set/get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  // exported for the main message handler to call — see comment above scanMessage()
  scanMessage,
  ocrAvailable: OCR_AVAILABLE,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antilink ? 'ON' : 'OFF';
        const action = settings.antilinkAction || 'delete';
        return extra.reply(
          `🔗 *Antilink Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n` +
          `OCR: *${OCR_AVAILABLE ? 'available' : 'unavailable — run: npm install tesseract.js'}*\n\n` +
          `Usage:\n` +
          `  .antilink on\n` +
          `  .antilink off\n` +
          `  .antilink set delete | kick\n` +
          `  .antilink get`
        );
      }
      
      const opt = args[0].toLowerCase();
      
      if (opt === 'on') {
        if (database.getGroupSettings(extra.from).antilink) {
          return extra.reply('*Antilink is already on*');
        }
        database.updateGroupSettings(extra.from, { antilink: true });
        return extra.reply('*Antilink has been turned ON*');
      }
      
      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { antilink: false });
        return extra.reply('*Antilink has been turned OFF*');
      }
      
      if (opt === 'set') {
        if (args.length < 2) {
          return extra.reply('*Please specify an action: .antilink set delete | kick*');
        }
        
        const setAction = args[1].toLowerCase();
        if (!['delete', 'kick'].includes(setAction)) {
          return extra.reply('*Invalid action. Choose delete or kick.*');
        }
        
        database.updateGroupSettings(extra.from, { 
          antilinkAction: setAction,
          antilink: true // Auto-enable when setting action
        });
        return extra.reply(`*Antilink action set to ${setAction}*`);
      }
      
      if (opt === 'get') {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antilink ? 'ON' : 'OFF';
        const action = settings.antilinkAction || 'delete';
        return extra.reply(`*Antilink Configuration:*\nStatus: ${status}\nAction: ${action}`);
      }
      
      return extra.reply('*Use .antilink for usage.*');
      
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
