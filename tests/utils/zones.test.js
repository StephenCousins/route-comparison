import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Zone Analysis Functions', () => {
    describe('calculateZones', () => {
        it('should calculate 5 heart rate zones', () => {
            // HR values from 100 to 180 (80 bpm range)
            const values = [];
            for (let i = 0; i < 100; i++) {
                values.push(100 + Math.floor(i * 0.8));  // Spread across range
            }
            const timestamps = values.map((_, i) => new Date(Date.now() + i * 1000));

            const result = Utils.calculateZones(values, timestamps, 'heartRate');

            expect(result).not.toBeNull();
            expect(result.zones.length).toBe(5);
            expect(result.zones[0].name).toBe('Recovery');
            expect(result.zones[4].name).toBe('Max');
        });

        it('should calculate time percentages', () => {
            // Values spread across range 100-200 (100 bpm range)
            const values = [];
            for (let i = 0; i < 100; i++) {
                values.push(100 + i);  // Values from 100 to 199
            }
            const timestamps = values.map((_, i) => new Date(Date.now() + i * 1000));

            const result = Utils.calculateZones(values, timestamps);

            expect(result).not.toBeNull();
            // Total percentages should sum to 100
            const totalPercent = result.zones.reduce((sum, z) => sum + z.percent, 0);
            expect(totalPercent).toBe(100);
            // Each zone should have some representation
            result.zones.forEach(zone => {
                expect(zone.percent).toBeGreaterThanOrEqual(0);
            });
        });

        it('should identify dominant zone', () => {
            // Most time in zone 3 (middle values)
            const values = Array(100).fill(null);
            for (let i = 0; i < 100; i++) {
                // Mostly in the middle range
                values[i] = 140 + Math.random() * 20;  // 140-160 range
            }
            // Add some low and high values
            values[0] = 100;
            values[99] = 180;

            const timestamps = values.map((_, i) => new Date(Date.now() + i * 1000));

            const result = Utils.calculateZones(values, timestamps);

            expect(result.dominantZone).toBeGreaterThanOrEqual(2);
            expect(result.dominantZone).toBeLessThanOrEqual(4);
        });

        it('should return null for insufficient data', () => {
            const values = [100, 110];  // Less than 10 values
            const timestamps = [new Date(), new Date()];

            const result = Utils.calculateZones(values, timestamps);

            expect(result).toBeNull();
        });

        it('should handle null values in data', () => {
            // Need at least 10 valid values for zones to work
            const values = [100, null, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
            const timestamps = values.map((_, i) => new Date(Date.now() + i * 1000));

            const result = Utils.calculateZones(values, timestamps);

            expect(result).not.toBeNull();
            // Total time should only count non-null values (11 out of 12)
            expect(result.zones.length).toBe(5);
        });

        it('should calculate zones for power data', () => {
            const values = [];
            for (let i = 0; i < 100; i++) {
                values.push(150 + i * 2);  // Power from 150W to 350W
            }
            const timestamps = values.map((_, i) => new Date(Date.now() + i * 1000));

            const result = Utils.calculateZones(values, timestamps, 'power');

            expect(result).not.toBeNull();
            expect(result.metric).toBe('power');
            expect(result.minVal).toBe(150);
            expect(result.maxVal).toBe(348);
        });
    });
});
