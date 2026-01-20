import { describe, it, expect } from 'vitest';
import { FileParser } from '../../src/js/FileParser.js';

describe('FileParser Validation', () => {
    describe('validateCoordinate', () => {
        it('should accept valid coordinates', () => {
            const result = FileParser.validateCoordinate(45.5, -122.6);
            expect(result.valid).toBe(true);
        });

        it('should reject out-of-range latitude', () => {
            const result = FileParser.validateCoordinate(91, 0);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('lat_out_of_range');
        });

        it('should reject out-of-range longitude', () => {
            const result = FileParser.validateCoordinate(0, 181);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('lng_out_of_range');
        });

        it('should reject NaN coordinates', () => {
            const result = FileParser.validateCoordinate(NaN, 0);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_number');
        });

        it('should reject null coordinates', () => {
            const result = FileParser.validateCoordinate(null, null);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('missing');
        });

        it('should reject Infinity', () => {
            const result = FileParser.validateCoordinate(Infinity, 0);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_number');
        });

        it('should accept edge values', () => {
            expect(FileParser.validateCoordinate(90, 180).valid).toBe(true);
            expect(FileParser.validateCoordinate(-90, -180).valid).toBe(true);
        });
    });

    describe('validateElevation', () => {
        it('should accept valid elevations', () => {
            const result = FileParser.validateElevation(100);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(100);
        });

        it('should accept null elevation', () => {
            const result = FileParser.validateElevation(null);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(null);
        });

        it('should reject elevations below -500m', () => {
            const result = FileParser.validateElevation(-600);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('out_of_range');
        });

        it('should reject elevations above 9000m', () => {
            const result = FileParser.validateElevation(10000);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('out_of_range');
        });

        it('should reject NaN', () => {
            const result = FileParser.validateElevation(NaN);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_number');
        });

        it('should accept Dead Sea elevation', () => {
            const result = FileParser.validateElevation(-430);
            expect(result.valid).toBe(true);
        });

        it('should accept Everest elevation', () => {
            const result = FileParser.validateElevation(8849);
            expect(result.valid).toBe(true);
        });
    });

    describe('validateTimestamp', () => {
        it('should accept valid timestamps', () => {
            const ts = new Date('2024-01-01T00:00:00');
            const result = FileParser.validateTimestamp(ts, null);
            expect(result.valid).toBe(true);
            expect(result.value).toEqual(ts);
        });

        it('should accept null timestamp', () => {
            const result = FileParser.validateTimestamp(null, null);
            expect(result.valid).toBe(true);
            expect(result.value).toBe(null);
        });

        it('should reject non-chronological timestamps', () => {
            const prev = new Date('2024-01-01T00:10:00');
            const current = new Date('2024-01-01T00:05:00');
            const result = FileParser.validateTimestamp(current, prev);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('not_chronological');
        });

        it('should accept equal timestamps', () => {
            const ts = new Date('2024-01-01T00:00:00');
            const result = FileParser.validateTimestamp(ts, ts);
            expect(result.valid).toBe(true);
        });

        it('should reject invalid date objects', () => {
            const result = FileParser.validateTimestamp(new Date('invalid'), null);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_date');
        });
    });

    describe('validateParsedData', () => {
        it('should filter out invalid coordinates', () => {
            const rawData = {
                coordinates: [
                    { lat: 45.5, lng: -122.6 },
                    { lat: 200, lng: 0 },  // Invalid
                    { lat: 45.6, lng: -122.5 }
                ],
                elevations: [100, 150, 200],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:01:00'),
                    new Date('2024-01-01T00:02:00')
                ],
                heartRates: [150, 155, 160],
                cadences: [170, 175, 180],
                powers: [200, 210, 220]
            };

            const result = FileParser.validateParsedData(rawData);

            expect(result.coordinates.length).toBe(2);
            expect(result.skipped).toBe(1);
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should preserve valid data with invalid elevation', () => {
            const rawData = {
                coordinates: [{ lat: 45.5, lng: -122.6 }],
                elevations: [50000],  // Invalid elevation
                timestamps: [new Date('2024-01-01T00:00:00')],
                heartRates: [150],
                cadences: [170],
                powers: [200]
            };

            const result = FileParser.validateParsedData(rawData);

            expect(result.coordinates.length).toBe(1);
            expect(result.elevations[0]).toBe(null);  // Invalid elevation replaced with null
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should handle all valid data', () => {
            const rawData = {
                coordinates: [
                    { lat: 45.5, lng: -122.6 },
                    { lat: 45.6, lng: -122.5 }
                ],
                elevations: [100, 150],
                timestamps: [
                    new Date('2024-01-01T00:00:00'),
                    new Date('2024-01-01T00:01:00')
                ],
                heartRates: [150, 155],
                cadences: [170, 175],
                powers: [200, 210]
            };

            const result = FileParser.validateParsedData(rawData);

            expect(result.coordinates.length).toBe(2);
            expect(result.skipped).toBe(0);
            expect(result.warnings.length).toBe(0);
        });

        it('should handle missing optional data', () => {
            const rawData = {
                coordinates: [{ lat: 45.5, lng: -122.6 }],
                elevations: [null],
                timestamps: [null],
                heartRates: [null],
                cadences: [undefined],
                powers: [undefined]
            };

            const result = FileParser.validateParsedData(rawData);

            expect(result.coordinates.length).toBe(1);
            expect(result.heartRates[0]).toBe(null);
            expect(result.cadences[0]).toBe(null);
            expect(result.powers[0]).toBe(null);
        });
    });

    describe('parseGPX with validation', () => {
        const validGPX = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1">
            <trk>
                <trkseg>
                    <trkpt lat="45.5" lon="-122.6">
                        <ele>100</ele>
                        <time>2024-01-01T00:00:00Z</time>
                    </trkpt>
                    <trkpt lat="45.51" lon="-122.61">
                        <ele>110</ele>
                        <time>2024-01-01T00:01:00Z</time>
                    </trkpt>
                </trkseg>
            </trk>
        </gpx>`;

        it('should parse valid GPX', () => {
            const result = FileParser.parseGPX(validGPX, '#FF0000', 'test.gpx');

            expect(result.coordinates.length).toBe(2);
            expect(result.filename).toBe('test.gpx');
            expect(result.color).toBe('#FF0000');
        });

        it('should throw for invalid XML', () => {
            const invalidXML = '<not valid xml';
            expect(() => FileParser.parseGPX(invalidXML, '#FF0000', 'test.gpx')).toThrow('Invalid XML');
        });

        it('should throw for GPX with no track points', () => {
            const emptyGPX = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>`;
            expect(() => FileParser.parseGPX(emptyGPX, '#FF0000', 'test.gpx')).toThrow('No track points found');
        });

        it('should throw if all coordinates are invalid', () => {
            const badGPX = `<?xml version="1.0"?>
            <gpx version="1.1">
                <trk><trkseg>
                    <trkpt lat="999" lon="999"><ele>100</ele></trkpt>
                </trkseg></trk>
            </gpx>`;
            expect(() => FileParser.parseGPX(badGPX, '#FF0000', 'test.gpx')).toThrow('No valid track points');
        });
    });
});
