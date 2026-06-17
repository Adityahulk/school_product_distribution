'use strict';

const express = require('express');
const db = require('../db');
const { readSession } = require('../lib/auth');

const router = express.Router();

// All schools with visited status — used by both driver and admin maps.
// Requires any logged-in user.
router.get('/schools', (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'login required' });

  const rows = db.prepare(`
    SELECT sc.udise, sc.no, sc.block, sc.name, sc.category, sc.tables, sc.chairs, sc.lat, sc.lon,
           v.id IS NOT NULL AS visited,
           v.driver_id AS visited_by,
           v.checkin_time AS visited_at
    FROM schools sc
    LEFT JOIN visits v ON v.udise = sc.udise
    ORDER BY sc.no
  `).all();

  for (const r of rows) r.visited = !!r.visited;
  res.json({ total: rows.length, schools: rows });
});

module.exports = router;
