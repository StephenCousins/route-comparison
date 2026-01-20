// FileParser - Handles GPX and FIT file parsing
import { Utils } from './utils.js';

// Validation constants for GPS data
const VALIDATION = {
    LAT_MIN: -90,
    LAT_MAX: 90,
    LNG_MIN: -180,
    LNG_MAX: 180,
    ELEV_MIN: -500,    // Dead Sea is ~-430m
    ELEV_MAX: 9000,    // Everest is ~8849m
    MAX_SPEED_KMH: 35  // Max running speed for GPS cleaning
};

export class FileParser {
    // Validate a single coordinate pair
    static validateCoordinate(lat, lng) {
        if (lat === null || lat === undefined || lng === null || lng === undefined) {
            return { valid: false, reason: 'missing' };
        }
        if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
            return { valid: false, reason: 'invalid_number' };
        }
        if (lat < VALIDATION.LAT_MIN || lat > VALIDATION.LAT_MAX) {
            return { valid: false, reason: 'lat_out_of_range' };
        }
        if (lng < VALIDATION.LNG_MIN || lng > VALIDATION.LNG_MAX) {
            return { valid: false, reason: 'lng_out_of_range' };
        }
        return { valid: true };
    }

    // Validate elevation value
    static validateElevation(elevation) {
        if (elevation === null || elevation === undefined) {
            return { valid: true, value: null }; // Null is acceptable for elevation
        }
        if (isNaN(elevation) || !isFinite(elevation)) {
            return { valid: false, reason: 'invalid_number' };
        }
        if (elevation < VALIDATION.ELEV_MIN || elevation > VALIDATION.ELEV_MAX) {
            return { valid: false, reason: 'out_of_range' };
        }
        return { valid: true, value: elevation };
    }

    // Validate timestamp (must be chronological)
    static validateTimestamp(timestamp, prevTimestamp) {
        if (timestamp === null || timestamp === undefined) {
            return { valid: true, value: null }; // Null is acceptable
        }
        if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
            return { valid: false, reason: 'invalid_date' };
        }
        if (prevTimestamp && timestamp < prevTimestamp) {
            return { valid: false, reason: 'not_chronological' };
        }
        return { valid: true, value: timestamp };
    }

    // Batch validate parsed data, returning cleaned arrays
    static validateParsedData(rawData) {
        const validated = {
            coordinates: [],
            elevations: [],
            timestamps: [],
            heartRates: [],
            cadences: [],
            powers: [],
            skipped: 0,
            warnings: []
        };

        let lastValidTimestamp = null;

        for (let i = 0; i < rawData.coordinates.length; i++) {
            const coord = rawData.coordinates[i];
            const coordResult = this.validateCoordinate(coord.lat, coord.lng);

            if (!coordResult.valid) {
                validated.skipped++;
                validated.warnings.push(`Point ${i}: Invalid coordinate (${coordResult.reason})`);
                continue;
            }

            const elevResult = this.validateElevation(rawData.elevations[i]);
            if (!elevResult.valid) {
                validated.warnings.push(`Point ${i}: Invalid elevation (${elevResult.reason}), using null`);
            }

            const tsResult = this.validateTimestamp(rawData.timestamps[i], lastValidTimestamp);
            if (!tsResult.valid) {
                validated.warnings.push(`Point ${i}: Invalid timestamp (${tsResult.reason}), using null`);
            } else if (tsResult.value) {
                lastValidTimestamp = tsResult.value;
            }

            // Add validated point
            validated.coordinates.push(coord);
            validated.elevations.push(elevResult.valid ? elevResult.value : null);
            validated.timestamps.push(tsResult.valid ? tsResult.value : null);
            validated.heartRates.push(rawData.heartRates[i] ?? null);
            validated.cadences.push(rawData.cadences[i] ?? null);
            validated.powers.push(rawData.powers[i] ?? null);
        }

        return validated;
    }
    static parseGPX(xmlString, color, filename) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlString, 'text/xml');

        if (xml.getElementsByTagName('parsererror').length > 0) {
            throw new Error('Invalid XML');
        }

        // Collect raw data first
        const rawData = {
            coordinates: [],
            elevations: [],
            timestamps: [],
            heartRates: [],
            cadences: [],
            powers: []
        };

        const trkpts = xml.getElementsByTagName('trkpt');
        const points = trkpts.length > 0 ? trkpts : xml.getElementsByTagName('rtept');

        for (let i = 0; i < points.length; i++) {
            const lat = parseFloat(points[i].getAttribute('lat'));
            const lon = parseFloat(points[i].getAttribute('lon'));
            rawData.coordinates.push({ lat, lng: lon });

            const eleNode = points[i].getElementsByTagName('ele')[0];
            rawData.elevations.push(eleNode ? parseFloat(eleNode.textContent) : null);

            const timeNode = points[i].getElementsByTagName('time')[0];
            rawData.timestamps.push(timeNode ? new Date(timeNode.textContent) : null);

            const extensions = points[i].getElementsByTagName('extensions')[0];
            rawData.heartRates.push(this.extractExtensionValue(extensions, ['tpx1:hr', 'gpxtpx:hr', 'ns3:hr', 'hr', 'heartrate', 'HeartRate']));
            const cadenceValue = this.extractExtensionValue(extensions, ['tpx1:cad', 'gpxtpx:cad', 'ns3:cad', 'cad', 'cadence', 'Cadence', 'RunCadence']);
            rawData.cadences.push(cadenceValue !== null && cadenceValue !== undefined ? cadenceValue * 2 : null);
            rawData.powers.push(this.extractExtensionValue(extensions, ['tpx1:power', 'power', 'Power', 'gpxtpx:power', 'ns3:power', 'pwr']));
        }

        if (rawData.coordinates.length === 0) {
            throw new Error('No track points found');
        }

        // Validate parsed data
        const validated = this.validateParsedData(rawData);

        // Log warnings if any
        if (validated.warnings.length > 0) {
            console.warn(`GPX ${filename}: ${validated.skipped} points skipped during validation`);
            if (validated.warnings.length <= 10) {
                validated.warnings.forEach(w => console.warn(w));
            } else {
                console.warn(`First 10 of ${validated.warnings.length} warnings:`);
                validated.warnings.slice(0, 10).forEach(w => console.warn(w));
            }
        }

        // Throw if no valid points remain
        if (validated.coordinates.length === 0) {
            throw new Error('No valid track points after validation');
        }

        const { coordinates, elevations, timestamps, heartRates, cadences, powers } = validated;

        // Calculate speeds and paces
        const speeds = [], paces = [];
        for (let i = 0; i < coordinates.length; i++) {
            if (i === 0 || !timestamps[i] || !timestamps[i-1]) {
                speeds.push(null);
                paces.push(null);
            } else {
                const dist = Utils.haversineDistance(coordinates[i-1], coordinates[i]);
                const timeDiff = (timestamps[i] - timestamps[i-1]) / 1000 / 3600;
                if (timeDiff > 0 && dist > 0) {
                    const speed = dist / timeDiff;
                    speeds.push(speed);
                    paces.push(60 / speed);
                } else {
                    speeds.push(null);
                    paces.push(null);
                }
            }
        }

        // Clean GPS data (filter outliers and smooth)
        const cleanedData = Utils.cleanGPSData(speeds, paces, coordinates, timestamps, VALIDATION.MAX_SPEED_KMH);
        const smoothedSpeeds = Utils.rollingMedian(cleanedData.speeds, 5);
        const smoothedPaces = Utils.rollingMedian(cleanedData.paces, 5);

        return this.createRouteData(filename, color, coordinates, elevations, timestamps,
            heartRates, cadences, powers, smoothedSpeeds, smoothedPaces);
    }

    static extractExtensionValue(extensions, tagNames) {
        if (!extensions) return null;
        for (let tagName of tagNames) {
            const node = extensions.getElementsByTagName(tagName)[0];
            if (node && node.textContent) {
                const value = parseFloat(node.textContent);
                if (!isNaN(value)) return value;
            }
        }
        return null;
    }

    static parseFIT(arrayBuffer, color, filename) {
        return new Promise((resolve, reject) => {
            if (!window.FitParser) {
                reject(new Error('FIT parser not loaded'));
                return;
            }

            const fitParser = new FitParser({
                force: true,
                speedUnit: 'km/h',
                lengthUnit: 'm',
                temperatureUnit: 'celsius',
                elapsedRecordField: true,
                mode: 'list'
            });

            fitParser.parse(arrayBuffer, (error, data) => {
                if (error) {
                    reject(error);
                    return;
                }

                const records = data.records || [];
                if (records.length === 0) {
                    reject(new Error('No data points found'));
                    return;
                }

                const coordinates = [], elevations = [], timestamps = [];
                const heartRates = [], cadences = [], powers = [], speeds = [], paces = [];

                records.forEach(record => {
                    if (record.position_lat !== undefined && record.position_long !== undefined) {
                        const lat = record.position_lat;
                        const lng = record.position_long;

                        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                            coordinates.push({ lat, lng });
                            elevations.push(record.enhanced_altitude ?? record.altitude ?? null);
                            timestamps.push(record.timestamp ? new Date(record.timestamp) : null);
                            heartRates.push(record.heart_rate ?? null);
                            cadences.push(record.cadence !== null && record.cadence !== undefined ? record.cadence * 2 : null);
                            powers.push(record.power ?? null);

                            let speedKmh = null;
                            if (record.enhanced_speed !== undefined && record.enhanced_speed !== null) {
                                speedKmh = record.enhanced_speed;
                            } else if (record.speed !== undefined && record.speed !== null) {
                                speedKmh = record.speed;
                            }
                            speeds.push(speedKmh);
                            paces.push(speedKmh && speedKmh > 0 ? 60 / speedKmh : null);
                        }
                    }
                });

                if (coordinates.length === 0) {
                    reject(new Error('No valid GPS data found'));
                    return;
                }

                // Clean GPS data (filter outliers and smooth)
                const cleanedData = Utils.cleanGPSData(speeds, paces, coordinates, timestamps, VALIDATION.MAX_SPEED_KMH);
                const smoothedSpeeds = Utils.rollingMedian(cleanedData.speeds, 5);
                const smoothedPaces = Utils.rollingMedian(cleanedData.paces, 5);

                // Debug logging
                const nonNullSpeeds = smoothedSpeeds.filter(s => s !== null && s !== undefined);
                console.log('FIT File Parsed:');
                console.log(`  Total points: ${coordinates.length}`);
                console.log(`  Speed values: ${nonNullSpeeds.length} non-null of ${smoothedSpeeds.length} total`);

                resolve(this.createRouteData(filename, color, coordinates, elevations,
                    timestamps, heartRates, cadences, powers, smoothedSpeeds, smoothedPaces));
            });
        });
    }

    static createRouteData(filename, color, coordinates, elevations, timestamps,
        heartRates, cadences, powers, speeds, paces) {
        const distance = Utils.calculateDistance(coordinates);
        const elevStats = Utils.calculateElevationStats(elevations);

        let duration = null;
        const validTimestamps = timestamps.filter(t => t !== null);
        if (validTimestamps.length >= 2) {
            duration = (validTimestamps[validTimestamps.length - 1] - validTimestamps[0]) / 1000;
        }

        return {
            filename,
            color,
            coordinates,
            elevations,
            heartRates,
            cadences,
            powers,
            speeds,
            paces,
            timestamps,
            stats: {
                distance,
                elevationGain: elevStats.gain,
                elevationLoss: elevStats.loss,
                minElevation: elevStats.min,
                maxElevation: elevStats.max,
                duration
            }
        };
    }
}
