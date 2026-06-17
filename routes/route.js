'use strict';

const express = require('express');
const db = require('../db');
const { requireDriver } = require('../lib/auth');
const { greedyOrder, haversine } = require('../lib/geo');

const router = express.Router();

// GET /api/route/next?lat=..&lon=..
// Returns the nearest unvisited school plus the full greedy nearest-neighbour
// ordering of all remaining unvisited schools. The unvisited set is shared across
// all drivers (a school is gone once anyone checks in), so this auto-adjusts.
router.get('/route/next', requireDriver, (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }

  const unvisited = db.prepare(`
    SELECT sc.udise, sc.no, sc.block, sc.name, sc.category, sc.tables, sc.chairs, sc.lat, sc.lon
    FROM schools sc
    LEFT JOIN visits v ON v.udise = sc.udise
    WHERE v.id IS NULL
  `).all();

  if (unvisited.length === 0) {
    return res.json({ done: true, remaining: 0, next: null, order: [] });
  }

  const start = { lat, lon };
  const order = greedyOrder(start, unvisited);
  const next = order[0];

  res.json({
    done: false,
    remaining: unvisited.length,
    next,                 // nearest unvisited school, with legMeters from current position
    order: order.slice(0, 50), // capped list for map/preview
  });
});

module.exports = router;
