'use strict'

const https = require('https')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

async function fetchWeather(city) {
  const API_KEY = process.env.OPENWEATHER_API_KEY
  if (!API_KEY) throw new Error('OPENWEATHER_API_KEY not set')
  return new Promise((resolve, reject) => {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`
    const req = https.get(url,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy())
  })
}

async function fetchForecast(city) {
  const API_KEY = process.env.OPENWEATHER_API_KEY
  if (!API_KEY) throw new Error('OPENWEATHER_API_KEY not set')
  return new Promise((resolve, reject) => {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric&cnt=3`
    const req = https.get(url,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy())
  })
}

// ── Auto detect reaction + emoji based on weather condition ──
function getWeatherStyle(condition, description) {
  const c = (condition   || '').toLowerCase()
  const d = (description || '').toLowerCase()

  if (c.includes('thunderstorm'))                          return { reaction: '⛈️',  emoji: '⛈️'  }
  if (c.includes('drizzle'))                               return { reaction: '🌦️',  emoji: '🌦️'  }
  if (c.includes('rain') && d.includes('heavy'))           return { reaction: '🌧️',  emoji: '🌧️'  }
  if (c.includes('rain'))                                  return { reaction: '🌧️',  emoji: '🌧️'  }
  if (c.includes('snow'))                                  return { reaction: '🌨️',  emoji: '🌨️'  }
  if (c.includes('mist') || c.includes('fog') ||
      c.includes('haze') || c.includes('smoke'))           return { reaction: '🌥️',  emoji: '🌫️'  }
  if (c.includes('dust') || c.includes('sand') ||
      c.includes('ash')  || c.includes('squall') ||
      c.includes('tornado'))                               return { reaction: '🌩️',  emoji: '🌪️'  }
  if (c.includes('clear'))                                 return { reaction: '☀️',   emoji: '☀️'   }
  if (d.includes('few clouds'))                            return { reaction: '🌤️',  emoji: '🌤️'  }
  if (d.includes('scattered clouds'))                      return { reaction: '⛅',   emoji: '⛅'   }
  if (d.includes('broken clouds'))                         return { reaction: '🌥️',  emoji: '🌥️'  }
  if (d.includes('overcast') || c.includes('clouds'))     return { reaction: '☁️',   emoji: '☁️'   }
  return { reaction: '🌤️', emoji: '🌡️' }
}

function getWindDirection(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(deg / 45) % 8] || 'N/A'
}

function formatTime(unix, offset) {
  const date = new Date((unix + offset) * 1000)
  return date.toUTCString().slice(17, 22)
}

function getForecastEmoji(condition) {
  return getWeatherStyle(condition, condition).emoji
}

const command = {
  pattern:  'weather',
  alias:    ['w', 'forecast', 'climate'],
  category: 'utility',
  desc:     'Get real-time weather for any city in the world',
  usage:    '.weather <city>',

  run: async ({ sock, from, msg, text, args }) => {

    const city = (text || args.join(' ')).trim()

    if (!city) {
      // ── Default reaction when no city given ──
      sock.sendMessage(from, { react: { text: '🌤️', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🌤️ *CYBER X WEATHER*     ║
╚═══════════════════════════╝

*How to use:*
• *.weather <city>* — Get weather
• *.w <city>* — Also works
• *.forecast <city>* — Also works

💡 *Examples:*
  _.weather Lagos_
  _.weather London_
  _.weather New York_
  _.weather Tokyo_
  _.weather Abuja_
  _.weather Dubai_
  _.weather Paris_

> Supports every city and state in the world! 🌍

${CREDIT}`,
        quoted: msg
      })
    }

    if (!process.env.OPENWEATHER_API_KEY) {
      sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `❌ *OPENWEATHER_API_KEY not set!*\n\nGet free key at:\n🔗 https://openweathermap.org/api\n\nAdd to .env:\n\`OPENWEATHER_API_KEY=your_key\`\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send searching message with default reaction first ──
    sock.sendMessage(from, { react: { text: '🔎', key: msg.key } }).catch(() => {})

    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Fetching weather for:* _${city}_...`,
    }, { quoted: msg })

    try {
      // ── Fetch weather + forecast at same time ──
      const [weather, forecast] = await Promise.all([
        fetchWeather(city),
        fetchForecast(city).catch(() => null),
      ])

      // ── City not found ──
      if (!weather || weather.cod === '404' || weather.cod === 404) {
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
        return sock.sendMessage(from, {
          text:
`❌ *City not found:* _${city}_

*Try:*
• Check the spelling
• Use English city name
• Add country code:
  _Example: .weather Lagos,NG_
  _Example: .weather London,UK_
  _Example: .weather Paris,FR_

${CREDIT}`,
          quoted: msg
        })
      }

      // ── Extract data ──
      const name        = weather.name
      const country     = weather.sys?.country  || ''
      const condition   = weather.weather?.[0]?.main        || 'Unknown'
      const description = weather.weather?.[0]?.description || 'Unknown'
      const temp        = Math.round(weather.main?.temp)
      const feelsLike   = Math.round(weather.main?.feels_like)
      const tempMin     = Math.round(weather.main?.temp_min)
      const tempMax     = Math.round(weather.main?.temp_max)
      const humidity    = weather.main?.humidity
      const pressure    = weather.main?.pressure
      const windSpeed   = weather.wind?.speed
      const windGust    = weather.wind?.gust
      const windDir     = getWindDirection(weather.wind?.deg)
      const visibility  = weather.visibility
        ? `${(weather.visibility / 1000).toFixed(1)} km` : 'N/A'
      const cloudiness  = weather.clouds?.all
      const sunrise     = formatTime(weather.sys?.sunrise, weather.timezone)
      const sunset      = formatTime(weather.sys?.sunset,  weather.timezone)
      const timezone    = weather.timezone / 3600
      const tzLabel     = timezone >= 0 ? `UTC+${timezone}` : `UTC${timezone}`
      const tempF       = Math.round((temp      * 9/5) + 32)
      const feelsLikeF  = Math.round((feelsLike * 9/5) + 32)

      // ── Auto detect style ──
      const { reaction, emoji } = getWeatherStyle(condition, description)

      // ── React with the weather-matching emoji ──
      sock.sendMessage(from, { react: { text: reaction, key: msg.key } }).catch(() => {})

      // ── Build forecast section ──
      let forecastSection = ''
      if (forecast?.list?.length) {
        forecastSection = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📅 *3-HOUR FORECAST*\n'
        for (const f of forecast.list.slice(0, 3)) {
          const fTime  = new Date((f.dt + weather.timezone) * 1000).toUTCString().slice(17, 22)
          const fTemp  = Math.round(f.main?.temp)
          const fDesc  = f.weather?.[0]?.description || ''
          const fCond  = f.weather?.[0]?.main        || ''
          const fEmoji = getForecastEmoji(fCond)
          forecastSection += `\n🕐 *${fTime}* — ${fTemp}°C ${fEmoji} _${fDesc}_`
        }
        forecastSection += '\n'
      }

      // ── Build full output ──
      const output =
`╔═══════════════════════════╗
║  ${emoji} *CYBER X WEATHER*     ║
╚═══════════════════════════╝

📍 *${name}, ${country}*
🕐 *Timezone:* ${tzLabel}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
${emoji} *${condition.toUpperCase()}*
_${description}_

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌡️ *TEMPERATURE*
• Current:     *${temp}°C / ${tempF}°F*
• Feels like:  *${feelsLike}°C / ${feelsLikeF}°F*
• Min / Max:   *${tempMin}°C / ${tempMax}°C*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💧 *ATMOSPHERE*
• Humidity:    *${humidity}%*
• Pressure:    *${pressure} hPa*
• Visibility:  *${visibility}*
• Cloud Cover: *${cloudiness}%*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💨 *WIND*
• Speed:       *${windSpeed} m/s*
• Direction:   *${windDir}*
${windGust ? `• Gusts:       *${windGust} m/s*` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌅 *SUN*
• Sunrise:     *${sunrise}*
• Sunset:      *${sunset}*

${forecastSection}━━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`

      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      await sock.sendMessage(from, { text: output, quoted: msg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      console.error('[WEATHER]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Failed to fetch weather.*\nPlease try again.\n\n${CREDIT}`,
        quoted: msg
      })
    }
  }
}

module.exports = command
