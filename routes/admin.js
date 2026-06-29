'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { requireAdmin } = require('../lib/auth');
const { listBlocks, isValidBlock } = require('../lib/blocks');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const udise = (req.body.udise || 'unknown').replace(/[^0-9A-Za-z]/g, '');
    const dir = path.join(UPLOAD_ROOT, udise);
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const stamp = Date.now();
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${file.fieldname}_admin_${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('only image uploads are allowed'));
  },
});

// --- Driver management ---
router.get('/blocks', requireAdmin, (req, res) => {
  res.json({ blocks: listBlocks() });
});

router.post('/drivers', requireAdmin, (req, res) => {
  const { username, password, name, assigned_block, can_test_mode } = req.body || {};
  if (!username || !password || !assigned_block) return res.status(400).json({ error: 'username, password and block required' });
  if (String(password).length < 4) return res.status(400).json({ error: 'password too short' });
  if (!isValidBlock(assigned_block)) return res.status(400).json({ error: 'unknown block' });
  const exists = db.prepare('SELECT id FROM drivers WHERE username = ? AND deleted_at IS NULL').get(username);
  if (exists) return res.status(409).json({ error: 'username already exists' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO drivers (username, password_hash, name, assigned_block, can_test_mode) VALUES (?,?,?,?,?)')
    .run(username, hash, name || username, assigned_block, can_test_mode ? 1 : 0);
  res.json({ id: info.lastInsertRowid, username, name: name || username, assigned_block, can_test_mode: !!can_test_mode });
});

router.get('/drivers', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, name, assigned_block, can_test_mode, active, created_at
    FROM drivers
    WHERE deleted_at IS NULL
    ORDER BY id
  `).all();
  for (const r of rows) {
    r.active = !!r.active;
    r.can_test_mode = !!r.can_test_mode;
  }
  res.json({ drivers: rows });
});

// Deactivate / reactivate / reset password.
router.patch('/drivers/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const driver = db.prepare('SELECT id FROM drivers WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!driver) return res.status(404).json({ error: 'driver not found' });
  const { active, password, assigned_block, can_test_mode } = req.body || {};
  if (typeof active === 'boolean') {
    db.prepare('UPDATE drivers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (password) {
    if (String(password).length < 4) return res.status(400).json({ error: 'password too short' });
    db.prepare('UPDATE drivers SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), id);
  }
  if (assigned_block) {
    if (!isValidBlock(assigned_block)) return res.status(400).json({ error: 'unknown block' });
    db.prepare('UPDATE drivers SET assigned_block = ? WHERE id = ?').run(assigned_block, id);
  }
  if (typeof can_test_mode === 'boolean') {
    db.prepare('UPDATE drivers SET can_test_mode = ? WHERE id = ?').run(can_test_mode ? 1 : 0, id);
  }
  res.json({ ok: true });
});

router.delete('/drivers/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const driver = db.prepare('SELECT id, username FROM drivers WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!driver) return res.status(404).json({ error: 'driver not found' });
  const stamp = new Date().toISOString();
  db.prepare(`
    UPDATE drivers
    SET active = 0,
        deleted_at = ?,
        username = ?
    WHERE id = ?
  `).run(stamp, `${driver.username}__deleted_${id}`, id);
  res.json({ ok: true });
});

router.post(
  '/manual-checkin',
  requireAdmin,
  upload.fields([
    { name: 'school_photo', maxCount: 1 },
    { name: 'delivery_photo', maxCount: 1 },
    { name: 'certificate_photo', maxCount: 1 },
  ]),
  (req, res) => {
    const driverId = parseInt(req.body.driver_id, 10);
    const { udise } = req.body;
    const schoolFile = req.files && req.files.school_photo && req.files.school_photo[0];
    const deliveryFile = req.files && req.files.delivery_photo && req.files.delivery_photo[0];
    const certificateFile = req.files && req.files.certificate_photo && req.files.certificate_photo[0];

    const cleanup = () => {
      [schoolFile, deliveryFile, certificateFile].forEach((f) => { if (f) require('fs').unlink(f.path, () => {}); });
    };

    if (!driverId || !udise) { cleanup(); return res.status(400).json({ error: 'driver and school required' }); }
    if (!schoolFile || !deliveryFile || !certificateFile) {
      cleanup();
      return res.status(400).json({ error: 'all three photos are required' });
    }

    const driver = db.prepare('SELECT id, assigned_block FROM drivers WHERE id = ? AND deleted_at IS NULL').get(driverId);
    if (!driver) { cleanup(); return res.status(404).json({ error: 'driver not found' }); }
    if (!driver.assigned_block) { cleanup(); return res.status(400).json({ error: 'driver has no assigned block' }); }

    const school = db.prepare('SELECT udise, block FROM schools WHERE udise = ?').get(udise);
    if (!school) { cleanup(); return res.status(404).json({ error: 'unknown school' }); }
    if (school.block !== driver.assigned_block) {
      cleanup();
      return res.status(403).json({ error: 'school is outside driver assigned block' });
    }

    const existing = db.prepare('SELECT id FROM visits WHERE udise = ?').get(udise);
    if (existing) { cleanup(); return res.status(409).json({ error: 'school already marked delivered' }); }

    const rel = (f) => path.relative(UPLOAD_ROOT, f.path).split(path.sep).join('/');
    try {
      db.prepare(`
        INSERT INTO visits (udise, driver_id, checkin_lat, checkin_lon, school_photo, tables_photo, certificate_photo, submitted_by)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(udise, driverId, null, null, rel(schoolFile), rel(deliveryFile), rel(certificateFile), 'admin');
      db.prepare('DELETE FROM school_holds WHERE udise = ?').run(udise);
    } catch (e) {
      cleanup();
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'school already marked delivered' });
      throw e;
    }

    res.json({ ok: true, udise });
  }
);

router.get('/held-schools', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT h.udise, h.driver_id, h.remarks, h.photo_one, h.photo_two, h.created_at,
           sc.name AS school_name, sc.block,
           d.name AS driver_name, d.username AS driver_username
    FROM school_holds h
    JOIN schools sc ON sc.udise = h.udise
    JOIN drivers d ON d.id = h.driver_id
    ORDER BY h.created_at DESC
  `).all();
  for (const r of rows) {
    r.photo_one_url = '/uploads/' + r.photo_one;
    r.photo_two_url = r.photo_two ? '/uploads/' + r.photo_two : null;
  }
  res.json({ schools: rows });
});

router.delete('/held-schools/:udise', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM school_holds WHERE udise = ?').run(req.params.udise);
  if (!info.changes) return res.status(404).json({ error: 'school is not toggled off' });
  res.json({ ok: true });
});

// --- Monitoring overview ---
router.get('/overview', requireAdmin, (req, res) => {
  const totalSchools = db.prepare('SELECT COUNT(*) c FROM schools').get().c;
  const totalVisited = db.prepare('SELECT COUNT(*) c FROM visits').get().c;

  const drivers = db.prepare(`
    SELECT d.id, d.username, d.name, d.assigned_block, d.can_test_mode, d.active,
      COALESCE(dd.meters, 0) AS meters,
      dd.last_lat, dd.last_lon, dd.updated_at AS last_seen,
      (SELECT COUNT(*) FROM visits v WHERE v.driver_id = d.id) AS visited_count
    FROM drivers d
    LEFT JOIN driver_distance dd ON dd.driver_id = d.id
    WHERE d.deleted_at IS NULL
    ORDER BY d.id
  `).all();

  for (const d of drivers) {
    d.km = Math.round((d.meters / 1000) * 100) / 100;
    d.active = !!d.active;
    d.can_test_mode = !!d.can_test_mode;
  }

  const blocks = db.prepare(`
    SELECT sc.block,
      COUNT(*) AS total,
      COUNT(v.id) AS delivered,
      COUNT(*) - COUNT(v.id) AS remaining
    FROM schools sc
    LEFT JOIN visits v ON v.udise = sc.udise
    GROUP BY sc.block
    ORDER BY sc.block
  `).all();

  res.json({
    totalSchools,
    totalVisited,
    remaining: totalSchools - totalVisited,
    blocks,
    drivers,
  });
});

// All visits with photo URLs and school + driver info.
router.get('/visits', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT v.id, v.udise, v.checkin_lat, v.checkin_lon, v.checkin_time,
           v.school_photo, v.tables_photo, v.certificate_photo, v.submitted_by,
           sc.name AS school_name, sc.block, sc.lat AS school_lat, sc.lon AS school_lon,
           d.username AS driver_username, d.name AS driver_name, d.id AS driver_id
    FROM visits v
    JOIN schools sc ON sc.udise = v.udise
    JOIN drivers d ON d.id = v.driver_id
    ORDER BY v.checkin_time DESC
  `).all();
  for (const r of rows) {
    r.school_photo_url = '/uploads/' + r.school_photo;
    r.delivery_photo_url = '/uploads/' + r.tables_photo;
    r.tables_photo_url = r.delivery_photo_url;
    r.certificate_photo_url = r.certificate_photo ? '/uploads/' + r.certificate_photo : null;
  }
  res.json({ visits: rows });
});

module.exports = router;
