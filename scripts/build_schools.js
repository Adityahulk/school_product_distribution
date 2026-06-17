/*
 * Rebuilds data/schools.json — the fixed reference list of the 485 Bokaro schools
 * with authoritative UDISE+ coordinates.
 *
 * Source of coordinates: datameet/udise_schools (a scrape of the official UDISE+
 * government database), matched by 11-digit UDISE code against the school list PDF.
 *
 * This script is the reproducible version of the one-time data build. It expects a
 * CSV with at least the columns: schcd, lat, lon  (the "accurate" coordinate columns).
 *
 * Usage:
 *   1. Download https://raw.githubusercontent.com/datameet/udise_schools/master/data/udise_schools.zip
 *   2. Unzip to get udise_schools.csv
 *   3. node scripts/build_schools.js path/to/udise_schools.csv path/to/codes.json
 *
 * codes.json is { "<udise>": { no, block, name, category, tables, chairs }, ... }
 * extracted from the PDF (see data/school_meta.json which is committed).
 *
 * Note: the committed data/schools.json is the canonical output. You only need to run
 * this if you want to regenerate it from scratch.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function main() {
  const csvPath = process.argv[2];
  const metaPath = process.argv[3] || path.join(__dirname, '..', 'data', 'school_meta.json');
  if (!csvPath) {
    console.error('Usage: node scripts/build_schools.js <udise_schools.csv> [school_meta.json]');
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const wanted = new Set(Object.keys(meta));
  const out = {};

  const rl = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let header = null;
  let iSchcd, iLat, iLon;
  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols;
      iSchcd = header.indexOf('schcd');
      iLat = header.indexOf('lat');
      iLon = header.indexOf('lon');
      if (iSchcd < 0 || iLat < 0 || iLon < 0) throw new Error('CSV missing schcd/lat/lon columns');
      continue;
    }
    const sc = (cols[iSchcd] || '').trim();
    if (!wanted.has(sc)) continue;
    const lat = parseFloat(cols[iLat]);
    const lon = parseFloat(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out[sc] = { ...meta[sc], udise: sc, lat: round7(lat), lon: round7(lon) };
  }

  const arr = Object.values(out).sort((a, b) => a.no - b.no);
  if (arr.length !== wanted.size) {
    throw new Error(`Matched ${arr.length}/${wanted.size} schools — refusing to write incomplete data.`);
  }
  for (const s of arr) {
    if (!(s.lat >= 23.0 && s.lat <= 24.5 && s.lon >= 85.0 && s.lon <= 87.0)) {
      throw new Error(`School ${s.udise} has out-of-range coords ${s.lat},${s.lon}`);
    }
  }
  const dest = path.join(__dirname, '..', 'data', 'schools.json');
  fs.writeFileSync(dest, JSON.stringify(arr, null, 0));
  console.log(`Wrote ${arr.length} schools to ${dest}; all coordinates valid.`);
}

function round7(n) { return Math.round(n * 1e7) / 1e7; }

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
