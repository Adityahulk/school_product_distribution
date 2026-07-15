'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { haversine } = require('../lib/geo');

const GODOWN = { name: 'Godown', lat: 23.6832768, lon: 86.2106908 };
const SCHOOLS_PER_DRIVER_DAY = 7;
const OUT_DIR = path.join(__dirname, '..', 'data');
const DETAIL_FILE = path.join(OUT_DIR, 'godown_daily_delivery_plan.csv');
const SUMMARY_FILE = path.join(OUT_DIR, 'godown_daily_delivery_plan_summary.csv');

const pending = db.prepare(`
  SELECT sc.udise, sc.name, sc.block, sc.lat, sc.lon,
         h.created_at AS hold_created_at, h.remarks AS hold_remarks
  FROM schools sc
  LEFT JOIN visits v ON v.udise = sc.udise
  LEFT JOIN school_holds h ON h.udise = sc.udise
  WHERE v.id IS NULL
  ORDER BY sc.block, sc.name
`).all();

const byBlock = new Map();
for (const school of pending) {
  if (!byBlock.has(school.block)) byBlock.set(school.block, []);
  byBlock.get(school.block).push(school);
}

const driversByBlock = new Map();
const drivers = db.prepare(`
  SELECT id, username, name, assigned_block
  FROM drivers
  WHERE deleted_at IS NULL
    AND active = 1
    AND assigned_block IS NOT NULL
    AND assigned_block != ''
  ORDER BY assigned_block, id
`).all();
for (const driver of drivers) {
  if (!driversByBlock.has(driver.assigned_block)) driversByBlock.set(driver.assigned_block, []);
  driversByBlock.get(driver.assigned_block).push(driver);
}

const detailRows = [[
  'Block',
  'Day',
  'Driver ID',
  'Driver Name',
  'Driver Username',
  'Stop No',
  'UDISE',
  'School Name',
  'Status',
  'Latitude',
  'Longitude',
  'Google Maps Link',
  'Leg From',
  'Leg KM',
  'Return To Godown KM',
  'Day Total KM',
  'Remarks',
]];
const summaryRows = [[
  'Block',
  'Day',
  'Driver ID',
  'Driver Name',
  'Driver Username',
  'Schools',
  'First School',
  'First UDISE',
  'Godown To First KM',
  'Last School',
  'Last UDISE',
  'Last To Godown KM',
  'Day Total KM',
]];

for (const [block, schools] of [...byBlock.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const remaining = schools.slice();
  const blockDrivers = driversByBlock.get(block) || [unassignedDriver(block)];
  let batch = 0;

  while (remaining.length) {
    const driver = blockDrivers[batch % blockDrivers.length];
    const day = Math.floor(batch / blockDrivers.length) + 1;
    const dayStops = takeGreedyDay(remaining, GODOWN, SCHOOLS_PER_DRIVER_DAY);
    let previous = GODOWN;
    let travelMeters = 0;
    const legMeters = [];

    for (const stop of dayStops) {
      const leg = haversine(previous, stop);
      legMeters.push(leg);
      travelMeters += leg;
      previous = stop;
    }

    const returnMeters = dayStops.length ? haversine(previous, GODOWN) : 0;
    const totalMeters = travelMeters + returnMeters;
    const first = dayStops[0];
    const last = dayStops[dayStops.length - 1];

    summaryRows.push([
      block,
      day,
      driver.id,
      driver.name || driver.username,
      driver.username,
      dayStops.length,
      first ? first.name : '',
      first ? first.udise : '',
      first ? km(legMeters[0]) : '',
      last ? last.name : '',
      last ? last.udise : '',
      km(returnMeters),
      km(totalMeters),
    ]);

    dayStops.forEach((stop, idx) => {
      detailRows.push([
        block,
        day,
        driver.id,
        driver.name || driver.username,
        driver.username,
        idx + 1,
        stop.udise,
        stop.name,
        stop.hold_created_at ? 'pending - toggled off/closed' : 'pending',
        stop.lat,
        stop.lon,
        mapsLink(stop),
        idx === 0 ? 'Godown' : dayStops[idx - 1].name,
        km(legMeters[idx]),
        idx === dayStops.length - 1 ? km(returnMeters) : '',
        idx === dayStops.length - 1 ? km(totalMeters) : '',
        stop.hold_remarks || '',
      ]);
    });

    batch += 1;
  }
}

fs.writeFileSync(DETAIL_FILE, toCsv(detailRows));
fs.writeFileSync(SUMMARY_FILE, toCsv(summaryRows));

const totalDays = summaryRows.length - 1;
console.log(JSON.stringify({
  godown: GODOWN,
  schoolsPerDriverDay: SCHOOLS_PER_DRIVER_DAY,
  pendingSchools: pending.length,
  blocks: byBlock.size,
  totalDriverDays: totalDays,
  detailFile: DETAIL_FILE,
  summaryFile: SUMMARY_FILE,
}, null, 2));

function takeGreedyDay(remaining, start, limit) {
  const stops = [];
  let current = start;
  while (remaining.length && stops.length < limit) {
    let bestIdx = 0;
    let bestMeters = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const meters = haversine(current, remaining[i]);
      if (meters < bestMeters) {
        bestMeters = meters;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    stops.push(next);
    current = next;
  }
  return stops;
}

function mapsLink(stop) {
  return `https://www.google.com/maps?q=${stop.lat},${stop.lon}&z=17&hl=en`;
}

function unassignedDriver(block) {
  return {
    id: '',
    username: '',
    name: `Unassigned ${block}`,
  };
}

function km(meters) {
  return (meters / 1000).toFixed(2);
}

function toCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const s = String(value == null ? '' : value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n') + '\n';
}
