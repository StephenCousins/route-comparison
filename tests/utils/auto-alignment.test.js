import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Auto-Alignment', () => {
    const latStep = 0.00003; // ~3.3m per point
    const N = 300;
    const refCoords = [];
    for (let i = 0; i < N; i++) refCoords.push({ lat: 51.5 + i * latStep, lng: -0.1 });

    const refT0 = new Date('2026-07-12T09:00:00Z').getTime();
    const refTimestamps = refCoords.map((_, i) => new Date(refT0 + i * 1000));
    const referenceRoute = { coordinates: refCoords, timestamps: refTimestamps };

    it('should return null when there are too few reference points', () => {
        const result = Utils.calculateAutoAlignment(
            { coordinates: [{ lat: 0, lng: 0 }], timestamps: [] },
            { coordinates: [{ lat: 0, lng: 0 }], timestamps: [] }
        );
        expect(result).toBeNull();
    });

    it('should detect both a distance and time offset for a same-run late start', () => {
        // Test watch turned on 15s late — its recording starts at the physical
        // point the reference route reaches after 15 seconds.
        const LATE_START = 15;
        const testCoords = refCoords.slice(LATE_START);
        const testT0 = refT0 + LATE_START * 1000;
        const testTimestamps = testCoords.map((_, k) => new Date(testT0 + k * 1000));
        const testRoute = { coordinates: testCoords, timestamps: testTimestamps };

        const result = Utils.calculateAutoAlignment(testRoute, referenceRoute);

        expect(result).not.toBeNull();
        // Expected offset is LATE_START * step-distance ≈ 0.0497km; allow a
        // small tolerance for the flat-earth vs haversine approximation.
        expect(result.distanceOffsetKm).toBeCloseTo(0.0497, 2);
        expect(result.timeOffsetSeconds).toBeCloseTo(15, 0);
        expect(result.sameDayComparison).toBe(true);
        expect(result.confidence.level).toBe('high');
    });

    it('should skip the time offset for a different-day comparison on the same course', () => {
        const testT0 = refT0 + 30 * 24 * 3600 * 1000; // 30 days later
        const testTimestamps = refCoords.map((_, i) => new Date(testT0 + i * 1000));
        const testRoute = { coordinates: refCoords.map(c => ({ ...c })), timestamps: testTimestamps };

        const result = Utils.calculateAutoAlignment(testRoute, referenceRoute);

        expect(result.sameDayComparison).toBe(false);
        expect(result.timeOffsetSeconds).toBeNull();
        // Distance alignment is still meaningful without a shared clock.
        expect(result.distanceOffsetKm).toBeCloseTo(0, 2);
    });

    it('should not force low confidence merely for being an out-and-back course', () => {
        // Out-and-back courses have a lower overlapFraction by construction
        // (matched index only spans half the reference's point range), but a
        // clean identical-path match should still land at medium-or-better,
        // not be crushed to low by the monotonicity guard alone.
        const outAndBack = [...refCoords, ...[...refCoords].reverse().slice(1)];
        const loopTimestamps = outAndBack.map((_, i) => new Date(refT0 + i * 1000));
        const loopReference = { coordinates: outAndBack, timestamps: loopTimestamps };
        const loopTest = { coordinates: outAndBack.map(c => ({ ...c })), timestamps: loopTimestamps.map(t => new Date(t)) };

        const result = Utils.calculateAutoAlignment(loopTest, loopReference);

        expect(result.confidence.monotonic).toBe(true);
        expect(['medium', 'high']).toContain(result.confidence.level);
    });

    it('should never mutate the input routes', () => {
        const testRoute = {
            coordinates: refCoords.slice(10).map(c => ({ ...c })),
            timestamps: refCoords.slice(10).map((_, i) => new Date(refT0 + (10 + i) * 1000))
        };
        const testTimestampsBefore = testRoute.timestamps.map(t => t.getTime());
        const refTimestampsBefore = referenceRoute.timestamps.map(t => t.getTime());

        Utils.calculateAutoAlignment(testRoute, referenceRoute);

        expect(testRoute.timestamps.map(t => t.getTime())).toEqual(testTimestampsBefore);
        expect(referenceRoute.timestamps.map(t => t.getTime())).toEqual(refTimestampsBefore);
    });
});
