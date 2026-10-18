'use strict'

// Render looping vector signal scenes for the Zen X README.
// Requires the project's existing `sharp` dependency. The SVG is rendered
// frame by frame and encoded as a self-contained GIF; no live server data is read.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const SVG_WIDTH = 1200
const SVG_HEIGHT = 540
const WIDTH = 900
const HEIGHT = 405
const FRAMES = 20
const FRAME_DELAY = 9
const OUT = path.join(__dirname, 'ocean')

const SCENES = [
  {
    file: 'zenx-ocean-core.gif',
    title: 'CORE SIGNAL',
    sonar: [744, 275],
    nodes: [
      [180, 327, 'INBOUND'], [465, 245, 'ZEN X CORE'], [710, 150, 'SESSIONS'],
      [960, 255, 'COMMAND ROUTER'], [790, 411, 'RESPONSE'], [1080, 405, 'DELIVERY'],
    ],
    edges: [[0,1],[1,2],[1,3],[3,4],[4,5],[2,3]],
  },
  {
    file: 'zenx-ocean-sessions.gif',
    title: 'SESSION NETWORK',
    sonar: [676, 277],
    nodes: [
      [676, 277, 'SHARED CORE'], [382, 153, 'SESSION 01'], [409, 401, 'SESSION 02'],
      [780, 119, 'SESSION 03'], [967, 225, 'SESSION 04'], [861, 420, 'SESSION 05'],
      [1082, 365, 'SESSION 06'],
    ],
    edges: [[0,1],[0,2],[0,3],[0,4],[0,5],[4,6],[5,6],[1,4]],
  },
  {
    file: 'zenx-ocean-initiation.gif',
    title: 'SESSION INITIATION',
    sonar: [875, 245],
    nodes: [
      [180, 330, 'REQUEST'], [410, 220, 'SESSION'], [635, 345, 'SOCKET'],
      [875, 245, 'EVENT FLOW'], [1080, 155, 'CORE'], [1080, 400, 'ROUTE'],
    ],
    edges: [[0,1],[1,2],[2,3],[3,4],[3,5]],
  },
  {
    file: 'zenx-ocean-commands.gif',
    title: 'COMMAND ROUTING',
    sonar: [604, 272],
    nodes: [
      [174, 278, 'MESSAGE'], [385, 278, 'DISPATCH'], [604, 272, 'HANDLER'],
      [842, 155, 'GROUP'], [842, 391, 'MEDIA'], [1072, 183, 'ACTION'],
      [1072, 369, 'REPLY'],
    ],
    edges: [[0,1],[1,2],[2,3],[2,4],[3,5],[4,6],[5,6]],
  },
  {
    file: 'zenx-ocean-output.gif',
    title: 'RESPONSE DELIVERY',
    sonar: [792, 280],
    nodes: [
      [190, 300, 'COMMAND'], [425, 205, 'HANDLER'], [645, 335, 'FORMAT'],
      [861, 225, 'SESSION'], [1064, 317, 'REPLY'], [1011, 131, 'DESTINATION'],
    ],
    edges: [[0,1],[1,2],[2,3],[3,4],[3,5],[5,4]],
  },
]

const rgbBin = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)

function makeSvg(scene, frame) {
  const phase = frame / FRAMES
  const [sx, sy] = scene.sonar
  const waves = []
  for (let i = 0; i < 4; i++) {
    const travel = (phase * 170 + i * 42) % 170
    const radius = 28 + travel
    const opacity = (0.28 * (1 - travel / 170)).toFixed(3)
    waves.push(`<circle cx="${sx}" cy="${sy}" r="${radius.toFixed(1)}" fill="none" stroke="#ff58cd" stroke-opacity="${opacity}" stroke-width="1.7"/>`)
  }

  const angle = phase * Math.PI * 2 - Math.PI / 2
  const rayX = sx + Math.cos(angle) * 250
  const rayY = sy + Math.sin(angle) * 250
  const fanA = angle - 0.13
  const fanB = angle + 0.13
  const fan = `<path d="M${sx} ${sy} L${(sx + Math.cos(fanA) * 250).toFixed(1)} ${(sy + Math.sin(fanA) * 250).toFixed(1)} A250 250 0 0 1 ${(sx + Math.cos(fanB) * 250).toFixed(1)} ${(sy + Math.sin(fanB) * 250).toFixed(1)} Z" fill="#ff4fc9" fill-opacity=".045"/>`

  const contours = Array.from({ length: 9 }, (_, i) => {
    const y = 100 + i * 56
    const drift = Math.sin(phase * Math.PI * 2 + i * 0.8) * 13
    const d = `M-30 ${y + drift} C160 ${y - 42 - drift} 280 ${y + 51 + drift} 455 ${y + drift} S755 ${y - 39 - drift} 935 ${y + 5 + drift} S1120 ${y + 42} 1230 ${y - 5 + drift}`
    return `<path d="${d}" fill="none" stroke="${i % 2 ? '#5f79aa' : '#b85cbb'}" stroke-opacity=".12" stroke-width="1.1"/>`
  }).join('')

  const edges = scene.edges.map(([ai, bi], index) => {
    const a = scene.nodes[ai], b = scene.nodes[bi]
    const bend = ((index % 2) ? 1 : -1) * (22 + (index % 3) * 8)
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2 + bend
    const d = `M${a[0]} ${a[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0]} ${b[1]}`
    const t = (phase * 2 + index * 0.23) % 1
    const u = 1 - t
    const px = u * u * a[0] + 2 * u * t * mx + t * t * b[0]
    const py = u * u * a[1] + 2 * u * t * my + t * t * b[1]
    const reverseT = (1 - t + 0.21) % 1
    const ru = 1 - reverseT
    const qx = ru * ru * a[0] + 2 * ru * reverseT * mx + reverseT * reverseT * b[0]
    const qy = ru * ru * a[1] + 2 * ru * reverseT * my + reverseT * reverseT * b[1]
    return `<path d="${d}" fill="none" stroke="#b17bbf" stroke-opacity=".28" stroke-width="1.6"/><path d="${d}" fill="none" stroke="#ff71d7" stroke-opacity=".62" stroke-width="1.5" stroke-dasharray="2 14" stroke-dashoffset="${-(frame * 2 + index * 5)}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5.5" fill="#ff5bcf" opacity=".30" filter="url(#glow)"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6" fill="#ffdafa"/><circle cx="${qx.toFixed(1)}" cy="${qy.toFixed(1)}" r="1.6" fill="#77dfff" opacity=".9"/>`
  }).join('')

  const nodes = scene.nodes.map(([x, y, label], i) => {
    const pulse = (phase * 16 + i * 7) % 16
    const r = 8 + pulse * 0.45
    const alpha = 0.3 * (1 - pulse / 16)
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="none" stroke="#ff73d8" stroke-opacity="${alpha.toFixed(3)}" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="6.5" fill="#0b1020" stroke="#ff91df" stroke-opacity=".8" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="2.5" fill="${i % 3 === 0 ? '#8deaff' : '#ff65d2'}" filter="url(#glow)"/><text x="${x + 13}" y="${y - 11}" fill="#eedcf1" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" letter-spacing="1.8" opacity=".88">${label}</text>`
  }).join('')

  const particles = Array.from({ length: 38 }, (_, i) => {
    const baseX = (i * 317 + 91) % SVG_WIDTH
    const x = (baseX + phase * (80 + (i % 4) * 30)) % SVG_WIDTH
    const y = (i * 137 + 47) % SVG_HEIGHT
    const r = i % 9 === 0 ? 1.7 : 0.9
    const opacity = (0.18 + (i % 5) * 0.075).toFixed(2)
    return `<circle cx="${x.toFixed(1)}" cy="${y}" r="${r}" fill="${i % 3 ? '#9dbde9' : '#ff9be5'}" opacity="${opacity}"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
    <defs>
      <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050812"/><stop offset=".52" stop-color="#0a1024"/><stop offset="1" stop-color="#10091a"/></linearGradient>
      <radialGradient id="haze"><stop stop-color="#563576" stop-opacity=".28"/><stop offset="1" stop-color="#080b17" stop-opacity="0"/></radialGradient>
      <radialGradient id="rose"><stop stop-color="#ff5acb" stop-opacity=".22"/><stop offset="1" stop-color="#ff5acb" stop-opacity="0"/></radialGradient>
      <filter id="glow" x="-250%" y="-250%" width="600%" height="600%"><feGaussianBlur stdDeviation="4"/></filter>
      <pattern id="grain" width="47" height="47" patternUnits="userSpaceOnUse"><circle cx="3" cy="7" r=".8" fill="#a8c2ee" opacity=".18"/><circle cx="29" cy="23" r=".7" fill="#d48bd5" opacity=".12"/><circle cx="42" cy="41" r=".8" fill="#a8c2ee" opacity=".1"/></pattern>
    </defs>
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#sea)"/>
    <ellipse cx="${sx}" cy="${sy}" rx="470" ry="350" fill="url(#haze)"/>
    <ellipse cx="${(sx + 90) % SVG_WIDTH}" cy="${(sy + 18) % SVG_HEIGHT}" rx="260" ry="220" fill="url(#rose)"/>
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#grain)"/>
    <g>${contours}</g>
    <g>${particles}</g>
    ${fan}
    <g>${waves.join('')}</g>
    <path d="M${sx} ${sy} L${rayX.toFixed(1)} ${rayY.toFixed(1)}" stroke="#ff75d8" stroke-opacity=".68" stroke-width="1.5" filter="url(#glow)"/>
    <path d="M${sx} ${sy} L${rayX.toFixed(1)} ${rayY.toFixed(1)}" stroke="#ffd9f4" stroke-opacity=".84" stroke-width=".8"/>
    <g>${edges}</g>
    <g>${nodes}</g>
    <circle cx="${sx}" cy="${sy}" r="18" fill="url(#rose)"/>
    <circle cx="${sx}" cy="${sy}" r="3.3" fill="#fff0fc" filter="url(#glow)"/>
    <text x="62" y="86" fill="#fff2fd" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" letter-spacing="8">ZEN X</text>
    <path d="M64 103H229" stroke="#ff5ecf" stroke-opacity=".82" stroke-width="2"/>
    <text x="64" y="128" fill="#f5c5ee" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="3">${scene.title}</text>
    <text x="64" y="149" fill="#b8bbd2" font-family="Arial,Helvetica,sans-serif" font-size="12" letter-spacing="2">MULTI-WHATSAPP SIGNAL NETWORK</text>
    <path d="M61 470 C250 445 345 500 514 476 S795 456 958 483 S1112 470 1200 448" fill="none" stroke="#6d7eb6" stroke-opacity=".16" stroke-width="1"/>
    <path d="M61 489 C250 464 345 519 514 495 S795 475 958 502 S1112 489 1200 467" fill="none" stroke="#d377d0" stroke-opacity=".14" stroke-width="1"/>
    <text x="65" y="514" fill="#9aa5c4" font-family="Arial,Helvetica,sans-serif" font-size="12" letter-spacing="2">SIGNAL IN  ·  ROUTE  ·  RESPONSE OUT</text>
  </svg>`
}

function makePalette(frames) {
  const histogram = new Map()
  for (const frame of frames) {
    for (let y = 0; y < HEIGHT; y += 4) for (let x = 0; x < WIDTH; x += 4) {
      const i = (y * WIDTH + x) * 4
      const key = rgbBin(frame[i], frame[i + 1], frame[i + 2])
      histogram.set(key, (histogram.get(key) || 0) + 1)
    }
  }
  const colors = [...histogram].map(([key, count]) => ({
    key,
    r: (((key >> 10) & 31) << 3) + 4,
    g: (((key >> 5) & 31) << 3) + 4,
    b: ((key & 31) << 3) + 4,
    count,
  }))
  const boxes = [colors]
  while (boxes.length < 256) {
    let target = -1, score = -1, channel = 'r'
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      const ranges = ['r', 'g', 'b'].map(c => {
        let lo = 255, hi = 0
        for (const item of box) { lo = Math.min(lo, item[c]); hi = Math.max(hi, item[c]) }
        return [c, hi - lo]
      })
      ranges.sort((a, b) => b[1] - a[1])
      const population = box.reduce((n, item) => n + item.count, 0)
      const candidateScore = ranges[0][1] * Math.log2(population + 1)
      if (candidateScore > score) { score = candidateScore; target = i; channel = ranges[0][0] }
    }
    if (target < 0) break
    const box = boxes[target].sort((a, b) => a[channel] - b[channel])
    const total = box.reduce((n, item) => n + item.count, 0)
    let tally = 0, splitAt = 1
    for (let i = 0; i < box.length - 1; i++) {
      tally += box[i].count
      if (tally >= total / 2) { splitAt = i + 1; break }
    }
    boxes.splice(target, 1, box.slice(0, splitAt), box.slice(splitAt))
  }
  const palette = boxes.map(box => {
    let r = 0, g = 0, b = 0, count = 0
    for (const item of box) { r += item.r * item.count; g += item.g * item.count; b += item.b * item.count; count += item.count }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
  })
  while (palette.length < 256) palette.push(palette[palette.length - 1] || [0, 0, 0])

  const binMap = new Uint8Array(32768)
  for (let key = 0; key < 32768; key++) {
    const r = (((key >> 10) & 31) << 3) + 4
    const g = (((key >> 5) & 31) << 3) + 4
    const b = ((key & 31) << 3) + 4
    let best = 0, bestDistance = Infinity
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2]
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) { bestDistance = distance; best = i }
    }
    binMap[key] = best
  }
  return { palette, binMap }
}

function quantize(frame, binMap) {
  const indices = Buffer.alloc(WIDTH * HEIGHT)
  for (let i = 0; i < indices.length; i++) {
    const pos = i * 4
    indices[i] = binMap[rgbBin(frame[pos], frame[pos + 1], frame[pos + 2])]
  }
  return indices
}

function u16(n) { return Buffer.from([n & 255, (n >> 8) & 255]) }

function lzw(indices) {
  const clear = 256, end = 257
  let nextCode = 258, bits = 9, dictionary = new Map()
  let accumulator = 0, bitCount = 0
  const bytes = []
  const emit = code => {
    accumulator |= code << bitCount
    bitCount += bits
    while (bitCount >= 8) { bytes.push(accumulator & 255); accumulator >>>= 8; bitCount -= 8 }
  }
  const reset = () => { dictionary = new Map(); nextCode = 258; bits = 9 }
  emit(clear)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const symbol = indices[i], key = prefix * 256 + symbol
    if (dictionary.has(key)) { prefix = dictionary.get(key); continue }
    emit(prefix)
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++)
      if (nextCode > (1 << bits) && bits < 12) bits++
    } else { emit(clear); reset() }
    prefix = symbol
  }
  emit(prefix); emit(end)
  if (bitCount) bytes.push(accumulator & 255)
  const blocks = []
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255)
    blocks.push(Buffer.from([chunk.length]), Buffer.from(chunk))
  }
  blocks.push(Buffer.from([0]))
  return Buffer.concat([Buffer.from([8]), ...blocks])
}

function encodeGif(frameIndices, palette) {
  const parts = [Buffer.from('GIF89a'), u16(WIDTH), u16(HEIGHT), Buffer.from([0xF7, 0, 0])]
  for (const color of palette) parts.push(Buffer.from(color))
  parts.push(Buffer.from([0x21, 0xFF, 0x0B]), Buffer.from('NETSCAPE2.0'), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]))
  for (const frame of frameIndices) {
    parts.push(Buffer.from([0x21, 0xF9, 4, 0x04]), u16(FRAME_DELAY), Buffer.from([0, 0]))
    parts.push(Buffer.from([0x2C]), u16(0), u16(0), u16(WIDTH), u16(HEIGHT), Buffer.from([0]))
    parts.push(lzw(frame))
  }
  parts.push(Buffer.from([0x3B]))
  return Buffer.concat(parts)
}

async function renderScene(scene) {
  const frames = []
  for (let frame = 0; frame < FRAMES; frame++) {
    const { data } = await sharp(Buffer.from(makeSvg(scene, frame)))
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    frames.push(data)
  }
  const { palette, binMap } = makePalette(frames)
  const indexedFrames = frames.map(frame => quantize(frame, binMap))
  const gif = encodeGif(indexedFrames, palette)
  fs.writeFileSync(path.join(OUT, scene.file), gif)
  console.log(`${scene.file}: ${(gif.length / 1024).toFixed(1)} KiB`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const scene of SCENES) await renderScene(scene)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
