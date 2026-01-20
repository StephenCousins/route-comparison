import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Split Calculation Functions', () => {
    describe('calculateSplits', () => {
        // Helper to create a test route
        function createTestRoute(distanceKm, paceMinPerKm) {
            const pointsPerKm = 10;
            const totalPoints = Math.ceil(distanceKm * pointsPerKm) + 1;
            const coordinates = [];
            const timestamps = [];
            const elevations = [];
            const heartRates = [];

            const startTime = new Date('2024-01-01T00:00:00');
            const secondsPerPoint = (paceMinPerKm * 60) / pointsPerKm;

            for (let i = 0; i < totalPoints; i++) {
                const km = i / pointsPerKm;
                coordinates.push({
                    lat: km * 0.009,
                    lng: 0
                });
                timestamps.push(new Date(startTime.getTime() + i * secondsPerPoint * 1000));
                elevations.push(100 + Math.sin(km) * 10);  // Some elevation variation
                heartRates.push(150);
            }

            return { coordinates, timestamps, elevations, heartRates };
        }

        it('should calculate 1km splits', () => {
            const route = createTestRoute(5, 5);  // 5km at 5:00/km

            const splits = Utils.calculateSplits(route, 1.0);

            // Due to GPS distance approximation, may have 5 or 6 splits
            expect(splits.length).toBeGreaterThanOrEqual(5);
            expect(splits.length).toBeLessThanOrEqual(6);
            expect(splits[0].number).toBe(1);
            expect(splits[0].distance).toBeGreaterThan(0.5);
        });

        it('should mark partial splits', () => {
            const route = createTestRoute(5.3, 5);  // 5.3km - last split is partial

            const splits = Utils.calculateSplits(route, 1.0);

            // Last split should be marked as partial (< 90% of 1km)
            const lastSplit = splits[splits.length - 1];
            expect(lastSplit.isPartial).toBe(true);
            expect(lastSplit.distance).toBeLessThan(1);
        });

        it('should calculate elevation gain per split', () => {
            const route = createTestRoute(3, 5);
            // Add climbing elevation
            route.elevations = route.elevations.map((e, i) => 100 + i * 3);

            const splits = Utils.calculateSplits(route, 1.0);

            expect(splits[0].elevGain).toBeGreaterThan(0);
        });

        it('should return empty for route with no coordinates', () => {
            const route = { coordinates: [], timestamps: [], elevations: [] };

            const splits = Utils.calculateSplits(route, 1.0);

            expect(splits).toEqual([]);
        });

        it('should handle routes without timestamps', () => {
            const route = createTestRoute(3, 5);
            route.timestamps = route.timestamps.map(() => null);

            const splits = Utils.calculateSplits(route, 1.0);

            // Should have 3-4 splits depending on GPS approximation
            expect(splits.length).toBeGreaterThanOrEqual(3);
            expect(splits.length).toBeLessThanOrEqual(4);
            expect(splits[0].pace).toBeNull();
            expect(splits[0].duration).toBeNull();
        });
    });

    describe('calculateSplitPace', () => {
        it('should calculate pace in min/km', () => {
            const route = {
                coordinates: [
                    { lat: 0, lng: 0 },
                    { lat: 0.009, lng: 0 }  // ~1km
                ],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:05:00')  // 5 minutes
                ]
            };

            const pace = Utils.calculateSplitPace(route, 0, 1);

            expect(pace).toBeCloseTo(5, 0.5);  // ~5:00/km
        });

        it('should return null for missing timestamps', () => {
            const route = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }],
                timestamps: [null, null]
            };

            const pace = Utils.calculateSplitPace(route, 0, 1);

            expect(pace).toBeNull();
        });
    });

    describe('findIndexAtDistance', () => {
        it('should find index at given cumulative distance', () => {
            const distances = [0, 1, 2, 3, 4, 5];  // km

            expect(Utils.findIndexAtDistance(distances, 0)).toBe(0);
            expect(Utils.findIndexAtDistance(distances, 2.5)).toBe(2);
            expect(Utils.findIndexAtDistance(distances, 5)).toBe(5);
        });

        it('should clamp to array bounds', () => {
            const distances = [0, 1, 2, 3];

            expect(Utils.findIndexAtDistance(distances, -1)).toBe(0);
            expect(Utils.findIndexAtDistance(distances, 10)).toBe(3);
        });
    });
});
