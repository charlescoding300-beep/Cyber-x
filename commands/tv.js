'use strict'
// commands/tv.js — .tv <show name>   (TVMaze, free, no key)
// Poster, rating, status, network, cast, plus the NEXT and LAST episode dates.

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'zenx-bot/1.0' } })
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e }
    return await r.json()
  } finally { clearTimeout(t) }
}

const EMBED = 'embed%5B%5D=nextepisode&embed%5B%5D=previousepisode&embed%5B%5D=cast'
const strip = (s = '') => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

async function findShow(q) {
  try {
    return await getJSON(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(q)}&${EMBED}`)
  } catch (e) {
    if (e.status !== 404) throw e
  }
  const list = await getJSON(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)
  if (!list.length) return null
  return getJSON(`https://api.tvmaze.com/shows/${list[0].show.id}?${EMBED}`)
}

function dateText(airstamp, airdate) {
  const d = airstamp ? new Date(airstamp) : airdate ? new Date(airdate + 'T00:00:00Z') : null
  if (!d || isNaN(d)) return 'TBA'
  const nice = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const days = Math.round((d - Date.now()) / 86400000)
  const rel = days > 1 ? ` (in ${days} days)` : days === 1 ? ' (tomorrow)' : days === 0 ? ' (today)' : days === -1 ? ' (yesterday)' : ` (${-days} days ago)`
  return nice + rel
}

const ep = (e) => `S${String(e.season).padStart(2, '0')}E${String(e.number ?? 0).padStart(2, '0')}${e.name ? ` “${e.name}”` : ''}`

module.exports = {
  pattern: 'tv',
  name: 'tv',
  alias: ['series', 'show'],
  category: 'media',
  desc: 'TV show info: rating, cast, next and last episode',
  usage: '.tv <show name>',

  run: async ({ sock, from, msg, args }) => {
    const reply = (c) => sock.sendMessage(from, c, { quoted: msg })
    const q = (args || []).join(' ').trim()
    if (!q) return reply({ text: '📺 Usage: *.tv <show name>*\nExample: *.tv Breaking Bad*' })

    let s
    try { s = await findShow(q) }
    catch (e) { return reply({ text: '❌ TV database is unreachable right now. Try again shortly.' }) }
    if (!s) return reply({ text: `❌ No TV show found for *${q}*.` })

    const years = `${(s.premiered || '').slice(0, 4) || '?'}${s.status === 'Running' ? '–present' : s.ended ? '–' + s.ended.slice(0, 4) : ''}`
    const net = s.network?.name || s.webChannel?.name
    const runtime = s.averageRuntime || s.runtime
    const next = s._embedded?.nextepisode
    const prev = s._embedded?.previousepisode
    const cast = (s._embedded?.cast || []).slice(0, 5).map((c) => `${c.person.name}${c.character?.name ? ` (${c.character.name})` : ''}`)
    let summary = strip(s.summary)
    if (summary.length > 450) summary = summary.slice(0, 447).replace(/\s+\S*$/, '') + '...'

    const lines = [
      `📺 *${s.name}* (${years})`,
      `⭐ ${s.rating?.average ?? 'N/A'}  •  📌 ${s.status || 'N/A'}${runtime ? `  •  ⏱ ${runtime} min` : ''}`,
      `🎭 ${(s.genres || []).join(', ') || 'N/A'}${net ? `  •  📡 ${net}` : ''}`,
    ]
    if (summary) lines.push('', `📖 ${summary}`)
    if (cast.length) lines.push('', `👥 ${cast.join(', ')}`)
    lines.push('')
    if (next) lines.push(`🗓 *Next:* ${ep(next)}\n      ${dateText(next.airstamp, next.airdate)}`)
    else lines.push(`🗓 *Next:* ${s.status === 'Ended' ? 'show has ended' : 'not announced yet'}`)
    if (prev) lines.push(`⏮ *Last:* ${ep(prev)}\n      ${dateText(prev.airstamp, prev.airdate)}`)
    if (s.officialSite) lines.push('', `🔗 ${s.officialSite}`)
    lines.push(`📺 Where to watch: https://www.justwatch.com/us/search?q=${encodeURIComponent(s.name)}`)
    const caption = lines.join('\n')

    const poster = s.image?.original || s.image?.medium
    if (poster) {
      try { return await reply({ image: { url: poster }, caption }) } catch (_) {}
    }
    return reply({ text: caption })
  },
}
