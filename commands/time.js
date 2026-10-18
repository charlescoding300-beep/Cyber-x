'use strict'

// .time defaults to UTC. Country names use the bundled country/timezone
// dataset; countries with multiple zones return the local times for each zone.
const countryTimezones = require('countries-and-timezones')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

const SHORTCUTS = {
  utc: 'UTC',
  gmt: 'UTC',
  lagos: 'Africa/Lagos',
  nigeria: 'Africa/Lagos',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  dubai: 'Asia/Dubai',
  delhi: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  tokyo: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  newyork: 'America/New_York',
  ny: 'America/New_York',
  chicago: 'America/Chicago',
  losangeles: 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  saopaulo: 'America/Sao_Paulo',
}

const COUNTRY_ALIASES = {
  us: 'US',
  usa: 'US',
  unitedstatesofamerica: 'US',
  britain: 'GB',
  greatbritain: 'GB',
  uk: 'GB',
  uae: 'AE',
  ivorycoast: 'CI',
  cotedivoire: 'CI',
  czechrepublic: 'CZ',
  southkorea: 'KR',
  republicofkorea: 'KR',
  northkorea: 'KP',
  dprk: 'KP',
  burma: 'MM',
  swaziland: 'SZ',
  turkey: 'TR',
  turkiye: 'TR',
  holland: 'NL',
  cabo: 'CV',
  capeverde: 'CV',
  laos: 'LA',
  russia: 'RU',
  palestine: 'PS',
  vatican: 'VA',
  vaticancity: 'VA',
}

const CONTINENTS = new Set([
  'africa', 'antarctica', 'asia', 'europe', 'northamerica', 'southamerica',
  'oceania', 'australia', 'americas', 'america', 'centralamerica', 'caribbean',
  'pacific', 'middleeast',
])

const normalizeName = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]/g, '')

const COUNTRIES = Object.values(countryTimezones.getAllCountries())
const COUNTRIES_BY_NAME = new Map()
for (const country of COUNTRIES) {
  COUNTRIES_BY_NAME.set(normalizeName(country.name), country)
}

function getCountry(input) {
  const key = normalizeName(input)
  const aliasCode = COUNTRY_ALIASES[key]
  if (aliasCode) return countryTimezones.getCountry(aliasCode)

  // Allow ISO alpha-2 country codes too (for example, .time NG or .time JP).
  if (/^[a-z]{2}$/i.test(String(input || '').trim())) {
    const byCode = countryTimezones.getCountry(String(input).trim().toUpperCase())
    if (byCode) return byCode
  }

  return COUNTRIES_BY_NAME.get(key) || null
}

function countryFlag(country) {
  const code = String(country?.id || country?.iso2 || country?.isoCode || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)))
}

function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function resolveLocation(input) {
  const raw = String(input || 'utc').trim()
  const shortcutKey = normalizeName(raw)

  const country = getCountry(raw)
  if (country) {
    const zones = [...new Set((country.timezones || []).filter(isValidZone))]
    if (zones.length) return { label: country.name, zones, country }
  }

  if (SHORTCUTS[shortcutKey]) {
    return { label: raw || 'UTC', zones: [SHORTCUTS[shortcutKey]], country: null }
  }

  // Preserve direct IANA timezone input, such as Europe/Berlin.
  if (isValidZone(raw)) return { label: raw, zones: [raw], country: null }
  return null
}

function resolveZone(input) {
  return resolveLocation(input)?.zones[0] || null
}

function formatTime(zone, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZoneName: 'short',
  }).format(date)
}

function formatDate(zone, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

module.exports = {
  name: 'time',
  aliases: ['clock', 'worldtime'],
  desc: 'Show the current time in UTC, a country, or any IANA timezone',
  usage: '.time [country, city shortcut, or IANA timezone]',
  category: 'utility',

  _internals: { resolveZone, resolveLocation, formatTime, formatDate, countryFlag },

  run: async ({ sock, from, msg, args = [], text }) => {
    const query = (Array.isArray(args) ? args.join(' ') : String(text || '')).trim()
    const reply = message => sock.sendMessage(from, { text: message }, { quoted: msg })

    const location = resolveLocation(query || 'utc')
    if (!location) {
      if (CONTINENTS.has(normalizeName(query))) {
        return reply(`🌍 *${query} is a continent or region, not a country.*\nPlease enter a specific country, such as *Nigeria*, *Japan*, or *Brazil*.\n\n${CREDIT}`)
      }
      return reply(`❌ I couldn't match *${query}* to a country or timezone.\nTry any country name (for example, Nigeria or Japan), or an IANA name like *Europe/Berlin*.\n\n${CREDIT}`)
    }

    const now = new Date()
    const flag = countryFlag(location.country)
    const countryName = `${flag ? `${flag} ` : ''}${location.country ? 'Country: ' : ''}${location.label}`
    if (location.zones.length > 1) {
      const lines = location.zones.map(zone => `│ • ${zone}: ${formatTime(zone, now)} · ${formatDate(zone, now)}`)
      return reply(`╭───「 TIME 」───╮\n│ ${countryName}\n${lines.join('\n')}\n╰─────────────────╯\n\n${CREDIT}`)
    }

    const zone = location.zones[0]
    return reply(`╭───「 TIME 」───╮\n│ ${countryName}\n│ 🕒 Current time: ${formatTime(zone, now)}\n│ 📅 Date: ${formatDate(zone, now)}\n╰─────────────────╯\n\n${CREDIT}`)
  },
}
