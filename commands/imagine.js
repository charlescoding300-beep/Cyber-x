'use strict'

const { askAI } = require('../lib/zenxAI')

const IMAGE_TIMEOUT_MS = 90_000

function cleanInput(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)
}

function makeFallbackPrompt(input) {
  return `Create a detailed image of ${input}. Preserve the main subject and requested details. Use a clear composition, coherent lighting, and a polished visual style.`
}

function parsePlan(raw, input) {
  const text = String(raw || '').replace(/```(?:json)?|```/gi, '').trim()
  if (!text) throw new Error('AI prompt response was empty')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try { parsed = JSON.parse(text.slice(first, last + 1)) } catch {}
    }
  }

  if (parsed && typeof parsed === 'object') {
    return {
      scene: typeof parsed.scene === 'string' && parsed.scene.trim()
        ? parsed.scene.trim().slice(0, 700)
        : `A visual interpretation of ${input}.`,
      prompt: typeof parsed.prompt === 'string' && parsed.prompt.trim()
        ? parsed.prompt.trim().slice(0, 1200)
        : makeFallbackPrompt(input),
    }
  }

  return {
    scene: text.slice(0, 700),
    prompt: makeFallbackPrompt(input),
  }
}

async function buildPlan(input) {
  const system = `You are an image prompt writer. Return only valid JSON with two string fields: "scene" (one vivid, concise sentence describing the requested image) and "prompt" (a clear, detailed image-generation prompt under 120 words). Keep the user's subject and intent. Do not add unrelated text, logos, or watermarks.`

  try {
    const raw = await askAI({ prompt: input, system })
    return parsePlan(raw, input)
  } catch (error) {
    // The AI-written description is optional. An empty or unavailable text
    // response should not prevent the image request from using a local prompt.
    console.warn('[IMAGINE] AI prompt helper failed; using rephrased input:', error?.message || error)
    return {
      scene: `A visual interpretation of ${input}.`,
      prompt: makeFallbackPrompt(input),
    }
  }
}

async function generateImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Image service returned HTTP ${response.status}`)

  const mimetype = response.headers.get('content-type') || 'image/jpeg'
  if (!mimetype.toLowerCase().startsWith('image/')) {
    throw new Error('Image service did not return an image')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 1000) throw new Error('Image service returned an incomplete image')
  return { buffer, mimetype }
}

const run = async ({ sock, from, message, text, args }) => {
  const input = cleanInput(text || (Array.isArray(args) ? args.join(' ') : ''))
  const reply = content => sock.sendMessage(from, content, { quoted: message })

  if (!input) {
    return reply({
      text:
`╭─「 IMAGINE 」─╮
🎨 Turn a description into an image.

Usage: .imagine <description>
Example: .imagine a dragon above Lagos at sunset`,
    })
  }

  void sock.sendMessage(from, { react: { text: '🎨', key: message.key } }).catch(() => {})

  let progress
  try {
    progress = await reply({ text: '🎨 Preparing your image…' })
    const plan = await buildPlan(input)
    const { buffer, mimetype } = await generateImage(plan.prompt)

    if (progress?.key) void sock.sendMessage(from, { delete: progress.key }).catch(() => {})
    await reply({
      image: buffer,
      caption: `╭─「 IMAGINE 」─╮\n🎨 ${input}\n\n${plan.scene}`.slice(0, 1000),
      mimetype,
    })
    void sock.sendMessage(from, { react: { text: '✅', key: message.key } }).catch(() => {})
  } catch (error) {
    console.error('[IMAGINE]', error?.message || error)
    if (progress?.key) void sock.sendMessage(from, { delete: progress.key }).catch(() => {})
    void sock.sendMessage(from, { react: { text: '❌', key: message.key } }).catch(() => {})
    await reply({
      text: '❌ I couldn’t create an image this time. Try a shorter description naming the subject, setting, and style.',
    })
  }
}

module.exports = {
  name: 'imagine',
  aliases: ['img', 'generate', 'draw'],
  category: 'ai',
  desc: 'Generate an image from a description',
  usage: '.imagine <description>',
  run,
}
