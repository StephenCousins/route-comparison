import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Time Gap Analysis Functions', () => {
    describe('buildTimeDistanceMap', () => {
        it('should build cumulative distance-time map', () => {
            const route = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.009, lng: 0 },  // ~1km
                    { lat: 0.018, lng: 0 }   // ~2km
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:05:00'),  // 5 min
                    new Date('2024-01-01T00:10:00')   // 10 min
                ]
            };

            const map = Utils.buildTimeDistanceMap(route);

            expect(map).not.toBeNull();
            expect(map.distances[0]).toBe(0);
            expect(map.times[0]).toBe(0);
            expect(map.times[1]).toBe(300);  // 5 minutes in seconds
            expect(map.times[2]).toBe(600);  // 10 minutes in seconds
        });

        it('should return null for route without timestamps', () => {
            const route = {
                coordinates: [{ lat: 0, lng: 0 }],
                timestamps: [null]
            };

            const map = Utils.buildTimeDistanceMap(route);

            expect(map).toBeNull();
        });

        it('should return null for empty route', () => {
            const route = {
                coordinates: [],
                timestamps: []
            };

            const map = Utils.buildTimeDistanceMap(route);

            expect(map).toBeNull();
        });
    });

    describe('getTimeAtDistance', () => {
        it('should interpolate time at given distance', () => {
            const map = {
                distances: [0, 1, 2, 3],  // km
                times: [0, 300, 600, 900]  // seconds (5 min/km pace)
            };

            // At 1.5km should be 450 seconds
            const time = Utils.getTimeAtDistance(map, 1.5);

            expect(time).toBe(450);
        });

        it('should return 0 for distance 0', () => {
            const map = {
                distances: [0, 1, 2],
                times: [0, 300, 600]
            };

            const time = Utils.getTimeAtDistance(map, 0);

            expect(time).toBe(0);
        });

        it('should return null for distance beyond route', () => {
            const map = {
                distances: [0, 1, 2],
                times: [0, 300, 600]
            };

            const time = Utils.getTimeAtDistance(map, 5);

            expect(time).toBeNull();
        });

        it('should handle exact distance matches', () => {
            const map = {
                distances: [0, 1, 2],
                times: [0, 300, 600]
            };

            const time = Utils.getTimeAtDistance(map, 2);

            expect(time).toBe(600);
        });
    });

    describe('calculateTimeGaps', () => {
        it('should calculate time gap between routes', () => {
            const referenceRoute = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.009, lng: 0 }
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:05:00')
                ]
            };

            const comparisonRoute = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.009, lng: 0 }
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:06:00')  // 1 minute slower
                ]
            };

            const result = Utils.calculateTimeGaps(referenceRoute, [comparisonRoute], 0.5);

            expect(result).not.toBeNull();
            expect(result.gaps.length).toBeGreaterThan(0);

            // At the end, comparison should be ~60 seconds behind
            const lastGap = result.gaps[result.gaps.length - 1];
            expect(lastGap.comparisons[0].gap).toBeCloseTo(60, 0);
        });

        it('should handle routes of different lengths', () => {
            const referenceRoute = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.018, lng: 0 }  // ~2km
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:10:00')
                ]
            };

            const shorterRoute = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.009, lng: 0 }  // ~1km
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:05:00')
                ]
            };

            const result = Utils.calculateTimeGaps(referenceRoute, [shorterRoute]);

            expect(result).not.toBeNull();
            // Should only compare up to shorter route's distance
            expect(result.maxDistance).toBeLessThanOrEqual(1.1);
        });

        it('should show a near-zero gap for an identical device once both Auto-Align offsets are applied', () => {
            // A device that started recording late is NOT actually behind — it's
            // physically at a different point on the course. Applying only the
            // time offset (without the matching distance offset) samples each
            // route's OWN odometer at the same value, which are different
            // physical points, and makes the reported gap worse, not better.
            const latStep = 0.00003; // ~3.3m/point, 1 point/sec
            const N = 300;
            const refCoords = Array.from({ length: N }, (_, i) => ({ lat: 51.5 + i * latStep, lng: -0.1 }));
            const t0 = new Date('2026-07-12T09:00:00Z').getTime();
            const referenceRoute = {
                coordinates: refCoords,
                timestamps: refCoords.map((_, i) => new Date(t0 + i * 1000)),
                filename: 'ref.gpx'
            };

            const LATE = 15; // seconds/points late — identical pace, so a true gap of 0
            const compRoute = {
                coordinates: refCoords.slice(LATE).map(c => ({ ...c })),
                timestamps: refCoords.slice(LATE).map((_, k) => new Date(t0 + (LATE + k) * 1000)),
                filename: 'comp.gpx'
            };

            const align = Utils.calculateAutoAlignment(compRoute, referenceRoute);
            expect(align.timeOffsetSeconds).toBeCloseTo(LATE, 0);

            const timeOnly = Utils.calculateTimeGaps(referenceRoute, [compRoute], 0.1,
                { 'comp.gpx': align.timeOffsetSeconds });
            const midTimeOnly = timeOnly.gaps[Math.floor(timeOnly.gaps.length / 2)];
            // Confirms the bug is real: time offset alone makes it worse, not better.
            expect(Math.abs(midTimeOnly.comparisons[0].gap)).toBeGreaterThan(10);

            const corrected = Utils.calculateTimeGaps(referenceRoute, [compRoute], 0.1,
                { 'comp.gpx': align.timeOffsetSeconds },
                { 'comp.gpx': align.distanceOffsetKm });
            const midCorrected = corrected.gaps[Math.floor(corrected.gaps.length / 2)];
            expect(Math.abs(midCorrected.comparisons[0].gap)).toBeLessThan(0.01);
        });

        it('should not crash to a negative sampling range when a distance offset is larger than the route', () => {
            // A distanceOffset bigger in magnitude than the route itself (e.g.
            // from a bad/low-confidence Auto-Align match) used to drive maxDist
            // negative, so the sampling loop's `for (d = 0; d <= maxDist; ...)`
            // never ran at all and produced zero gaps unconditionally.
            const referenceRoute = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }], // ~1km
                timestamps: [new Date('2024-01-01T00:00:00'), new Date('2024-01-01T00:05:00')]
            };
            const compRoute = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }],
                timestamps: [new Date('2024-01-01T00:00:00'), new Date('2024-01-01T00:05:00')],
                filename: 'comp.gpx'
            };

            const result = Utils.calculateTimeGaps(referenceRoute, [compRoute], 0.1, {}, { 'comp.gpx': -5 });

            expect(result).not.toBeNull();
            expect(result.maxDistance).toBeGreaterThanOrEqual(0);
        });

        it('should not let one comparison route with a bad offset break Time Gap for the others', () => {
            const referenceRoute = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }], // ~1km
                timestamps: [new Date('2024-01-01T00:00:00'), new Date('2024-01-01T00:05:00')]
            };
            const goodRoute = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }],
                timestamps: [new Date('2024-01-01T00:00:00'), new Date('2024-01-01T00:05:30')],
                filename: 'good.gpx'
            };
            const badRoute = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.0005, lng: 0 }],
                timestamps: [new Date('2024-01-01T00:00:00'), new Date('2024-01-01T00:00:10')],
                filename: 'bad.gpx'
            };

            // bad.gpx gets a nonsense offset (far larger than any real route);
            // good.gpx has no offset at all and should be unaffected.
            const result = Utils.calculateTimeGaps(
                referenceRoute, [goodRoute, badRoute], 0.1, {}, { 'bad.gpx': -50 }
            );

            expect(result).not.toBeNull();
            expect(result.gaps.length).toBeGreaterThan(0);
            expect(result.gaps.some(g => g.comparisons.some(c => c.route.filename === 'good.gpx'))).toBe(true);
            // maxDistance should reflect good.gpx's real range, not be dragged
            // toward 0 by bad.gpx's offset.
            expect(result.maxDistance).toBeGreaterThan(0.5);
        });
    });
});
