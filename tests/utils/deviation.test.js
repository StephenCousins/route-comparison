import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('GPS Deviation Analysis Functions', () => {
    describe('percentile', () => {
        it('should return null for empty array', () => {
            expect(Utils.percentile([], 50)).toBeNull();
            expect(Utils.percentile(null, 50)).toBeNull();
        });

        it('should compute median at p50', () => {
            expect(Utils.percentile([1, 2, 3, 4, 5], 50)).toBe(3);
        });

        it('should interpolate between values', () => {
            expect(Utils.percentile([1, 2, 3, 4, 5], 95)).toBeCloseTo(4.8, 5);
        });

        it('should return min/max at p0/p100', () => {
            expect(Utils.percentile([5, 1, 3], 0)).toBe(1);
            expect(Utils.percentile([5, 1, 3], 100)).toBe(5);
        });
    });

    describe('calculateCrossTrackDeviation', () => {
        // Reference: a straight north-south line, ~111m per 0.001deg lat step.
        const refCoords = [];
        for (let i = 0; i < 100; i++) {
            refCoords.push({ lat: 51.5 + i * 0.001, lng: -0.1 });
        }
        const referenceRoute = { coordinates: refCoords };

        it('should return null for routes with fewer than 2 reference points', () => {
            const result = Utils.calculateCrossTrackDeviation(
                { coordinates: [{ lat: 0, lng: 0 }] },
                { coordinates: [{ lat: 0, lng: 0 }] }
            );
            expect(result).toBeNull();
        });

        it('should measure a known lateral offset accurately', () => {
            const lngOffsetForMeters = (m) => m / (111320 * Math.cos(51.5 * Math.PI / 180));
            const offset = lngOffsetForMeters(10); // ~10m east of the reference line
            const testRoute = {
                coordinates: refCoords.map(c => ({ lat: c.lat, lng: c.lng + offset }))
            };

            const result = Utils.calculateCrossTrackDeviation(testRoute, referenceRoute);

            expect(result).not.toBeNull();
            expect(result.stats.mean).toBeCloseTo(10, 0);
            expect(result.stats.median).toBeCloseTo(10, 0);
            expect(result.stats.max).toBeCloseTo(10, 0);
            expect(result.perPointDeviations).toHaveLength(testRoute.coordinates.length);
            expect(result.matchedRefIndex[0]).toBe(0);
        });

        it('should report zero deviation for an identical route', () => {
            const testRoute = { coordinates: refCoords.map(c => ({ ...c })) };
            const result = Utils.calculateCrossTrackDeviation(testRoute, referenceRoute);
            expect(result.stats.mean).toBeCloseTo(0, 3);
        });

        it('should track matchedRefIndex forward and backward through an out-and-back turnaround', () => {
            // Route goes out along refCoords then returns along the same path.
            const outAndBack = [...refCoords, ...[...refCoords].reverse().slice(1)];
            const loopReference = { coordinates: outAndBack };
            const loopTest = { coordinates: outAndBack.map(c => ({ lat: c.lat, lng: c.lng })) };

            const result = Utils.calculateCrossTrackDeviation(loopTest, loopReference);

            // Around the turnaround (index ~99), matched index should increase
            // then decrease rather than jumping to an unrelated point.
            const turnaround = result.matchedRefIndex.slice(95, 105).filter(i => i !== null);
            const increasing = turnaround.slice(0, 5);
            const decreasing = turnaround.slice(5);
            expect(increasing).toEqual([...increasing].sort((a, b) => a - b));
            expect(decreasing).toEqual([...decreasing].sort((a, b) => b - a));
        });
    });

    describe('getDeviationColor', () => {
        it('should return green at zero deviation', () => {
            // interpolateColor lowercases hex digits, matching getPaceColor's behavior.
            expect(Utils.getDeviationColor(0, 20)).toBe('#34a853');
        });

        it('should return grey for null/undefined deviation', () => {
            expect(Utils.getDeviationColor(null, 20)).toBe('#9E9E9E');
            expect(Utils.getDeviationColor(undefined, 20)).toBe('#9E9E9E');
        });

        it('should clamp beyond maxDeviation to red', () => {
            expect(Utils.getDeviationColor(1000, 20)).toBe('#ea4335');
        });
    });
});
