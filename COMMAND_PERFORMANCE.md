# Command performance guide

Commands run through the shared dispatcher and per-session executor. Every command inherits the same in-memory settings cache, command timing, queue limits, and error handling.

## Keep command handlers responsive

- Keep synchronous JavaScript work small. Do not use synchronous filesystem, child-process, compression, or crypto APIs inside `run`; use async APIs instead.
- Await network and database operations without blocking the event loop. Use the shared `helper.fetchWithRetry`, `helper.fetchJson`, and `helper.fetchBuffer` helpers where they fit.
- Avoid waiting for group metadata unless the command actually needs admin or participant data. The dispatcher already checks admin context for commands that declare `adminOnly`, `botAdmin`, or `requiresAdmin`.
- Use the provided `settings` object (`get`, `set`, `unset`) rather than reading or writing `data/users/*.json` directly. Session settings are loaded once and then served from memory; settings API writes update that cache.
- Mark CPU-heavy, large-media download/upload, conversion, or multi-session broadcast command modules with `heavy: true`. The executor then puts them in the bounded heavy lane shared across sessions, keeping ordinary commands available while that work runs. New commands get this isolation automatically when they declare `heavy: true`.

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

## Shared event-loop work

- Character AI keeps conversation memory in the existing local JSON store. Reads are asynchronous on first use, and writes are compact, asynchronous, and coalesced; pending writes are flushed during graceful shutdown. This keeps AI disk persistence off the command hot path.
- Normal per-command trace lines are disabled by default to reduce log traffic. Set `COMMAND_TRACE=1` temporarily when diagnosing dispatch; slow-command and error warnings remain active.
- WhatsApp sends, metadata requests, media downloads, and external API calls still depend on the remote service. The bot can dispatch promptly, but cannot guarantee zero-second delivery or eliminate upstream errors.
