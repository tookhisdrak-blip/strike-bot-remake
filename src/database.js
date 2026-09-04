const fs = require('node:fs');
const path = require('node:path');
const Sqlite = require('better-sqlite3');

function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'bot.db');
  let database;
  try {
    database = new Sqlite(databasePath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.exec(`CREATE TABLE IF NOT EXISTS state (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch (error) {
    throw new Error(`Persistent database could not be opened at ${databasePath}: ${error.message}`);
  }

  const read = database.prepare('SELECT payload FROM state WHERE name = ?');
  const write = database.prepare(`INSERT INTO state (name, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`);
  const saveTransaction = database.transaction((name, value) => {
    write.run(name, JSON.stringify(value), new Date().toISOString());
  });

  function load(name, legacyPath) {
    const saved = read.get(name);
    if (saved) return JSON.parse(saved.payload);
    if (!legacyPath || !fs.existsSync(legacyPath)) return {};
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    saveTransaction(name, legacy);
    return legacy;
  }

  return {
    path: databasePath,
    load,
    save(name, value) { saveTransaction(name, value); },
    backup(destination = `${databasePath}.${Date.now()}.backup`) {
      database.backup(destination);
      return destination;
    },
    close() { database.close(); },
  };
}

module.exports = { createDatabase };
