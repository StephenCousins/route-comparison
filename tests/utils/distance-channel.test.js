import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

// A short straight track heading north. Each 0.001 degree of latitude is
// roughly 111 m, so consecutive points are ~111 m apart.
const track = (n) => Array.from({ length: n }, (_, i) => ({ lat: 51 + i * 0.001, lng: -1 }));

describe('isUsableDistanceChannel', () => {
    it('accepts a complete, monotonic channel', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.1, 0.2, 0.3], 4)).toBe(true);
    });

    it('accepts plateaus — a stationary runner is not a broken odometer', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.1, 0.1, 0.2], 4)).toBe(true);
    });

    it('rejects a channel that does not cover every point', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.1, 0.2], 4)).toBe(false);
    });

    it('rejects a channel with gaps', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.1, null, 0.3], 4)).toBe(false);
    });

    it('rejects a channel that goes backwards', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.2, 0.1, 0.3], 4)).toBe(false);
    });

    it('rejects a channel that never advances', () => {
        expect(Utils.isUsableDistanceChannel([0, 0, 0, 0], 4)).toBe(false);
    });

    it('rejects non-arrays, empty arrays and single points', () => {
        expect(Utils.isUsableDistanceChannel(null, 0)).toBe(false);
        expect(Utils.isUsableDistanceChannel([], 0)).toBe(false);
        expect(Utils.isUsableDistanceChannel([0.5], 1)).toBe(false);
    });

    it('skips the length check when no expected length is given', () => {
        expect(Utils.isUsableDistanceChannel([0, 0.1, 0.2])).toBe(true);
    });
});

describe('deviceTotalDistance', () => {
    it('returns the odometer total', () => {
        expect(Utils.deviceTotalDistance([0, 1.5, 3.2, 5.0])).toBe(5.0);
    });

    it('tolerates gaps that would disqualify the channel for plotting', () => {
        expect(Utils.deviceTotalDistance([0, null, 3.2, null])).toBe(3.2);
    });

    it('ignores a spurious reset at the end of the file', () => {
        expect(Utils.deviceTotalDistance([0, 1.5, 3.2, 0])).toBe(3.2);
    });

    it('returns null when there is nothing usable', () => {
        expect(Utils.deviceTotalDistance([])).toBeNull();
        expect(Utils.deviceTotalDistance([null, null])).toBeNull();
        expect(Utils.deviceTotalDistance([0, 0])).toBeNull();
        expect(Utils.deviceTotalDistance(null)).toBeNull();
    });
});

describe('buildCumulativeDistances', () => {
    it('uses the device channel when it is usable', () => {
        const route = { coordinates: track(4), distances: [0, 1, 2, 3] };
        expect(Utils.buildCumulativeDistances(route)).toEqual([0, 1, 2, 3]);
    });

    it('rebases the channel to zero at the first plotted point', () => {
        // The odometer was already at 0.4 km when the GPS got its first fix.
        const route = { coordinates: track(4), distances: [0.4, 1.4, 2.4, 3.4] };
        const result = Utils.buildCumulativeDistances(route);

        expect(result).toHaveLength(4);
        [0, 1, 2, 3].forEach((expected, i) => expect(result[i]).toBeCloseTo(expected, 9));
    });

    it('falls back to Haversine when the channel is unusable', () => {
        const route = { coordinates: track(4), distances: [0, null, 2, 3] };
        const result = Utils.buildCumulativeDistances(route);

        expect(result[0]).toBe(0);
        expect(result).toHaveLength(4);
        // ~111 m per step, so the third point sits near 0.222 km.
        expect(result[2]).toBeCloseTo(0.222, 2);
    });

    it('falls back to Haversine when there is no channel at all (GPX)', () => {
        const result = Utils.buildCumulativeDistances({ coordinates: track(3) });

        expect(result).toHaveLength(3);
        expect(result[0]).toBe(0);
        expect(result[2]).toBeGreaterThan(result[1]);
    });

    it('matches calculateDistance on the Haversine path', () => {
        const coordinates = track(6);
        const cumulative = Utils.buildCumulativeDistances({ coordinates });

        expect(cumulative[cumulative.length - 1])
            .toBeCloseTo(Utils.calculateDistance(coordinates), 6);
    });

    it('survives a route with no coordinates', () => {
        expect(Utils.buildCumulativeDistances({})).toEqual([0]);
    });
});

describe('distance-indexed analysis follows the device channel', () => {
    // 21 points over a 2 km device odometer, one every 100 m. The GPS track
    // deliberately covers a different ground distance so that any function
    // still summing Haversine hops gives itself away.
    const route = {
        coordinates: track(21),
        distances: Array.from({ length: 21 }, (_, i) => i * 0.1),
        timestamps: Array.from({ length: 21 }, (_, i) => new Date(2026, 0, 1, 12, 0, i * 30)),
        elevations: new Array(21).fill(100),
        speeds: new Array(21).fill(12),
        paces: new Array(21).fill(5),
        heartRates: new Array(21).fill(150),
        cadences: new Array(21).fill(170),
        powers: new Array(21).fill(250)
    };

    it('splits on odometer kilometres, not GPS kilometres', () => {
        const splits = Utils.calculateSplits(route, 1.0);

        expect(splits).toHaveLength(2);
        expect(splits[0].startKm).toBeCloseTo(0, 6);
        expect(splits[0].endKm).toBeCloseTo(1, 6);
        expect(splits[1].endKm).toBeCloseTo(2, 6);
        expect(splits.every(s => !s.isPartial)).toBe(true);
    });

    it('maps time against odometer distance', () => {
        const map = Utils.buildTimeDistanceMap(route);

        expect(map.distances[map.distances.length - 1]).toBeCloseTo(2, 6);
        expect(map.times[map.times.length - 1]).toBeCloseTo(600, 6);
    });

    it('measures segments against odometer distance', () => {
        const metrics = Utils.calculateSegmentMetrics(route, 0.5, 1.5);

        expect(metrics).not.toBeNull();
        expect(metrics.actualDistance).toBeCloseTo(1, 6);
    });

    it('paces splits in odometer kilometres', () => {
        // 10 points x 100 m of odometer in 10 x 30 s = 1 km per 300 s = 5:00/km.
        // On the ~111 m GPS spacing the same window would price out at ~4:30.
        expect(Utils.calculateSplitPace(route, 0, 10)).toBeCloseTo(5, 6);
    });

    it('bounds best-effort windows by the track span, not the headline total', () => {
        // stats.distance covers the whole recording including a pre-fix
        // stretch; only 2 km of it is on the track, so 5 km is not available.
        const withHeadline = { ...route, stats: { distance: 6 } };
        const efforts = Utils.calculateBestEfforts(withHeadline, [1, 5]);

        expect(efforts.map(e => e.distance)).toEqual([1]);
    });
});
