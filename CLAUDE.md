# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GPX & FIT Route Overlay is a web application for comparing GPS routes from GPX and FIT files. Users can upload multiple routes, visualize them on a map, compare metrics (elevation, speed, pace, heart rate, cadence, power, temperature, battery, GPS accuracy), and save sessions to Firebase cloud storage.

Beyond casual route comparison, the app doubles as a **Garmin hardware-tester toolkit**: a "Validate"/"Analyse" toolbar lets a tester record a run on a test watch alongside a reference watch/course and quantify GPS accuracy, sensor accuracy, and firmware self-reporting bugs numerically instead of eyeballing two overlapping polylines. See "Hardware-Tester / Validate Features" below.

## Development & Deployment

### Local Development
```bash
# Serve from src directory (any static server works)
npx serve src
# or
cd src && python -m http.server 8000
```

Note: Local dev requires `src/js/config.js` with Firebase and Google Maps API keys — the app won't initialize without it. Copy `config.example.js` and fill in credentials. This file is gitignored.

### Deployment (Railway/Nixpacks)
The app deploys via nixpacks.toml:
```bash
serve -s src -l $PORT
```

Pushing to `main` auto-deploys to Railway.

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

- **`FileParser.js`** - Parses GPX (XML) and FIT (binary) files. Extracts coordinates, timestamps, metrics, running dynamics, battery data (including raw binary scanner for FIT message type 104), GPS vs barometric elevation, and temperature.

- **`FirebaseManager.js`** - Firebase initialization plus `FirebaseAuthManager` and `FirebaseStorageManager` classes for Google Auth and Firestore operations. Sessions store optional `name`, `tags` (array), and `notes` metadata.

- **`InsightsManager.js`** - Per-route "Insights" modal: effort score, split/consistency analysis, best-effort detection, HR/elevation/cadence commentary, HR and power zone breakdowns. This is runner-facing performance analysis, distinct from the hardware-tester Validate features below.

- **`ChartEventHandler.js`** - Shared zoom/pan/crosshair/drag-to-align mouse-event logic used by both `ChartManager` and the Insights modal's chart, so the two don't duplicate canvas interaction code.

- **`toast.js`** - Lightweight non-blocking toast notifications (`showToast(message, type, duration)`), replacing blocking `alert()` calls. Types: `info`, `success`, `warning`, `error`.

- **`utils.js`** - Pure calculation/formatting functions, including:
  - Distance calculations (Haversine)
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

### Hardware-Tester / Validate Features

The comparison panel's toolbar has three button groups: **Charts** (per-metric line charts), **Analyse** (Time Gap, Splits, Segment, Deviation, Distance Drift, Auto-Align, Power Curve, Dev Fields), and **Validate** (Dynamics, Session Check, HR/Cadence, Dropout, Fault Report). All of the "Analyse"/"Validate" logic lives in `app.js` `compare*`/`render*Modal` methods calling into pure `Utils.calculate*`/`Utils.detect*` functions.

- **Deviation** (`compareDeviation`) - Cross-track deviation: perpendicular distance from each route's points to the nearest segment of a reference route's polyline (mean/median/p95/max), with a map heat-map overlay.
- **Auto-Align** (`autoAlign`) - Geographically matches two routes to compute a distance offset (feeds the metric charts) and, for same-day comparisons, a time offset (feeds Time Gap/Race), with a confidence signal.
- **Distance Drift** (`compareDistanceDrift`) - Whether a device's odometer reads consistently long/short vs a reference route over time.
- **Dynamics** (`compareRunningDynamics`) - FIT running dynamics averages (vertical oscillation, ground contact time, vertical ratio, GCT balance, step length) and per-route field coverage.
- **Session Check** (`compareSessionCheck`) - A FIT route's own device-reported totals (distance/duration/ascent/descent) vs values recomputed from its raw track — a mismatch is a firmware self-reporting bug, not a GPS-accuracy question. Also derives a barometric elevation estimate from raw pressure when present.
- **HR / Cadence** (`compareHrValidation`) - Bland-Altman-style mean-absolute-error/bias between two routes' heart rate, plus cadence-lock detection (HR suspiciously tracking cadence — a classic optical-sensor failure mode).
- **Dropout** (`compareDropout`) - Recording gaps (vs the file's own typical sampling interval) and per-sensor null-value runs, excluding sensors that were never recorded at all.
- **Fault Report** (`generateFaultReport`) - Consolidates all of the above into a downloadable Markdown summary + CSV, for filing bugs with device engineers: per-metric pass/fail against `FAULT_REPORT_THRESHOLDS` (top of `app.js`, tune per test protocol), plus a raw incident log (gaps/dropouts/cadence-lock runs) with the timestamp/distance to locate them in the source file. Compares every selected route against a picked reference route (`pickReferenceRoute` - prefers a route with timestamps).

Device/firmware metadata (manufacturer, product, firmware version, serial) is parsed from FIT `file_id`/`device_info` messages into `route.device`; GPX files have no equivalent and show "Unknown".

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

## File Structure

```
src/
  index.html              # Main HTML entry point
  css/
    styles.css            # All application styles
  js/
    app.js                 # Main application logic + hardware-tester Validate/Analyse features
    Route.js               # Route class
    MapManager.js          # Google Maps wrapper
    AnimationManager.js    # Route playback
    ChartManager.js        # Metric charts (incl. dual elev, pace toggle, show zeros, dev fields)
    ChartEventHandler.js   # Shared chart zoom/pan/crosshair/drag-to-align logic
    InsightsManager.js     # Per-route runner-facing insights modal
    FileParser.js          # GPX/FIT parsing (incl. raw binary battery scanner)
    FirebaseManager.js     # Firebase auth and storage (sessions with name/tags/notes)
    utils.js               # Utility/calculation functions (incl. hardware-tester calculations)
    toast.js               # Non-blocking toast notifications
    config.js              # Credentials (gitignored)
    config.example.js      # Credentials template

tests/                     # Vitest unit tests (tests/utils/*, tests/file-parser/*) — run with `npm test`
index.html                # Legacy single-file version
nixpacks.toml             # Railway deployment configuration
.gitignore                # Excludes config.js and other sensitive files
```
