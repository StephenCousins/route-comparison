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

    calculateElevationStats(elevations) {
        if (!elevations || elevations.length === 0) {
            return { gain: 0, loss: 0, min: 0, max: 0 };
        }

        const validElevations = elevations.filter(e => e !== null && !isNaN(e));
        if (validElevations.length === 0) {
            return { gain: 0, loss: 0, min: 0, max: 0 };
        }

        let gain = 0, loss = 0;
        let min = validElevations[0], max = validElevations[0];
        for (let i = 1; i < validElevations.length; i++) {
            const diff = validElevations[i] - validElevations[i-1];
            if (diff > 0) gain += diff;
            else loss += Math.abs(diff);
            if (validElevations[i] < min) min = validElevations[i];
            if (validElevations[i] > max) max = validElevations[i];
        }
        return { gain, loss, min, max };
    },

    formatDistance(km) {
        return km >= 1 ? `${km.toFixed(2)} km` : `${(km * 1000).toFixed(0)} m`;
    },

    formatElevation(m) {
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

    // Time Gap Analysis utilities
    buildTimeDistanceMap(route) {
        const map = { distances: [0], times: [0] };

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
                map.times.push(elapsedTime);
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

    calculateTimeGaps(referenceRoute, comparisonRoutes, sampleInterval = 0.1) {
        const refMap = this.buildTimeDistanceMap(referenceRoute);
        if (!refMap) return null;

        const compMaps = comparisonRoutes.map(r => ({
            route: r,
            map: this.buildTimeDistanceMap(r)
        })).filter(c => c.map !== null);

        if (compMaps.length === 0) return null;

        // Find the minimum max distance across all routes
        const maxDistances = [refMap.distances[refMap.distances.length - 1]];
        compMaps.forEach(c => {
            maxDistances.push(c.map.distances[c.map.distances.length - 1]);
        });
        const maxDist = Math.min(...maxDistances);

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
                const compTime = this.getTimeAtDistance(c.map, d);
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

        let gain = 0;
        for (let i = startIdx + 1; i <= endIdx; i++) {
            const prev = elevations[i - 1];
            const curr = elevations[i];
            if (prev !== null && curr !== null && !isNaN(prev) && !isNaN(curr)) {
                const diff = curr - prev;
                if (diff > 0) gain += diff;
            }
        }
        return gain;
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

            // Calculate metrics for split
            const split = {
                number: splitNum,
                startKm: startKm,
                endKm: endKm,
                distance: endKm - startKm,
                isPartial: isPartialSplit,
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
    }
};
