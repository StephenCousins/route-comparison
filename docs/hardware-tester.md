# Hardware-tester / Validate features

Moved from CLAUDE.md.

The comparison panel's toolbar has three button groups: **Charts** (per-metric line charts), **Analyse** (Time Gap, Splits, Segment, Deviation, Distance Drift, Auto-Align, Power Curve, Dev Fields), and **Validate** (Dynamics, Session Check, HR/Cadence, Dropout, Fault Report). All of the "Analyse"/"Validate" logic lives in `app.js` `compare*`/`render*Modal` methods calling into pure `Utils.calculate*`/`Utils.detect*` functions.

- **Deviation** (`compareDeviation`) - Cross-track deviation: perpendicular distance from each route's points to the nearest segment of a reference route's polyline (mean/median/p95/max), with a map heat-map overlay.
- **Auto-Align** (`autoAlign`) - Geographically matches two routes to compute a distance offset (feeds the metric charts) and, for same-day comparisons, a time offset (feeds Time Gap/Race), with a confidence signal.
- **Distance Drift** (`compareDistanceDrift`) - Whether a device's odometer reads consistently long/short vs a reference route over time.
- **Dynamics** (`compareRunningDynamics`) - FIT running dynamics averages (vertical oscillation, ground contact time, vertical ratio, GCT balance, step length) and per-route field coverage.
- **Session Check** (`compareSessionCheck`) - A FIT route's own device-reported totals (distance/duration/ascent/descent) vs values recomputed from its raw track (`stats.gpsDistance`/`stats.gpsDuration` — see "Distance Provenance") — a mismatch is a firmware self-reporting bug, not a GPS-accuracy question. Also derives a barometric elevation estimate from raw pressure when present.
- **HR / Cadence** (`compareHrValidation`) - Bland-Altman-style mean-absolute-error/bias between two routes' heart rate, plus cadence-lock detection (HR suspiciously tracking cadence — a classic optical-sensor failure mode).
- **Dropout** (`compareDropout`) - Recording gaps (vs the file's own typical sampling interval) and per-sensor null-value runs, excluding sensors that were never recorded at all.
- **Fault Report** (`generateFaultReport`) - Consolidates all of the above into a downloadable Markdown summary + CSV, for filing bugs with device engineers: per-metric pass/fail against `FAULT_REPORT_THRESHOLDS` (top of `app.js`, tune per test protocol), plus a raw incident log (gaps/dropouts/cadence-lock runs) with the timestamp/distance to locate them in the source file. Compares every selected route against a picked reference route (`pickReferenceRoute` - prefers a route with timestamps).

Device/firmware metadata (manufacturer, product, firmware version, serial) is parsed from FIT `file_id`/`device_info` messages into `route.device`; GPX files have no equivalent and show "Unknown". The fault report's Devices table also carries a **Distance Basis** column naming each route's `stats.distanceSource` — a comparison means something different when one side is the watch's own number and the other is a Haversine sum over a GPX export.

