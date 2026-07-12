import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('calculateRunningDynamicsSummary', () => {
    it('should average each running-dynamics field, ignoring nulls', () => {
        const route = {
            verticalOscillations: [80, 82, null, 84],
            groundContactTimes: [240, 250, 260, null],
            verticalRatios: [6.5, 6.7, null, 6.9],
            groundContactBalances: [50.1, 49.9, 50.0, null],
            stepLengths: [1100, 1120, null, 1140]
        };

        const summary = Utils.calculateRunningDynamicsSummary(route);

        expect(summary.verticalOscillation).toBeCloseTo(82, 5);
        expect(summary.groundContactTime).toBeCloseTo(250, 5);
        expect(summary.verticalRatio).toBeCloseTo(6.7, 5);
        expect(summary.groundContactBalance).toBeCloseTo(50, 5);
        expect(summary.stepLength).toBeCloseTo(1120, 5);
    });

    it('should report coverage based on how many points have data', () => {
        const route = {
            verticalOscillations: [80, null, null, null],
            groundContactTimes: [],
            verticalRatios: [],
            groundContactBalances: [],
            stepLengths: []
        };

        const summary = Utils.calculateRunningDynamicsSummary(route);
        expect(summary.coverage).toBeCloseTo(0.25, 5);
    });

    it('should return nulls and zero coverage when no running dynamics data exists (e.g. a GPX route)', () => {
        const route = { verticalOscillations: [], groundContactTimes: [], verticalRatios: [], groundContactBalances: [], stepLengths: [] };
        const summary = Utils.calculateRunningDynamicsSummary(route);

        expect(summary.verticalOscillation).toBeNull();
        expect(summary.coverage).toBe(0);
    });

    it('should handle a route object missing the fields entirely', () => {
        const summary = Utils.calculateRunningDynamicsSummary({});
        expect(summary.verticalOscillation).toBeNull();
        expect(summary.coverage).toBe(0);
    });
});
