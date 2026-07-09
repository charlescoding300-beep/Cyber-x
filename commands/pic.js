'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — PIC COMMAND
//  Usage: .pic <country>
//  Returns a random person's profile (name + photo) via randomuser.me,
//  matched to that country's nationality data where supported.
//
//  HONEST LIMITATION (confirmed directly from randomuser.me's own docs):
//  the `nat` parameter changes name format, phone format, and location
//  to match the requested country — but it does NOT guarantee the PHOTO
//  itself is someone who looks like they're from that country. The photo
//  pool is shared across all nationalities. This command says so plainly
//  in the caption rather than pretending otherwise.
//
//  Supported nationality codes (per randomuser.me's own documented list):
//  AU, BR, CA, CH, DE, DK, ES, FI, FR, GB, IE, IN, IR, MX, NL, NO, NZ,
//  RS, TR, UA, US
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT = `> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

// Maps common country name variants to randomuser.me's supported nat codes.
const COUNTRY_TO_NAT = {
  australia: 'AU',
  brazil: 'BR',
  canada: 'CA',
  switzerland: 'CH',
  germany: 'DE',
  denmark: 'DK',
  spain: 'ES',
  finland: 'FI',
  france: 'FR',
  'united kingdom': 'GB', uk: 'GB', england: 'GB', britain: 'GB',
  ireland: 'IE',
  india: 'IN',
  iran: 'IR',
  mexico: 'MX',
  netherlands: 'NL', holland: 'NL',
  norway: 'NO',
  'new zealand': 'NZ',
  serbia: 'RS',
  turkey: 'TR',
  ukraine: 'UA',
  'united states': 'US', usa: 'US', america: 'US', 'united states of america': 'US',
}

const SUPPORTED_LIST = [
  'Australia', 'Brazil', 'Canada', 'Switzerland', 'Germany', 'Denmark',
  'Spain', 'Finland', 'France', 'United Kingdom', 'Ireland', 'India',
  'Iran', 'Mexico', 'Netherlands', 'Norway', 'New Zealand', 'Serbia',
  'Turkey', 'Ukraine', 'United States',
]

function toTitleCase(str) {
  return str.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function resolveNat(input) {
  const key = input.toLowerCase().trim()
  return COUNTRY_TO_NAT[key] || null
}

async function fetchRandomUser(natCode) {
  const url = natCode
    ? `https://randomuser.me/api/?nat=${natCode}`
    : `https://randomuser.me/api/`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const user = data?.results?.[0]
  if (!user) throw new Error('No user in response')
  return user
}

async function fetchImageBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

module.exports = {
  pattern:  'pic',
  alias:    ['randomuser'],
  category: 'download',
  desc:     "Get a random person's profile photo, nationality-matched where possible",
  usage:    '.pic <country>',

  run: async ({ sock, from, msg, args, text }) => {

    const input = (text || args?.join(' ') || '').trim()

    if (!input) {
      return sock.sendMessage(from, {
        text: `╔════════════════════════════╗\n║   🧑  *C Y B E R  X  PIC*  ║\n╚════════════════════════════╝\n\n❌ *No country provided!*\n\n┌─────────────────────────────\n│ 📌 *Usage:*  _.pic <country>_\n└─────────────────────────────\n\n✅ *Best-matched countries:*\n${SUPPORTED_LIST.join(', ')}\n\n💡 Other countries still work, but return a fully random nationality.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    await sock.sendMessage(from, { react: { text: '🧑', key: msg.key } }).catch(() => {})

    const displayName = toTitleCase(input)
    const natCode = resolveNat(input)

    let user = null
    try {
      user = await fetchRandomUser(natCode)
    } catch (e) {
      console.warn(`[PIC] randomuser.me failed:`, e.message)
    }

    if (!user) {
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `╔════════════════════════════╗\n║   🧑  *C Y B E R  X  PIC*  ║\n╚════════════════════════════╝\n\n❌ *Could not fetch a profile right now.*\n\n💡 Try again in a moment\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    let buf = null
    try {
      buf = await fetchImageBuffer(user.picture.large)
    } catch (e) {
      console.warn(`[PIC] image download failed:`, e.message)
    }

    const fullName = `${user.name.first} ${user.name.last}`
    const age = user.dob?.age ?? '—'
    const location = `${user.location?.city || '—'}, ${user.location?.country || '—'}`

    const matchNote = natCode
      ? `✅ Matched nationality: *${displayName}*`
      : `⚠️ "${displayName}" isn't in the supported list — showing a random nationality instead.`

    const caption =
      `╔════════════════════════════╗\n║   🧑  *C Y B E R  X  PIC*  ║\n╚════════════════════════════╝\n\n` +
      `👤 *Name:* ${fullName}\n` +
      `🎂 *Age:* ${age}\n` +
      `📍 *Location:* ${location}\n` +
      `${matchNote}\n\n` +
      `⚠️ _Note: the photo itself is from a shared pool and isn't guaranteed to visually match the nationality — only the name/location data is matched._\n\n` +
      `${CREDIT}`

    if (buf) {
      await sock.sendMessage(from, {
        image: buf,
        caption,
        mimetype: 'image/jpeg',
      }, { quoted: msg })
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})
    } else {
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(from, {
        text: `${caption}\n\n❌ _(photo download failed, showing data only)_`,
      }, { quoted: msg })
    }
  }
}
