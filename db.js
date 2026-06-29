'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'app.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    udise    TEXT PRIMARY KEY,
    no       INTEGER,
    block    TEXT,
    name     TEXT,
    category TEXT,
    tables   INTEGER,
    chairs   INTEGER,
    lat      REAL NOT NULL,
    lon      REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    assigned_block TEXT,
    can_test_mode INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    deleted_at    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS visits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    udise        TEXT NOT NULL UNIQUE REFERENCES schools(udise),
    driver_id    INTEGER NOT NULL REFERENCES drivers(id),
    checkin_lat  REAL,
    checkin_lon  REAL,
    checkin_time TEXT NOT NULL DEFAULT (datetime('now')),
    school_photo TEXT NOT NULL,
    tables_photo TEXT NOT NULL,
    certificate_photo TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS driver_tracks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    ts        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tracks_driver ON driver_tracks(driver_id, id);

  CREATE TABLE IF NOT EXISTS driver_distance (
    driver_id INTEGER PRIMARY KEY REFERENCES drivers(id),
    meters    REAL NOT NULL DEFAULT 0,
    last_lat  REAL,
    last_lon  REAL,
    updated_at TEXT
  );
`);

const driverColumns = db.prepare('PRAGMA table_info(drivers)').all().map((c) => c.name);
if (!driverColumns.includes('assigned_block')) {
  db.exec('ALTER TABLE drivers ADD COLUMN assigned_block TEXT');
}
if (!driverColumns.includes('can_test_mode')) {
  db.exec('ALTER TABLE drivers ADD COLUMN can_test_mode INTEGER NOT NULL DEFAULT 0');
}
if (!driverColumns.includes('deleted_at')) {
  db.exec('ALTER TABLE drivers ADD COLUMN deleted_at TEXT');
}

const visitColumns = db.prepare('PRAGMA table_info(visits)').all().map((c) => c.name);
if (!visitColumns.includes('certificate_photo')) {
  db.exec('ALTER TABLE visits ADD COLUMN certificate_photo TEXT');
}

// Seed the fixed school list (idempotent: insert-or-replace the canonical reference data).
function seedSchools() {
  const arr = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'schools.json'), 'utf8'));
  const insert = db.prepare(`
    INSERT INTO schools (udise, no, block, name, category, tables, chairs, lat, lon)
    VALUES (@udise, @no, @block, @name, @category, @tables, @chairs, @lat, @lon)
    ON CONFLICT(udise) DO UPDATE SET
      no=@no, block=@block, name=@name, category=@category,
      tables=@tables, chairs=@chairs, lat=@lat, lon=@lon
  `);
  const tx = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  tx(arr);
  return arr.length;
}

const n = seedSchools();
console.log(`[db] ready — ${n} schools seeded at ${DB_PATH}`);

module.exports = db;
