"use strict";

// ══════════════════════════════════════════════════════════════════════
//  ZENX / ZEN X — VPS SQLITE PERSISTENCE ENGINE
//
//  Source of truth:
//    ~/zenx-bot/database/zenx.db
//
//  Existing command interfaces are preserved:
//    global.slotData
//    global.heroSystem
//    loadAll()
//    saveAll()
//
//  JSON files are NO LONGER used as the live database.
//  They remain in data/ as rollback/reference copies.
// ══════════════════════════════════════════════════════════════════════

const store = require("../database/persistence");

const SAVE_MS = 60_000;

// ── SQLite namespaces ────────────────────────────────────────────────

const NS = "zenx";

const KEYS = {
  coins: "coins.json",
  daily: "daily.json",
  cards: "cards.json",
  herocache: "herocache.json",
  meta: "meta.json",
};

// ── Serialisation helpers ────────────────────────────────────────────

function mapToObj(map) {
  const obj = {};

  for (const [k, v] of map) {
    obj[k] = v;
  }

  return obj;
}

function mapOfSetsToObj(map) {
  const obj = {};

  for (const [k, v] of map) {
    obj[k] = [...v];
  }

  return obj;
}

function objToMap(obj) {
  const m = new Map();

  if (!obj || typeof obj !== "object") {
    return m;
  }

  for (const [k, v] of Object.entries(obj)) {
    m.set(k, v);
  }

  return m;
}

function objToMapOfSets(obj) {
  const m = new Map();

  if (!obj || typeof obj !== "object") {
    return m;
  }

  for (const [k, v] of Object.entries(obj)) {
    m.set(
      k,
      new Set(Array.isArray(v) ? v : [])
    );
  }

  return m;
}

// ── Read/write wrappers ──────────────────────────────────────────────

function readData(key, fallback = {}) {
  // Primary source: live ZEN X namespace.
  const live = store.get(NS, key, null);

  if (live !== null && live !== undefined) {
    return live;
  }

  // Safety fallback: original staged migration data.
  // This prevents a fresh/empty ZEN X namespace from
  // overwriting previously migrated data.
  const staged = store.get("json_data", key, null);

  if (staged !== null && staged !== undefined) {
    console.log(
      `[PERSIST] 🔄 Recovered ${key} from json_data migration backup`
    );

    // Restore it immediately into the live namespace.
    store.set(NS, key, staged);

    return staged;
  }

  return fallback;
}

function writeData(key, value) {
  store.set(NS, key, value);
}

// ══════════════════════════════════════════════════════════════════════
//  LOAD
// ══════════════════════════════════════════════════════════════════════

function loadAll() {
  let restored = 0;

  // ── Slot economy ──────────────────────────────────────────────────

  const coinsData = readData(KEYS.coins, {});
  const dailyData = readData(KEYS.daily, {});

  if (!global.slotData) {
    global.slotData = {
      coins: new Map(),
      cooldowns: new Map(),
      daily: new Map(),
      totalSpins: 0,
      totalJackpots: 0,
    };
  }

  if (Object.keys(coinsData).length > 0) {
    global.slotData.coins =
      objToMap(coinsData.coins || coinsData);

    global.slotData.totalSpins =
      coinsData.totalSpins || 0;

    global.slotData.totalJackpots =
      coinsData.totalJackpots || 0;

    console.log(
      `[PERSIST] 💰 Restored ${global.slotData.coins.size} coin balances from VPS SQLite`
    );

    restored++;
  }

  if (Object.keys(dailyData).length > 0) {
    global.slotData.daily =
      objToMap(dailyData);

    console.log(
      `[PERSIST] 🎁 Restored ${global.slotData.daily.size} daily timestamps from VPS SQLite`
    );

    restored++;
  }

  // ── Hero system ───────────────────────────────────────────────────

  const cardsData = readData(KEYS.cards, {});

  if (!global.heroSystem) {
    global.heroSystem = {
      apiCache: new Map(),
      collection: new Map(),
      battles: new Map(),
    };
  }

  if (Object.keys(cardsData).length > 0) {
    global.heroSystem.collection =
      objToMapOfSets(cardsData);

    const totalCards =
      [...global.heroSystem.collection.values()]
        .reduce((sum, set) => sum + set.size, 0);

    console.log(
      `[PERSIST] 🦸 Restored ${global.heroSystem.collection.size} players' card collections (${totalCards} cards total) from VPS SQLite`
    );

    restored++;
  }

  // ── Hero API cache ────────────────────────────────────────────────

  const cacheData = readData(KEYS.herocache, {});

  if (Object.keys(cacheData).length > 0) {
    for (const [k, v] of Object.entries(cacheData)) {
      const key = isNaN(k) ? k : Number(k);

      global.heroSystem.apiCache.set(key, v);
    }

    console.log(
      `[PERSIST] 📡 Restored ${global.heroSystem.apiCache.size} cached hero profiles from VPS SQLite`
    );

    restored++;
  }

  // ── Meta ──────────────────────────────────────────────────────────

  const meta = readData(KEYS.meta, {});

  if (meta.lastSave) {
    console.log(
      `[PERSIST] ⏱️ Last save was: ${meta.lastSave}`
    );
  }

  console.log(
    `[PERSIST] ✅ Load complete — ${restored} data set(s) restored from VPS SQLite`
  );
}

// ══════════════════════════════════════════════════════════════════════
//  SAVE
//
//  Every write goes directly to the VPS SQLite database.
//  No JSON filesystem write is performed.
// ══════════════════════════════════════════════════════════════════════

function saveAll(reason = "auto") {
  let saved = 0;

  store.transaction(() => {

    // ── Slot coins ─────────────────────────────────────────────────

    if (global.slotData?.coins) {
      writeData(KEYS.coins, {
        coins: mapToObj(global.slotData.coins),
        totalSpins:
          global.slotData.totalSpins || 0,
        totalJackpots:
          global.slotData.totalJackpots || 0,
      });

      saved++;
    }

    // ── Daily timestamps ───────────────────────────────────────────

    if (global.slotData?.daily) {
      writeData(
        KEYS.daily,
        mapToObj(global.slotData.daily)
      );

      saved++;
    }

    // ── Card collections ───────────────────────────────────────────

    if (global.heroSystem?.collection) {
      writeData(
        KEYS.cards,
        mapOfSetsToObj(
          global.heroSystem.collection
        )
      );

      saved++;
    }

    // ── Hero API cache ─────────────────────────────────────────────

    if (global.heroSystem?.apiCache?.size > 0) {
      const cacheObj = {};

      for (
        const [k, v]
        of global.heroSystem.apiCache
      ) {
        cacheObj[k] = v;
      }

      writeData(
        KEYS.herocache,
        cacheObj
      );

      saved++;
    }

    // ── Meta ────────────────────────────────────────────────────────

    writeData(KEYS.meta, {
      lastSave: new Date().toISOString(),
      reason,
      players:
        global.slotData?.coins?.size || 0,
      cards:
        global.heroSystem?.collection?.size || 0,
    });

    saved++;
  });

  if (reason !== "auto") {
    console.log(
      `[PERSIST] 💾 Saved (${reason}) — ${saved} data set(s) written to VPS SQLite`
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
//  AUTO-SAVE
// ══════════════════════════════════════════════════════════════════════

let saveTimer = null;

function startAutoSave() {
  if (saveTimer) return;

  saveTimer = setInterval(
    () => saveAll("auto"),
    SAVE_MS
  );

  saveTimer.unref();

  console.log(
    `[PERSIST] ⏰ SQLite auto-save enabled every ${SAVE_MS / 1000}s`
  );
}

// ══════════════════════════════════════════════════════════════════════
//  EXIT / CRASH HANDLING
// ══════════════════════════════════════════════════════════════════════

function setupExitHooks() {

  const handler = (signal) => {
    console.log(
      `\n[PERSIST] 🚨 ${signal} received — saving to VPS SQLite before exit...`
    );

    try {
      saveAll(signal);
    } catch (err) {
      console.error(
        "[PERSIST] ❌ Final SQLite save failed:",
        err
      );
    }

    process.exit(0);
  };

  process.once(
    "SIGINT",
    () => handler("SIGINT")
  );

  process.once(
    "SIGTERM",
    () => handler("SIGTERM")
  );

  process.once(
    "exit",
    () => {
      try {
        saveAll("exit");
      } catch (err) {
        console.error(
          "[PERSIST] ❌ Exit SQLite save failed:",
          err
        );
      }
    }
  );

  const crashHandler = (err) => {
    console.error(
      "[PERSIST] 💥 Crash detected — saving data to VPS SQLite..."
    );

    try {
      saveAll("crash");
    } catch (saveErr) {
      console.error(
        "[PERSIST] ❌ Crash save failed:",
        saveErr
      );
    }
  };

  process.on(
    "uncaughtException",
    crashHandler
  );

  process.on(
    "unhandledRejection",
    crashHandler
  );
}

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════

loadAll();
startAutoSave();
setupExitHooks();

console.log(
  "[PERSIST] 💾 VPS SQLite persistence engine active"
);
console.log(
  "[PERSIST] 📍 Source of truth: ~/zenx-bot/database/zenx.db"
);

// ── Public API ───────────────────────────────────────────────────────

module.exports = {
  saveAll,
  loadAll,
};
