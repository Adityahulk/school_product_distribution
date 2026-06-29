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

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const udise = (req.body.udise || 'unknown').replace(/[^0-9A-Za-z]/g, '');
    const dir = path.join(UPLOAD_ROOT, udise, 'issues');
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
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('only image uploads are allowed'));
  },
});

router.post(
  '/school-issue',
  requireDriver,
  upload.fields([{ name: 'issue_photo_1', maxCount: 1 }, { name: 'issue_photo_2', maxCount: 1 }]),
  (req, res) => {
    const { udise } = req.body;
    const remarks = String(req.body.remarks || '').trim();
    const photoOne = req.files && req.files.issue_photo_1 && req.files.issue_photo_1[0];
    const photoTwo = req.files && req.files.issue_photo_2 && req.files.issue_photo_2[0];

    const cleanup = () => {
      [photoOne, photoTwo].forEach((f) => { if (f) fs.unlink(f.path, () => {}); });
    };

    if (!udise) { cleanup(); return res.status(400).json({ error: 'udise required' }); }
    if (!photoOne) { cleanup(); return res.status(400).json({ error: 'at least one issue photo is required' }); }

    const assignedBlock = getDriverBlock(req.user.id);
    if (!assignedBlock) { cleanup(); return res.status(403).json({ error: 'driver has no assigned block' }); }

    const school = db.prepare('SELECT udise, block FROM schools WHERE udise = ?').get(udise);
    if (!school) { cleanup(); return res.status(404).json({ error: 'unknown school' }); }
    if (school.block !== assignedBlock) {
      cleanup();
      return res.status(403).json({ error: 'school is outside assigned block' });
    }

    const visited = db.prepare('SELECT id FROM visits WHERE udise = ?').get(udise);
    if (visited) { cleanup(); return res.status(409).json({ error: 'school already marked delivered' }); }

    const rel = (f) => f ? path.relative(UPLOAD_ROOT, f.path).split(path.sep).join('/') : null;
    db.prepare(`
      INSERT INTO school_holds (udise, driver_id, remarks, photo_one, photo_two)
      VALUES (?,?,?,?,?)
      ON CONFLICT(udise) DO UPDATE SET
        driver_id=excluded.driver_id,
        remarks=excluded.remarks,
        photo_one=excluded.photo_one,
        photo_two=excluded.photo_two,
        created_at=datetime('now')
    `).run(udise, req.user.id, remarks, rel(photoOne), rel(photoTwo));

    res.json({ ok: true, udise });
  }
);

module.exports = router;
