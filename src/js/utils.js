// Utility functions for GPX Route Overlay

export const Utils = {
    colors: [
        '#EA4335', '#4285F4', '#FBBC04', '#34A853', '#FF6D00', '#46BDC6',
        '#7B1FA2', '#C2185B', '#00BCD4', '#8BC34A', '#FF5722', '#9C27B0',
        '#03A9F4', '#FFEB3B', '#E91E63', '#00ACC1', '#7CB342', '#F57C00',
        '#5E35B1', '#D81B60'
    ],

    haversineDistance(coord1, coord2) {
        const R = 6371;
        const dLat = this.toRad(coord2.lat - coord1.lat);
        const dLon = this.toRad(coord2.lng - coord1.lng);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.toRad(coord1.lat)) * Math.cos(this.toRad(coord2.lat)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    toRad(deg) {
        return deg * (Math.PI / 180);
    },

    calculateDistance(coords) {
        let totalDistance = 0;
        for (let i = 1; i < coords.length; i++) {
            totalDistance += this.haversineDistance(coords[i-1], coords[i]);
        }
        return totalDistance;
    },

    calculateElevationStats(elevations, options = {}) {
        if (!elevations || elevations.length === 0) {
            return { gain: 0, loss: 0, min: 0, max: 0 };
        }

        const validElevations = elevations.filter(e => e !== null && !isNaN(e));
        if (validElevations.length === 0) {
            return { gain: 0, loss: 0, min: 0, max: 0 };
        }

        let min = validElevations[0], max = validElevations[0];
        for (const e of validElevations) {
            if (e < min) min = e;
            if (e > max) max = e;
        }

        const { gain, loss } = this.calculateElevationChange(elevations, 0, elevations.length - 1, options);
        return { gain, loss, min, max };
    },

    // Shared by calculateElevationStats and the per-split/segment gain/loss
    // helpers below. GPS/barometric elevation is noisy enough that summing
    // every raw point-to-point delta (the old approach) counts small jitter
    // as real climbing — a genuinely flat route can report tens of meters of
    // "gain" from noise alone. Smooth first (median filter, robust against
    // isolated spike readings), then only accumulate gain/loss once movement
    // away from the last reference point clears a deadband threshold — the
    // standard technique GPS platforms use so noise can't masquerade as
    // elevation change. Smoothing runs over the FULL array before slicing to
    // [startIdx, endIdx], so a window near a split boundary still has real
    // neighboring context instead of an artificial edge.
    calculateElevationChange(elevations, startIdx, endIdx, options = {}) {
        if (!elevations || startIdx > endIdx) return { gain: 0, loss: 0 };

        const threshold = options.threshold ?? 3; // meters
        const smoothed = this.rollingMedian(elevations, 5);

        let gain = 0, loss = 0;
        let reference = null;
        for (let i = startIdx; i <= endIdx; i++) {
            const value = smoothed[i];
            if (value === null || value === undefined || isNaN(value)) continue;
            if (reference === null) {
                reference = value;
                continue;
            }
            const diff = value - reference;
            if (Math.abs(diff) >= threshold) {
                if (diff > 0) gain += diff;
                else loss += Math.abs(diff);
                reference = value;
            }
        }
        return { gain, loss };
    },

    formatDistance(km) {
        return km >= 1 ? `${km.toFixed(2)} km` : `${(km * 1000).toFixed(0)} m`;
    },

    formatElevation(m) {
        return `${Math.round(m)} m`;
    },

    formatDeviation(m) {
        if (m === null || m === undefined || isNaN(m)) return 'N/A';
        return `${Math.round(m)} m`;
    },

    formatDuration(seconds) {
        if (!seconds) return 'N/A';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.round(seconds % 60);
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        } else if (mins > 0) {
            return `${mins}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    },

    formatBreakDuration(seconds) {
        if (!seconds) return 'N/A';
        if (seconds < 60) {
            return `${Math.round(seconds)} seconds`;
        } else {
            const mins = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    },

    formatHeartRate(bpm) {
        return (!bpm || isNaN(bpm)) ? 'N/A' : `${Math.round(bpm)} bpm`;
    },

    formatPace(minPerKm) {
        if (minPerKm === null || minPerKm === undefined || isNaN(minPerKm) || !isFinite(minPerKm) || minPerKm <= 0 || minPerKm > 20) {
            return 'N/A';
        }
        const mins = Math.floor(minPerKm);
        const secs = Math.round((minPerKm - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')} /km`;
    },

    formatCadence(spm) {
        return (!spm || isNaN(spm)) ? 'N/A' : `${Math.round(spm)} spm`;
    },

    smoothData(data, windowSize = 20) {
        if (data.length < windowSize) return data;
        const smoothed = [];
        for (let i = 0; i < data.length; i++) {
            const start = Math.max(0, i - Math.floor(windowSize / 2));
            const end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
            let sum = 0, count = 0;
            for (let j = start; j < end; j++) {
                if (data[j] !== null && data[j] !== undefined) {
                    sum += data[j];
                    count++;
                }
            }
            smoothed.push(count > 0 ? sum / count : data[i]);
        }
        return smoothed;
    },

    decimateData(data, distances, factor = 20) {
        if (data.length <= factor * 2) return { data, distances };
        const decimatedData = [data[0]];
        const decimatedDistances = [distances[0]];
        for (let i = factor; i < data.length - 1; i += factor) {
            decimatedData.push(data[i]);
            decimatedDistances.push(distances[i]);
        }
        decimatedData.push(data[data.length - 1]);
        decimatedDistances.push(distances[distances.length - 1]);
        return { data: decimatedData, distances: decimatedDistances };
    },

    getAdaptiveSmoothingParams(totalDistanceKm) {
        if (totalDistanceKm < 10) return { windowSize: 50, decimationFactor: 5 };
        if (totalDistanceKm < 25) return { windowSize: 100, decimationFactor: 10 };
        if (totalDistanceKm < 50) return { windowSize: 200, decimationFactor: 15 };
        if (totalDistanceKm < 100) return { windowSize: 300, decimationFactor: 25 };
        return { windowSize: 500, decimationFactor: 50 };
    },

    // Advanced GPS Filtering Functions
    median(arr) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    },

    percentile(arr, p) {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        const weight = index - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    },

    calculateMAD(arr) {
        if (!arr || arr.length === 0) return { median: null, mad: null };
        const med = this.median(arr);
        const deviations = arr.map(val => Math.abs(val - med));
        const mad = this.median(deviations);
        return { median: med, mad: mad };
    },

    filterOutliersIQR(data, multiplier = 1.5) {
        if (!data || data.length < 4) return data;

        const sorted = [...data].sort((a, b) => a - b);
        const q1Index = Math.floor(sorted.length * 0.25);
        const q3Index = Math.floor(sorted.length * 0.75);
        const q1 = sorted[q1Index];
        const q3 = sorted[q3Index];
        const iqr = q3 - q1;

        const lowerBound = q1 - (multiplier * iqr);
        const upperBound = q3 + (multiplier * iqr);

        return data.filter(val => val >= lowerBound && val <= upperBound);
    },

    filterOutliersMAD(data, threshold = 3) {
        if (!data || data.length < 4) return data;

        const { median, mad } = this.calculateMAD(data);
        if (mad === 0) return data;

        return data.filter(val => {
            const modifiedZScore = 0.6745 * Math.abs(val - median) / mad;
            return modifiedZScore <= threshold;
        });
    },

    filterAccelerationSpikes(speeds, timestamps, maxAcceleration = 10) {
        if (!speeds || !timestamps || speeds.length < 2) return speeds;

        const filtered = [speeds[0]];

        for (let i = 1; i < speeds.length; i++) {
            if (!speeds[i] || !speeds[i-1] || !timestamps[i] || !timestamps[i-1]) {
                filtered.push(speeds[i]);
                continue;
            }

            const deltaSpeed = Math.abs(speeds[i] - speeds[i-1]) * (1000/3600);
            const deltaTime = (timestamps[i] - timestamps[i-1]) / 1000;

            if (deltaTime > 0) {
                const acceleration = deltaSpeed / deltaTime;

                if (acceleration > maxAcceleration) {
                    filtered.push(null);
                    continue;
                }
            }

            filtered.push(speeds[i]);
        }

        return filtered;
    },

    filterDistanceJumps(coordinates, timestamps, maxSpeedKmh = 35) {
        if (!coordinates || !timestamps || coordinates.length < 2) return coordinates.map(() => true);

        const validFlags = [true];

        for (let i = 1; i < coordinates.length; i++) {
            if (!timestamps[i] || !timestamps[i-1]) {
                validFlags.push(true);
                continue;
            }

            const distance = this.haversineDistance(coordinates[i-1], coordinates[i]) * 1000;
            const deltaTime = (timestamps[i] - timestamps[i-1]) / 1000;

            if (deltaTime > 0) {
                const impliedSpeed = (distance / deltaTime) * 3.6;

                if (impliedSpeed > maxSpeedKmh) {
                    validFlags.push(false);
                    continue;
                }
            }

            validFlags.push(true);
        }

        return validFlags;
    },

    rollingMedian(data, windowSize = 5) {
        if (!data || data.length < windowSize) return data;

        const result = [];
        const halfWindow = Math.floor(windowSize / 2);

        for (let i = 0; i < data.length; i++) {
            const start = Math.max(0, i - halfWindow);
            const end = Math.min(data.length, i + halfWindow + 1);
            const window = data.slice(start, end).filter(v => v !== null && !isNaN(v));

            if (window.length > 0) {
                result.push(this.median(window));
            } else {
                result.push(data[i]);
            }
        }

        return result;
    },

    cleanGPSData(speeds, paces, coordinates, timestamps, maxSpeed = 30) {
        const cleaned = {
            speeds: [...speeds],
            paces: [...paces],
            validIndices: []
        };

        const distanceFlags = this.filterDistanceJumps(coordinates, timestamps, maxSpeed);
        const accelFiltered = this.filterAccelerationSpikes(speeds, timestamps);

        for (let i = 0; i < speeds.length; i++) {
            if (!distanceFlags[i] || accelFiltered[i] === null) {
                cleaned.speeds[i] = null;
                cleaned.paces[i] = null;
            } else if (speeds[i] > maxSpeed || speeds[i] < 0) {
                cleaned.speeds[i] = null;
                cleaned.paces[i] = null;
            } else {
                cleaned.validIndices.push(i);
            }
        }

        return cleaned;
    },

    // Time Gap Analysis utilities. timeOffsetSeconds shifts every elapsed-time
    // value (including the route's own t=0) — used to correct for a device that
    // started recording late relative to another device on the same run. It
    // never touches route.timestamps itself, so the raw recording is preserved.
    buildTimeDistanceMap(route, timeOffsetSeconds = 0) {
        const map = { distances: [0], times: [timeOffsetSeconds] };

        if (!route.timestamps || route.timestamps.length === 0) {
            return null;
        }

        const startTime = route.timestamps[0]?.getTime();
        if (!startTime) return null;

        let cumulativeDistance = 0;

        for (let i = 1; i < route.coordinates.length; i++) {
            const dist = this.haversineDistance(route.coordinates[i-1], route.coordinates[i]);
            cumulativeDistance += dist;

            if (route.timestamps[i]) {
                const elapsedTime = (route.timestamps[i].getTime() - startTime) / 1000;
                map.distances.push(cumulativeDistance);
                map.times.push(elapsedTime + timeOffsetSeconds);
            }
        }

        return map.distances.length > 1 ? map : null;
    },

    getTimeAtDistance(map, targetDistance) {
        if (!map || map.distances.length < 2) return null;

        // If target is beyond the route, return null
        if (targetDistance > map.distances[map.distances.length - 1]) {
            return null;
        }

        // If target is at or before start, return 0
        if (targetDistance <= 0) {
            return 0;
        }

        // Binary search for the interval containing targetDistance
        let low = 0;
        let high = map.distances.length - 1;

        while (low < high - 1) {
            const mid = Math.floor((low + high) / 2);
            if (map.distances[mid] <= targetDistance) {
                low = mid;
            } else {
                high = mid;
            }
        }

        // Linear interpolation between low and high
        const d1 = map.distances[low];
        const d2 = map.distances[high];
        const t1 = map.times[low];
        const t2 = map.times[high];

        if (d2 === d1) return t1;

        const ratio = (targetDistance - d1) / (d2 - d1);
        return t1 + ratio * (t2 - t1);
    },

    // Inverse of getTimeAtDistance: cumulative distance (km) covered by the
    // given elapsed time. map.times must be monotonically increasing, which
    // buildTimeDistanceMap guarantees (chronological timestamps + a constant offset).
    getDistanceAtTime(map, targetTime) {
        if (!map || map.times.length < 2) return null;

        if (targetTime > map.times[map.times.length - 1]) {
            return null;
        }

        if (targetTime <= map.times[0]) {
            return map.distances[0];
        }

        let low = 0;
        let high = map.times.length - 1;

        while (low < high - 1) {
            const mid = Math.floor((low + high) / 2);
            if (map.times[mid] <= targetTime) {
                low = mid;
            } else {
                high = mid;
            }
        }

        const t1 = map.times[low];
        const t2 = map.times[high];
        const d1 = map.distances[low];
        const d2 = map.distances[high];

        if (t2 === t1) return d1;

        const ratio = (targetTime - t1) / (t2 - t1);
        return d1 + ratio * (d2 - d1);
    },

    // distanceOffsets (km, keyed by filename — the same Auto-Align values used
    // elsewhere) correct for the two routes' distance-0 points not being the
    // same physical location. Without this, comparing "time at distance d" is
    // comparing d on each route's OWN odometer — different physical points —
    // and applying only a time offset actively makes the gap worse rather than
    // better. d is always in the reference route's physical frame; a
    // comparison route's own distance at that physical point is d - offset.
    calculateTimeGaps(referenceRoute, comparisonRoutes, sampleInterval = 0.1, timeOffsets = {}, distanceOffsets = {}) {
        const refMap = this.buildTimeDistanceMap(referenceRoute);
        if (!refMap) return null;

        const compMaps = comparisonRoutes.map(r => ({
            route: r,
            map: this.buildTimeDistanceMap(r, timeOffsets[r.filename] || 0),
            distanceOffset: distanceOffsets[r.filename] || 0
        })).filter(c => c.map !== null);

        if (compMaps.length === 0) return null;

        // Sample as far as the reference goes, or as far as the most useful
        // comparison route reaches (whichever is shorter) — in the reference's
        // physical frame (a comp route's own max distance + its offset). Using
        // the MAX across comparison routes (not the min) means one route with
        // a bad/extreme offset — e.g. from a low-confidence Auto-Align match —
        // can't collapse the range to nothing for every other selected route;
        // that one route just stops contributing points past its own range,
        // same as any route that's genuinely shorter than the others.
        const refMaxDist = refMap.distances[refMap.distances.length - 1];
        const compMaxDistances = compMaps.map(c =>
            c.map.distances[c.map.distances.length - 1] + c.distanceOffset
        );
        const maxDist = Math.min(refMaxDist, Math.max(0, ...compMaxDistances));

        // Sample at regular intervals
        const gaps = [];
        for (let d = 0; d <= maxDist; d += sampleInterval) {
            const refTime = this.getTimeAtDistance(refMap, d);
            if (refTime === null) continue;

            const point = {
                distance: d,
                referenceTime: refTime,
                comparisons: []
            };

            compMaps.forEach(c => {
                const compTime = this.getTimeAtDistance(c.map, d - c.distanceOffset);
                if (compTime !== null) {
                    point.comparisons.push({
                        route: c.route,
                        time: compTime,
                        gap: compTime - refTime  // Positive = behind, Negative = ahead
                    });
                }
            });

            if (point.comparisons.length > 0) {
                gaps.push(point);
            }
        }

        return {
            referenceRoute,
            gaps,
            maxDistance: maxDist
        };
    },

    // Distance Drift: cumulative-distance difference between routes sampled at
    // equal elapsed time (the mirror image of calculateTimeGaps, which samples
    // at equal distance). A device that reads consistently long/short shows up
    // as a steadily diverging drift line rather than a flat one.
    //
    // distanceOffsets (km, keyed by filename — the same values Auto-Align seeds
    // into ChartManager.routeOffsets) correct for the two routes' distance-0
    // points not being the same physical location (different GPS-lock timing,
    // or a route that started recording partway into the run). Without this,
    // any such gap reads as constant "drift" and swamps genuine odometer error.
    calculateDistanceDrift(referenceRoute, comparisonRoutes, sampleInterval = 10, timeOffsets = {}, distanceOffsets = {}) {
        const refMap = this.buildTimeDistanceMap(referenceRoute);
        if (!refMap) return null;

        const compMaps = comparisonRoutes.map(r => ({
            route: r,
            map: this.buildTimeDistanceMap(r, timeOffsets[r.filename] || 0)
        })).filter(c => c.map !== null);

        if (compMaps.length === 0) return null;

        // A timeOffsetSeconds shift means a route's map may not start at t=0 —
        // sample from the latest start to the earliest end across all routes.
        const startTimes = [refMap.times[0]];
        const endTimes = [refMap.times[refMap.times.length - 1]];
        compMaps.forEach(c => {
            startTimes.push(c.map.times[0]);
            endTimes.push(c.map.times[c.map.times.length - 1]);
        });
        const startTime = Math.max(...startTimes);
        const endTime = Math.min(...endTimes);

        const drifts = [];
        for (let t = startTime; t <= endTime; t += sampleInterval) {
            const refDistance = this.getDistanceAtTime(refMap, t);
            if (refDistance === null) continue;

            const point = { time: t, referenceDistance: refDistance, comparisons: [] };

            compMaps.forEach(c => {
                const rawDistance = this.getDistanceAtTime(c.map, t);
                if (rawDistance !== null) {
                    const distance = rawDistance + (distanceOffsets[c.route.filename] || 0);
                    point.comparisons.push({
                        route: c.route,
                        distance,
                        drift: distance - refDistance // Positive = reads long, Negative = reads short
                    });
                }
            });

            if (point.comparisons.length > 0) {
                drifts.push(point);
            }
        }

        return { referenceRoute, drifts, startTime, endTime };
    },

    // Cross-Track Deviation (GPS accuracy testing): perpendicular distance from
    // each testRoute point to the nearest segment of referenceRoute's polyline.
    // Uses a sequential local-window search (consecutive test points project to
    // nearby reference segments) with a grid-indexed broad search as a fallback
    // when the window search "loses" the thread — keeps the common case near
    // O(n) instead of the O(n*m) a naive full scan per point would cost.
    calculateCrossTrackDeviation(testRoute, referenceRoute, options = {}) {
        const WINDOW = options.window ?? 40;
        const LOST_THRESHOLD_M = options.lostThresholdM ?? 150;
        const MAX_MATCH_M = options.maxMatchM ?? 500;
        const GRID_CELL_DEG = 0.001; // ~110m at the equator

        const refCoords = referenceRoute.coordinates;
        if (!refCoords || refCoords.length < 2 || !testRoute.coordinates || testRoute.coordinates.length === 0) {
            return null;
        }

        // Local flat-Earth projection centered on the reference route's start —
        // accurate enough at single-course scale (<0.1% error under ~50km) and
        // far cheaper than per-segment great-circle math.
        const origin = refCoords[0];
        const mPerDegLat = 110540;
        const mPerDegLng = 111320 * Math.cos(this.toRad(origin.lat));
        const project = (coord) => ({
            x: (coord.lng - origin.lng) * mPerDegLng,
            y: (coord.lat - origin.lat) * mPerDegLat
        });

        const refPoints = refCoords.map(project);
        const refCumDist = this.buildCumulativeDistances(referenceRoute);

        // Coarse spatial grid over the reference route, consulted only when the
        // local window search is lost (course diverges, GPS gap, loop/out-and-back).
        const grid = new Map();
        const cellKey = (lat, lng) => `${Math.round(lat / GRID_CELL_DEG)},${Math.round(lng / GRID_CELL_DEG)}`;
        refCoords.forEach((coord, i) => {
            const key = cellKey(coord.lat, coord.lng);
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(i);
        });

        const distanceToSegment = (p, a, b) => {
            const abx = b.x - a.x, aby = b.y - a.y;
            const lenSq = abx * abx + aby * aby;
            let t = lenSq > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const dx = p.x - (a.x + t * abx);
            const dy = p.y - (a.y + t * aby);
            return { distance: Math.sqrt(dx * dx + dy * dy), t };
        };

        const bestInRange = (p, startIdx, endIdx) => {
            let best = { distance: Infinity, refSegmentIndex: Math.max(0, startIdx), t: 0 };
            const lo = Math.max(0, startIdx);
            const hi = Math.min(refPoints.length - 2, endIdx);
            for (let j = lo; j <= hi; j++) {
                const { distance, t } = distanceToSegment(p, refPoints[j], refPoints[j + 1]);
                if (distance < best.distance) {
                    best = { distance, refSegmentIndex: j, t };
                }
            }
            return best;
        };

        let refPointer = 0;
        const perPointDeviations = [];
        const matchedRefIndex = [];
        // Distance-along-reference (km) interpolated within the matched segment
        // via its projection parameter t — more precise than refCumDist[matchedRefIndex]
        // alone, which would floor to the segment's start point.
        const matchedRefDistance = [];

        testRoute.coordinates.forEach((testCoord) => {
            const p = project(testCoord);
            let best = bestInRange(p, refPointer - WINDOW, refPointer + WINDOW);

            if (best.distance > LOST_THRESHOLD_M) {
                const key = cellKey(testCoord.lat, testCoord.lng);
                const [gLat, gLng] = key.split(',').map(Number);
                const candidateIndices = new Set();
                for (let dLat = -1; dLat <= 1; dLat++) {
                    for (let dLng = -1; dLng <= 1; dLng++) {
                        const neighbours = grid.get(`${gLat + dLat},${gLng + dLng}`);
                        if (neighbours) neighbours.forEach(i => candidateIndices.add(i));
                    }
                }
                let broadBest = { distance: Infinity, refSegmentIndex: refPointer, t: 0 };
                candidateIndices.forEach(i => {
                    const cand = bestInRange(p, i - 1, i + 1);
                    if (cand.distance < broadBest.distance) broadBest = cand;
                });
                if (broadBest.distance < best.distance) best = broadBest;
            }

            if (best.distance > MAX_MATCH_M) {
                perPointDeviations.push(null);
                matchedRefIndex.push(null);
                matchedRefDistance.push(null);
            } else {
                perPointDeviations.push(best.distance);
                matchedRefIndex.push(best.refSegmentIndex);
                const segStart = refCumDist[best.refSegmentIndex];
                const segEnd = refCumDist[best.refSegmentIndex + 1];
                matchedRefDistance.push(segStart + best.t * (segEnd - segStart));
                refPointer = best.refSegmentIndex;
            }
        });

        const confident = perPointDeviations.filter(d => d !== null);
        const stats = confident.length > 0 ? {
            mean: confident.reduce((a, b) => a + b, 0) / confident.length,
            median: this.median(confident),
            p95: this.percentile(confident, 95),
            max: Math.max(...confident)
        } : { mean: null, median: null, p95: null, max: null };

        return { perPointDeviations, matchedRefIndex, matchedRefDistance, refCumDist, stats };
    },

    // Auto-Alignment: derives two independent corrections between testRoute and
    // referenceRoute by geographically matching an "anchor window" near the
    // start of testRoute (50m-250m in, skipping noisy start-line GPS wander).
    //  - distanceOffsetKm: for distance-indexed views (the metric charts).
    //  - timeOffsetSeconds: for elapsed-time-indexed views (Time Gap, Race) —
    //    only computed when both routes' start timestamps are close enough in
    //    real time to plausibly be the same run (see sameDayComparison).
    // Never mutates testRoute/referenceRoute — callers apply the offsets externally.
    calculateAutoAlignment(testRoute, referenceRoute, options = {}) {
        const ANCHOR_MIN_KM = options.anchorMinKm ?? 0.05;
        const ANCHOR_MAX_KM = options.anchorMaxKm ?? 0.25;
        const CONFIDENT_MATCH_M = options.confidentMatchM ?? 75;
        const SAME_RUN_HOURS = options.sameRunHours ?? 6;

        const deviation = this.calculateCrossTrackDeviation(testRoute, referenceRoute, options);
        if (!deviation) return null;

        const { perPointDeviations, matchedRefIndex, matchedRefDistance, refCumDist, stats } = deviation;
        const testCumDist = this.buildCumulativeDistances(testRoute);

        const anchorIndices = [];
        for (let i = 0; i < testRoute.coordinates.length; i++) {
            const d = testCumDist[i];
            if (d < ANCHOR_MIN_KM || d > ANCHOR_MAX_KM) continue;
            if (perPointDeviations[i] === null || perPointDeviations[i] > CONFIDENT_MATCH_M) continue;
            anchorIndices.push(i);
        }

        // Confidence signal — computed regardless of whether an anchor window
        // was found, so the UI can explain a low-confidence/no-match result.
        const total = perPointDeviations.length;
        const confidentValues = perPointDeviations.filter(d => d !== null && d < CONFIDENT_MATCH_M);
        const coverage = total > 0 ? confidentValues.length / total : 0;
        const avgDeviation = confidentValues.length > 0
            ? confidentValues.reduce((a, b) => a + b, 0) / confidentValues.length
            : null;

        const matchedIndices = matchedRefIndex.filter(i => i !== null);
        const refPointCount = refCumDist.length;
        const overlapFraction = matchedIndices.length > 0 && refPointCount > 1
            ? (Math.max(...matchedIndices) - Math.min(...matchedIndices)) / (refPointCount - 1)
            : 0;

        // Monotonicity guard: a loop/out-and-back course produces a matchedRefIndex
        // sequence that reverses direction at the turnaround — a small number of
        // reversals is normal GPS noise, a large number means the match is ambiguous.
        let reversals = 0;
        let lastDir = 0;
        let lastIdx = null;
        matchedRefIndex.forEach((idx) => {
            if (idx === null) return;
            if (lastIdx !== null) {
                const dir = Math.sign(idx - lastIdx);
                if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals++;
                if (dir !== 0) lastDir = dir;
            }
            lastIdx = idx;
        });
        const monotonic = reversals <= Math.max(1, Math.floor(total * 0.01));

        let level;
        if (!monotonic) {
            level = 'low';
        } else if (coverage > 0.9 && avgDeviation !== null && avgDeviation < 15 && overlapFraction > 0.8) {
            level = 'high';
        } else if (coverage > 0.6 && avgDeviation !== null && avgDeviation < 40) {
            level = 'medium';
        } else {
            level = 'low';
        }

        const confidence = { level, coverage, avgDeviation, overlapFraction, monotonic, deviationStats: stats };

        if (anchorIndices.length === 0) {
            return { distanceOffsetKm: null, timeOffsetSeconds: null, sameDayComparison: false, confidence };
        }

        const distanceDiffs = anchorIndices.map(i => matchedRefDistance[i] - testCumDist[i]);
        const distanceOffsetKm = this.median(distanceDiffs);

        // Only compute a time-offset when the two starts are close enough in
        // real time to plausibly be the same run (same-day late start), not a
        // different-day comparison where Race/Time-Gap head-to-head timing
        // isn't a meaningful concept.
        let timeOffsetSeconds = null;
        let sameDayComparison = false;
        const refStart = referenceRoute.timestamps?.[0];
        const testStart = testRoute.timestamps?.[0];
        if (refStart && testStart) {
            const hoursApart = Math.abs(refStart.getTime() - testStart.getTime()) / 3600000;
            sameDayComparison = hoursApart < SAME_RUN_HOURS;
        }

        if (sameDayComparison) {
            const refMap = this.buildTimeDistanceMap(referenceRoute);
            const testMap = this.buildTimeDistanceMap(testRoute);
            if (refMap && testMap) {
                const timeDiffs = [];
                anchorIndices.forEach((i) => {
                    const testElapsed = this.getTimeAtDistance(testMap, testCumDist[i]);
                    const refElapsed = this.getTimeAtDistance(refMap, matchedRefDistance[i]);
                    if (testElapsed !== null && refElapsed !== null) {
                        timeDiffs.push(refElapsed - testElapsed);
                    }
                });
                if (timeDiffs.length > 0) {
                    timeOffsetSeconds = this.median(timeDiffs);
                }
            }
        }

        return { distanceOffsetKm, timeOffsetSeconds, sameDayComparison, confidence };
    },

    formatTimeDelta(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) return 'N/A';

        const sign = seconds >= 0 ? '+' : '-';
        const absSeconds = Math.abs(seconds);
        const mins = Math.floor(absSeconds / 60);
        const secs = Math.floor(absSeconds % 60);

        if (mins > 0) {
            return `${sign}${mins}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${sign}${secs}s`;
        }
    },

    // Split Comparison utilities
    findIndexAtDistance(distances, targetKm) {
        if (!distances || distances.length === 0) return 0;
        if (targetKm <= 0) return 0;
        if (targetKm >= distances[distances.length - 1]) return distances.length - 1;

        let low = 0;
        let high = distances.length - 1;

        while (low < high - 1) {
            const mid = Math.floor((low + high) / 2);
            if (distances[mid] <= targetKm) {
                low = mid;
            } else {
                high = mid;
            }
        }

        return low;
    },

    calculateSplitPace(route, startIdx, endIdx) {
        if (!route.timestamps || startIdx >= endIdx) return null;

        const startTime = route.timestamps[startIdx];
        const endTime = route.timestamps[endIdx];

        if (!startTime || !endTime) return null;

        const durationSeconds = (endTime - startTime) / 1000;
        if (durationSeconds <= 0) return null;

        // Calculate actual distance for this segment
        let segmentDistance = 0;
        for (let i = startIdx + 1; i <= endIdx; i++) {
            segmentDistance += this.haversineDistance(
                route.coordinates[i - 1],
                route.coordinates[i]
            );
        }

        if (segmentDistance <= 0) return null;

        // Pace in min/km
        const paceMinPerKm = (durationSeconds / 60) / segmentDistance;
        return paceMinPerKm > 0 && paceMinPerKm < 30 ? paceMinPerKm : null;
    },

    calculateSplitElevGain(elevations, startIdx, endIdx) {
        if (!elevations || startIdx >= endIdx) return 0;
        return this.calculateElevationChange(elevations, startIdx, endIdx).gain;
    },

    calculateSplitAvg(arr, startIdx, endIdx) {
        if (!arr || startIdx >= endIdx) return null;

        const segment = arr.slice(startIdx, endIdx + 1);
        const valid = segment.filter(v => v !== null && v !== undefined && !isNaN(v));

        if (valid.length === 0) return null;
        return valid.reduce((a, b) => a + b, 0) / valid.length;
    },

    calculateSplits(route, splitDistanceKm = 1.0) {
        if (!route || !route.coordinates || route.coordinates.length < 2) {
            return [];
        }

        // Build cumulative distances
        const distances = [0];
        for (let i = 1; i < route.coordinates.length; i++) {
            distances.push(
                distances[i - 1] +
                this.haversineDistance(route.coordinates[i - 1], route.coordinates[i])
            );
        }

        const totalDistance = distances[distances.length - 1];
        const splits = [];
        let splitNum = 1;
        let currentKm = 0;

        while (currentKm < totalDistance) {
            const startKm = currentKm;
            const endKm = Math.min(currentKm + splitDistanceKm, totalDistance);
            const isPartialSplit = (endKm - startKm) < splitDistanceKm * 0.9;

            // Find indices for this split
            const startIdx = this.findIndexAtDistance(distances, startKm);
            const endIdx = this.findIndexAtDistance(distances, endKm);

            // Calculate duration for this split
            let duration = null;
            if (route.timestamps && route.timestamps[startIdx] && route.timestamps[endIdx]) {
                duration = (route.timestamps[endIdx] - route.timestamps[startIdx]) / 1000; // seconds
            }

            // Calculate metrics for split
            const split = {
                number: splitNum,
                startKm: startKm,
                endKm: endKm,
                distance: endKm - startKm,
                isPartial: isPartialSplit,
                duration: duration,
                pace: this.calculateSplitPace(route, startIdx, endIdx),
                elevGain: this.calculateSplitElevGain(route.elevations, startIdx, endIdx),
                avgHR: this.calculateSplitAvg(route.heartRates, startIdx, endIdx)
            };

            splits.push(split);
            currentKm += splitDistanceKm;
            splitNum++;
        }

        return splits;
    },

    formatSplitPace(pace) {
        if (pace === null || pace === undefined || isNaN(pace) || !isFinite(pace)) {
            return 'N/A';
        }
        const mins = Math.floor(pace);
        const secs = Math.round((pace - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatSplitElevation(meters) {
        if (meters === null || meters === undefined || isNaN(meters)) {
            return 'N/A';
        }
        const rounded = Math.round(meters);
        return rounded >= 0 ? `+${rounded}m` : `${rounded}m`;
    },

    formatSplitHR(hr) {
        if (hr === null || hr === undefined || isNaN(hr)) {
            return 'N/A';
        }
        return Math.round(hr).toString();
    },

    formatSplitTime(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) {
            return 'N/A';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatSplitGap(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) {
            return '-';
        }
        const sign = seconds >= 0 ? '+' : '-';
        const absSecs = Math.abs(seconds);
        const mins = Math.floor(absSecs / 60);
        const secs = Math.round(absSecs % 60);
        if (mins > 0) {
            return `${sign}${mins}:${secs.toString().padStart(2, '0')}`;
        }
        return `${sign}${Math.round(absSecs)}s`;
    },

    // Segment Analysis utilities
    calculateSplitElevLoss(elevations, startIdx, endIdx) {
        if (!elevations || startIdx >= endIdx) return 0;
        return this.calculateElevationChange(elevations, startIdx, endIdx).loss;
    },

    calculateSegmentDuration(route, startIdx, endIdx) {
        if (!route.timestamps || startIdx >= endIdx) return null;

        const startTime = route.timestamps[startIdx];
        const endTime = route.timestamps[endIdx];

        if (!startTime || !endTime) return null;

        return (endTime - startTime) / 1000; // seconds
    },

    calculateSegmentMetrics(route, startKm, endKm) {
        if (!route || !route.coordinates || route.coordinates.length < 2) {
            return null;
        }

        // Build cumulative distances
        const distances = [0];
        for (let i = 1; i < route.coordinates.length; i++) {
            distances.push(
                distances[i - 1] +
                this.haversineDistance(route.coordinates[i - 1], route.coordinates[i])
            );
        }

        const totalDistance = distances[distances.length - 1];

        // Validate range
        if (startKm >= endKm || startKm < 0 || endKm > totalDistance) {
            return null;
        }

        // Find indices for segment boundaries
        const startIdx = this.findIndexAtDistance(distances, startKm);
        const endIdx = this.findIndexAtDistance(distances, endKm);

        if (startIdx >= endIdx) return null;

        // Calculate segment metrics
        return {
            startKm: startKm,
            endKm: endKm,
            actualDistance: distances[endIdx] - distances[startIdx],
            duration: this.calculateSegmentDuration(route, startIdx, endIdx),
            pace: this.calculateSplitPace(route, startIdx, endIdx),
            elevGain: this.calculateSplitElevGain(route.elevations, startIdx, endIdx),
            elevLoss: this.calculateSplitElevLoss(route.elevations, startIdx, endIdx),
            avgHR: this.calculateSplitAvg(route.heartRates, startIdx, endIdx),
            avgCadence: this.calculateSplitAvg(route.cadences, startIdx, endIdx),
            avgPower: this.calculateSplitAvg(route.powers, startIdx, endIdx)
        };
    },

    formatSegmentDuration(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) {
            return 'N/A';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    // Best Efforts Detection
    buildCumulativeDistances(route) {
        const distances = [0];
        for (let i = 1; i < route.coordinates.length; i++) {
            const d = this.haversineDistance(
                route.coordinates[i - 1],
                route.coordinates[i]
            );
            distances.push(distances[i - 1] + d);
        }
        return distances;
    },

    getDistanceLabel(km) {
        if (km === 21.1 || km === 21.0975) return 'Half Marathon';
        if (km === 42.195 || km === 42.2) return 'Marathon';
        if (km < 1) return `${Math.round(km * 1000)}m`;
        return `${km}km`;
    },

    calculateBestEfforts(route, distances = [1, 5, 10, 21.1, 42.195]) {
        const routeDistance = route.stats.distance;
        const validDistances = distances.filter(d => d <= routeDistance);

        if (validDistances.length === 0) return [];

        // Build cumulative distance array
        const cumulativeDistances = this.buildCumulativeDistances(route);

        const bestEfforts = [];

        for (const targetDistance of validDistances) {
            let bestPace = Infinity;
            let bestStartKm = 0;
            let bestDuration = 0;
            let bestElevGain = 0;
            let bestStartIdx = 0;
            let bestEndIdx = 0;

            // Slide window across route
            for (let i = 0; i < cumulativeDistances.length; i++) {
                const startKm = cumulativeDistances[i];
                const endKm = startKm + targetDistance;

                if (endKm > routeDistance + 0.01) break; // Small tolerance

                // Find end index using binary search
                const endIdx = this.findIndexAtDistance(cumulativeDistances, endKm);
                if (endIdx >= route.coordinates.length) continue;

                // Calculate duration for this window
                const startTime = route.timestamps[i];
                const endTime = route.timestamps[endIdx];
                if (!startTime || !endTime) continue;

                const durationSec = (endTime - startTime) / 1000;
                if (durationSec <= 0) continue;

                const pace = durationSec / 60 / targetDistance; // min/km

                if (pace < bestPace && pace > 0) {
                    bestPace = pace;
                    bestStartKm = startKm;
                    bestDuration = durationSec;
                    bestStartIdx = i;
                    bestEndIdx = endIdx;
                    bestElevGain = this.calculateSplitElevGain(
                        route.elevations, i, endIdx
                    );
                }
            }

            if (bestPace < Infinity) {
                bestEfforts.push({
                    distance: targetDistance,
                    distanceLabel: this.getDistanceLabel(targetDistance),
                    pace: bestPace,
                    duration: bestDuration,
                    startKm: bestStartKm,
                    elevGain: bestElevGain,
                    startIdx: bestStartIdx,
                    endIdx: bestEndIdx
                });
            }
        }

        return bestEfforts;
    },

    // Gradient Analysis
    calculateGrades(route) {
        if (!route.elevations || route.elevations.length < 2) {
            return [];
        }

        const grades = [];
        const distances = this.buildCumulativeDistances(route);

        for (let i = 1; i < route.coordinates.length; i++) {
            const dist = (distances[i] - distances[i - 1]) * 1000; // km to meters
            const elevChange = route.elevations[i] - route.elevations[i - 1];

            if (dist > 0) {
                grades.push({
                    grade: (elevChange / dist) * 100,
                    distance: distances[i],
                    elevChange: elevChange
                });
            } else {
                grades.push({
                    grade: 0,
                    distance: distances[i],
                    elevChange: 0
                });
            }
        }

        return grades;
    },

    detectSteepSections(route, threshold = 5, minLength = 0.05) {
        const grades = this.calculateGrades(route);
        if (grades.length === 0) return { climbs: [], descents: [] };

        const climbs = [];
        const descents = [];

        let currentSection = null;
        const distances = this.buildCumulativeDistances(route);

        for (let i = 0; i < grades.length; i++) {
            const { grade, elevChange } = grades[i];
            const distKm = distances[i + 1]; // +1 because grades array is offset by 1

            const isClimb = grade >= threshold;
            const isDescent = grade <= -threshold;

            if (isClimb || isDescent) {
                const type = isClimb ? 'climb' : 'descent';

                if (!currentSection || currentSection.type !== type) {
                    // Save previous section if valid
                    if (currentSection && currentSection.distance >= minLength) {
                        if (currentSection.type === 'climb') {
                            climbs.push(currentSection);
                        } else {
                            descents.push(currentSection);
                        }
                    }

                    // Start new section
                    currentSection = {
                        type: type,
                        startKm: distances[i],
                        endKm: distKm,
                        distance: distKm - distances[i],
                        elevChange: elevChange,
                        maxGrade: Math.abs(grade),
                        grades: [grade]
                    };
                } else {
                    // Extend current section
                    currentSection.endKm = distKm;
                    currentSection.distance = currentSection.endKm - currentSection.startKm;
                    currentSection.elevChange += elevChange;
                    currentSection.maxGrade = Math.max(currentSection.maxGrade, Math.abs(grade));
                    currentSection.grades.push(grade);
                }
            } else {
                // End current section if exists
                if (currentSection && currentSection.distance >= minLength) {
                    if (currentSection.type === 'climb') {
                        climbs.push(currentSection);
                    } else {
                        descents.push(currentSection);
                    }
                }
                currentSection = null;
            }
        }

        // Don't forget the last section
        if (currentSection && currentSection.distance >= minLength) {
            if (currentSection.type === 'climb') {
                climbs.push(currentSection);
            } else {
                descents.push(currentSection);
            }
        }

        // Calculate average grade for each section
        const finalize = (sections) => sections.map(s => ({
            type: s.type,
            startKm: s.startKm,
            endKm: s.endKm,
            distance: s.distance,
            elevChange: Math.abs(s.elevChange),
            maxGrade: s.maxGrade,
            avgGrade: Math.abs(s.grades.reduce((a, b) => a + b, 0) / s.grades.length)
        }));

        return {
            climbs: finalize(climbs),
            descents: finalize(descents)
        };
    },

    // Heatmap Color Functions
    interpolateColor(color1, color2, factor) {
        // Parse hex colors
        const r1 = parseInt(color1.slice(1, 3), 16);
        const g1 = parseInt(color1.slice(3, 5), 16);
        const b1 = parseInt(color1.slice(5, 7), 16);

        const r2 = parseInt(color2.slice(1, 3), 16);
        const g2 = parseInt(color2.slice(3, 5), 16);
        const b2 = parseInt(color2.slice(5, 7), 16);

        // Interpolate
        const r = Math.round(r1 + (r2 - r1) * factor);
        const g = Math.round(g1 + (g2 - g1) * factor);
        const b = Math.round(b1 + (b2 - b1) * factor);

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    getPaceColor(pace, minPace, maxPace) {
        // Colors: Green (fast) -> Yellow (medium) -> Red (slow)
        const GREEN = '#34A853';
        const YELLOW = '#FBBC04';
        const RED = '#EA4335';

        if (pace === null || pace === undefined || isNaN(pace)) {
            return YELLOW; // Default for invalid data
        }

        // Clamp pace to range
        const clampedPace = Math.max(minPace, Math.min(maxPace, pace));

        // Normalize to 0-1 (0 = fast/minPace, 1 = slow/maxPace)
        const normalized = (clampedPace - minPace) / (maxPace - minPace);

        // Two-stage gradient: green->yellow (0-0.5), yellow->red (0.5-1)
        if (normalized <= 0.5) {
            return this.interpolateColor(GREEN, YELLOW, normalized * 2);
        } else {
            return this.interpolateColor(YELLOW, RED, (normalized - 0.5) * 2);
        }
    },

    // Green (on-course) -> Yellow -> Red (off-course). maxDeviation is typically
    // the p95 deviation rather than the max, so a single outlier point doesn't
    // wash out the rest of the gradient.
    getDeviationColor(deviationMeters, maxDeviation) {
        const GREEN = '#34A853';
        const YELLOW = '#FBBC04';
        const RED = '#EA4335';

        if (deviationMeters === null || deviationMeters === undefined || isNaN(deviationMeters)) {
            return '#9E9E9E'; // Grey for unmatched/no-data points
        }
        if (!maxDeviation || maxDeviation <= 0) {
            return GREEN;
        }

        const normalized = Math.max(0, Math.min(1, deviationMeters / maxDeviation));

        if (normalized <= 0.5) {
            return this.interpolateColor(GREEN, YELLOW, normalized * 2);
        } else {
            return this.interpolateColor(YELLOW, RED, (normalized - 0.5) * 2);
        }
    },

    // Zone Analysis
    calculateZones(values, timestamps, metricType = 'heartRate') {
        // Filter valid values
        const validValues = values.filter(v => v !== null && v > 0);
        if (validValues.length < 10) return null;

        const minVal = Math.min(...validValues);
        const maxVal = Math.max(...validValues);
        const range = maxVal - minVal;

        if (range === 0) return null;

        // Define 5 zones
        const zoneNames = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'Max'];
        const zoneColors = ['#34A853', '#4285F4', '#FBBC04', '#FF9800', '#EA4335'];

        const zones = [];
        for (let i = 0; i < 5; i++) {
            zones.push({
                zone: i + 1,
                name: zoneNames[i],
                color: zoneColors[i],
                min: Math.round(minVal + range * (i * 0.2)),
                max: Math.round(minVal + range * ((i + 1) * 0.2)),
                time: 0,
                points: 0
            });
        }

        // Count time/points in each zone
        let totalTime = 0;
        let hasTimestamps = timestamps && timestamps.length === values.length;

        for (let i = 0; i < values.length; i++) {
            const val = values[i];
            if (val === null || val <= 0) continue;

            // Find which zone this value belongs to
            const normalized = (val - minVal) / range;
            const zoneIdx = Math.min(4, Math.floor(normalized * 5));

            // Calculate time delta
            let timeDelta = 1; // Default to 1 unit if no timestamps
            if (hasTimestamps && i > 0 && timestamps[i] && timestamps[i - 1]) {
                timeDelta = (timestamps[i] - timestamps[i - 1]) / 1000; // seconds
                if (timeDelta < 0 || timeDelta > 60) timeDelta = 1; // Sanity check
            }

            zones[zoneIdx].time += timeDelta;
            zones[zoneIdx].points++;
            totalTime += timeDelta;
        }

        // Calculate percentages
        zones.forEach(z => {
            z.percent = totalTime > 0 ? Math.round((z.time / totalTime) * 100) : 0;
        });

        // Find dominant zone
        const dominantZone = zones.reduce((max, z) => z.time > max.time ? z : max, zones[0]);

        return {
            zones: zones,
            totalTime: totalTime,
            dominantZone: dominantZone.zone,
            metric: metricType,
            minVal: minVal,
            maxVal: maxVal
        };
    },

    // Effort Score Calculation
    calculateEffortScore(route) {
        let score = 0;
        let factorsUsed = 0;

        // Duration factor (30%): 0-30 min = 0-30, 30-90 min = 30-100
        if (route.stats.duration && route.stats.duration > 0) {
            const durationMins = route.stats.duration / 60;
            let durationScore;
            if (durationMins <= 30) {
                durationScore = (durationMins / 30) * 30; // 0-30 maps to 0-30
            } else {
                durationScore = 30 + ((Math.min(durationMins, 90) - 30) / 60) * 70; // 30-90 maps to 30-100
            }
            score += durationScore * 0.30;
            factorsUsed++;
        }

        // Distance factor (25%): 0-5km = 0-25, 5-20km = 25-100
        if (route.stats.distance && route.stats.distance > 0) {
            const distKm = route.stats.distance;
            let distanceScore;
            if (distKm <= 5) {
                distanceScore = (distKm / 5) * 25;
            } else {
                distanceScore = 25 + ((Math.min(distKm, 20) - 5) / 15) * 75;
            }
            score += distanceScore * 0.25;
            factorsUsed++;
        }

        // Elevation factor (25%): 0-100m = 0-25, 100-500m = 25-100
        if (route.stats.elevationGain && route.stats.elevationGain > 0) {
            const elevGain = route.stats.elevationGain;
            let elevationScore;
            if (elevGain <= 100) {
                elevationScore = (elevGain / 100) * 25;
            } else {
                elevationScore = 25 + ((Math.min(elevGain, 500) - 100) / 400) * 75;
            }
            score += elevationScore * 0.25;
            factorsUsed++;
        }

        // Pace factor (20%): Faster pace = higher effort
        // Use inverse of pace (faster = lower min/km = harder)
        if (route.paces && route.paces.length > 10) {
            const validPaces = route.paces.filter(p => p !== null && p > 0 && p < 20);
            if (validPaces.length > 0) {
                const avgPace = validPaces.reduce((a, b) => a + b, 0) / validPaces.length;
                // 8+ min/km = easy (0), 4 min/km = very hard (100)
                let paceScore = Math.max(0, Math.min(100, (8 - avgPace) / 4 * 100));
                score += paceScore * 0.20;
                factorsUsed++;
            }
        }

        // If we used fewer than all factors, normalize
        if (factorsUsed > 0 && factorsUsed < 4) {
            score = score / (factorsUsed * 0.25); // Normalize based on factors used
        }

        // Clamp and ensure minimum
        score = Math.max(5, Math.min(100, Math.round(score)));

        // Determine category
        let category, categoryColor;
        if (score <= 25) {
            category = 'Easy';
            categoryColor = '#34A853';
        } else if (score <= 50) {
            category = 'Moderate';
            categoryColor = '#4285F4';
        } else if (score <= 75) {
            category = 'Hard';
            categoryColor = '#FF9800';
        } else {
            category = 'Very Hard';
            categoryColor = '#EA4335';
        }

        return {
            score: score,
            category: category,
            color: categoryColor,
            factorsUsed: factorsUsed
        };
    }
};
