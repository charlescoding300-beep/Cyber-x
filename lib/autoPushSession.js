const { exec } = require("child_process")
const path = require("path")

let pushTimer   = null
let lastPushAt  = 0
const COOLDOWN  = 20000 // don't push more than once every 20s even if creds update rapidly

function run(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout?.trim(), stderr: stderr?.trim() })
    })
  })
}

// Call this every time the session is saved. It debounces so a burst of
// creds.update events only triggers one push.
function autoPushSession(repoRoot = path.join(__dirname, "..")) {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    const now = Date.now()
    if (now - lastPushAt < COOLDOWN) return
    lastPushAt = now

    const add = await run("git add session/", repoRoot)
    if (!add.ok) { console.error("[AUTOPUSH] ✗ add failed:", add.stderr); return }

    const commit = await run(`git commit -m "auto: session update"`, repoRoot)
    if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      console.error("[AUTOPUSH] ✗ commit failed:", commit.stderr)
      return
    }
    if (/nothing to commit/i.test(commit.stdout)) {
      console.log("[AUTOPUSH] · no changes to push")
      return
    }

    const push = await run("git push", repoRoot)
    if (push.ok) console.log("[AUTOPUSH] ✅ session pushed to GitHub")
    else console.error("[AUTOPUSH] ✗ push failed:", push.stderr)
  }, 5000)
}

module.exports = { autoPushSession }
