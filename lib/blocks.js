'use strict';

const db = require('../db');

function listBlocks() {
  return db.prepare('SELECT DISTINCT block FROM schools ORDER BY block').all().map((r) => r.block);
}

function isValidBlock(block) {
  if (!block) return false;
  return !!db.prepare('SELECT 1 FROM schools WHERE block = ? LIMIT 1').get(block);
}

function getDriverBlock(driverId) {
  const row = db.prepare('SELECT assigned_block FROM drivers WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(driverId);
  return row && row.assigned_block;
}

module.exports = { listBlocks, isValidBlock, getDriverBlock };
