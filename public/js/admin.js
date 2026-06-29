'use strict';

const BOKARO = [23.67, 86.15];
let map;
const schoolLayer = L.layerGroup();
const driverLayer = L.layerGroup();
const el = (id) => document.getElementById(id);

function pin(color, s) {
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${color};border:2px solid #0f1720"></div>`;
}
const visitedIcon = L.divIcon({ html: pin('#27ae60', 12), iconSize: [12, 12], iconAnchor: [6, 6] });
const pendingIcon = L.divIcon({ html: pin('#9bb0c3', 8), iconSize: [8, 8], iconAnchor: [4, 4] });
function driverIcon(label) {
  return L.divIcon({
    html: `<div style="background:#2f80ed;color:#fff;border:2px solid #0f1720;border-radius:14px;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap">🚚 ${label}</div>`,
    iconSize: [0, 0], iconAnchor: [20, 12],
  });
}

function initMap() {
  map = L.map('map').setView(BOKARO, 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  schoolLayer.addTo(map);
  driverLayer.addTo(map);
  const fix = () => map.invalidateSize();
  window.addEventListener('orientationchange', () => setTimeout(fix, 250));
  window.addEventListener('resize', fix);
  setTimeout(fix, 300);
}

let visitsByUdise = {};
let allVisits = [];
let selectedDriverId = null;
let selectedDriverName = '';
let blocks = [];

async function loadBlocks() {
  const res = await fetch('/api/admin/blocks');
  if (!res.ok) { if (res.status === 401) location.href = '/'; return; }
  const data = await res.json();
  blocks = data.blocks || [];
  el('dBlock').innerHTML = '<option value="">Select block</option>' +
    blocks.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
}

async function loadVisits() {
  const res = await fetch('/api/admin/visits');
  if (!res.ok) { if (res.status === 401) location.href = '/'; return; }
  const { visits } = await res.json();
  allVisits = visits || [];
  visitsByUdise = {};
  for (const v of allVisits) visitsByUdise[v.udise] = v;

  renderVisitList();
}

function renderVisitList() {
  const visits = selectedDriverId
    ? allVisits.filter((v) => v.driver_id === selectedDriverId)
    : allVisits.slice(0, 30);
  const header = selectedDriverId
    ? `<div class="driver-item">
        <div class="nm">${escapeHtml(selectedDriverName)}</div>
        <div class="sub">${visits.length} deliveries</div>
        <div style="margin-top:6px"><button class="secondary" style="padding:4px 8px;font-size:12px" data-clear-driver>Show all recent</button></div>
      </div>`
    : '';

  el('visitList').innerHTML = header + (visits.map((v) => `
    <div class="driver-item" style="cursor:pointer" data-udise="${v.udise}">
      <div class="nm">${escapeHtml(v.school_name)}</div>
      <div class="sub">${escapeHtml(v.block)} · by ${escapeHtml(v.driver_name)} · submitted by ${formatSubmittedBy(v.submitted_by)} · ${fmt(v.checkin_time)}</div>
    </div>`).join('') || '<p class="muted">No deliveries yet.</p>');

  const clear = el('visitList').querySelector('[data-clear-driver]');
  if (clear) clear.addEventListener('click', () => {
    selectedDriverId = null;
    selectedDriverName = '';
    renderVisitList();
  });

  el('visitList').querySelectorAll('[data-udise]').forEach((node) => {
    node.addEventListener('click', () => openPhotos(node.dataset.udise));
  });
}

async function loadSchools() {
  const res = await fetch('/api/schools');
  if (!res.ok) return;
  const data = await res.json();
  schoolLayer.clearLayers();
  for (const s of data.schools) {
    const m = L.marker([s.lat, s.lon], { icon: s.visited ? visitedIcon : pendingIcon });
    if (s.visited) {
      m.on('click', () => openPhotos(s.udise));
      m.bindPopup(`<b>${s.name}</b><br>${s.block}<br>✅ delivered — click for photos`);
    } else {
      m.bindPopup(`<b>${s.name}</b><br>${s.block} · ${s.tables} tables<br><span class="muted">pending</span>`);
    }
    m.addTo(schoolLayer);
  }
}

async function loadOverview() {
  const res = await fetch('/api/admin/overview');
  if (!res.ok) { if (res.status === 401) location.href = '/'; return; }
  const o = await res.json();
  el('kVisited').textContent = o.totalVisited;
  el('kRemaining').textContent = o.remaining;
  el('kTotal').textContent = o.totalSchools;
  el('blockList').innerHTML = (o.blocks || []).map((b) => {
    const pct = b.total ? Math.round((b.delivered / b.total) * 100) : 0;
    return `
      <div class="block-item">
        <div class="top"><span>${escapeHtml(b.block)}</span><span>${b.delivered}/${b.total}</span></div>
        <div class="sub">${b.remaining} remaining</div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  el('driverList').innerHTML = o.drivers.map((d) => `
    <div class="driver-item">
      <div class="nm"><span class="driver-name" data-driver-deliveries="${d.id}" data-driver-name="${escapeHtml(d.name || d.username)}">${escapeHtml(d.name || d.username)}</span>
        <span class="pill ${d.active ? 'on' : 'off'}">${d.active ? 'active' : 'disabled'}</span>
        <span class="pill ${d.can_test_mode ? 'on' : 'off'}">${d.can_test_mode ? 'test on' : 'test off'}</span>
      </div>
      <div class="sub">@${escapeHtml(d.username)} · ${escapeHtml(d.assigned_block || 'no block')} · ${d.visited_count} delivered · ${d.km} km
        ${d.last_seen ? '· seen ' + fmt(d.last_seen) : '· never seen'}</div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="secondary" style="padding:4px 8px;font-size:12px" data-toggle="${d.id}" data-active="${d.active}">${d.active ? 'Disable' : 'Enable'}</button>
        <button class="secondary" style="padding:4px 8px;font-size:12px" data-reset="${d.id}">Reset password</button>
        <button class="secondary" style="padding:4px 8px;font-size:12px" data-block="${d.id}">Block</button>
        <button class="secondary" style="padding:4px 8px;font-size:12px" data-test="${d.id}" data-test-active="${d.can_test_mode}">${d.can_test_mode ? 'Test off' : 'Test on'}</button>
        <button class="secondary danger" style="padding:4px 8px;font-size:12px" data-delete="${d.id}" data-delete-name="${escapeHtml(d.name || d.username)}">Delete</button>
        ${d.last_lat ? `<button class="secondary" style="padding:4px 8px;font-size:12px" data-focus="${d.last_lat},${d.last_lon}">Locate</button>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">No drivers yet.</p>';

  // Live driver markers.
  driverLayer.clearLayers();
  for (const d of o.drivers) {
    if (d.last_lat != null && d.last_lon != null) {
      L.marker([d.last_lat, d.last_lon], { icon: driverIcon(d.name || d.username), zIndexOffset: 2000 })
        .bindPopup(`<b>${d.name || d.username}</b><br>${d.km} km · ${d.visited_count} delivered<br>seen ${fmt(d.last_seen)}`)
        .addTo(driverLayer);
    }
  }

  el('driverList').querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    await fetch('/api/admin/drivers/' + b.dataset.toggle, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: b.dataset.active !== 'true' }),
    });
    loadOverview();
  }));
  el('driverList').querySelectorAll('[data-driver-deliveries]').forEach((node) => node.addEventListener('click', () => {
    selectedDriverId = Number(node.dataset.driverDeliveries);
    selectedDriverName = node.dataset.driverName || 'Driver';
    renderVisitList();
  }));
  el('driverList').querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const pw = prompt('New password for this driver:');
    if (!pw) return;
    const r = await fetch('/api/admin/drivers/' + b.dataset.reset, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    alert(r.ok ? 'Password updated.' : 'Failed to update.');
  }));
  el('driverList').querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete ${b.dataset.deleteName}? This removes the login but keeps old delivery records.`)) return;
    const r = await fetch('/api/admin/drivers/' + b.dataset.delete, { method: 'DELETE' });
    if (!r.ok) alert('Failed to delete driver.');
    if (selectedDriverId === Number(b.dataset.delete)) {
      selectedDriverId = null;
      selectedDriverName = '';
    }
    refreshAll();
  }));
  el('driverList').querySelectorAll('[data-block]').forEach((b) => b.addEventListener('click', async () => {
    const assigned_block = prompt('Assign block:\n' + blocks.join('\n'));
    if (!assigned_block) return;
    const r = await fetch('/api/admin/drivers/' + b.dataset.block, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_block }),
    });
    if (!r.ok) alert('Failed to update block.');
    loadOverview();
  }));
  el('driverList').querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
    await fetch('/api/admin/drivers/' + b.dataset.test, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ can_test_mode: b.dataset.testActive !== 'true' }),
    });
    loadOverview();
  }));
  el('driverList').querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => {
    const [la, lo] = b.dataset.focus.split(',').map(Number);
    map.setView([la, lo], 14);
  }));
}

function openPhotos(udise) {
  const v = visitsByUdise[udise];
  if (!v) return;
  el('mTitle').textContent = v.school_name;
  el('mSub').textContent = `${v.block} · UDISE ${v.udise} · driver ${v.driver_name} · submitted by ${formatSubmittedBy(v.submitted_by)} · ${fmt(v.checkin_time)}`;
  el('mSchool').src = v.school_photo_url;
  el('mDelivery').src = v.delivery_photo_url || v.tables_photo_url;
  el('mCertificate').src = v.certificate_photo_url || '';
  el('modalBg').classList.add('show');
}
el('mClose').addEventListener('click', () => el('modalBg').classList.remove('show'));

el('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('addErr').textContent = '';
  const res = await fetch('/api/admin/drivers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: el('dName').value.trim(),
      assigned_block: el('dBlock').value,
      can_test_mode: el('dTestMode').checked,
      username: el('dUser').value.trim(),
      password: el('dPass').value,
    }),
  });
  const data = await res.json();
  if (!res.ok) { el('addErr').textContent = data.error || 'Failed'; return; }
  e.target.reset();
  loadOverview();
});

el('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});

function fmt(t) {
  if (!t) return '';
  const d = new Date(t.replace(' ', 'T') + (t.includes('T') ? '' : 'Z'));
  if (isNaN(d)) return t;
  return d.toLocaleString();
}

function formatSubmittedBy(value) {
  return value === 'admin' ? 'admin' : 'driver';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function refreshAll() { loadBlocks(); loadOverview(); loadSchools(); loadVisits(); }

initMap();
refreshAll();
setInterval(() => { loadOverview(); }, 10000); // live driver locations
setInterval(() => { loadSchools(); loadVisits(); }, 30000);
