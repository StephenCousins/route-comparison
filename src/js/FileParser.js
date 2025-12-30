// FileParser - Handles GPX and FIT file parsing
import { Utils } from './utils.js';

export class FileParser {
    static parseGPX(xmlString, color, filename) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlString, 'text/xml');

        if (xml.getElementsByTagName('parsererror').length > 0) {
            throw new Error('Invalid XML');
        }

        const coordinates = [], elevations = [], timestamps = [];
        const heartRates = [], cadences = [], powers = [];

        const trkpts = xml.getElementsByTagName('trkpt');
        const points = trkpts.length > 0 ? trkpts : xml.getElementsByTagName('rtept');

        for (let i = 0; i < points.length; i++) {
            const lat = parseFloat(points[i].getAttribute('lat'));
            const lon = parseFloat(points[i].getAttribute('lon'));
            coordinates.push({ lat, lng: lon });

            const eleNode = points[i].getElementsByTagName('ele')[0];
            elevations.push(eleNode ? parseFloat(eleNode.textContent) : null);

            const timeNode = points[i].getElementsByTagName('time')[0];
            timestamps.push(timeNode ? new Date(timeNode.textContent) : null);

            const extensions = points[i].getElementsByTagName('extensions')[0];
            heartRates.push(this.extractExtensionValue(extensions, ['tpx1:hr', 'gpxtpx:hr', 'ns3:hr', 'hr', 'heartrate', 'HeartRate']));
            const cadenceValue = this.extractExtensionValue(extensions, ['tpx1:cad', 'gpxtpx:cad', 'ns3:cad', 'cad', 'cadence', 'Cadence', 'RunCadence']);
            cadences.push(cadenceValue !== null && cadenceValue !== undefined ? cadenceValue * 2 : null);
            powers.push(this.extractExtensionValue(extensions, ['tpx1:power', 'power', 'Power', 'gpxtpx:power', 'ns3:power', 'pwr']));
        }

        if (coordinates.length === 0) {
            throw new Error('No track points found');
        }

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

        return this.createRouteData(filename, color, coordinates, elevations, timestamps,
            heartRates, cadences, powers, speeds, paces);
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

                // Debug logging
                const nonNullSpeeds = speeds.filter(s => s !== null && s !== undefined);
                console.log('FIT File Parsed:');
                console.log(`  Total points: ${coordinates.length}`);
                console.log(`  Speed values: ${nonNullSpeeds.length} non-null of ${speeds.length} total`);

                resolve(this.createRouteData(filename, color, coordinates, elevations,
                    timestamps, heartRates, cadences, powers, speeds, paces));
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
