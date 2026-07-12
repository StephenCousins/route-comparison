import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('pressureToElevation', () => {
    it('should return 0 at standard sea-level pressure', () => {
        expect(Utils.pressureToElevation(101325)).toBeCloseTo(0, 1);
    });

    it('should match known reference altitudes', () => {
        expect(Utils.pressureToElevation(89876)).toBeCloseTo(1000, 0);
        expect(Utils.pressureToElevation(79495)).toBeCloseTo(2000, -1);
    });

    it('should return null for invalid input', () => {
        expect(Utils.pressureToElevation(null)).toBeNull();
        expect(Utils.pressureToElevation(undefined)).toBeNull();
        expect(Utils.pressureToElevation(0)).toBeNull();
        expect(Utils.pressureToElevation(-5)).toBeNull();
    });
});

describe('calculateSessionCheck', () => {
    it('should return null when the route has no session summary (e.g. GPX)', () => {
        const route = { sessionSummary: null, stats: { distance: 5, duration: 1500, elevationGain: 50, elevationLoss: 50 } };
        expect(Utils.calculateSessionCheck(route)).toBeNull();
    });

    it('should compute diffs between reported and recomputed totals', () => {
        const route = {
            sessionSummary: { totalDistanceKm: 5.1, totalElapsedSeconds: 1520, totalAscent: 55, totalDescent: 52 },
            stats: { distance: 5.0, duration: 1500, elevationGain: 50, elevationLoss: 50 },
            absolutePressures: []
        };

        const check = Utils.calculateSessionCheck(route);

        expect(check.distanceKm.diff).toBeCloseTo(0.1, 5);
        expect(check.durationSeconds.diff).toBeCloseTo(20, 5);
        expect(check.ascent.diff).toBeCloseTo(5, 5);
        expect(check.descent.diff).toBeCloseTo(2, 5);
        expect(check.baroAscent).toBeNull(); // no pressure data
    });

    it('should derive a barometric ascent estimate when absolute_pressure is present', () => {
        // Simulate a steady descent in pressure (i.e. a climb) from sea level.
        const N = 100;
        const pressures = Array.from({ length: N }, (_, i) => {
            const targetElevation = (i / N) * 100; // 100m climb
            return 101325 * Math.pow(1 - targetElevation / 44330, 5.255);
        });

        const route = {
            sessionSummary: { totalDistanceKm: 1, totalElapsedSeconds: 600, totalAscent: 100, totalDescent: 0 },
            stats: { distance: 1, duration: 600, elevationGain: 0, elevationLoss: 0 }, // device has no GPS elevation in this synthetic case
            absolutePressures: pressures
        };

        const check = Utils.calculateSessionCheck(route);

        expect(check.baroAscent).not.toBeNull();
        expect(check.baroAscent.recomputed).toBeGreaterThan(80);
        expect(check.baroAscent.recomputed).toBeLessThan(120);
    });
});
