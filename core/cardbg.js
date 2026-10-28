'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/cardbg.js — colours for group text statuses and link cards
//
//  • pickStatusBackground()  random ARGB background for each TEXT status
//                            (WhatsApp's extendedTextMessage.backgroundArgb).
//                            Never the same colour as the status before it.
//  • makeCardBackground()    coloured picture for a link that has no picture of its own.
//
//  Black is not in the palette. The last picks are saved in
//  data/gcstatus/, so the no-repeat rule still holds after a restart.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let sharp = null
try { sharp = require('sharp') } catch {}

const DIR = path.join(__dirname, '..', 'data', 'gcstatus')
const CARD_STATE = path.join(DIR, 'cardcolor.json')
const STATUS_STATE = path.join(DIR, 'statusbg.json')

// [name, gradient start, gradient end, text colour]
const PALETTE = [
  { name: 'red',     from: '#EF4444', to: '#991B1B', text: '#FFFFFF' },
  { name: 'orange',  from: '#FB923C', to: '#C2410C', text: '#111827' },
  { name: 'yellow',  from: '#FDE047', to: '#CA8A04', text: '#111827' },
  { name: 'lime',    from: '#A3E635', to: '#4D7C0F', text: '#111827' },
  { name: 'green',   from: '#4ADE80', to: '#15803D', text: '#FFFFFF' },
  { name: 'teal',    from: '#2DD4BF', to: '#0F766E', text: '#FFFFFF' },
  { name: 'cyan',    from: '#22D3EE', to: '#0E7490', text: '#111827' },
  { name: 'blue',    from: '#60A5FA', to: '#1D4ED8', text: '#FFFFFF' },
  { name: 'indigo',  from: '#818CF8', to: '#3730A3', text: '#FFFFFF' },
  { name: 'violet',  from: '#A78BFA', to: '#6D28D9', text: '#FFFFFF' },
  { name: 'magenta', from: '#E879F9', to: '#A21CAF', text: '#FFFFFF' },
  { name: 'pink',    from: '#F472B6', to: '#BE185D', text: '#FFFFFF' },
]

// ── small saved state, so "never the same twice in a row" survives a restart ──
function readState(file, key) {
  try {
    const n = Number(JSON.parse(fs.readFileSync(file, 'utf8'))[key])
    return Number.isInteger(n) && n >= 0 && n < PALETTE.length ? n : -1
  } catch {
    return -1
  }
}

function saveState(file, key, value) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ [key]: value }))
    fs.renameSync(file + '.tmp', file)
  } catch (e) {
    console.warn(`[GCSTATUS] could not save colour state: ${e.message}`)
  }
}

// random index, never the same as `last`
function randomIndexAvoiding(last) {
  let index = crypto.randomInt(0, PALETTE.length)
  if (PALETTE.length > 1) {
    while (index === last) index = crypto.randomInt(0, PALETTE.length)
  }
  return index
}

// ARGB as an unsigned 32-bit number, e.g. #4ADE80 → 0xFF4ADE80
const argbOf = hex => (0xff000000 + parseInt(String(hex).replace('#', ''), 16)) >>> 0

// Random background for a text status. Each call gives a different colour from the last.
function pickStatusBackground() {
  const index = randomIndexAvoiding(readState(STATUS_STATE, 'last'))
  saveState(STATUS_STATE, 'last', index)
  return argbOf(PALETTE[index].from)
}

// Random colour for a link card's picture background. Never the same as the card before.
function pickCardColour() {
  const index = randomIndexAvoiding(readState(CARD_STATE, 'last'))
  saveState(CARD_STATE, 'last', index)
  return PALETTE[index]
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return 'link' }
}

// Returns a JPEG Buffer (320x180) in a random colour, or null when sharp is missing.
async function makeCardBackground(host, title) {
  if (!sharp) return null
  const c = pickCardColour()
  const svg =
    `<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c.from}"/><stop offset="1" stop-color="${c.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g)"/>` +
    `<text x="24" y="86" fill="${c.text}" font-family="Arial,sans-serif" font-size="22" font-weight="700">${esc(String(title || '').slice(0, 28))}</text>` +
    `<text x="24" y="120" fill="${c.text}" font-family="Arial,sans-serif" font-size="15" opacity="0.85">${esc(String(host || '').slice(0, 36))}</text>` +
    `</svg>`
  console.log(`[GCSTATUS] link card background colour: ${c.name}`)
  return sharp(Buffer.from(svg)).jpeg({ quality: 75 }).toBuffer()
}

module.exports = { makeCardBackground, hostOf, pickStatusBackground, pickCardColour, argbOf, PALETTE }

