'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireDriver } = require('../lib/auth');
const { getDriverBlock } = require('../lib/blocks');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const MAX_PHOTO_SIZE = 30 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const udise = (req.body.udise || 'unknown').replace(/[^0-9A-Za-z]/g, '');
    const dir = path.join(UPLOAD_ROOT, udise);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const stamp = Date.now();
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${file.fieldname}_${req.user.id}_${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE },
  fileFilter(req, file, cb) {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('only image uploads are allowed'));
  },
});

// POST /api/checkin (multipart)
// fields: udise, lat, lon, certificate_remarks ; files: school_photo, delivery_photo, optional certificate_photo
router.post(
  '/checkin',
  requireDriver,
  upload.fields([
    { name: 'school_photo', maxCount: 1 },
    { name: 'delivery_photo', maxCount: 1 },
    { name: 'tables_photo', maxCount: 1 }, // backward-compatible alias
    { name: 'certificate_photo', maxCount: 1 },
  ]),
  (req, res) => {
    const { udise } = req.body;
    const testMode = req.body.test_mode === '1';
    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);
    const schoolFile = req.files && req.files.school_photo && req.files.school_photo[0];
    const deliveryFile = req.files && (
      (req.files.delivery_photo && req.files.delivery_photo[0]) ||
      (req.files.tables_photo && req.files.tables_photo[0])
    );
    const certificateFile = req.files && req.files.certificate_photo && req.files.certificate_photo[0];
    const certificateRemarks = String(req.body.certificate_remarks || '').trim();

    const cleanup = () => {
      [schoolFile, deliveryFile, certificateFile].forEach((f) => { if (f) fs.unlink(f.path, () => {}); });
    };

    if (!udise) { cleanup(); return res.status(400).json({ error: 'udise required' }); }
    if (!schoolFile || !deliveryFile) {
      cleanup();
      return res.status(400).json({ error: 'school_photo and delivery_photo are required' });
    }

    const assignedBlock = getDriverBlock(req.user.id);
    if (!assignedBlock) { cleanup(); return res.status(403).json({ error: 'driver has no assigned block' }); }

    const school = db.prepare('SELECT udise, block FROM schools WHERE udise = ?').get(udise);
    if (!school) { cleanup(); return res.status(404).json({ error: 'unknown school' }); }
    if (school.block !== assignedBlock) {
      cleanup();
      return res.status(403).json({ error: 'school is outside assigned block' });
    }

    if (testMode) {
      const driver = db.prepare('SELECT can_test_mode FROM drivers WHERE id = ? AND deleted_at IS NULL').get(req.user.id);
      if (!driver || !driver.can_test_mode) {
        cleanup();
        return res.status(403).json({ error: 'test mode is not enabled for this driver' });
      }
      cleanup();
      return res.json({ ok: true, test: true, udise });
    }

    const held = db.prepare('SELECT udise FROM school_holds WHERE udise = ?').get(udise);
    if (held) { cleanup(); return res.status(409).json({ error: 'school is currently toggled off by admin' }); }

    const existing = db.prepare('SELECT id FROM visits WHERE udise = ?').get(udise);
    if (existing) { cleanup(); return res.status(409).json({ error: 'school already marked visited' }); }

    const rel = (f) => path.relative(UPLOAD_ROOT, f.path).split(path.sep).join('/');
    const finalCertificateRemarks = certificateFile
      ? certificateRemarks
      : (certificateRemarks || 'Certificate not received but tables delivered');
    try {
      db.prepare(`
        INSERT INTO visits (udise, driver_id, checkin_lat, checkin_lon, school_photo, tables_photo, certificate_photo, certificate_remarks, submitted_by)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(udise, req.user.id, Number.isFinite(lat) ? lat : null,
             Number.isFinite(lon) ? lon : null, rel(schoolFile), rel(deliveryFile),
             certificateFile ? rel(certificateFile) : null, finalCertificateRemarks, 'driver');
    } catch (e) {
      cleanup();
      // UNIQUE race: someone else just checked in.
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'school already marked visited' });
      throw e;
    }

    res.json({ ok: true, udise });
  }
);

module.exports = router;
