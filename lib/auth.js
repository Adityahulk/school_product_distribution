'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const COOKIE = 'session';
const SECURE = String(process.env.SECURE_COOKIES).toLowerCase() === 'true';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function setSession(res, payload) {
  res.cookie(COOKIE, sign(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

function readSession(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const s = readSession(req);
  if (!s || s.role !== 'admin') return res.status(401).json({ error: 'admin login required' });
  req.user = s;
  next();
}

function requireDriver(req, res, next) {
  const s = readSession(req);
  if (!s || s.role !== 'driver') return res.status(401).json({ error: 'driver login required' });
  req.user = s;
  next();
}

module.exports = { setSession, clearSession, readSession, requireAdmin, requireDriver, COOKIE };
