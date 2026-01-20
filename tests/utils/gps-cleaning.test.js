import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('GPS Cleaning Functions', () => {
    describe('filterDistanceJumps', () => {
        it('should flag points with impossible speed jumps', () => {
            // filterDistanceJumps checks speed from PREVIOUS point to CURRENT point
            // So the flag at index i reflects if the jump FROM i-1 TO i was valid
            const coordinates = [
                { lat: 0, lng: 0 },
                { lat: 0.00005, lng: 0 },  // ~5.5m from point 0 (5.5m/s = 19.8 km/h)
                { lat: 0.01, lng: 0 },     // ~1.1km jump from point 1 - impossible in 1 second
                { lat: 0.01005, lng: 0 }   // ~5.5m jump from point 2 (under threshold)
            ];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:01'),
                new Date('2024-01-01T00:00:02'),  // 1.1km in 1 second = 3960 km/h
                new Date('2024-01-01T00:00:03')
            ];

            const flags = Utils.filterDistanceJumps(coordinates, timestamps, 35);

            expect(flags[0]).toBe(true);   // First point is always valid
            expect(flags[1]).toBe(true);   // 5.5m in 1s = 19.8 km/h - under threshold
            expect(flags[2]).toBe(false);  // 1.1km in 1s - flagged as invalid
            expect(flags[3]).toBe(true);   // 5.5m in 1s = 19.8 km/h - under threshold
        });

        it('should allow normal running speeds', () => {
            const coordinates = [
                { lat: 0, lng: 0 },
                { lat: 0.00009, lng: 0 },  // ~10m in 1 second = 36 km/h (sprinting)
            ];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:01')
            ];

            const flags = Utils.filterDistanceJumps(coordinates, timestamps, 40);

            expect(flags[0]).toBe(true);
            expect(flags[1]).toBe(true);
        });

        it('should handle missing timestamps', () => {
            const coordinates = [
                { lat: 0, lng: 0 },
                { lat: 0.01, lng: 0 }
            ];
            const timestamps = [null, null];

            const flags = Utils.filterDistanceJumps(coordinates, timestamps);

            expect(flags[0]).toBe(true);
            expect(flags[1]).toBe(true);
        });

        it('should handle empty arrays', () => {
            const flags = Utils.filterDistanceJumps([], []);
            expect(flags).toEqual([]);
        });
    });

    describe('filterAccelerationSpikes', () => {
        it('should filter physically impossible acceleration', () => {
            // The function checks raw speeds array, not filtered values
            // 0 to 100 km/h in 1 second = ~27.8 m/s^2 (way over 10 m/s^2)
            // 100 to 15 km/h in 1 second = ~23.6 m/s^2 (also over 10 m/s^2)
            const speeds = [10, 100, 12];  // 10->100 is impossible, 100->12 also
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:01'),
                new Date('2024-01-01T00:00:02')
            ];

            const filtered = Utils.filterAccelerationSpikes(speeds, timestamps, 10);

            expect(filtered[0]).toBe(10);
            expect(filtered[1]).toBe(null);  // 10->100 km/h in 1s = ~25 m/s^2
            expect(filtered[2]).toBe(null);  // 100->12 km/h in 1s = ~24 m/s^2 (uses original speeds)
        });

        it('should allow gradual speed changes', () => {
            // 10 to 15 km/h in 1 second = ~1.4 m/s^2 (normal acceleration)
            const speeds = [10, 15, 18];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:01'),
                new Date('2024-01-01T00:00:02')
            ];

            const filtered = Utils.filterAccelerationSpikes(speeds, timestamps, 10);

            expect(filtered[0]).toBe(10);
            expect(filtered[1]).toBe(15);
            expect(filtered[2]).toBe(18);
        });

        it('should handle null speeds', () => {
            const speeds = [10, null, 12];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:01'),
                new Date('2024-01-01T00:00:02')
            ];

            const filtered = Utils.filterAccelerationSpikes(speeds, timestamps);

            expect(filtered[0]).toBe(10);
            expect(filtered[1]).toBe(null);
            expect(filtered[2]).toBe(12);
        });
    });

    describe('cleanGPSData', () => {
        it('should combine distance and acceleration filtering', () => {
            const speeds = [12, 150, 14, 13];  // 150 is an outlier
            const paces = [5, 0.4, 4.3, 4.6];
            const coordinates = [
                { lat: 0, lng: 0 },
                { lat: 0.0001, lng: 0 },
                { lat: 0.0002, lng: 0 },
                { lat: 0.0003, lng: 0 }
            ];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:10'),
                new Date('2024-01-01T00:00:20'),
                new Date('2024-01-01T00:00:30')
            ];

            const cleaned = Utils.cleanGPSData(speeds, paces, coordinates, timestamps, 35);

            expect(cleaned.speeds[1]).toBe(null);  // 150 km/h should be filtered
            expect(cleaned.paces[1]).toBe(null);
        });

        it('should preserve valid data', () => {
            const speeds = [10, 11, 12, 11];
            const paces = [6, 5.5, 5, 5.5];
            const coordinates = [
                { lat: 0, lng: 0 },
                { lat: 0.00003, lng: 0 },
                { lat: 0.00006, lng: 0 },
                { lat: 0.00009, lng: 0 }
            ];
            const timestamps = [
                new Date('2024-01-01T00:00:00'),
                new Date('2024-01-01T00:00:10'),
                new Date('2024-01-01T00:00:20'),
                new Date('2024-01-01T00:00:30')
            ];

            const cleaned = Utils.cleanGPSData(speeds, paces, coordinates, timestamps, 35);

            expect(cleaned.speeds).toEqual([10, 11, 12, 11]);
            expect(cleaned.validIndices.length).toBe(4);
        });
    });

    describe('rollingMedian', () => {
        it('should smooth data using median filter', () => {
            const data = [10, 11, 50, 12, 11];  // 50 is an outlier

            const smoothed = Utils.rollingMedian(data, 3);

            // Middle value (50) should be smoothed to median of [11, 50, 12] = 12
            expect(smoothed[2]).toBe(12);
        });

        it('should handle null values', () => {
            const data = [10, null, 12, 11, 13];

            const smoothed = Utils.rollingMedian(data, 3);

            expect(smoothed[0]).toBe(10);
            expect(smoothed[2]).toBe(11.5);  // median of [12, 11]
        });

        it('should return original if too short', () => {
            const data = [10, 11];

            const smoothed = Utils.rollingMedian(data, 5);

            expect(smoothed).toEqual([10, 11]);
        });
    });
});
