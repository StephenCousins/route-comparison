import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Distance Drift Analysis', () => {
    describe('getDistanceAtTime', () => {
        it('should interpolate distance at a given elapsed time', () => {
            const map = {
                times: [0, 300, 600, 900], // seconds
                distances: [0, 1, 2, 3]    // km (5 min/km pace)
            };
            expect(Utils.getDistanceAtTime(map, 450)).toBe(1.5);
        });

        it('should clamp to the first distance at or before the start time', () => {
            const map = { times: [0, 300, 600], distances: [0, 1, 2] };
            expect(Utils.getDistanceAtTime(map, 0)).toBe(0);
            expect(Utils.getDistanceAtTime(map, -10)).toBe(0);
        });

        it('should return null beyond the route', () => {
            const map = { times: [0, 300, 600], distances: [0, 1, 2] };
            expect(Utils.getDistanceAtTime(map, 1000)).toBeNull();
        });

        it('should respect a non-zero starting time (offset routes)', () => {
            const map = { times: [15, 315, 615], distances: [0, 1, 2] };
            expect(Utils.getDistanceAtTime(map, 10)).toBe(0); // before offset start
            expect(Utils.getDistanceAtTime(map, 165)).toBe(0.5);
        });
    });

    describe('calculateDistanceDrift', () => {
        const latStep = 0.00003; // ~3.3m per point
        const N = 100;
        const refCoords = Array.from({ length: N }, (_, i) => ({ lat: 51.5 + i * latStep, lng: -0.1 }));
        const t0 = new Date('2026-07-12T09:00:00Z').getTime();
        const refTimestamps = refCoords.map((_, i) => new Date(t0 + i * 1000));
        const referenceRoute = { coordinates: refCoords, timestamps: refTimestamps };

        it('should detect a device that reads consistently long', () => {
            // Same elapsed-time-per-point, but each step covers 2% more distance.
            const longCoords = refCoords.map((_, i) => ({ lat: 51.5 + i * latStep * 1.02, lng: -0.1 }));
            const compRoute = {
                coordinates: longCoords,
                timestamps: refTimestamps.map(t => new Date(t.getTime())),
                filename: 'long.fit'
            };

            const result = Utils.calculateDistanceDrift(referenceRoute, [compRoute], 10);

            expect(result).not.toBeNull();
            expect(result.drifts.length).toBeGreaterThan(0);
            const last = result.drifts[result.drifts.length - 1];
            const driftPct = (last.comparisons[0].drift / last.referenceDistance) * 100;
            expect(driftPct).toBeCloseTo(2, 1);
        });

        it('should show zero drift for an identical route', () => {
            const compRoute = {
                coordinates: refCoords.map(c => ({ ...c })),
                timestamps: refTimestamps.map(t => new Date(t.getTime())),
                filename: 'identical.fit'
            };

            const result = Utils.calculateDistanceDrift(referenceRoute, [compRoute], 10);
            const last = result.drifts[result.drifts.length - 1];
            expect(last.comparisons[0].drift).toBeCloseTo(0, 5);
        });

        it('should return null when routes lack timestamps', () => {
            const result = Utils.calculateDistanceDrift(
                { coordinates: refCoords, timestamps: [] },
                [{ coordinates: refCoords, timestamps: [] }]
            );
            expect(result).toBeNull();
        });

        it('should not report a start-line mismatch as drift once both Auto-Align offsets are applied', () => {
            // Comparison route is a late-starting slice of the identical course
            // (physically the tail end of refCoords) — no odometer error at all.
            // With only the time offset applied (as Auto-Align's Time Gap/Race
            // integration does) but not the distance offset, "distance covered
            // by true time t" for the late-started route is compared against a
            // start point ~40m further back than the reference's, which reads
            // as a spurious ~40m drift that's really just "different start line."
            const LATE_START = 12;
            const compCoords = refCoords.slice(LATE_START).map(c => ({ ...c }));
            const compTimestamps = refCoords.slice(LATE_START).map((_, k) =>
                new Date(t0 + (LATE_START + k) * 1000)
            );
            const compRoute = { coordinates: compCoords, timestamps: compTimestamps, filename: 'late-start.fit' };

            const distanceOffsetKm = LATE_START * (0.00003 * 110.54); // matches calculateAutoAlignment's own math
            const timeOffsets = { 'late-start.fit': LATE_START };

            const timeOnlyCorrection = Utils.calculateDistanceDrift(referenceRoute, [compRoute], 10, timeOffsets);
            const lastTimeOnly = timeOnlyCorrection.drifts[timeOnlyCorrection.drifts.length - 1];
            // Confirms the mismatch is real and would otherwise show up as drift.
            expect(Math.abs(lastTimeOnly.comparisons[0].drift)).toBeGreaterThan(0.03);

            const distanceOffsets = { 'late-start.fit': distanceOffsetKm };
            const fullyCorrected = Utils.calculateDistanceDrift(referenceRoute, [compRoute], 10, timeOffsets, distanceOffsets);
            const lastCorrected = fullyCorrected.drifts[fullyCorrected.drifts.length - 1];
            expect(Math.abs(lastCorrected.comparisons[0].drift)).toBeLessThan(0.005); // within 5m
        });
    });
});
