'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/scanfile.js — ZEN X | .scanfile   (bot owner only)
//
//  Reply to a bot message (for example the menu) and send  .scanfile
//    → sends you the whole command file that made that message, as a document.
//  Reply to a file someone sent you and send  .scanfile
//    → scans the file and shows its type, risks, and web addresses.
//
//  The bot does not remember which file made each message, so the match is made from
//  the message text. It cannot see inside other people's bots.
//  Secrets are never shown: every key or token is replaced with ••••.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const scan = require('../core/scanfile')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const BOT_ROOT = path.join(__dirname, '..')
const MAX_FILE_BYTES = 2 * 1024 * 1024
const RISK_ICON = { INFO: '🟢', LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }

const kb = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`)

function contextOf(msg) {
  const m = msg?.message || {}
  for (const k of Object.keys(m)) {
    if (m[k]?.contextInfo) return m[k].contextInfo
  }
  return {}
}

function unwrap(message) {
  let m = message || {}
  for (let i = 0; i < 3; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message
    if (!inner) break
    m = inner
  }
  return m
}

function quotedTextOf(quotedMessage) {
  const m = unwrap(quotedMessage)
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '').trim()
}

function box(title, rows) {
  return `╭─「 ${title} 」─╮\n${rows.map(r => `│ ${r}`).join('\n')}\n╰${'─'.repeat(title.length + 6)}╯`
}

function findingsRows(report) {
  if (!report.findings.length) return ['✅ No risky patterns found.']
  const rows = ['⚠️ *What it can do:*']
  for (const f of report.findings) {
    const where = f.lines.length ? ` (line${f.lines.length > 1 ? 's' : ''} ${f.lines.join(', ')})` : ''
    rows.push(`${RISK_ICON[f.level]} ${f.level}: ${f.label}${where}`)
  }
  return rows
}

// ── a file the bot made (matched from the message text): sent as the whole file ──
// Secrets are still replaced with ••••, so a key that is hardcoded in a file never leaks.
async function sendBotFile(sock, from, msg, match) {
  const full = path.join(BOT_ROOT, match.file)
  const stat = fs.statSync(full)
  if (stat.size > MAX_FILE_BYTES) {
    return sock.sendMessage(from, { text: `❌ That file is too large to send (${kb(stat.size)}).\n\n${CREDIT}` }, { quoted: msg })
  }
  const source = scan.redact(fs.readFileSync(full, 'utf8'))
  const caption = `📄 ${match.file}\n🧩 Command: .${match.command}\n\n${CREDIT}`
  return sock.sendMessage(from, {
    document: Buffer.from(source, 'utf8'),
    mimetype: 'application/javascript',
    fileName: path.basename(match.file),
    caption,
  }, { quoted: msg })
}

// ── a file someone sent you ──────────────────────────────────────────────────
function reportDocument(doc) {
  const rows = [
    `📄 File: ${doc.fileName || '(no name)'}`,
    `📦 Size: ${kb(doc.size)}`,
    `🔐 SHA-256: ${doc.sha256.slice(0, 16)}…`,
    `🧾 Type: ${doc.kind || (doc.text ? 'text file' : 'unknown')}`,
  ]
  if (doc.note) rows.push('', `ℹ️ ${doc.note}`)
  if (doc.text) {
    const hosts = doc.hosts.length ? doc.hosts.slice(0, 8).join(', ') : 'none'
    rows.push(`🌐 Web addresses: ${hosts}`, '', ...findingsRows(doc))
    rows.push('', `${RISK_ICON[doc.risk]} *Overall risk: ${doc.risk}*`)
    if (doc.secrets) rows.push(`🔒 ${doc.secrets} secret(s) in this file were hidden.`)
  } else {
    rows.push('', `${RISK_ICON[doc.risk]} *Overall risk: ${doc.risk}*`)
  }
  return scan.redact(box('🛡️ FILE CHECK', rows)) + `\n\n${CREDIT}`
}

async function downloadQuoted(sock, msg, quoted) {
  const baileys = require('@systemzero/baileys')
  const { downloadMediaMessage } = baileys
  const fakeMsg = {
    key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant, fromMe: false },
    message: unwrap(quoted.quotedMessage),
  }
  const buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
  if (!buf || buf.length === 0) throw new Error('the file could not be downloaded')
  if (buf.length > MAX_FILE_BYTES) throw new Error(`file is too large to scan (${kb(buf.length)}, limit ${kb(MAX_FILE_BYTES)})`)
  return buf
}

module.exports = {
  name: 'scanfile',
  aliases: ['checkfile', 'filescan'],
  desc: 'Reply to a bot output or a file to see what file made it and whether it is risky',
  usage: '.scanfile (reply to a bot message or to a file)',
  category: 'owner',
  heavy: true,

  _internals: { findSourceFile: scan.findSourceFile, sendBotFile, reportDocument },

  run: async ({ sock, from, msg, isOwner }) => {
    const reply = t => sock.sendMessage(from, { text: t }, { quoted: msg })
    if (!isOwner) return reply('❌ Only the bot owner can use .scanfile.')

    const ctx = contextOf(msg)
    if (!ctx.quotedMessage) {
      return reply('ℹ️ Reply to a bot message or to a file, then send *.scanfile*.')
    }

    const quotedInner = unwrap(ctx.quotedMessage)
    const quoted = { quotedMessage: ctx.quotedMessage, participant: ctx.participant, stanzaId: ctx.stanzaId }

    // ── a file someone sent ────────────────────────────────────────────────
    if (quotedInner.documentMessage) {
      try {
        const buf = await downloadQuoted(sock, msg, quoted)
        const doc = scan.scanDocument(buf, quotedInner.documentMessage.fileName || '')
        return reply(reportDocument(doc))
      } catch (e) {
        return reply(`❌ Could not scan that file.\nReason: ${e.message}`)
      }
    }

    // ── a bot output (matched against the bot's own files) ─────────────────
    const text = quotedTextOf(ctx.quotedMessage)
    if (!text) return reply('❌ That message has no text or file I can scan.')

    const match = scan.findSourceFile(text, BOT_ROOT)
    if (!match) {
      return reply(box('📄 FILE SCAN', [
        'I could not match this message to a single file.',
        'It may be built from what someone typed, or it may come from another bot.',
        CREDIT,
      ]))
    }
    return sendBotFile(sock, from, msg, match)
  },
}

