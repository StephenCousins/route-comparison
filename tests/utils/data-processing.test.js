import { describe, it, expect } from 'vitest';
import { Utils } from '../../src/js/utils.js';

describe('smoothData', () => {
  it('returns original data when shorter than window', () => {
    const data = [1, 2, 3];
    expect(Utils.smoothData(data, 20)).toEqual(data);
  });

  it('smooths data with moving average', () => {
    const data = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 10 : 20));
    const smoothed = Utils.smoothData(data, 5);
    expect(smoothed.length).toBe(data.length);
    // Smoothed values should be closer to the mean (15)
    const midValue = smoothed[25];
    expect(midValue).toBeGreaterThan(12);
    expect(midValue).toBeLessThan(18);
  });

  it('handles null values in data', () => {
    const data = [1, null, 3, null, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const smoothed = Utils.smoothData(data, 3);
    expect(smoothed.length).toBe(data.length);
  });
});

describe('decimateData', () => {
  it('returns original when data is small', () => {
    const data = [1, 2, 3];
    const distances = [0, 1, 2];
    const result = Utils.decimateData(data, distances, 20);
    expect(result.data).toEqual(data);
    expect(result.distances).toEqual(distances);
  });

  it('reduces data points', () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const distances = Array.from({ length: 100 }, (_, i) => i * 0.01);
    const result = Utils.decimateData(data, distances, 10);
    expect(result.data.length).toBeLessThan(data.length);
    // Should include first and last points
    expect(result.data[0]).toBe(0);
    expect(result.data[result.data.length - 1]).toBe(99);
  });
});

describe('getAdaptiveSmoothingParams', () => {
  it('returns small window for short routes', () => {
    const params = Utils.getAdaptiveSmoothingParams(5);
    expect(params.windowSize).toBe(50);
    expect(params.decimationFactor).toBe(5);
  });

  it('returns medium window for medium routes', () => {
    const params = Utils.getAdaptiveSmoothingParams(15);
    expect(params.windowSize).toBe(100);
    expect(params.decimationFactor).toBe(10);
  });

  it('returns large window for long routes', () => {
    const params = Utils.getAdaptiveSmoothingParams(75);
    expect(params.windowSize).toBe(300);
    expect(params.decimationFactor).toBe(25);
  });

  it('returns largest window for ultra routes', () => {
    const params = Utils.getAdaptiveSmoothingParams(150);
    expect(params.windowSize).toBe(500);
    expect(params.decimationFactor).toBe(50);
  });
});

describe('median', () => {
  it('returns median of odd-length array', () => {
    expect(Utils.median([1, 3, 5])).toBe(3);
  });

  it('returns average of middle values for even-length array', () => {
    expect(Utils.median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns single value for single-element array', () => {
    expect(Utils.median([42])).toBe(42);
  });

  it('returns null for empty array', () => {
    expect(Utils.median([])).toBe(null);
  });

  it('returns null for null input', () => {
    expect(Utils.median(null)).toBe(null);
  });

  it('handles unsorted input', () => {
    expect(Utils.median([5, 1, 3])).toBe(3);
  });
});

describe('calculateMAD', () => {
  it('calculates median and MAD', () => {
    const result = Utils.calculateMAD([1, 2, 3, 4, 5]);
    expect(result.median).toBe(3);
    expect(result.mad).toBe(1); // deviations: [2,1,0,1,2], median of those = 1
  });

  it('returns nulls for empty array', () => {
    const result = Utils.calculateMAD([]);
    expect(result.median).toBe(null);
    expect(result.mad).toBe(null);
  });

  it('returns nulls for null input', () => {
    const result = Utils.calculateMAD(null);
    expect(result.median).toBe(null);
    expect(result.mad).toBe(null);
  });
});

describe('filterOutliersIQR', () => {
  it('removes outliers from data', () => {
    const data = [1, 2, 3, 4, 5, 100]; // 100 is an outlier
    const filtered = Utils.filterOutliersIQR(data);
    expect(filtered).not.toContain(100);
  });

  it('keeps normal values', () => {
    const data = [1, 2, 3, 4, 5];
    const filtered = Utils.filterOutliersIQR(data);
    expect(filtered.length).toBe(5);
  });

  it('returns original for arrays smaller than 4', () => {
    const data = [1, 2, 3];
    expect(Utils.filterOutliersIQR(data)).toEqual(data);
  });

  it('returns original for null input', () => {
    expect(Utils.filterOutliersIQR(null)).toBe(null);
  });

  it('respects custom multiplier', () => {
    const data = [1, 2, 3, 4, 5, 10];
    const strict = Utils.filterOutliersIQR(data, 0.5);
    const lenient = Utils.filterOutliersIQR(data, 3);
    expect(strict.length).toBeLessThanOrEqual(lenient.length);
  });
});

describe('filterOutliersMAD', () => {
  it('removes outliers based on MAD', () => {
    const data = [1, 2, 3, 4, 5, 100];
    const filtered = Utils.filterOutliersMAD(data);
    expect(filtered).not.toContain(100);
  });

  it('returns original for small arrays', () => {
    const data = [1, 2, 3];
    expect(Utils.filterOutliersMAD(data)).toEqual(data);
  });

  it('returns original for null input', () => {
    expect(Utils.filterOutliersMAD(null)).toBe(null);
  });
});

describe('calculateElevationStats', () => {
  it('calculates gain, loss, min, max', () => {
    const stats = Utils.calculateElevationStats([100, 120, 110, 130]);
    expect(stats.gain).toBe(40); // +20 + +20
    expect(stats.loss).toBe(10); // -10
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(130);
  });

  it('returns zeros for empty array', () => {
    const stats = Utils.calculateElevationStats([]);
    expect(stats).toEqual({ gain: 0, loss: 0, min: 0, max: 0 });
  });

  it('returns zeros for null input', () => {
    const stats = Utils.calculateElevationStats(null);
    expect(stats).toEqual({ gain: 0, loss: 0, min: 0, max: 0 });
  });

  it('handles flat elevation', () => {
    const stats = Utils.calculateElevationStats([100, 100, 100]);
    expect(stats.gain).toBe(0);
    expect(stats.loss).toBe(0);
  });

  it('filters null values', () => {
    const stats = Utils.calculateElevationStats([100, null, 200]);
    expect(stats.gain).toBe(100);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(200);
  });
});

describe('haversineDistance', () => {
  it('calculates distance between two points', () => {
    // London to Paris approx 344 km
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const dist = Utils.haversineDistance(london, paris);
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(360);
  });

  it('returns 0 for same point', () => {
    const point = { lat: 51.5074, lng: -0.1278 };
    expect(Utils.haversineDistance(point, point)).toBe(0);
  });
});

describe('calculateDistance', () => {
  it('sums distances between consecutive points', () => {
    const coords = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 51.5080, lng: -0.1278 },
      { lat: 51.5090, lng: -0.1278 },
    ];
    const dist = Utils.calculateDistance(coords);
    expect(dist).toBeGreaterThan(0);
  });
});
