'use strict';

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

require('./db'); // initialise + seed

const { readSession } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const schoolRoutes = require('./routes/schools');
const routeRoutes = require('./routes/route');
const locationRoutes = require('./routes/location');
const checkinRoutes = require('./routes/checkin');
const issueRoutes = require('./routes/issues');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// API
app.use('/api', authRoutes);
app.use('/api', schoolRoutes);
app.use('/api', routeRoutes);
app.use('/api', locationRoutes);
app.use('/api', checkinRoutes);
app.use('/api', issueRoutes);
app.use('/api/admin', adminRoutes);

// Delivery photos — only for logged-in users.
app.use('/uploads', (req, res, next) => {
  if (!readSession(req)) return res.status(401).send('login required');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Page guards: redirect to login if not authorised for the role.
app.get('/driver', (req, res) => {
  const s = readSession(req);
  if (!s || s.role !== 'driver') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'driver.html'));
});
app.get('/admin', (req, res) => {
  const s = readSession(req);
  if (!s || s.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Root -> login page (logged-in users are bounced client-side).
app.get('/', (req, res) => {
  const s = readSession(req);
  if (s && s.role === 'admin') return res.redirect('/admin');
  if (s && s.role === 'driver') return res.redirect('/driver');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Static frontend (login page, JS, CSS).
app.use(express.static(path.join(__dirname, 'public')));

// Multer / generic error handler -> JSON.
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Photo is too large. Please upload a photo up to 30 MB.' });
  }
  res.status(400).json({ error: err.message || 'request failed' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bokaro delivery app running on http://localhost:${PORT}`);
  console.log(`Admin login: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASS || 'admin123'}`);
});
