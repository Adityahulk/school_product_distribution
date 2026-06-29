# Bokaro School Table-Delivery App

A lightweight web app that routes drivers delivering tables to the **485 government
schools** of Bokaro district, Jharkhand (the schools in `Bokaro_school list.pdf`).

From a driver's live GPS location it always points to the **nearest unvisited school**.
At each school the driver checks in, uploads three photos (school name board, delivery,
and certificate), and
marks it delivered. The unvisited pool is **shared across all drivers** — once anyone
delivers to a school it disappears from everyone's route. An **admin** creates driver
logins and monitors live locations, distance covered, deliveries, and photos.

## Why it exists
Drivers had no guidance on the most efficient order to visit scattered, far-apart rural
schools. This gives each driver a self-adjusting nearest-next route and gives the office
live visibility into progress.

## Coordinates (accuracy)
The PDF has no coordinates. Every school's latitude/longitude comes from the official
**UDISE+** database (via the `datameet/udise_schools` scrape), matched by 11-digit UDISE
code. All **485/485** schools matched with coordinates verified inside Bokaro's range.
These are baked into `data/schools.json` as fixed, non-editable reference data.

## Tech
- Node + Express + SQLite (`better-sqlite3`), photos stored on disk under `uploads/`.
- Frontend: plain HTML/JS + **Leaflet + OpenStreetMap** (no API key, free).
- "Navigate" opens **Google Maps** turn-by-turn directions to the next school.
- Routing: greedy nearest-neighbour by great-circle (haversine) distance.

## Run
```bash
npm install
cp .env.example .env      # then edit ADMIN_USER / ADMIN_PASS / JWT_SECRET
npm start                 # http://localhost:3000
```
Log in as admin (credentials from `.env`), create drivers, share each driver their
username/password. Drivers log in on their phones.

### ⚠️ HTTPS is required for GPS on real phones
Browsers only expose `navigator.geolocation` over **https** or **localhost**. For drivers
in the field, serve the app behind TLS — e.g. deploy on a host with HTTPS, or for quick
testing run a tunnel:
```bash
npx localtunnel --port 3000   # or: ngrok http 3000 / cloudflared tunnel
```

## Roles
- **Admin** — fixed login from `.env`. Creates/disables drivers, resets passwords, sees
  KPIs (delivered / remaining / total), per-driver km + delivery count + live location on
  a map, recent deliveries, and each delivery's three photos.
- **Driver** — login created by admin. Map of all schools (pending grey, delivered green,
  next target highlighted), the next nearest school with distance, a Navigate button, and
  Check-in (camera photos). Check-in unlocks within 300 m of the target.

## Data model (SQLite, `data/app.db`)
- `schools` — fixed seed (udise, block, name, category, tables, chairs, lat, lon).
- `drivers` — admin-created, bcrypt-hashed passwords.
- `visits` — one row per delivered school (shared "visited" state) + photos + check-in GPS.
- `driver_tracks` / `driver_distance` — GPS breadcrumbs and **server-computed** cumulative
  distance (jitter-filtered; never accepted from the client, not editable).

## Rebuild the school data (optional)
`data/schools.json` is committed and canonical. To regenerate from source:
```bash
# download + unzip the dataset, then:
node scripts/build_schools.js path/to/udise_schools.csv
```
It matches against `data/school_meta.json` (the PDF-derived metadata) and refuses to write
unless all 485 schools resolve with in-range coordinates.

## Notes / limits
- Distances use straight-line great-circle for ordering; real driving distance is handled
  by the Google Maps Navigate hand-off.
- A school can be delivered once (enforced with a UNIQUE constraint + race handling).
