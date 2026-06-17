'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

// --- Driver management ---
router.post('/drivers', requireAdmin, (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (String(password).length < 4) return res.status(400).json({ error: 'password too short' });
  const exists = db.prepare('SELECT id FROM drivers WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'username already exists' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO drivers (username, password_hash, name) VALUES (?,?,?)')
    .run(username, hash, name || username);
  res.json({ id: info.lastInsertRowid, username, name: name || username });
});

router.get('/drivers', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, name, active, created_at FROM drivers ORDER BY id').all();
  res.json({ drivers: rows });
});

// Deactivate / reactivate / reset password.
router.patch('/drivers/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id);
  if (!driver) return res.status(404).json({ error: 'driver not found' });
  const { active, password } = req.body || {};
  if (typeof active === 'boolean') {
    db.prepare('UPDATE drivers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (password) {
    if (String(password).length < 4) return res.status(400).json({ error: 'password too short' });
    db.prepare('UPDATE drivers SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), id);
  }
  res.json({ ok: true });
});

// --- Monitoring overview ---
router.get('/overview', requireAdmin, (req, res) => {
  const totalSchools = db.prepare('SELECT COUNT(*) c FROM schools').get().c;
  const totalVisited = db.prepare('SELECT COUNT(*) c FROM visits').get().c;

  const drivers = db.prepare(`
    SELECT d.id, d.username, d.name, d.active,
      COALESCE(dd.meters, 0) AS meters,
      dd.last_lat, dd.last_lon, dd.updated_at AS last_seen,
      (SELECT COUNT(*) FROM visits v WHERE v.driver_id = d.id) AS visited_count
    FROM drivers d
    LEFT JOIN driver_distance dd ON dd.driver_id = d.id
    ORDER BY d.id
  `).all();

  for (const d of drivers) {
    d.km = Math.round((d.meters / 1000) * 100) / 100;
    d.active = !!d.active;
  }

  res.json({
    totalSchools,
    totalVisited,
    remaining: totalSchools - totalVisited,
    drivers,
  });
});

// All visits with photo URLs and school + driver info.
router.get('/visits', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT v.id, v.udise, v.checkin_lat, v.checkin_lon, v.checkin_time,
           v.school_photo, v.tables_photo,
           sc.name AS school_name, sc.block, sc.lat AS school_lat, sc.lon AS school_lon,
           d.username AS driver_username, d.name AS driver_name, d.id AS driver_id
    FROM visits v
    JOIN schools sc ON sc.udise = v.udise
    JOIN drivers d ON d.id = v.driver_id
    ORDER BY v.checkin_time DESC
  `).all();
  for (const r of rows) {
    r.school_photo_url = '/uploads/' + r.school_photo;
    r.tables_photo_url = '/uploads/' + r.tables_photo;
  }
  res.json({ visits: rows });
});

module.exports = router;
