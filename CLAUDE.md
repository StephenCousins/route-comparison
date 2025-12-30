# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GPX & FIT Route Overlay is a web application for comparing GPS routes from GPX and FIT files. Users can upload multiple routes, visualize them on a map, compare metrics (elevation, speed, pace, heart rate, cadence, power), and save sessions to Firebase cloud storage.

## Development & Deployment

### Local Development
```bash
# Serve from src directory (any static server works)
npx serve src
# or
cd src && python -m http.server 8000
```

### Deployment (Railway/Nixpacks)
The app deploys via nixpacks.toml:
```bash
serve -s src -l $PORT
```

## Architecture

The application uses ES6 modules with the following structure:

### Core Modules (`src/js/`)

- **`app.js`** - Main application entry point. Initializes all managers, sets up event handlers, coordinates file uploads and route management.

- **`Route.js`** - Encapsulates route data (coordinates, elevations, speeds, timestamps, etc.) and Google Maps objects (polyline, markers). Handles map object lifecycle and closest-point calculations.

- **`MapManager.js`** - Wraps Google Maps API. Manages map initialization, route fitting, and tooltip display.

- **`AnimationManager.js`** - Handles route playback animation using timestamps. Supports variable playback speed (1x-1000x).

- **`ChartManager.js`** - Renders metric comparison charts on HTML5 Canvas. Supports zooming, crosshair tooltips, and drag-to-align for comparing routes at different offsets.

- **`FileParser.js`** - Parses GPX (XML) and FIT (binary) files. Extracts coordinates, timestamps, and metrics.

- **`FirebaseManager.js`** - Firebase initialization plus `FirebaseAuthManager` and `FirebaseStorageManager` classes for Google Auth and Firestore operations.

- **`utils.js`** - Utility functions for:
  - Distance calculations (Haversine)
  - Elevation statistics
  - Data smoothing and decimation
  - GPS data cleaning (MAD outlier detection, acceleration spike filtering, distance jump detection)
  - Formatting (distance, duration, pace, heart rate, etc.)

- **`config.js`** - Contains Firebase and Google Maps API credentials. **Not committed to git** - use `config.example.js` as template.

### Configuration

Copy `src/js/config.example.js` to `src/js/config.js` and fill in your credentials:
- Firebase config from Firebase Console
- Google Maps API key from Google Cloud Console

### Key Data Flow

1. User drops GPX/FIT files → `FileParser` extracts coordinates, timestamps, and metrics
2. `Route` objects created → Google Maps polylines rendered via `MapManager`
3. Comparison mode enables metric charts via `ChartManager`
4. Firebase integration allows saving compressed route sessions

### External Dependencies (loaded via CDN)
- Google Maps JavaScript API (with geometry library)
- Firebase SDK (Auth, Firestore, Storage)
- FIT file parser (`fit-file-parser` via esm.run)

## File Structure

```
src/
  index.html              # Main HTML entry point
  css/
    styles.css            # All application styles
  js/
    app.js                # Main application logic
    Route.js              # Route class
    MapManager.js         # Google Maps wrapper
    AnimationManager.js   # Route playback
    ChartManager.js       # Metric charts
    FileParser.js         # GPX/FIT parsing
    FirebaseManager.js    # Firebase auth and storage
    utils.js              # Utility functions
    config.js             # Credentials (gitignored)
    config.example.js     # Credentials template

index.html                # Legacy single-file version
nixpacks.toml             # Railway deployment configuration
.gitignore                # Excludes config.js and other sensitive files
```
