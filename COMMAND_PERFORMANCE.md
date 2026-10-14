# Command performance guide

Commands run through the shared dispatcher and per-session executor. Every command inherits the same in-memory settings cache, command timing, queue limits, and error handling.

## Keep command handlers responsive

- Keep synchronous JavaScript work small. Do not use synchronous filesystem, child-process, compression, or crypto APIs inside `run`; use async APIs instead.
- Await network and database operations without blocking the event loop. Use the shared `helper.fetchWithRetry`, `helper.fetchJson`, and `helper.fetchBuffer` helpers where they fit.
- Avoid waiting for group metadata unless the command actually needs admin or participant data. The dispatcher already checks admin context for commands that declare `adminOnly`, `botAdmin`, or `requiresAdmin`.
- Use the provided `settings` object (`get`, `set`, `unset`) rather than reading or writing `data/users/*.json` directly. Session settings are loaded once and then served from memory; settings API writes update that cache.
- Mark CPU-heavy or media-processing command modules with `heavy: true`. The executor then puts them in the bounded heavy lane shared across sessions, keeping ordinary commands available while media work runs.
- The executor also learns command names that take longer than `EXEC_AUTO_HEAVY_MS` (default 1000 ms) and saves them in `data/learned-heavy-commands.json`. Later runs, including after a restart, use the bounded heavy lane automatically.

Example:

```js
module.exports = {
  pattern: 'example-media',
  heavy: true,
  run: async ({ sock, from }) => {
    // Use async I/O or an isolated worker/process for expensive work.
  },
}
```

Command duration warnings, executor queue statistics, and event-loop lag warnings help identify a slow handler after it is added. Network/API response time and unbounded CPU work inside a command still depend on that command's implementation.
