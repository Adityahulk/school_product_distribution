'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { setSession, clearSession, readSession } = require('../lib/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // Admin: fixed credentials from env.
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  if (username === adminUser && password === adminPass) {
    setSession(res, { role: 'admin', username });
    return res.json({ role: 'admin', redirect: '/admin' });
  }

  // Driver: bcrypt-hashed password in DB.
  const driver = db.prepare('SELECT * FROM drivers WHERE username = ? AND deleted_at IS NULL').get(username);
  if (driver && driver.active && bcrypt.compareSync(password, driver.password_hash)) {
    setSession(res, {
      role: 'driver',
      id: driver.id,
      username: driver.username,
      name: driver.name,
      assigned_block: driver.assigned_block,
      can_test_mode: !!driver.can_test_mode,
    });
    return res.json({ role: 'driver', redirect: '/driver' });
  }

  return res.status(401).json({ error: 'invalid credentials' });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'not logged in' });
  if (s.role === 'driver') {
    const driver = db.prepare('SELECT assigned_block, can_test_mode FROM drivers WHERE id = ?').get(s.id);
    return res.json({
      role: s.role,
      username: s.username,
      name: s.name,
      id: s.id,
      assigned_block: driver && driver.assigned_block,
      can_test_mode: !!(driver && driver.can_test_mode),
    });
  }
  res.json({ role: s.role, username: s.username, name: s.name, id: s.id });
});

module.exports = router;
