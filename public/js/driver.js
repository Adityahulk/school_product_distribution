'use strict';

const BOKARO = [23.67, 86.15];
const GUJARAT = { lat: 23.0225, lon: 72.5714 };
const TEST_MODE_FROM_URL = new URLSearchParams(location.search).get('test') === '1';
let map, meMarker, accuracyCircle;
let schoolLayer = L.layerGroup();
let myPos = null;          // {lat, lon}
let nextSchool = null;
let lastSentPos = null;
let routeLine = null;
let testModeAllowed = TEST_MODE_FROM_URL;

const el = (id) => document.getElementById(id);

function initMap() {
  map = L.map('map', { zoomControl: false, tap: true }).setView(BOKARO, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  schoolLayer.addTo(map);
  // Mobile: recompute map size when the screen rotates or the browser bar shows/hides.
  const fix = () => map.invalidateSize();
  window.addEventListener('orientationchange', () => setTimeout(fix, 250));
  window.addEventListener('resize', fix);
  setTimeout(fix, 300);
}

const visitedIcon = L.divIcon({ className: '', html: pin('#27ae60'), iconSize: [18, 18], iconAnchor: [9, 9] });
const pendingIcon = L.divIcon({ className: '', html: pin('#9bb0c3'), iconSize: [14, 14], iconAnchor: [7, 7] });
const targetIcon  = L.divIcon({ className: '', html: pin('#f2994a', true), iconSize: [26, 26], iconAnchor: [13, 13] });
function pin(color, big) {
  const s = big ? 22 : 12;
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${color};border:2px solid #0f1720;box-shadow:0 0 0 ${big?3:1}px ${color}66"></div>`;
}

async function loadSchools() {
  const res = await fetch('/api/schools');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    el('nextName').textContent = data.error || 'Unable to load schools.';
    el('nextMeta').textContent = '';
    return;
  }
  const data = await res.json();
  el('blockName').textContent = data.assigned_block || 'All';
  el('totalCount').textContent = data.total;
  schoolLayer.clearLayers();
  let done = 0;
  for (const s of data.schools) {
    if (s.visited) done++;
    const icon = s.visited ? visitedIcon : pendingIcon;
    L.marker([s.lat, s.lon], { icon })
      .bindPopup(`<b>${s.name}</b><br>${s.block} · ${s.tables} tables${s.visited ? '<br>✅ delivered' : ''}`)
      .addTo(schoolLayer);
  }
  el('doneCount').textContent = done;
}

async function refreshRoute() {
  if (!myPos) return;
  const res = await fetch(`/api/route/next?lat=${myPos.lat}&lon=${myPos.lon}`);
  if (!res.ok) return;
  const data = await res.json();
  if (data.done) {
    nextSchool = null;
    el('nextName').textContent = '🎉 All schools delivered!';
    el('nextMeta').textContent = '';
    el('navBtn').disabled = true;
    el('checkinBtn').disabled = true;
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    return;
  }
  nextSchool = data.next;
  if (testModeAllowed) el('testArriveBtn').disabled = false;
  const km = (nextSchool.legMeters / 1000).toFixed(2);
  el('nextName').textContent = nextSchool.name;
  el('nextMeta').textContent = `${nextSchool.block} · ${nextSchool.tables} tables · ${km} km away · ${data.remaining} schools left`;
  el('navBtn').disabled = false;
  // Enable check-in only when close (within 300 m) — prevents remote check-ins.
  const close = nextSchool.legMeters <= 300;
  el('checkinBtn').disabled = !close;
  el('checkinBtn').textContent = close ? '📷 Check in & deliver' : `📷 Get closer (${km} km)`;

  // Draw straight line me -> next target.
  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline([[myPos.lat, myPos.lon], [nextSchool.lat, nextSchool.lon]],
    { color: '#f2994a', weight: 3, dashArray: '6 6' }).addTo(map);

  // Highlight the target pin.
  L.marker([nextSchool.lat, nextSchool.lon], { icon: targetIcon, zIndexOffset: 1000 })
    .bindPopup(`<b>NEXT: ${nextSchool.name}</b><br>${nextSchool.block} · ${nextSchool.tables} tables`)
    .addTo(schoolLayer);
}

async function sendLocation() {
  if (!myPos) return;
  // Throttle: only send when moved enough or first fix.
  if (lastSentPos) {
    const dLat = Math.abs(lastSentPos.lat - myPos.lat);
    const dLon = Math.abs(lastSentPos.lon - myPos.lon);
    if (dLat < 0.0001 && dLon < 0.0001) return; // ~11m
  }
  lastSentPos = { ...myPos };
  const res = await fetch('/api/location', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(myPos),
  });
  if (res.ok) {
    const d = await res.json();
    el('distKm').textContent = (d.meters / 1000).toFixed(2);
  }
}

function setPosition(lat, lon, accuracy) {
  const first = !myPos;
  myPos = { lat, lon };
  const acc = accuracy || 0;
  if (!meMarker) {
    meMarker = L.circleMarker([myPos.lat, myPos.lon], { radius: 8, color: '#2f80ed', fillColor: '#2f80ed', fillOpacity: 1 }).addTo(map);
    accuracyCircle = L.circle([myPos.lat, myPos.lon], { radius: acc, color: '#2f80ed', opacity: .25, fillOpacity: .08 }).addTo(map);
  } else {
    meMarker.setLatLng([myPos.lat, myPos.lon]);
    accuracyCircle.setLatLng([myPos.lat, myPos.lon]).setRadius(acc);
  }
  if (first) map.setView([myPos.lat, myPos.lon], 14);
  sendLocation();
  refreshRoute();
}

function onPosition(p) {
  setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
}

function startGeo() {
  if (TEST_MODE_FROM_URL) {
    el('testPanel').hidden = false;
    setPosition(GUJARAT.lat, GUJARAT.lon, 30);
    return;
  }
  if (!('geolocation' in navigator)) {
    el('nextName').textContent = 'Geolocation not available on this device/browser.';
    return;
  }
  navigator.geolocation.watchPosition(onPosition, (e) => {
    el('nextName').textContent = 'Location blocked — enable GPS/location permission.';
    console.warn('geo error', e.message);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

// --- Navigate (Google Maps turn-by-turn) ---
el('navBtn').addEventListener('click', () => {
  if (!nextSchool) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${nextSchool.lat},${nextSchool.lon}&travelmode=driving`;
  window.open(url, '_blank');
});

el('testGujaratBtn').addEventListener('click', () => {
  if (!testModeAllowed) return;
  setPosition(GUJARAT.lat, GUJARAT.lon, 30);
});

el('testArriveBtn').addEventListener('click', () => {
  if (!testModeAllowed || !nextSchool) return;
  setPosition(nextSchool.lat, nextSchool.lon, 8);
});

// --- Check-in modal ---
const modalBg = el('modalBg');
el('checkinBtn').addEventListener('click', () => {
  if (!nextSchool) return;
  el('ciTitle').textContent = nextSchool.name;
  el('ciSub').textContent = `${nextSchool.block} · deliver ${nextSchool.tables} tables, ${nextSchool.chairs} chairs`;
  el('ciErr').textContent = '';
  el('checkinForm').reset();
  modalBg.classList.add('show');
});
el('ciCancel').addEventListener('click', () => modalBg.classList.remove('show'));

el('checkinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!nextSchool) return;
  const fd = new FormData(e.target);
  fd.append('udise', nextSchool.udise);
  if (myPos) { fd.append('lat', myPos.lat); fd.append('lon', myPos.lon); }
  el('ciSubmit').disabled = true;
  el('ciErr').textContent = '';
  try {
    const res = await fetch('/api/checkin', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { el('ciErr').textContent = data.error || 'Check-in failed'; return; }
    modalBg.classList.remove('show');
    await loadSchools();
    await refreshRoute();
  } catch (err) {
    el('ciErr').textContent = 'Upload failed — check connection.';
  } finally {
    el('ciSubmit').disabled = false;
  }
});

el('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});

// Poll so other drivers' check-ins update this route/map.
setInterval(() => { loadSchools(); refreshRoute(); }, 20000);

async function initDriver() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const me = await res.json();
      testModeAllowed = TEST_MODE_FROM_URL || !!me.can_test_mode;
      el('testPanel').hidden = !testModeAllowed;
    }
  } catch (e) {
    console.warn('profile load failed', e);
  }
  initMap();
  loadSchools();
  startGeo();
}

initDriver();
