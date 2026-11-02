'use strict'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map()
const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const REGION = /^[A-Z]{2}$/i.test(process.env.TMDB_REGION || '')
  ? process.env.TMDB_REGION.toUpperCase()
  : 'NG'

function clean(value, max = 480) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Movie provider returned HTTP ' + response.status)
  return response.json()
}

function apiURL(path, key, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + path)
  url.searchParams.set('api_key', key)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value))
    }
  }
  return url.toString()
}

async function fromTMDb(query, key) {
  const search = await getJSON(apiURL('/search/movie', key, {
    query,
    include_adult: false,
    region: REGION,
  }))
  const match = search.results?.[0]
  if (!match) throw new Error('Movie not found')

  const [details, providerResponse] = await Promise.all([
    getJSON(apiURL('/movie/' + match.id, key, {
      append_to_response: 'credits,videos',
    })),
    getJSON(apiURL('/movie/' + match.id + '/watch/providers', key)).catch(() => null),
  ])

  const country = providerResponse?.results?.[REGION]
  const providerGroups = ['flatrate', 'free', 'ads', 'rent', 'buy']
  const providers = [...new Set(providerGroups.flatMap(group =>
    (country?.[group] || []).map(provider => provider.provider_name).filter(Boolean)
  ))].slice(0, 6)
  const videos = details.videos?.results || []
  const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer') ||
    videos.find(video => video.site === 'YouTube' && video.type === 'Teaser')

  return {
    title: details.title || match.title,
    year: (details.release_date || match.release_date || '').slice(0, 4),
    rating: details.vote_average ? Number(details.vote_average).toFixed(1) + '/10' : 'N/A',
    runtime: details.runtime ? details.runtime + ' min' : 'N/A',
    genres: (details.genres || []).map(genre => genre.name).join(', ') || 'N/A',
    plot: details.overview || 'No plot available.',
    cast: (details.credits?.cast || []).slice(0, 5).map(person => person.name).join(', ') || 'N/A',
    poster: details.poster_path
      ? 'https://image.tmdb.org/t/p/w500' + details.poster_path
      : null,
    trailer: trailer ? 'https://youtu.be/' + trailer.key : null,
    providers,
    providerLink: country?.link || null,
    region: REGION,
    source: 'TMDb',
  }
}

async function fromOMDb(query, key) {
  const url = new URL('https://www.omdbapi.com/')
  url.searchParams.set('apikey', key)
  url.searchParams.set('t', query)
  url.searchParams.set('plot', 'short')
  const details = await getJSON(url.toString())
  if (details.Response === 'False') throw new Error('Movie not found')

  return {
    title: details.Title || query,
    year: details.Year || 'N/A',
    rating: details.imdbRating && details.imdbRating !== 'N/A'
      ? details.imdbRating + '/10'
      : 'N/A',
    runtime: details.Runtime || 'N/A',
    genres: details.Genre || 'N/A',
    plot: details.Plot || 'No plot available.',
    cast: details.Actors || 'N/A',
    poster: details.Poster && details.Poster !== 'N/A' ? details.Poster : null,
    trailer: null,
    providers: [],
    providerLink: null,
    region: REGION,
    source: 'OMDb',
  }
}

async function lookup(query) {
  const tmdbKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY
  const omdbKey = process.env.OMDB_KEY || process.env.OMDB_API_KEY
  if (!tmdbKey && !omdbKey) {
    throw new Error('Set TMDB_KEY or OMDB_KEY in the server environment first.')
  }

  const cacheKey = query.toLowerCase()
  const saved = cache.get(cacheKey)
  if (saved && Date.now() - saved.at < CACHE_TTL_MS) return saved.value

  let result
  if (tmdbKey) {
    try {
      result = await fromTMDb(query, tmdbKey)
    } catch (error) {
      if (!omdbKey) throw error
    }
  }
  if (!result && omdbKey) result = await fromOMDb(query, omdbKey)

  if (cache.size >= 100) cache.delete(cache.keys().next().value)
  cache.set(cacheKey, { at: Date.now(), value: result })
  return result
}

function formatMovie(movie) {
  const lines = [
    '🎬 *' + clean(movie.title, 120) + (movie.year ? ' (' + clean(movie.year, 8) + ')' : '') + '*',
    '⭐ Rating: ' + clean(movie.rating, 20),
    '⏱️ Runtime: ' + clean(movie.runtime, 20),
    '🎭 Genres: ' + clean(movie.genres, 120),
    '',
    '📝 *Plot*',
    clean(movie.plot, 480),
    '',
    '👥 *Cast:* ' + clean(movie.cast, 180),
  ]

  if (movie.trailer) lines.push('▶️ Trailer: ' + movie.trailer)
  if (movie.providers?.length) {
    lines.push('📺 Legal watch options (' + movie.region + '): ' + movie.providers.join(', '))
  } else {
    lines.push('📺 Check official services in your region for availability.')
  }
  if (movie.providerLink) lines.push('🔎 Provider listings: ' + movie.providerLink)

  lines.push('', 'Data: ' + movie.source + '. Provider availability is regional and may change.')
  if (movie.source === 'TMDb') {
    lines.push('TMDb API data is not endorsed or certified by TMDb. Availability listings via JustWatch.')
  }
  lines.push('', CREDIT)
  return lines.join('\n')
}

module.exports = {
  pattern: 'movie',
  alias: ['movies', 'film'],
  desc: 'Look up movie details, trailer, and legal viewing options',
  usage: '.movie <movie title>',
  category: 'media',

  async run({ sock, from, msg, args, text }) {
    const query = clean(Array.isArray(args) ? args.join(' ') : text, 120)
    if (!query) {
      return sock.sendMessage(from, {
        text: 'Usage: *.movie <movie title>*\nExample: *.movie The Matrix*\n\n' + CREDIT,
      }, { quoted: msg })
    }

    const pending = await sock.sendMessage(from, {
      text: '🔎 Searching movie information for *' + query + '*…',
    }, { quoted: msg })

    try {
      const movie = await lookup(query)
      const caption = formatMovie(movie)
      if (pending?.key) sock.sendMessage(from, { delete: pending.key }).catch(() => {})

      if (movie.poster) {
        try {
          return await sock.sendMessage(from, {
            image: { url: movie.poster },
            caption,
          }, { quoted: msg })
        } catch {}
      }
      return await sock.sendMessage(from, { text: caption }, { quoted: msg })
    } catch (error) {
      if (pending?.key) sock.sendMessage(from, { delete: pending.key }).catch(() => {})
      const message = /Set TMDB_KEY|Set .*OMDB_KEY/i.test(error.message)
        ? '❌ Movie lookup is not configured. Add TMDB_KEY or OMDB_KEY to the server environment.'
        : /not found/i.test(error.message)
          ? '❌ I could not find that movie. Check the title and try again.'
          : '❌ Movie lookup failed. Check the API key or try again shortly.'
      return sock.sendMessage(from, { text: message + '\n\n' + CREDIT }, { quoted: msg })
    }
  },
}

