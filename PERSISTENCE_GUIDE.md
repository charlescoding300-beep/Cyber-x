# ZEN X persistence

The project's SQLite database at database/zenx.db is the source of truth for
bot settings, per-phone settings, linked-user records, and command state.
SQLite uses WAL journaling and synchronous writes for durable updates.

## Command state

The main message handler injects a persistence object into each command. It is
scoped to the linked bot phone number, canonical command name, and chat JID.

    module.exports = {
      pattern: "example",
      async run({ persistence }) {
        const count = persistence.get("count", 0)
        persistence.set("count", count + 1)
      }
    }

The API supports get, has, all, set, setMany, update, delete, and clear. Values
must be JSON-serializable. Each mutation is synchronously saved to SQLite before
it returns. Future commands must use this injected API (or lib.userDb for shared
feature settings) for state that should survive a restart; ordinary local
variables are intentionally transient.

## Settings and logout behavior

Global settings and linked-phone overrides are also stored in SQLite. Existing
data/settings_store.json and data/users/<phone>.json files are imported only
when the corresponding SQLite record does not yet exist. Later reads come from
SQLite, so stale files cannot overwrite newer settings.

Only a confirmed WhatsApp logout removes the linked phone's SQLite user record,
command state, and session settings along with phone-scoped local data. Ordinary
restarts, temporary disconnects, and manual removal from the website preserve
application state.
