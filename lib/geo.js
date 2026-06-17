'use strict';

const R = 6371008.8; // Earth mean radius in metres (IUGG)

/** Great-circle distance in metres between {lat,lon} a and b. */
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Greedy nearest-neighbour ordering starting from `start`.
 * `points` is an array of objects each having lat/lon. Returns a new array of the
 * same objects, each annotated with `legMeters` (distance from previous stop) and
 * `cumMeters` (running total), in visit order.
 */
function greedyOrder(start, points) {
  const remaining = points.slice();
  const order = [];
  let cur = start;
  let cum = 0;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cur, remaining[i]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    cum += bestD;
    order.push({ ...next, legMeters: Math.round(bestD), cumMeters: Math.round(cum) });
    cur = next;
  }
  return order;
}

module.exports = { haversine, greedyOrder };
