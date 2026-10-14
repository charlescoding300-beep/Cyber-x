'use strict'

// Build deterministic, self-hosted animated GIF panels for the GitHub README.
// No external animation service, JavaScript, CSS, or runtime telemetry is used.
const fs = require('node:fs')
const path = require('node:path')

const W = 900
const H = 390
const FRAMES = 32
const DELAY = 11 // hundredths of a second
const palette = [
  [7, 12, 17], [11, 20, 26], [17, 31, 38], [30, 54, 60],
  [32, 232, 151], [18, 143, 112], [72, 212, 234], [158, 133, 250],
  [231, 244, 241], [137, 164, 161], [247, 190, 88], [13, 43, 39],
  [246, 102, 110], [42, 67, 71], [95, 125, 120], [255, 255, 255],
]
const C = { bg: 0, panel: 1, panel2: 2, border: 3, mint: 4, green: 5,
  cyan: 6, purple: 7, white: 8, muted: 9, amber: 10, deep: 11,
  red: 12, grid: 13, quiet: 14, pure: 15 }

const FONT = {
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],
  'J':['00111','00010','00010','00010','10010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','11001','10101','10011','10011','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','10101','01010'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  ':':['00000','00110','00110','00000','00110','00110','00000'],
  '/':['00001','00010','00010','00100','01000','01000','10000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '_':['00000','00000','00000','00000','00000','00000','11111'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '>':['10000','01000','00100','00010','00100','01000','10000'],
  '[':['01110','01000','01000','01000','01000','01000','01110'],
  ']':['01110','00010','00010','00010','00010','00010','01110'],
  '#':['01010','11111','01010','01010','11111','01010','00000'],
  '=':['00000','11111','00000','11111','00000','00000','00000'],
}

class Canvas {
  constructor() { this.p = new Uint8Array(W * H) }
  pixel(x, y, color) { if (x >= 0 && y >= 0 && x < W && y < H) this.p[y * W + x] = color }
  rect(x, y, w, h, color) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h)
    for (let yy = y0; yy < y1; yy++) this.p.fill(color, yy * W + x0, yy * W + x1)
  }
  outline(x, y, w, h, color) {
    this.rect(x, y, w, 1, color); this.rect(x, y + h - 1, w, 1, color)
    this.rect(x, y, 1, h, color); this.rect(x + w - 1, y, 1, h, color)
  }
  line(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy
    for (;;) {
      this.pixel(x0, y0, color)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }
  circle(cx, cy, r, color, filled = false) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y
      if (filled ? d <= r * r : d <= r * r && d >= (r - 1) * (r - 1)) this.pixel(cx + x, cy + y, color)
    }
  }
  text(value, x, y, color = C.white, scale = 1, maxWidth = Infinity) {
    let at = x
    for (const raw of String(value).toUpperCase()) {
      const glyph = FONT[raw]
      if (at + 5 * scale > x + maxWidth) break
      if (glyph) for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') this.rect(at + gx * scale, y + gy * scale, scale, scale, color)
      }
      at += 6 * scale
    }
  }
  dotGrid(x, y, w, h, spacing = 22) {
    for (let yy = y + 10; yy < y + h; yy += spacing) for (let xx = x + 10; xx < x + w; xx += spacing) this.pixel(xx, yy, C.grid)
  }
  panel(x, y, w, h, title, accent = C.mint) {
    this.rect(x, y, w, h, C.panel); this.outline(x, y, w, h, C.border)
    this.rect(x + 1, y + 1, w - 2, 25, C.panel2)
    this.rect(x + 10, y + 8, 3, 9, accent)
    this.text(title, x + 20, y + 8, C.muted, 1, w - 32)
  }
}

function roundRect(c, x, y, w, h, color) { c.rect(x, y, w, h, color); c.outline(x, y, w, h, C.border) }
function drawNode(c, x, y, label, frame, color = C.mint, radius = 5) {
  const pulse = Math.floor(frame / 4) % 2 === 0
  c.circle(x, y, radius + (pulse ? 2 : 0), C.green, false)
  c.circle(x, y, radius, C.panel, true); c.circle(x, y, 2, color, true)
  c.text(label, x - Math.min(label.length * 3, 42), y + 12, C.muted, 1, 84)
}
function packet(c, a, b, progress, color = C.cyan) {
  const t = ((progress % 100) + 100) % 100 / 100
  const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t)
  c.circle(x, y, 3, color, true); c.circle(x, y, 5, color, false)
}

function makeFrame(mode, frame) {
  const c = new Canvas()
  c.rect(0, 0, W, H, C.bg)
  for (let x = 6; x < W; x += 24) c.line(x, 0, x, H, C.panel)
  for (let y = 6; y < H; y += 24) c.line(0, y, W, y, C.panel)
  c.rect(18, 14, 864, 38, C.panel); c.outline(18, 14, 864, 38, C.border)
  c.circle(33, 33, 4, C.red, true); c.circle(48, 33, 4, C.amber, true); c.circle(63, 33, 4, C.mint, true)
  c.text('ZEN X  /  BOT CONTROL PANEL', 80, 27, C.white, 2)
  c.text('VISUAL LOOP  -  NOT LIVE TELEMETRY', 608, 29, C.muted, 1)

  c.rect(18, 64, 145, 308, C.panel); c.outline(18, 64, 145, 308, C.border)
  c.text('MODULES', 30, 76, C.muted)
  const rows = [['CORE', 'core'], ['SESSIONS', 'sessions'], ['COMMANDS', 'commands'], ['PAIRING', 'pairing']]
  rows.forEach(([label, key], i) => {
    const y = 101 + i * 34
    if (key === mode) { c.rect(26, y - 5, 129, 25, C.deep); c.rect(26, y - 5, 2, 25, C.mint) }
    c.circle(36, y + 5, 2, key === mode ? C.mint : C.quiet, true)
    c.text(label, 46, y, key === mode ? C.white : C.muted)
  })
  c.line(29, 251, 152, 251, C.border)
  c.text('ANIMATION', 30, 265, C.muted)
  c.text('FRAME', 30, 284, C.quiet)
  c.text(String(frame + 1).padStart(2, '0') + ' / ' + FRAMES, 30, 300, C.mint)
  for (let i = 0; i < 14; i++) c.rect(30 + i * 8, 326, 5, 3, (i + frame) % 14 < 9 ? C.green : C.border)
  c.text('ZENX', 30, 346, C.quiet)

  const heading = {
    core: 'CORE ROUTING MAP', sessions: 'MULTI SESSION MESH',
    commands: 'COMMAND EVENT PIPELINE', pairing: 'PAIRING HANDSHAKE',
  }[mode]
  c.panel(176, 64, 456, 208, heading, mode === 'pairing' ? C.cyan : C.mint)
  c.dotGrid(180, 92, 448, 178)
  c.panel(642, 64, 238, 208, 'ACTIVITY SIGNAL', C.cyan)
  c.panel(176, 282, 704, 90, 'EVENT STREAM', C.purple)

  const graph = { core: [[210,135],[286,119],[369,150],[447,111],[524,148],[592,118],[276,218],[391,222],[510,216]],
    sessions: [[207,165],[277,112],[363,124],[442,106],[526,128],[594,178],[530,228],[421,236],[311,224]],
    commands: [[211,139],[294,139],[379,139],[467,112],[467,169],[555,112],[555,169],[593,224]],
    pairing: [[210,174],[313,174],[416,174],[519,174],[600,174]] }[mode]
  let edges
  if (mode === 'pairing') edges = [[0,1],[1,2],[2,3],[3,4]]
  else if (mode === 'commands') edges = [[0,1],[1,2],[2,3],[2,4],[3,5],[4,6],[5,7],[6,7]]
  else edges = [[0,1],[1,2],[2,3],[3,4],[4,5],[2,7],[7,6],[7,8],[4,8],[1,6],[3,8]]
  edges.forEach(([a, b], i) => {
    const p = graph[a], q = graph[b]
    c.line(p[0], p[1], q[0], q[1], i % 3 === 0 ? C.border : C.green)
    packet(c, p, q, frame * 9 + i * 17, i % 3 === 0 ? C.cyan : C.mint)
  })
  if (mode === 'pairing') {
    const labels = ['PHONE', 'PAIR CODE', 'VERIFY', 'WHATSAPP', 'BOT LINK']
    graph.forEach((p, i) => drawNode(c, p[0], p[1], labels[i], frame, i === 2 ? C.cyan : C.mint, 7))
    // A drawn, abstract pairing tile avoids presenting a usable/real QR code.
    const qx = 453, qy = 199
    c.rect(qx, qy, 22, 22, C.panel); c.outline(qx, qy, 22, 22, C.cyan)
    c.rect(qx + 4, qy + 4, 5, 5, C.cyan); c.rect(qx + 13, qy + 4, 5, 5, C.cyan)
    c.rect(qx + 4, qy + 13, 5, 5, C.cyan); c.rect(qx + 13, qy + 13, 5, 5, frame % 2 ? C.purple : C.mint)
  } else if (mode === 'commands') {
    const labels = ['MESSAGE', 'HANDLER', 'QUEUE', 'GROUP', 'MEDIA', 'FAST LANE', 'HEAVY LANE', 'REPLY']
    graph.forEach((p, i) => drawNode(c, p[0], p[1], labels[i] || 'ROUTE', frame, i === 2 ? C.cyan : C.mint, 5))
    const cursorX = 200 + (frame * 13) % 408
    c.line(cursorX, 102, cursorX, 240, C.quiet)
  } else {
    const labels = mode === 'sessions'
      ? ['HUB','NODE 01','NODE 02','NODE 03','NODE 04','NODE 05','NODE 06','NODE 07','NODE 08']
      : ['CORE','SOCKET','EVENTS','ROUTES','QUEUE','MEDIA','CACHE','GROUPS','TOOLS']
    graph.forEach((p, i) => drawNode(c, p[0], p[1], labels[i], frame, i % 4 === 0 ? C.cyan : C.mint, i === 0 ? 7 : 5))
    const scanX = 190 + (frame * 12) % 432
    c.line(scanX, 100, scanX, 254, C.green)
  }

  const signals = [
    [686, 112, 'MESSAGE ROUTING'], [686, 153, 'SESSION LINKS'], [686, 194, 'COMMAND FLOW'], [686, 235, 'MEDIA WORKERS'],
  ]
  signals.forEach(([x, y, label], i) => {
    const active = (frame + i * 3) % 8 < 6
    c.circle(858, y, 3, active ? (i === 1 ? C.cyan : C.mint) : C.border, true)
    c.text(label, 654, y - 4, C.muted, 1)
    const count = 9
    for (let b = 0; b < count; b++) {
      const h = 4 + ((frame * (i + 2) + b * 7 + i * 3) % 10)
      c.rect(654 + b * 22, y + 26 - h, 12, h, b < (frame + i) % 10 ? (i === 1 ? C.cyan : C.green) : C.border)
    }
  })

  const events = [
    '[00:01]  SOCKET  >  EVENT ROUTED',
    '[00:02]  COMMAND  >  HANDLER READY',
    '[00:03]  SESSION  >  LINK FLOW',
    '[00:04]  WORKER  >  TASK QUEUED',
    '[00:05]  ROUTER  >  MESSAGE SENT',
    '[00:06]  MODULE  >  RESPONSE BUILT',
  ]
  const offset = Math.floor(frame / 4) % events.length
  for (let row = 0; row < 2; row++) {
    const idx = (offset + row) % events.length
    const y = 313 + row * 25
    c.circle(193, y + 4, 2, row === 0 ? C.mint : C.cyan, true)
    c.text(events[idx], 205, y, row === 0 ? C.white : C.muted, 1)
    c.text(row === 0 ? 'FLOW' : 'MODULE', 806, y, row === 0 ? C.mint : C.cyan, 1)
  }
  // A small moving caret makes the terminal feel active without claiming
  // that the image is reporting real server state.
  if (frame % 8 < 5) c.rect(786, 351, 7, 2, C.mint)
  return c.p
}

function gifLzw(indices) {
  const minSize = 4, clear = 1 << minSize, end = clear + 1
  let next = end + 1, bits = minSize + 1, dict = new Map()
  const bytes = []; let accumulator = 0, bitCount = 0
  const emit = code => {
    accumulator |= code << bitCount; bitCount += bits
    while (bitCount >= 8) { bytes.push(accumulator & 255); accumulator >>>= 8; bitCount -= 8 }
  }
  const reset = () => { dict = new Map(); next = end + 1; bits = minSize + 1 }
  emit(clear)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const symbol = indices[i], key = prefix * 16 + symbol
    if (dict.has(key)) { prefix = dict.get(key); continue }
    emit(prefix)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > (1 << bits) && bits < 12) bits++
    } else { emit(clear); reset() }
    prefix = symbol
  }
  emit(prefix); emit(end)
  if (bitCount) bytes.push(accumulator & 255)
  const blocks = []
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255); blocks.push(Buffer.from([chunk.length]), Buffer.from(chunk))
  }
  blocks.push(Buffer.from([0]))
  return Buffer.concat([Buffer.from([minSize]), ...blocks])
}
function u16(n) { return Buffer.from([n & 255, (n >> 8) & 255]) }
function makeGif(mode) {
  const chunks = [Buffer.from('GIF89a'), u16(W), u16(H), Buffer.from([0xF3, 0, 0])]
  for (const rgb of palette) chunks.push(Buffer.from(rgb))
  // Netscape's loop extension with a repeat count of zero means loop forever.
  chunks.push(Buffer.from([0x21, 0xFF, 0x0B]), Buffer.from('NETSCAPE2.0'), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]))
  for (let f = 0; f < FRAMES; f++) {
    chunks.push(Buffer.from([0x21, 0xF9, 4, 0x04]), u16(DELAY), Buffer.from([0, 0])) // loop forever, disposal=1
    chunks.push(Buffer.from([0x2C]), u16(0), u16(0), u16(W), u16(H), Buffer.from([0]))
    chunks.push(gifLzw(makeFrame(mode, f)))
  }
  chunks.push(Buffer.from([0x3B]))
  return Buffer.concat(chunks)
}

const panels = [
  ['zenx-core.gif', 'core'], ['zenx-sessions.gif', 'sessions'],
  ['zenx-commands.gif', 'commands'], ['zenx-pairing.gif', 'pairing'],
]
const out = path.join(__dirname)
for (const [file, mode] of panels) {
  const gif = makeGif(mode)
  fs.writeFileSync(path.join(out, file), gif)
  console.log(`${file}: ${(gif.length / 1024).toFixed(1)} KiB`)
}
