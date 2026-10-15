# Architecture

Modules, distance provenance, data flow, charts, photos, ZIP export, Activity Library, FIT parsing and CDN dependencies. Moved from CLAUDE.md.

## Architecture

The application uses ES6 modules with the following structure:

### Core Modules (`src/js/`)

- **`app.js`** - Main application entry point. Initializes all managers, sets up event handlers, coordinates file uploads, route management, photo handling, ZIP export, and the Activity Library (session save/load with name/tags/notes). Also contains all hardware-tester Validate/Analyse features.

- **`Route.js`** - Encapsulates route data (coordinates, elevations, speeds, timestamps, gpsElevations, temperatures, batteryLevels, running dynamics fields, etc.) and Google Maps objects (polyline, markers). Handles map object lifecycle and closest-point calculations.

- **`MapManager.js`** - Wraps Google Maps API. Manages map initialization, route fitting, and tooltip display.

- **`AnimationManager.js`** - Handles route playback animation using timestamps. Supports variable playback speed (1x-1000x).

- **`ChartManager.js`** - Renders metric comparison charts on HTML5 Canvas. Supports zooming, crosshair tooltips, drag-to-align, range stats, smoothing slider, and contextual toggles:
  - **Dual Elevation**: dashed GPS altitude line alongside barometric altitude (toggle appears for elevation charts when gpsElevations data differs from elevations)
  - **Show Zeros**: filters optical HR dropouts (zero values) from heart rate charts
  - **Speed/Pace toggle**: switches between speed (km/h) and pace (min/km) with correct axis inversion
  - **Dev Fields**: cycles through running dynamics (VO, GCT, VR, GCT balance, step length) — click the title to switch fields
  - **Mean Max Power**: log-scale power-duration curve
  - **Battery stats**: burn rate and estimated capacity shown in legend

  Y-axis bounds come from `Utils.niceAxisBounds`, which rounds out to whole multiples of a nice step so labels are round numbers. Per-metric rules live in `ChartManager.AXIS_OPTIONS`: speed/power/cadence/GPS accuracy snap down to 0; heart rate, pace, temperature and dev fields don't (zero isn't meaningful and would flatten the chart); battery is capped at 100% and prefers 100 as its top when within one step, so a heavy drain lands on 0-100 while a short run keeps a tight axis. Pace and time-gap axes use second-based step ladders.

- **`FileParser.js`** - Parses GPX (XML) and FIT (binary) files. Extracts coordinates, timestamps, metrics, running dynamics, battery data (including raw binary scanner for FIT message type 104), GPS vs barometric elevation, temperature, and the device's own distance odometer. See "Distance Provenance" below for how `stats.distance` is chosen.

- **`FirebaseManager.js`** - Firebase initialization plus `FirebaseAuthManager` and `FirebaseStorageManager` classes for Google Auth and Firestore operations. Sessions store optional `name`, `tags` (array), and `notes` metadata.

- **`InsightsManager.js`** - Per-route "Insights" modal: effort score, split/consistency analysis, best-effort detection, HR/elevation/cadence commentary, HR and power zone breakdowns. This is runner-facing performance analysis, distinct from the hardware-tester Validate features below.

- **`ChartEventHandler.js`** - Shared zoom/pan/crosshair/drag-to-align mouse-event logic used by both `ChartManager` and the Insights modal's chart, so the two don't duplicate canvas interaction code.

- **`toast.js`** - Lightweight non-blocking toast notifications (`showToast(message, type, duration)`), replacing blocking `alert()` calls. Types: `info`, `success`, `warning`, `error`.

- **`utils.js`** - Pure calculation/formatting functions, including:
  - Distance: `buildCumulativeDistances` is the single source of per-point distance for every distance axis and distance-indexed analysis; `calculateDistance` is the raw Haversine sum, kept only as the GPS baseline (see "Distance Provenance")
  - Elevation statistics
  - Data smoothing and decimation
  - GPS data cleaning (MAD outlier detection, acceleration spike filtering, distance jump detection)
  - Formatting (distance, duration, pace, heart rate, etc.)
  - Chart axis scaling (`niceStep`, `niceAxisBounds`, plus the `PACE_STEPS`/`TIME_STEPS`/`BATTERY_STEPS` ladders)
  - Hardware-tester calculations: cross-track deviation, auto-alignment, distance drift, running-dynamics summary, session self-check, HR comparison (Bland-Altman-style), cadence-lock detection, dropout diagnostics

- **`config.js`** - Contains Firebase and Google Maps API credentials. **Not committed to git** - use `config.example.js` as template.

### Configuration

Copy `src/js/config.example.js` to `src/js/config.js` and fill in your credentials:
- Firebase config from Firebase Console
- Google Maps API key from Google Cloud Console

### Distance Provenance

A Haversine sum over the GPS track is the *worst* available distance for a FIT file: it accumulates positional jitter as real distance, and records with no lat/lng are dropped at parse time, so a lost-fix stretch is chorded straight across. The device's own figure fuses GPS with the accelerometer/footpod, spans dropouts, and is what the watch actually displayed.

`FileParser.createRouteData` therefore picks `stats.distance` by precedence, recording which it used in `stats.distanceSource`:

1. `session.total_distance` (`'session'`) — the FIT session message
2. `record.distance` (`'record'`) — the per-point odometer, when there's no session message
3. Haversine over the track (`'gps'`) — every GPX file, and FIT files with neither

`stats.duration` follows the same shape (`session.total_elapsed_time` → track timestamps, recorded in `stats.durationSource`); `stats.movingTime` holds `total_timer_time` (elapsed minus auto-pause) and nothing is wired onto it yet. **Ascent/descent stay recomputed on purpose** — device ascent is barometric and calibrated per-device, so comparing two watches on their own numbers compares their barometers. The device figures remain on `route.sessionSummary`.

Two invariants matter:

- **`stats.gpsDistance` / `stats.gpsDuration` are always the track-derived values.** `Utils.calculateSessionCheck` measures the session totals against *these*, not against `stats.distance`/`stats.duration` — which now come from the session message, so comparing against them would report zero discrepancy on every file and silently retire the check. Sessions saved before this change stored the track-derived values under the plain names, hence the `??` fallbacks in `calculateSessionCheck` and in the session loader.
- **Per-point distance always goes through `Utils.buildCumulativeDistances(route)`.** It returns the device channel (`route.distances`, km, parallel to `coordinates`) rebased to 0 at the first plotted point, or a Haversine fallback when the channel is absent or unusable. `Utils.isUsableDistanceChannel` requires it to be complete, gap-free and monotonic, because the split finder and best-effort window search binary-search it. Never re-derive a cumulative sum inline — six copies of that loop is exactly the drift this replaced.

`route.distances` is persisted with saved sessions, compressed with the same factor as `coordinates` so the arrays stay index-parallel. The parser discards the channel outright if it disagrees with the session total by more than 25%, which is insurance against a units change in the CDN-loaded FIT parser (both fields are metres under `lengthUnit: 'm'`).

### Key Data Flow

1. User drops GPX/FIT files → `FileParser` extracts coordinates, timestamps, and metrics
2. `Route` objects created → Google Maps polylines rendered via `MapManager`
3. Comparison mode enables metric charts via `ChartManager`
4. Firebase integration allows saving compressed route sessions with name/tags/notes
5. Photos can be attached (stored client-side as data URLs, included in ZIP exports)
6. Download ZIP bundles routes as GPX + comparison CSV + photos

### Chart Features

The Charts button group in the comparison toolbar offers per-metric line charts:
- **Elevation** — with optional dashed GPS altitude overlay (toggle: "GPS Alt")
- **Speed** — with inline Pace toggle to switch units
- **Pace** — inverted Y-axis (faster = higher), with Speed toggle
- **Heart Rate** — with "Show Zeros" toggle to filter optical sensor dropouts
- **Cadence**, **Power**, **GPS Accuracy**, **Battery**, **Temperature** — standard line charts
- **Dev Fields** — cycles through running dynamics fields (VO, GCT, VR, GCT balance, step length)
- **Power Curve** — mean-max power on a log-scale duration axis

All charts support: zoom (drag to select), drag-to-align (horizontal offset), smoothing slider, and range stats (select a region for min/avg/max).

### Photos

Users can attach photos to a session via the photo drop zone in the sidebar (appears when routes are loaded). Photos are stored client-side as data URLs (max 5MB each). Features:
- Drag/drop or click to add images
- Thumbnail gallery with hover-to-remove buttons
- Lightbox viewer with prev/next navigation (Escape to close)
- Photos included in ZIP exports under `photos/` subfolder

### Download ZIP

The "Download ZIP" button in the comparison toolbar bundles:
- Each selected route as a reconstructed GPX file
- A comparison CSV (when 2+ routes selected)
- Any attached photos in a `photos/` subfolder

Uses JSZip loaded via CDN.

### Activity Library

The sessions modal ("Load Session") serves as an Activity Library:
- **Save Session modal**: name, tags (comma-separated), and notes fields
- **Tag-based folder tabs**: auto-generated from all saved session tags, click to filter
- **Search**: full-text search across names, tags, notes, and route info
- **Session cards**: display custom name (or auto-generated from route names), tag pills, truncated notes, date, and route count
- Sessions stored in Firestore with optional `name`, `tags` (array), and `notes` fields

### FIT Binary Parsing

Battery data comes from FIT message type 104 ("pad"), not from `device_info` fields (which are INVALID in most files). `FileParser.extractBatteryFromRaw(arrayBuffer)` is a raw binary scanner that:
- Parses FIT record headers and definition messages
- Targets only message type 104 (Garmin's battery snapshot message)
- Extracts field 253 (timestamp) and field 2 (battery %)
- Converts from Garmin epoch (Dec 31 1989) to JavaScript Date

Dual elevation: `enhanced_altitude` (barometric/corrected) goes to `elevations`, `altitude` (GPS-derived) goes to `gpsElevations`. The parser only keeps `gpsElevations` when >10% of points differ by >0.1m from `elevations`.

### External Dependencies (loaded via CDN)
- Google Maps JavaScript API (with geometry library)
- Firebase SDK (Auth, Firestore, Storage)
- FIT file parser (`fit-file-parser` via esm.run)
- JSZip (for ZIP export)

