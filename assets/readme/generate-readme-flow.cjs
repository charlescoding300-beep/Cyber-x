'use strict'

// Three different vector scenes for the README: global signal routing,
// vertical database traffic, and a dark WhatsApp bot ecosystem.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const SOURCE_W = 1080
const SOURCE_H = 480
const WIDTH = 900
const HEIGHT = 400
const FRAMES = 20
const DELAY = 9
const OUT = path.join(__dirname, 'flow')

const clamp = value => Math.max(0, Math.min(255, value))
const rgbBin = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
const escapeXml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])

function shell(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_W}" height="${SOURCE_H}" viewBox="0 0 ${SOURCE_W} ${SOURCE_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#030712"/><stop offset=".56" stop-color="#08172a"/><stop offset="1" stop-color="#100a20"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#18304d"/><stop offset="1" stop-color="#080f21"/></linearGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#65fff0"/><stop offset="1" stop-color="#51a9ff"/></linearGradient>
    <linearGradient id="rose" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff70d7"/><stop offset="1" stop-color="#9d83ff"/></linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#101c30"/><stop offset=".5" stop-color="#26364b"/><stop offset="1" stop-color="#111a2d"/></linearGradient>
    <radialGradient id="globe"><stop stop-color="#163a5a"/><stop offset=".76" stop-color="#10233f"/><stop offset="1" stop-color="#091326"/></radialGradient>
    <radialGradient id="aura"><stop stop-color="#16d9cf" stop-opacity=".25"/><stop offset="1" stop-color="#16d9cf" stop-opacity="0"/></radialGradient>
    <radialGradient id="greenAura"><stop stop-color="#16e6a8" stop-opacity=".20"/><stop offset="1" stop-color="#16e6a8" stop-opacity="0"/></radialGradient>
    <filter id="glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="12"/></filter>
    <clipPath id="earthClip"><circle cx="225" cy="246" r="105"/></clipPath>
  </defs>
  <rect width="${SOURCE_W}" height="${SOURCE_H}" fill="url(#bg)"/>
  ${content}
  </svg>`
}

function topography() {
  return Array.from({ length: 26 }, (_, i) => {
    const x = (i * 173 + 23) % SOURCE_W
    const y = (i * 97 + 31) % SOURCE_H
    const r = i % 7 === 0 ? 1.4 : 0.7
    const color = i % 4 === 0 ? '#83f6e7' : '#9fb9d9'
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity=".38"/>`
  }).join('')
}

function header(kicker, title, subtitle, color = '#dbeaff') {
  return `<text x="56" y="51" fill="#8da5c5" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" letter-spacing="4">${kicker}</text>
    <text x="56" y="82" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="23" font-weight="700" letter-spacing="2">${title}</text>
    <text x="56" y="105" fill="#91a5c0" font-family="Arial,Helvetica,sans-serif" font-size="12" letter-spacing="1.6">${subtitle}</text>`
}

function quad(a, c, b, t) {
  const u = 1 - t
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]
}

function packet(x, y, color, radius = 3.2) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius * 2.5).toFixed(1)}" fill="${color}" opacity=".28" filter="url(#glow)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="#f5fdff"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius * .58).toFixed(1)}" fill="${color}"/>`
}

function worldScene(frame) {
  const phase = frame / FRAMES
  const routes = [
    { a: [330, 247], c: [391, 180], b: [456, 228], color: '#61f3e2' },
    { a: [604, 225], c: [687, 157], b: [766, 182], color: '#ff78d9' },
    { a: [604, 254], c: [698, 335], b: [863, 347], color: '#7bdcff' },
  ]
  const routeLines = routes.map(r => `<path d="M${r.a[0]} ${r.a[1]} Q${r.c[0]} ${r.c[1]} ${r.b[0]} ${r.b[1]}" fill="none" stroke="${r.color}" stroke-opacity=".25" stroke-width="2"/><path d="M${r.a[0]} ${r.a[1]} Q${r.c[0]} ${r.c[1]} ${r.b[0]} ${r.b[1]}" fill="none" stroke="${r.color}" stroke-opacity=".62" stroke-width="1" stroke-dasharray="3 12" stroke-dashoffset="${-(phase * 15)}"/>`).join('')
  const packets = routes.map((r, i) => {
    const t = (phase + i * .29) % 1
    const p = quad(r.a, r.c, r.b, t)
    const back = quad(r.a, r.c, r.b, (t + .5) % 1)
    return packet(p[0], p[1], r.color, 3.4) + packet(back[0], back[1], r.color, 2.1)
  }).join('')
  const scanY = 175 + ((phase * 105) % 105)
  const globeLongitudes = [38, 68, 91].map(rx => `<ellipse cx="225" cy="246" rx="${rx}" ry="105" fill="none" stroke="#72e8df" stroke-opacity=".20" stroke-width="1"/>`).join('')
  const globeLatitudes = [205, 226, 246, 266, 287].map((y, i) => `<ellipse cx="225" cy="${y}" rx="${Math.sqrt(Math.max(1, 105 * 105 - (y - 246) ** 2))}" ry="${i === 2 ? 1 : 11}" fill="none" stroke="#72e8df" stroke-opacity=".17" stroke-width="1"/>`).join('')
  const globe = `<circle cx="225" cy="246" r="116" fill="url(#aura)"/><circle cx="225" cy="246" r="105" fill="url(#globe)" stroke="#7cefe5" stroke-opacity=".72" stroke-width="1.5"/>
    <g clip-path="url(#earthClip)"><path d="M155 207l21-27 24 4 10 13 21-1 9 13-14 11-3 20-20 3-7 25-16-5-8-19-18-8-9-17zM247 258l19-13 22 6 13 22-14 11-4 23-17 9-8-19-16-10zM290 181l28 5 20 18-14 14-26-9z" fill="#42bea7" fill-opacity=".7" stroke="#8bf6dd" stroke-opacity=".5" stroke-width="1"/>${globeLongitudes}${globeLatitudes}<path d="M115 ${scanY}H335" stroke="#a0fff3" stroke-opacity=".74" stroke-width="1.2" filter="url(#glow)"/><path d="M115 ${scanY}H335" stroke="#bffffa" stroke-opacity=".7" stroke-width=".7"/></g>
    <ellipse cx="225" cy="246" rx="120" ry="38" transform="rotate(-25 225 246)" fill="none" stroke="#a2ffed" stroke-opacity=".4" stroke-width="1.2" stroke-dasharray="2 7"/>
    <text x="225" y="375" text-anchor="middle" fill="#b6cadc" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" letter-spacing="2">WORLD TRAFFIC</text>`
  const pins = Array.from({ length: 8 }, (_, i) => {
    const n = 485 + i * 17
    return `<path d="M${n} 173V155M${n} 298V316" stroke="#95adcc" stroke-opacity=".8" stroke-width="3"/><path d="M457 ${185 + i * 13}H439M617 ${185 + i * 13}H635" stroke="#95adcc" stroke-opacity=".8" stroke-width="3"/>`
  }).join('')
  const chip = `<circle cx="537" cy="239" r="110" fill="url(#aura)"/><g>${pins}</g><path d="M475 174H599L620 195V282L599 303H475L454 282V195Z" fill="#101a2d" stroke="#7de8e7" stroke-opacity=".88" stroke-width="2"/><path d="M489 190H585L603 207V270L585 287H489L471 270V207Z" fill="url(#glass)" stroke="#46667e" stroke-width="1.2"/><path d="M505 220H568M505 232H568M505 244H568M505 256H551" stroke="#7c9ab2" stroke-opacity=".42" stroke-width="2"/><circle cx="537" cy="239" r="23" fill="#0a1926" stroke="url(#mint)" stroke-width="1.5"/><path d="M526 239h22m-11-11v22" stroke="#c5fff7" stroke-opacity=".9" stroke-width="1.4"/><text x="537" y="330" text-anchor="middle" fill="#d7eaff" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" letter-spacing="2">ZEN X CORE CHIP</text>`
  const tvScan = Array.from({ length: 7 }, (_, i) => `<path d="M789 ${138 + i * 12}H959" stroke="#82f7eb" stroke-opacity="${i % 2 ? '.11' : '.18'}" stroke-width="1"/>`).join('')
  const tvWave = `<path d="M792 185 C812 185 814 155 832 155 S850 210 868 210 S885 165 902 165 S923 195 941 195 S950 179 962 179" fill="none" stroke="#74fff0" stroke-opacity=".95" stroke-width="2" stroke-dasharray="90 160" stroke-dashoffset="${-(phase * 250)}" filter="url(#glow)"/><path d="M792 185 C812 185 814 155 832 155 S850 210 868 210 S885 165 902 165 S923 195 941 195 S950 179 962 179" fill="none" stroke="#c9fff7" stroke-opacity=".88" stroke-width="1"/>`
  const tv = `<path d="M779 123Q779 111 793 111H960Q975 111 975 126V238Q975 252 961 252H793Q779 252 779 238Z" fill="#0c1321" stroke="#d0b8e1" stroke-opacity=".74" stroke-width="2"/><path d="M790 127Q790 121 797 121H949Q961 121 961 132V224Q961 236 949 236H797Q790 236 790 228Z" fill="#071524" stroke="#4f7c8a" stroke-width="1"/>${tvScan}${tvWave}<circle cx="967" cy="153" r="3" fill="#6bffe9"/><circle cx="967" cy="173" r="3" fill="#ff8ae0"/><path d="M855 253V264M822 265H889M838 111L817 93M838 111L859 94" stroke="#9cadc1" stroke-width="2" stroke-linecap="round"/><text x="877" y="282" text-anchor="middle" fill="#d8e3f3" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="700" letter-spacing="1.7">LIVE DISPLAY</text>`
  const phone = `<path d="M902 319Q902 309 912 309H965Q975 309 975 319V396Q975 406 965 406H912Q902 406 902 396Z" fill="#101a28" stroke="#a0b5c9" stroke-opacity=".82" stroke-width="1.8"/><rect x="909" y="318" width="59" height="72" rx="7" fill="#091623" stroke="#36546b"/><path d="M917 336h40M917 344h27" stroke="#6bffe9" stroke-opacity=".55" stroke-width="2"/><path d="M919 360q13-12 26 0" fill="none" stroke="#ff83dd" stroke-width="2" stroke-dasharray="18 30" stroke-dashoffset="${-(phase * 48)}"/><circle cx="938" cy="398" r="2" fill="#93a5b8"/><text x="938" y="428" text-anchor="middle" fill="#bdcddd" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="700" letter-spacing="1.4">PHONE</text>`
  const content = `${topography()}<ellipse cx="542" cy="240" rx="280" ry="220" fill="url(#aura)" opacity=".3"/>${header('01  /  GLOBAL ROUTE', 'WORLD  →  CHIP  →  SCREEN', 'Requests move through the shared core to connected devices.')}${routeLines}${globe}${chip}${tv}${phone}${packets}<text x="55" y="451" fill="#8fa4bd" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">SIGNAL IN  ·  ROUTE THROUGH ZEN X  ·  RESPONSE OUT</text>`
  return shell(content)
}

function rack(x, label, phase, side) {
  const bays = Array.from({ length: 5 }, (_, i) => {
    const y = 148 + i * 45
    const light = (i + Math.floor(phase * 8)) % 4 === 0 ? '#ffcf80' : '#50e5dc'
    return `<rect x="${x + 12}" y="${y}" width="148" height="35" rx="3" fill="url(#metal)" stroke="#536d87" stroke-opacity=".7"/><path d="M${x + 23} ${y + 10}H${x + 89}M${x + 23} ${y + 17}H${x + 89}M${x + 23} ${y + 24}H${x + 89}" stroke="#a1b8d2" stroke-opacity=".22" stroke-width="1.4"/><circle cx="${x + 132}" cy="${y + 17}" r="2.5" fill="${light}"/><circle cx="${x + 132}" cy="${y + 17}" r="6" fill="${light}" opacity=".2" filter="url(#glow)"/><path d="M${x + 98} ${y + 10}h18m-18 7h18m-18 7h18" stroke="#899bb1" stroke-opacity=".42" stroke-width="1"/>`
  }).join('')
  const rails = `<path d="M${x} 127V388M${x + 172} 127V388" stroke="#70849c" stroke-opacity=".8" stroke-width="4"/><path d="M${x + 5} 127H${x + 167}M${x + 5} 388H${x + 167}" stroke="#9badc0" stroke-opacity=".7" stroke-width="3"/>`
  const tagX = side === 'left' ? x + 85 : x + 85
  return `${rails}${bays}<text x="${tagX}" y="415" text-anchor="middle" fill="#adc1d4" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" letter-spacing="1.8">${label}</text>`
}

function databaseScene(frame) {
  const phase = frame / FRAMES
  const verticalStreams = Array.from({ length: 8 }, (_, i) => {
    const x = 340 + i * 57
    const falling = (phase * 430 + i * 73) % 430
    const rising = (430 - ((phase * 430 + i * 59) % 430))
    const col = i % 2 ? '#67e6ff' : '#ffbd73'
    return `<path d="M${x} 108V403" stroke="${col}" stroke-opacity=".13" stroke-width="1" stroke-dasharray="2 11"/><path d="M${x} ${falling + 108}v-27" stroke="${col}" stroke-width="2" opacity=".76"/><circle cx="${x}" cy="${falling + 108}" r="3.1" fill="${col}" filter="url(#glow)"/><path d="M${x + 10} ${rising + 108}v25" stroke="#bd94ff" stroke-width="1.8" opacity=".75"/><circle cx="${x + 10}" cy="${rising + 108}" r="2.5" fill="#e5c9ff"/>`
  }).join('')
  const dataBands = [0,1,2,3].map(i => {
    const y = 192 + i * 42
    const offset = (phase * 80 + i * 28) % 80
    return `<path d="M438 ${y}H642" stroke="#6de9e0" stroke-opacity=".16" stroke-width="1.5"/><path d="M438 ${y}H642" stroke="#a9fff5" stroke-opacity=".85" stroke-width="2" stroke-dasharray="22 72" stroke-dashoffset="${-offset}"/>`
  }).join('')
  const db = `<ellipse cx="540" cy="158" rx="115" ry="30" fill="#182f48" stroke="#83e7e1" stroke-width="1.5"/><path d="M425 158V345C425 362 477 376 540 376S655 362 655 345V158" fill="#112338" fill-opacity=".88" stroke="#75d5d4" stroke-width="1.6"/><path d="M425 205C425 222 477 236 540 236S655 222 655 205M425 252C425 269 477 283 540 283S655 269 655 252M425 299C425 316 477 330 540 330S655 316 655 299" fill="none" stroke="#7694ad" stroke-opacity=".55" stroke-width="1.2"/><ellipse cx="540" cy="158" rx="115" ry="30" fill="url(#glass)" stroke="#b5fbf1" stroke-opacity=".8" stroke-width="1.4"/><ellipse cx="540" cy="158" rx="57" ry="14" fill="none" stroke="#9df5e7" stroke-opacity=".38"/><text x="540" y="247" text-anchor="middle" fill="#effcff" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="700" letter-spacing="3">DATABASE</text><text x="540" y="270" text-anchor="middle" fill="#a6c1d7" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">PERSISTENT STORE</text>${dataBands}`
  const floor = Array.from({ length: 8 }, (_, i) => `<path d="M${i * 160 - 100} 423L485 386M${i * 160 - 100} 423L${490 + i * 2} 386" stroke="#6686a4" stroke-opacity=".13" stroke-width="1"/>`).join('')
  const arrows = `<path d="M320 352V184m0 0-6 11m6-11 6 11M760 172v171m0 0-6-11m6 11 6-11" fill="none" stroke="#ffcc84" stroke-width="1.7" stroke-linecap="round"/><text x="295" y="267" transform="rotate(-90 295 267)" fill="#d8c7b5" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">WRITE / INGEST</text><text x="786" y="267" transform="rotate(90 786 267)" fill="#b5d4df" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">READ / STREAM</text>`
  const content = `${topography()}${header('02  /  PERSISTENCE', 'DATABASE SERVER  ·  READ / WRITE', 'Traffic moves vertically through storage, then returns on demand.', '#e4e8f5')}${rack(105, 'INGEST RACK', phase, 'left')}${rack(803, 'RESPONSE RACK', phase, 'right')}${verticalStreams}${arrows}<ellipse cx="540" cy="260" rx="195" ry="210" fill="url(#aura)" opacity=".23"/>${db}${floor}<text x="55" y="451" fill="#8fa4bd" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">WRITE DOWN  ·  STORE  ·  READ BACK UP</text>`
  return shell(content)
}

function ecosystemScene(frame) {
  const phase = frame / FRAMES
  const center = [540, 252]
  const satellites = [
    [250, 252, 'SESSIONS', '#55edb4'], [389, 125, 'GROUPS', '#7bffd4'],
    [690, 125, 'COMMANDS', '#ff76d8'], [831, 252, 'REPLIES', '#6beaff'],
    [690, 379, 'MEDIA', '#ff9f70'], [389, 379, 'USERS', '#a88bff'],
  ]
  const orbit = `<ellipse cx="540" cy="252" rx="295" ry="136" fill="none" stroke="#1a735a" stroke-opacity=".42" stroke-width="1.2"/><ellipse cx="540" cy="252" rx="220" ry="95" transform="rotate(-24 540 252)" fill="none" stroke="#37586a" stroke-opacity=".35" stroke-width="1" stroke-dasharray="3 8"/><ellipse cx="540" cy="252" rx="128" ry="128" fill="url(#greenAura)"/>`
  const links = satellites.map(([x,y,label,color], i) => {
    const cx = (center[0] + x) / 2 + (i % 2 ? 22 : -22)
    const cy = (center[1] + y) / 2 + (i % 3 - 1) * 15
    const t = (phase + i * .19) % 1
    const p = quad(center, [cx, cy], [x, y], t)
    const returnP = quad(center, [cx, cy], [x, y], (t + .5) % 1)
    return `<path d="M${center[0]} ${center[1]}Q${cx} ${cy} ${x} ${y}" fill="none" stroke="${color}" stroke-opacity=".22" stroke-width="1.2"/><path d="M${center[0]} ${center[1]}Q${cx} ${cy} ${x} ${y}" fill="none" stroke="${color}" stroke-opacity=".45" stroke-width="1" stroke-dasharray="2 12" stroke-dashoffset="${-(phase * 14)}"/>${packet(p[0],p[1],color,2.8)}${packet(returnP[0],returnP[1],color,1.7)}`
  }).join('')
  const nodes = satellites.map(([x,y,label,color], i) => {
    const pulse = (phase * 2 * Math.PI + i * .9)
    const r = 15 + (Math.sin(pulse) + 1) * 3
    const icon = ['◉','▤','⌘','↗','◌','◎'][i]
    return `<circle cx="${x}" cy="${y}" r="${r + 8}" fill="none" stroke="${color}" stroke-opacity="${(.12 + (Math.sin(pulse)+1)*.08).toFixed(2)}" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="${r}" fill="#07120f" stroke="${color}" stroke-opacity=".78" stroke-width="1.4"/><text x="${x}" y="${y + 5}" text-anchor="middle" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700">${icon}</text><text x="${x}" y="${y + 34}" text-anchor="middle" fill="#c8dfd7" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" letter-spacing="1.7">${label}</text>`
  }).join('')
  const ping = `<circle cx="540" cy="252" r="${72 + (Math.sin(phase * 2 * Math.PI) + 1) * 9}" fill="none" stroke="#34f2ae" stroke-opacity=".27" stroke-width="1.5"/><circle cx="540" cy="252" r="58" fill="#06130f" stroke="#63f5b7" stroke-opacity=".86" stroke-width="1.8"/><path d="M510 227Q510 218 520 218H560Q570 218 570 228V256Q570 266 560 266H542L528 278V266H520Q510 266 510 256Z" fill="#0b251b" stroke="#69f5bb" stroke-width="1.6"/><path d="M527 242q2-8 7-4l4 5q2 3-2 6l-2 2q4 7 11 10l3-3q3-3 6-1l4 4q3 4-3 8-5 3-14-1-13-6-19-19-4-9-1-14z" fill="#bfffe0"/><text x="540" y="304" text-anchor="middle" fill="#e5fff4" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2">WHATSAPP BOT</text><text x="540" y="322" text-anchor="middle" fill="#58dca9" font-family="Arial,Helvetica,sans-serif" font-size="9" font-weight="700" letter-spacing="2">PING  ·  ROUTE  ·  REPLY</text>`
  const content = `<rect width="${SOURCE_W}" height="${SOURCE_H}" fill="#020605"/>${topography()}<circle cx="540" cy="252" r="290" fill="url(#greenAura)" opacity=".42"/>${header('03  /  BOT ECOSYSTEM', 'PING  ·  WHATSAPP BOT', 'One active core. Sessions, groups, commands and replies in orbit.', '#edfff7')}${orbit}${links}${nodes}${ping}<text x="55" y="451" fill="#74988a" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="2">MESSAGE ARRIVES  ·  BOT PINGS  ·  RESPONSE RETURNS</text>`
  return shell(content)
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
  const colors = [...histogram].map(([key,count]) => ({
    key, r: (((key >> 10) & 31) << 3) + 4, g: (((key >> 5) & 31) << 3) + 4,
    b: ((key & 31) << 3) + 4, count,
  }))
  const boxes = [colors]
  while (boxes.length < 256) {
    let target = -1, score = -1, channel = 'r'
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      const ranges = ['r','g','b'].map(c => {
        let lo = 255, hi = 0
        for (const item of box) { lo = Math.min(lo,item[c]); hi = Math.max(hi,item[c]) }
        return [c,hi-lo]
      }).sort((a,b) => b[1]-a[1])
      const population = box.reduce((n,item) => n+item.count,0)
      const candidate = ranges[0][1] * Math.log2(population+1)
      if (candidate > score) { score=candidate; target=i; channel=ranges[0][0] }
    }
    if (target < 0) break
    const box = boxes[target].sort((a,b) => a[channel]-b[channel])
    const total = box.reduce((n,item) => n+item.count,0)
    let tally=0, split=1
    for (let i=0;i<box.length-1;i++) { tally+=box[i].count; if (tally>=total/2) { split=i+1; break } }
    boxes.splice(target,1,box.slice(0,split),box.slice(split))
  }
  const palette = boxes.map(box => {
    let r=0,g=0,b=0,n=0
    for (const item of box) { r+=item.r*item.count; g+=item.g*item.count; b+=item.b*item.count; n+=item.count }
    return [Math.round(r/n),Math.round(g/n),Math.round(b/n)]
  })
  while (palette.length<256) palette.push(palette[palette.length-1] || [0,0,0])
  const binMap = new Uint8Array(32768)
  for (let key=0;key<32768;key++) {
    const r=(((key>>10)&31)<<3)+4, g=(((key>>5)&31)<<3)+4, b=((key&31)<<3)+4
    let best=0, distance=Infinity
    for (let i=0;i<palette.length;i++) {
      const dr=r-palette[i][0], dg=g-palette[i][1], db=b-palette[i][2]
      const d=dr*dr+dg*dg+db*db
      if (d<distance) { distance=d; best=i }
    }
    binMap[key]=best
  }
  return { palette, binMap }
}

function indexFrame(frame, binMap) {
  const output = Buffer.alloc(WIDTH*HEIGHT)
  for (let i=0;i<output.length;i++) {
    const p=i*4
    output[i]=binMap[rgbBin(frame[p],frame[p+1],frame[p+2])]
  }
  return output
}

function u16(n) { return Buffer.from([n&255,(n>>8)&255]) }

function lzw(indices) {
  const clear=256, end=257
  let next=258, bits=9, dictionary=new Map(), accumulator=0, bitCount=0
  const bytes=[]
  const emit=code => { accumulator|=code<<bitCount; bitCount+=bits; while(bitCount>=8){bytes.push(accumulator&255);accumulator>>>=8;bitCount-=8} }
  const reset=()=>{dictionary=new Map();next=258;bits=9}
  emit(clear)
  let prefix=indices[0]
  for(let i=1;i<indices.length;i++){
    const symbol=indices[i], key=prefix*256+symbol
    if(dictionary.has(key)){prefix=dictionary.get(key);continue}
    emit(prefix)
    if(next<4096){dictionary.set(key,next++);if(next>(1<<bits)&&bits<12)bits++}
    else{emit(clear);reset()}
    prefix=symbol
  }
  emit(prefix);emit(end)
  if(bitCount)bytes.push(accumulator&255)
  const blocks=[]
  for(let i=0;i<bytes.length;i+=255){const part=bytes.slice(i,i+255);blocks.push(Buffer.from([part.length]),Buffer.from(part))}
  blocks.push(Buffer.from([0]))
  return Buffer.concat([Buffer.from([8]),...blocks])
}

function encodeGif(frames,palette) {
  const chunks=[Buffer.from('GIF89a'),u16(WIDTH),u16(HEIGHT),Buffer.from([0xF7,0,0])]
  for(const color of palette)chunks.push(Buffer.from(color))
  chunks.push(Buffer.from([0x21,0xFF,0x0B]),Buffer.from('NETSCAPE2.0'),Buffer.from([0x03,0x01,0,0,0]))
  for(const frame of frames){
    chunks.push(Buffer.from([0x21,0xF9,4,0x04]),u16(DELAY),Buffer.from([0,0]))
    chunks.push(Buffer.from([0x2C]),u16(0),u16(0),u16(WIDTH),u16(HEIGHT),Buffer.from([0]),lzw(frame))
  }
  chunks.push(Buffer.from([0x3B]))
  return Buffer.concat(chunks)
}

async function render(file, scene) {
  const rgba=[]
  for(let frame=0;frame<FRAMES;frame++){
    const {data}=await sharp(Buffer.from(scene(frame))).resize(WIDTH,HEIGHT).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    rgba.push(data)
  }
  const {palette,binMap}=makePalette(rgba)
  const indexed=rgba.map(frame=>indexFrame(frame,binMap))
  const gif=encodeGif(indexed,palette)
  fs.writeFileSync(path.join(OUT,file),gif)
  console.log(`${file}: ${(gif.length/1024).toFixed(0)} KiB`)
}

async function main() {
  fs.mkdirSync(OUT,{recursive:true})
  await render('01-world-to-device.gif',worldScene)
  await render('02-database-flow.gif',databaseScene)
  await render('03-whatsapp-ecosystem.gif',ecosystemScene)
}

main().catch(error=>{console.error(error);process.exitCode=1})
