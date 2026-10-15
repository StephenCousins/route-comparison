# CLAUDE.md

GPX & FIT Route Overlay: a static web app (vanilla ES6 modules in `src/js/`, no build step) for comparing GPS routes
from GPX and FIT files on a Google Map, charting metrics (elevation, speed, pace, HR, cadence, power, temperature,
battery, GPS accuracy) and saving sessions to Firebase. It doubles as a Garmin hardware-tester toolkit: the Analyse and
Validate toolbar groups quantify GPS accuracy, sensor accuracy and firmware self-reporting bugs between a test watch and
a reference. Hosted on Railway.

## Commands

```bash
npx serve src            # local dev (or: cd src && python -m http.server 8000)
npm test                 # Vitest, tests/utils/* and tests/file-parser/*
npm run lint             # also lint:fix, format, format:check
```

Local dev needs `src/js/config.js` (gitignored) with Firebase and Google Maps keys; copy `src/js/config.example.js`.
`start.sh` generates it from `FIREBASE_*` and `GOOGLE_MAPS_API_KEY` env vars, though `nixpacks.toml` starts
`serve -s src -l $PORT` directly. Pushing to `main` auto-deploys to Railway. Google Maps, Firebase, `fit-file-parser`
(esm.run) and JSZip all load from CDNs.

## Rules and traps

- `stats.distance` is chosen by precedence: FIT `session.total_distance`, then per-record `record.distance`, then a
  Haversine sum (every GPX file). `stats.distanceSource` records which. A Haversine sum is the worst figure for a FIT
  file, so don't promote it.
- `stats.gpsDistance` / `stats.gpsDuration` are always track-derived. `Utils.calculateSessionCheck` must compare the
  session totals against these, not `stats.distance`, or it reports zero discrepancy on every file. The `??` fallbacks
  are for sessions saved before the change.
- Per-point distance always goes through `Utils.buildCumulativeDistances(route)`. Never re-derive a cumulative sum
  inline.
- Ascent and descent are recomputed on purpose: device ascent is barometric and per-device calibrated.
- Battery comes from FIT message type 104, read by the raw binary scanner `FileParser.extractBatteryFromRaw`;
  `device_info` battery fields are invalid in most files.
- Chart y-axis rules are per metric in `ChartManager.AXIS_OPTIONS` via `Utils.niceAxisBounds`; HR, pace, temperature
  and dev fields deliberately don't snap to 0.
- Fault-report thresholds are `FAULT_REPORT_THRESHOLDS` at the top of `app.js`, tuned per test protocol.

## Where to find more

- `docs/architecture.md`: every module, the full distance-provenance reasoning and invariants, data flow, chart
  features, photos, ZIP export, Activity Library, FIT binary parsing. Read before touching `FileParser`, `utils.js` or
  `ChartManager`.
- `docs/hardware-tester.md`: each Analyse/Validate feature, the fault report, device metadata. Read before changing a
  `compare*` method.
- `SUPABASE_MIGRATION_PLAN.md`, `CODE_ANALYSIS.md`: older plans and analysis at the repo root.
