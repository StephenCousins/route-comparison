import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('Formatting Functions', () => {
    describe('formatDuration', () => {
        it('should format seconds only', () => {
            expect(Utils.formatDuration(45)).toBe('45s');
        });

        it('should format minutes and seconds', () => {
            expect(Utils.formatDuration(125)).toBe('2m 5s');
        });

        it('should format hours and minutes', () => {
            expect(Utils.formatDuration(3725)).toBe('1h 2m');
        });

        it('should handle null input', () => {
            expect(Utils.formatDuration(null)).toBe('N/A');
        });

        it('should handle zero', () => {
            expect(Utils.formatDuration(0)).toBe('N/A');
        });
    });

    describe('formatPace', () => {
        it('should format pace in min:sec/km', () => {
            expect(Utils.formatPace(5)).toBe('5:00 /km');
            expect(Utils.formatPace(5.5)).toBe('5:30 /km');
            expect(Utils.formatPace(4.25)).toBe('4:15 /km');
        });

        it('should handle edge cases', () => {
            expect(Utils.formatPace(null)).toBe('N/A');
            expect(Utils.formatPace(undefined)).toBe('N/A');
            expect(Utils.formatPace(NaN)).toBe('N/A');
            expect(Utils.formatPace(Infinity)).toBe('N/A');
            expect(Utils.formatPace(0)).toBe('N/A');
            expect(Utils.formatPace(-1)).toBe('N/A');
            expect(Utils.formatPace(25)).toBe('N/A');  // > 20 min/km
        });
    });

    describe('formatDistance', () => {
        it('should format km distances', () => {
            expect(Utils.formatDistance(5.25)).toBe('5.25 km');
            expect(Utils.formatDistance(1)).toBe('1.00 km');
        });

        it('should format sub-km distances in meters', () => {
            expect(Utils.formatDistance(0.5)).toBe('500 m');
            expect(Utils.formatDistance(0.123)).toBe('123 m');
        });
    });

    describe('formatElevation', () => {
        it('should format elevation in meters', () => {
            expect(Utils.formatElevation(150)).toBe('150 m');
            expect(Utils.formatElevation(1234.5)).toBe('1235 m');
        });
    });

    describe('formatHeartRate', () => {
        it('should format heart rate in bpm', () => {
            expect(Utils.formatHeartRate(150)).toBe('150 bpm');
            expect(Utils.formatHeartRate(165.7)).toBe('166 bpm');
        });

        it('should handle invalid values', () => {
            expect(Utils.formatHeartRate(null)).toBe('N/A');
            expect(Utils.formatHeartRate(NaN)).toBe('N/A');
        });
    });

    describe('formatTimeDelta', () => {
        it('should format positive delta (behind)', () => {
            expect(Utils.formatTimeDelta(65)).toBe('+1:05');
            expect(Utils.formatTimeDelta(30)).toBe('+30s');
        });

        it('should format negative delta (ahead)', () => {
            expect(Utils.formatTimeDelta(-65)).toBe('-1:05');
            expect(Utils.formatTimeDelta(-30)).toBe('-30s');
        });

        it('should handle zero', () => {
            expect(Utils.formatTimeDelta(0)).toBe('+0s');
        });

        it('should handle invalid values', () => {
            expect(Utils.formatTimeDelta(null)).toBe('N/A');
            expect(Utils.formatTimeDelta(undefined)).toBe('N/A');
            expect(Utils.formatTimeDelta(NaN)).toBe('N/A');
        });
    });

    describe('formatSplitPace', () => {
        it('should format pace without /km suffix', () => {
            expect(Utils.formatSplitPace(5)).toBe('5:00');
            expect(Utils.formatSplitPace(5.5)).toBe('5:30');
        });

        it('should handle invalid values', () => {
            expect(Utils.formatSplitPace(null)).toBe('N/A');
            expect(Utils.formatSplitPace(Infinity)).toBe('N/A');
        });
    });

    describe('formatSplitGap', () => {
        it('should format positive gap (behind)', () => {
            expect(Utils.formatSplitGap(65)).toBe('+1:05');
            expect(Utils.formatSplitGap(30)).toBe('+30s');
        });

        it('should format negative gap (ahead)', () => {
            expect(Utils.formatSplitGap(-65)).toBe('-1:05');
            expect(Utils.formatSplitGap(-30)).toBe('-30s');
        });

        it('should handle null', () => {
            expect(Utils.formatSplitGap(null)).toBe('-');
        });
    });

    describe('formatSplitTime', () => {
        it('should format cumulative time', () => {
            expect(Utils.formatSplitTime(300)).toBe('5:00');
            expect(Utils.formatSplitTime(3605)).toBe('60:05');
        });

        it('should handle invalid', () => {
            expect(Utils.formatSplitTime(null)).toBe('N/A');
        });
    });
});
