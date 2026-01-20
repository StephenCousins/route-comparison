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
    });
});
