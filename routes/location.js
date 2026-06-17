'use strict';

const express = require('express');
const db = require('../db');
const { requireDriver } = require('../lib/auth');
const { haversine } = require('../lib/geo');

const router = express.Router();

const JITTER_METERS = 15;   // ignore movements smaller than this (GPS noise)
const MAX_JUMP_METERS = 5000; // ignore implausible single-sample jumps

// POST /api/location { lat, lon }
// Appends a breadcrumb and updates the driver's cumulative distance SERVER-SIDE.
// The client never sends a distance; it cannot be edited.
router.post('/location', requireDriver, (req, res) => {
  const lat = parseFloat(req.body.lat);
  const lon = parseFloat(req.body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  const driverId = req.user.id;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO driver_tracks (driver_id, lat, lon, ts) VALUES (?,?,?,?)')
      .run(driverId, lat, lon, now);

    let row = db.prepare('SELECT meters, last_lat, last_lon FROM driver_distance WHERE driver_id = ?').get(driverId);
    if (!row) {
      db.prepare('INSERT INTO driver_distance (driver_id, meters, last_lat, last_lon, updated_at) VALUES (?,0,?,?,?)')
        .run(driverId, lat, lon, now);
      return { meters: 0 };
    }
    let added = 0;
    if (row.last_lat != null) {
      const d = haversine({ lat: row.last_lat, lon: row.last_lon }, { lat, lon });
      if (d >= JITTER_METERS && d <= MAX_JUMP_METERS) added = d;
    }
    const meters = row.meters + added;
    db.prepare('UPDATE driver_distance SET meters=?, last_lat=?, last_lon=?, updated_at=? WHERE driver_id=?')
      .run(meters, lat, lon, now, driverId);
    return { meters };
  });

  const out = tx();
  res.json({ ok: true, meters: Math.round(out.meters) });
});

module.exports = router;
