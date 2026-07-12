import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

function buildRoute(N, { hrFn, cadenceFn, t0 = new Date('2026-07-12T09:00:00Z').getTime() } = {}) {
    return {
        filename: 'route.fit',
        timestamps: Array.from({ length: N }, (_, i) => new Date(t0 + i * 1000)),
        heartRates: Array.from({ length: N }, (_, i) => (hrFn ? hrFn(i) : null)),
        cadences: Array.from({ length: N }, (_, i) => (cadenceFn ? cadenceFn(i) : null))
    };
}

describe('buildTimeValueMap / getValueAtTime', () => {
    it('should interpolate a value at a given elapsed time', () => {
        const route = buildRoute(3, { hrFn: (i) => [100, 110, 120][i] });
        const map = Utils.buildTimeValueMap(route, route.heartRates);
        expect(Utils.getValueAtTime(map, 0.5)).toBeCloseTo(105, 5);
    });

    it('should return null outside the mapped range', () => {
        const route = buildRoute(3, { hrFn: (i) => [100, 110, 120][i] });
        const map = Utils.buildTimeValueMap(route, route.heartRates);
        expect(Utils.getValueAtTime(map, 100)).toBeNull();
    });
});

describe('calculateHrComparison', () => {
    it('should report near-zero bias/MAE for identical heart rate traces', () => {
        const N = 100;
        const hrFn = (i) => 140 + Math.sin(i / 10) * 20;
        const referenceRoute = buildRoute(N, { hrFn });
        const testRoute = { ...buildRoute(N, { hrFn }), filename: 'test.fit' };

        const result = Utils.calculateHrComparison(referenceRoute, testRoute, {});

        expect(result).not.toBeNull();
        expect(Math.abs(result.bias)).toBeLessThan(0.5);
        expect(result.meanAbsoluteError).toBeLessThan(0.5);
    });

    it('should detect a consistent positive bias (test watch reads high)', () => {
        const N = 100;
        const referenceRoute = buildRoute(N, { hrFn: (i) => 140 + Math.sin(i / 10) * 10 });
        const testRoute = { ...buildRoute(N, { hrFn: (i) => 145 + Math.sin(i / 10) * 10 }), filename: 'test.fit' };

        const result = Utils.calculateHrComparison(referenceRoute, testRoute, {});

        expect(result.bias).toBeCloseTo(5, 0);
        expect(result.meanAbsoluteError).toBeCloseTo(5, 0);
    });

    it('should return null when routes lack heart rate data', () => {
        const N = 20;
        const referenceRoute = buildRoute(N, {});
        const testRoute = { ...buildRoute(N, {}), filename: 'test.fit' };
        expect(Utils.calculateHrComparison(referenceRoute, testRoute, {})).toBeNull();
    });
});

describe('detectCadenceLock', () => {
    it('should flag a stretch where HR tracks cadence', () => {
        const N = 60;
        // Points 0-19: normal HR distinct from cadence. Points 20-39: HR locked
        // onto cadence (classic optical sensor failure). Points 40-59: normal again.
        const route = buildRoute(N, {
            hrFn: (i) => (i >= 20 && i < 40) ? 172 : 145,
            cadenceFn: () => 172
        });

        const flags = Utils.detectCadenceLock(route);

        expect(flags.length).toBe(1);
        expect(flags[0].startIndex).toBe(20);
        expect(flags[0].endIndex).toBe(39);
        expect(flags[0].pointCount).toBe(20);
    });

    it('should not flag a route with normal, distinct HR and cadence', () => {
        const N = 60;
        const route = buildRoute(N, { hrFn: () => 145, cadenceFn: () => 172 });
        expect(Utils.detectCadenceLock(route)).toEqual([]);
    });

    it('should ignore brief coincidental crossings shorter than minConsecutivePoints', () => {
        const N = 20;
        const route = buildRoute(N, {
            hrFn: (i) => i === 10 ? 172 : 145, // a single-point crossing
            cadenceFn: () => 172
        });
        expect(Utils.detectCadenceLock(route)).toEqual([]);
    });

    it('should return no flags when cadence data is absent', () => {
        const N = 20;
        const route = buildRoute(N, { hrFn: () => 172 });
        expect(Utils.detectCadenceLock(route)).toEqual([]);
    });
});
