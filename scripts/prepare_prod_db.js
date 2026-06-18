'use strict';

/*
 * Run this on the production server when handing over a fresh project:
 *   node scripts/prepare_prod_db.js --confirm
 *
 * It resets delivery progress to zero and soft-deletes any active driver whose
 * username or name contains "aditya". It does not delete schools or other drivers.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const confirm = process.argv.includes('--confirm');

const before = {
  visits: count('visits'),
  tracks: count('driver_tracks'),
  distances: count('driver_distance'),
  activeDrivers: db.prepare(`
    SELECT id, username, name, assigned_block
    FROM drivers
    WHERE deleted_at IS NULL
    ORDER BY id
  `).all(),
};

const adityaDrivers = db.prepare(`
  SELECT id, username, name
  FROM drivers
  WHERE deleted_at IS NULL
    AND (lower(username) LIKE '%aditya%' OR lower(COALESCE(name, '')) LIKE '%aditya%')
`).all();

if (!confirm) {
  console.log(JSON.stringify({
    dryRun: true,
    message: 'No changes made. Re-run with --confirm to reset production progress.',
    before,
    wouldSoftDeleteDrivers: adityaDrivers,
  }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
const tx = db.transaction(() => {
  for (const d of adityaDrivers) {
    db.prepare(`
      UPDATE drivers
      SET active = 0,
          deleted_at = ?,
          username = ?
      WHERE id = ?
    `).run(now, `${d.username}__deleted_${d.id}`, d.id);
  }
  db.prepare('DELETE FROM visits').run();
  db.prepare('DELETE FROM driver_tracks').run();
  db.prepare('DELETE FROM driver_distance').run();
});
tx();

const uploads = path.join(__dirname, '..', 'uploads');
let clearedUploads = false;
if (fs.existsSync(uploads)) {
  for (const item of fs.readdirSync(uploads)) {
    fs.rmSync(path.join(uploads, item), { recursive: true, force: true });
  }
  clearedUploads = true;
}

console.log(JSON.stringify({
  dryRun: false,
  softDeletedDrivers: adityaDrivers,
  clearedUploads,
  after: {
    visits: count('visits'),
    tracks: count('driver_tracks'),
    distances: count('driver_distance'),
    activeDrivers: db.prepare(`
      SELECT id, username, name, assigned_block
      FROM drivers
      WHERE deleted_at IS NULL
      ORDER BY id
    `).all(),
  },
}, null, 2));

function count(table) {
  return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
}
