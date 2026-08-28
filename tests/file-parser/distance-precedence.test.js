import { describe, it, expect, vi, afterEach } from 'vitest';
import { FileParser } from '../../src/js/FileParser.js';
import { Utils } from '../../src/js/utils.js';

// ~111 m between consecutive points.
const track = (n) => Array.from({ length: n }, (_, i) => ({ lat: 51 + i * 0.001, lng: -1 }));

const build = (coordinates, options = {}, timestamps = null) =>
    FileParser.createRouteData(
        'test.fit', '#EA4335', coordinates,
        new Array(coordinates.length).fill(100),
        timestamps ?? new Array(coordinates.length).fill(null),
        [], [], [], [], [],
        options
    );

afterEach(() => vi.restoreAllMocks());

describe('createRouteData distance precedence', () => {
    const coordinates = track(11); // ~1.11 km of GPS track

    it('prefers the session total over everything else', () => {
        const route = build(coordinates, {
            distances: Array.from({ length: 11 }, (_, i) => i * 0.1),
            sessionSummary: { totalDistanceKm: 1.05, totalElapsedSeconds: null, totalAscent: null, totalDescent: null }
        });

        expect(route.stats.distance).toBe(1.05);
        expect(route.stats.distanceSource).toBe('session');
    });

    it('falls back to the record odometer when there is no session total', () => {
        const route = build(coordinates, {
            distances: Array.from({ length: 11 }, (_, i) => i * 0.1)
        });

        expect(route.stats.distance).toBeCloseTo(1.0, 6);
        expect(route.stats.distanceSource).toBe('record');
    });

    it('falls back to the GPS track when neither is present (GPX)', () => {
        const route = build(coordinates);

        expect(route.stats.distanceSource).toBe('gps');
        expect(route.stats.distance).toBeCloseTo(Utils.calculateDistance(coordinates), 6);
    });

    it('always reports the track-derived distance alongside', () => {
        const route = build(coordinates, {
            distances: Array.from({ length: 11 }, (_, i) => i * 0.1),
            sessionSummary: { totalDistanceKm: 1.05, totalElapsedSeconds: null, totalAscent: null, totalDescent: null }
        });

        expect(route.stats.gpsDistance).toBeCloseTo(Utils.calculateDistance(coordinates), 6);
        expect(route.stats.gpsDistance).not.toBe(route.stats.distance);
    });

    it('discards a record channel that grossly disagrees with the session total', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        // What a metres-vs-kilometres units slip would look like.
        const route = build(coordinates, {
            distances: Array.from({ length: 11 }, (_, i) => i * 100),
            sessionSummary: { totalDistanceKm: 1.05, totalElapsedSeconds: null, totalAscent: null, totalDescent: null }
        });

        expect(route.distances).toEqual([]);
        expect(route.stats.distance).toBe(1.05);
        expect(console.warn).toHaveBeenCalled();
    });

    it('keeps a record channel that agrees with the session total', () => {
        const route = build(coordinates, {
            distances: Array.from({ length: 11 }, (_, i) => i * 0.1),
            sessionSummary: { totalDistanceKm: 1.02, totalElapsedSeconds: null, totalAscent: null, totalDescent: null }
        });

        expect(route.distances).toHaveLength(11);
    });
});

describe('createRouteData duration precedence', () => {
    const coordinates = track(3);
    const timestamps = [
        new Date(2026, 0, 1, 12, 0, 0),
        new Date(2026, 0, 1, 12, 0, 30),
        new Date(2026, 0, 1, 12, 1, 0)
    ];

    it('prefers the session elapsed time, which includes the pre-fix portion', () => {
        const route = build(coordinates, {
            sessionSummary: {
                totalDistanceKm: null, totalElapsedSeconds: 95,
                totalTimerSeconds: 90, totalAscent: null, totalDescent: null
            }
        }, timestamps);

        expect(route.stats.duration).toBe(95);
        expect(route.stats.durationSource).toBe('session');
        expect(route.stats.gpsDuration).toBe(60);
        expect(route.stats.movingTime).toBe(90);
    });

    it('falls back to the track timestamps', () => {
        const route = build(coordinates, {}, timestamps);

        expect(route.stats.duration).toBe(60);
        expect(route.stats.durationSource).toBe('gps');
        expect(route.stats.movingTime).toBeNull();
    });
});

describe('session self-check stays independent of the headline stats', () => {
    it('measures the session totals against the GPS track, not against themselves', () => {
        const route = {
            sessionSummary: {
                totalDistanceKm: 10.2, totalElapsedSeconds: 3000,
                totalAscent: 100, totalDescent: 100
            },
            stats: {
                // Device-sourced headline figures, straight off the session message.
                distance: 10.2, duration: 3000,
                // The independent track-derived measurement.
                gpsDistance: 10.0, gpsDuration: 2950,
                elevationGain: 90, elevationLoss: 95
            }
        };

        const check = Utils.calculateSessionCheck(route);

        expect(check.distanceKm.recomputed).toBe(10.0);
        expect(check.distanceKm.diff).toBeCloseTo(0.2, 6);
        expect(check.durationSeconds.recomputed).toBe(2950);
        expect(check.durationSeconds.diff).toBe(50);
    });

    it('still works on sessions saved before the device-first change', () => {
        const route = {
            sessionSummary: {
                totalDistanceKm: 10.2, totalElapsedSeconds: 3000,
                totalAscent: 100, totalDescent: 100
            },
            // No gpsDistance/gpsDuration — distance/duration were track-derived.
            stats: { distance: 10.0, duration: 2950, elevationGain: 90, elevationLoss: 95 }
        };

        const check = Utils.calculateSessionCheck(route);

        expect(check.distanceKm.recomputed).toBe(10.0);
        expect(check.distanceKm.diff).toBeCloseTo(0.2, 6);
    });
});
