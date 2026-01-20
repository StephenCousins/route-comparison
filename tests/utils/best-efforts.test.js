import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Best Efforts Functions', () => {
    describe('calculateBestEfforts', () => {
        // Helper to create a route with consistent pace
        function createRoute(distanceKm, paceMinPerKm) {
            const pointsPerKm = 10;
            const totalPoints = Math.ceil(distanceKm * pointsPerKm);
            const coordinates = [];
            const timestamps = [];
            const elevations = [];

            const startTime = new Date('2024-01-01T00:00:00');
            const secondsPerPoint = (paceMinPerKm * 60) / pointsPerKm;

            for (let i = 0; i < totalPoints; i++) {
                const km = i / pointsPerKm;
                coordinates.push({
                    lat: km * 0.009,  // ~1km per 0.009 degrees
                    lng: 0
                });
                timestamps.push(new Date(startTime.getTime() + i * secondsPerPoint * 1000));
                elevations.push(100);
            }

            return {
                coordinates,
                timestamps,
                elevations,
                stats: { distance: distanceKm }
            };
        }

        it('should find best 1km effort', () => {
            const route = createRoute(5, 5);  // 5km at 5:00/km pace

            const efforts = Utils.calculateBestEfforts(route, [1]);

            expect(efforts.length).toBe(1);
            expect(efforts[0].distance).toBe(1);
            // Allow some tolerance due to GPS approximations (~1km per 0.009 degrees)
            expect(efforts[0].pace).toBeGreaterThan(3);
            expect(efforts[0].pace).toBeLessThan(7);
        });

        it('should skip distances longer than route', () => {
            const route = createRoute(3, 5);  // 3km route

            const efforts = Utils.calculateBestEfforts(route, [1, 5, 10]);

            expect(efforts.length).toBe(1);  // Only 1km effort found
            expect(efforts[0].distance).toBe(1);
        });

        it('should return empty for route without timestamps', () => {
            const route = {
                coordinates: [{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }],
                timestamps: [null, null],
                elevations: [100, 100],
                stats: { distance: 1 }
            };

            const efforts = Utils.calculateBestEfforts(route, [1]);

            expect(efforts.length).toBe(0);
        });

        it('should find best effort in variable-pace route', () => {
            // Create route with fast middle section
            const coordinates = [];
            const timestamps = [];
            const elevations = [];
            const startTime = new Date('2024-01-01T00:00:00');

            // First km at 6:00/km
            for (let i = 0; i < 10; i++) {
                coordinates.push({ lat: i * 0.0009, lng: 0 });
                timestamps.push(new Date(startTime.getTime() + i * 36 * 1000));
                elevations.push(100);
            }

            // Second km at 4:00/km (faster)
            for (let i = 0; i < 10; i++) {
                coordinates.push({ lat: 0.009 + i * 0.0009, lng: 0 });
                timestamps.push(new Date(startTime.getTime() + 360000 + i * 24 * 1000));
                elevations.push(100);
            }

            // Third km at 6:00/km
            for (let i = 0; i < 10; i++) {
                coordinates.push({ lat: 0.018 + i * 0.0009, lng: 0 });
                timestamps.push(new Date(startTime.getTime() + 600000 + i * 36 * 1000));
                elevations.push(100);
            }

            const route = {
                coordinates,
                timestamps,
                elevations,
                stats: { distance: 3 }
            };

            const efforts = Utils.calculateBestEfforts(route, [1]);

            expect(efforts.length).toBe(1);
            // Best 1km should be around 4:00/km
            expect(efforts[0].pace).toBeLessThan(5);
        });
    });

    describe('getDistanceLabel', () => {
        it('should label half marathon correctly', () => {
            expect(Utils.getDistanceLabel(21.1)).toBe('Half Marathon');
            expect(Utils.getDistanceLabel(21.0975)).toBe('Half Marathon');
        });

        it('should label marathon correctly', () => {
            expect(Utils.getDistanceLabel(42.195)).toBe('Marathon');
            expect(Utils.getDistanceLabel(42.2)).toBe('Marathon');
        });

        it('should format sub-km distances in meters', () => {
            expect(Utils.getDistanceLabel(0.4)).toBe('400m');
            expect(Utils.getDistanceLabel(0.8)).toBe('800m');
        });

        it('should format km distances', () => {
            expect(Utils.getDistanceLabel(1)).toBe('1km');
            expect(Utils.getDistanceLabel(5)).toBe('5km');
            expect(Utils.getDistanceLabel(10)).toBe('10km');
        });
    });
});
