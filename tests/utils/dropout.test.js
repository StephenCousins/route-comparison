import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('calculateDropoutDiagnostics', () => {
    const t0 = new Date('2026-07-12T09:00:00Z').getTime();
    const N = 60;
    const coords = Array.from({ length: N }, (_, i) => ({ lat: 51.5 + i * 0.00003, lng: -0.1 }));

    it('should report no gaps or null runs for a clean 1Hz recording', () => {
        const route = {
            coordinates: coords,
            timestamps: Array.from({ length: N }, (_, i) => new Date(t0 + i * 1000)),
            heartRates: Array.from({ length: N }, () => 150),
            cadences: Array.from({ length: N }, () => 170),
            powers: Array.from({ length: N }, () => 250),
            gpsAccuracies: Array.from({ length: N }, () => 5)
        };

        const result = Utils.calculateDropoutDiagnostics(route);

        expect(result.typicalIntervalSeconds).toBeCloseTo(1, 5);
        expect(result.gaps).toEqual([]);
        expect(result.nullRuns.heartRate).toEqual([]);
    });

    it('should flag a genuine recording gap', () => {
        // 1Hz recording with a deliberate 30s gap between index 20 and 21.
        const timestamps = Array.from({ length: N }, (_, i) => new Date(t0 + i * 1000));
        timestamps.splice(21, N - 21, ...Array.from({ length: N - 21 }, (_, i) => new Date(t0 + 20000 + 30000 + i * 1000)));

        const route = { coordinates: coords, timestamps };
        const result = Utils.calculateDropoutDiagnostics(route);

        expect(result.gaps.length).toBe(1);
        expect(result.gaps[0].gapSeconds).toBeCloseTo(30, 0);
    });

    it('should flag a sustained null-value run in a metric but ignore brief drops', () => {
        const timestamps = Array.from({ length: N }, (_, i) => new Date(t0 + i * 1000));
        const heartRates = Array.from({ length: N }, (_, i) => {
            if (i >= 10 && i < 20) return null; // 10-point dropout
            if (i === 40) return null; // single-point drop — should be ignored
            return 150;
        });

        const route = { coordinates: coords, timestamps, heartRates };
        const result = Utils.calculateDropoutDiagnostics(route);

        expect(result.nullRuns.heartRate.length).toBe(1);
        expect(result.nullRuns.heartRate[0].startIndex).toBe(10);
        expect(result.nullRuns.heartRate[0].pointCount).toBe(10);
    });

    it('should handle a route with no timestamps gracefully', () => {
        const route = { coordinates: [], timestamps: [] };
        const result = Utils.calculateDropoutDiagnostics(route);
        expect(result.typicalIntervalSeconds).toBeNull();
        expect(result.gaps).toEqual([]);
    });

    it('should not flag a metric that was never recorded at all as a dropout', () => {
        // No power meter on this device — every point is null, not a mid-route gap.
        const route = {
            coordinates: coords,
            timestamps: Array.from({ length: N }, (_, i) => new Date(t0 + i * 1000)),
            powers: Array.from({ length: N }, () => null)
        };

        const result = Utils.calculateDropoutDiagnostics(route);
        expect(result.nullRuns.power).toEqual([]);
    });
});
