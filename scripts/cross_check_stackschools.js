'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { haversine } = require('../lib/geo');

const SCHOOLS_FILE = path.join(__dirname, '..', 'data', 'schools.json');
const OUT_FILE = path.join(__dirname, '..', 'data', 'stackschools_location_crosscheck.csv');
const BASE_URL = 'https://stackschools.com/schools/';

const schools = JSON.parse(fs.readFileSync(SCHOOLS_FILE, 'utf8'));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const rows = [];
  let done = 0;
  for (const school of schools) {
    done += 1;
    const url = BASE_URL + encodeURIComponent(school.udise) + '/';
    try {
      const html = await fetchText(url);
      const stack = extractStackSchool(html);
      if (!stack) {
        rows.push({ school, url, status: 'missing coordinate' });
      } else {
        const distanceMeters = haversine(
          { lat: school.lat, lon: school.lon },
          { lat: stack.lat, lon: stack.lon }
        );
        rows.push({
          school,
          url,
          status: distanceMeters > 300 ? 'review' : 'ok',
          stackName: stack.name,
          stackLat: stack.lat,
          stackLon: stack.lon,
          distanceKm: distanceMeters / 1000,
        });
      }
    } catch (err) {
      rows.push({ school, url, status: 'fetch failed', error: err.message });
    }

    if (done % 25 === 0) console.log(`Checked ${done}/${schools.length}`);
    await sleep(40);
  }

  rows.sort((a, b) => (b.distanceKm || -1) - (a.distanceKm || -1));
  writeCsv(rows);

  const review = rows.filter((r) => r.status === 'review');
  const failed = rows.filter((r) => r.status !== 'ok' && r.status !== 'review');
  console.log(JSON.stringify({
    checked: rows.length,
    review: review.length,
    failed: failed.length,
    output: OUT_FILE,
    worst: rows.slice(0, 10).map((r) => ({
      udise: r.school.udise,
      name: r.school.name,
      block: r.school.block,
      distanceKm: r.distanceKm == null ? null : Number(r.distanceKm.toFixed(3)),
      status: r.status,
    })),
  }, null, 2));
}

function extractStackSchool(html) {
  const coord = html.match(/query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!coord) return null;
  const title = html.match(/<title>\s*([^<]+?)\s*-\s*-\s*Stack Schools\s*<\/title>/i);
  return {
    name: title ? decodeHtml(title[1].trim()) : '',
    lat: Number(coord[1]),
    lon: Number(coord[2]),
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; school-location-crosscheck/1.0)',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchText(nextUrl).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
  });
}

function writeCsv(rows) {
  const out = [[
    'status',
    'distance_km',
    'udise',
    'block',
    'project_school_name',
    'stackschools_name',
    'project_lat',
    'project_lon',
    'stackschools_lat',
    'stackschools_lon',
    'project_google_maps',
    'stackschools_google_maps',
    'stackschools_url',
    'error',
  ]];

  for (const r of rows) {
    out.push([
      r.status,
      r.distanceKm == null ? '' : r.distanceKm.toFixed(3),
      r.school.udise,
      r.school.block,
      r.school.name,
      r.stackName || '',
      r.school.lat,
      r.school.lon,
      r.stackLat || '',
      r.stackLon || '',
      mapsLink(r.school.lat, r.school.lon),
      r.stackLat && r.stackLon ? mapsLink(r.stackLat, r.stackLon) : '',
      r.url,
      r.error || '',
    ]);
  }

  fs.writeFileSync(OUT_FILE, out.map((row) => row.map(csvCell).join(',')).join('\n') + '\n');
}

function mapsLink(lat, lon) {
  return `https://www.google.com/maps?q=${lat},${lon}&z=17&hl=en`;
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
