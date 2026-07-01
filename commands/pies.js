'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — PIC COMMAND
//  Usage: .pic <any country in the world>
//  Anyone can use | Category: download
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT = `> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

const SLICE_LABELS = ['🔥 Rizz', '💀 Chaos', '✨ Vibes', '🎭 Drama', '😎 Swag']

function resolveCountry(input) {
  return input.toLowerCase().trim()
}

function toTitleCase(str) {
  return str.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function randomSlices(n) {
  let remaining = 100
  const vals = []
  for (let i = 0; i < n - 1; i++) {
    const max = remaining - (n - 1 - i)
    const v = Math.max(1, Math.floor(Math.random() * max))
    vals.push(v)
    remaining -= v
  }
  vals.push(remaining)
  return vals
}

function buildChartUrl(countryName) {
  const values = randomSlices(SLICE_LABELS.length)
  const config = {
    type: 'pie',
    data: {
      labels: SLICE_LABELS,
      datasets: [{
        data: values,
        backgroundColor: ['#ff4d4d', '#4d79ff', '#ffd24d', '#4dff88', '#c94dff']
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: `${countryName} Energy 🥧`, font: { size: 22 } },
        legend: { position: 'bottom' }
      }
    }
  }
  const encoded = encodeURIComponent(JSON.stringify(config))
  return `https://quickchart.io/chart?width=600&height=600&backgroundColor=white&c=${encoded}`
}

async function fetchImage(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error(`Not an image: ${ct}`)
  return Buffer.from(await res.arrayBuffer())
}

module.exports = {
  pattern:  'pic',
  alias:    ['pics', 'countrypie'],
  category: 'download',
  desc:     'Get a fun pie chart for any country',
  usage:    '.pic <country>',

  run: async ({ sock, from, msg, args, text }) => {

    const input = (text || args?.join(' ') || '').trim()

    if (!input) {
      return sock.sendMessage(from, {
        text: `╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIC*   ║
╚════════════════════════════╝

❌ *No country provided!*

┌─────────────────────────────
│ 📌 *Usage:*  _.pic <country>_
└─────────────────────────────

🔥 *Examples:*
  _.pic nigeria_
  _.pic united states_
  _.pic south africa_
  _.pic japan_
  _.pic brazil_

${CREDIT}`,
      }, { quoted: msg })
    }

    await sock.sendMessage(from, { react: { text: '🗽', key: msg.key } }).catch(() => {})

    const displayName = toTitleCase(input)
    const url = buildChartUrl(displayName)

    let buf = null
    try {
      buf = await fetchImage(url)
    } catch (e) {
      console.warn(`[PIC] QuickChart failed:`, e.message)
    }

    if (buf) {
      await sock.sendMessage(from, {
        image:   buf,
        caption: `🗽 *${displayName}*\n\n${CREDIT}`,
        mimetype: 'image/jpeg',
      }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: ' ✅', key: msg.key } }).catch(() => {})
    } else {
      await sock.sendMessage(from, { react: { text: ' ❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(from, {
        text: `╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIC*   ║
╚════════════════════════════╝

❌ *Could not generate chart for:* _"${displayName}"_

💡 Try again in a moment

${CREDIT}`,
      }, { quoted: msg })
    }
  }
}
