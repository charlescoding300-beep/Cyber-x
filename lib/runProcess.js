'use strict'

const { spawn } = require('child_process')

function runProcess(command, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60000
  const maxStderrChars = Number.isFinite(options.maxStderrChars) ? options.maxStderrChars : 8000

  return new Promise((resolve, reject) => {
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer
    let child

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        if (stderr) error.stderr = stderr
        reject(error)
      } else resolve(result)
    }

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (error) {
      finish(error)
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
      const error = new Error(`${command} exceeded its ${timeoutMs}ms time limit`)
      error.code = 'ETIMEDOUT'
      finish(error)
    }, timeoutMs)
    timer.unref?.()

    child.stderr?.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-maxStderrChars)
    })
    child.once('error', error => finish(error))
    child.once('close', (code, signal) => {
      if (timedOut) return
      if (code === 0) return finish(null, { code, signal, stderr })
      const detail = stderr.trim()
      const error = new Error(`${command} exited with ${code === null ? signal : `code ${code}`}${detail ? `: ${detail.slice(-1200)}` : ''}`)
      error.code = code
      error.signal = signal
      finish(error)
    })
  })
}

module.exports = { runProcess }
