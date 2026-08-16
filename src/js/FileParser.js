// FileParser - Handles GPX and FIT file parsing
import { Utils } from './utils.js';

// The FIT parser is an ESM package pulled from a CDN. Load it on demand and
// cache the import promise: the first FIT upload triggers the fetch, later ones
// reuse it, and a genuine load failure surfaces as a clear error instead of the
// old race where `window.FitParser` could still be undefined at upload time.
let fitParserPromise = null;
function loadFitParser() {
    if (!fitParserPromise) {
        fitParserPromise = import('https://esm.run/fit-file-parser@4.1.0')
            .then((mod) => {
                // fit-file-parser ships CommonJS with `exports.default = FitParser`,
                // so the CDN's ESM default is `{ default: FitParser }` — the real
                // constructor is nested. Unwrap `default` until we reach the function.
                let ctor = mod;
                for (let i = 0; i < 3 && ctor && typeof ctor !== 'function'; i++) {
                    ctor = ctor.default;
                }
                if (typeof ctor !== 'function') {
                    throw new Error('FIT parser module did not expose a constructor.');
                }
                return ctor;
            })
            .catch((err) => {
                // Clear the cache so a later upload can retry after a transient
                // network/CDN failure rather than being stuck on the rejection.
                fitParserPromise = null;
                throw new Error('Could not load the FIT parser from the CDN — check your connection and try again.');
            });
    }
    return fitParserPromise;
}

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

    // Build a device/firmware summary from FIT file_id + device_info messages.
    // device_info's `product` field is a raw numeric ID (not name-resolved by
    // the parser) — fall back to a manufacturer+ID label when `product_name`
    // (a string some firmwares write) isn't present in the file.
    static buildDeviceInfo(data) {
        const deviceInfos = data.device_infos || [];
        const fileId = (data.file_ids || [])[0] || null;
        const primary = deviceInfos.find(d => d.source_type === 'local') || deviceInfos[0] || null;

        const manufacturer = primary?.manufacturer ?? fileId?.manufacturer ?? null;
        const productId = primary?.product ?? fileId?.product ?? null;
        const productName = primary?.product_name ?? fileId?.product_name
            ?? (manufacturer && productId ? `${manufacturer} product ${productId}` : null);
        const firmwareVersion = primary?.software_version ?? null;
        const serialNumber = primary?.serial_number ?? fileId?.serial_number ?? null;

        if (!manufacturer && !productName) {
            return null;
        }

        return { manufacturer, productName, firmwareVersion, serialNumber };
    }

    // Scan raw FIT binary for message type 104 ("pad") which Garmin uses
    // for periodic battery snapshots: field 2 = battery %, field 253 = timestamp.
    static extractBatteryFromRaw(arrayBuffer) {
        const buf = new Uint8Array(arrayBuffer);
        if (buf.length < 14) return [];
        const headerSize = buf[0];
        let offset = headerSize;
        const definitions = {};
        const GARMIN_EPOCH = new Date('1989-12-31T00:00:00Z').getTime();
        const snapshots = [];

        while (offset < buf.length - 2) {
            const rh = buf[offset]; offset++;

            if ((rh & 0x80) !== 0) {
                const lt = (rh >> 5) & 0x03;
                if (definitions[lt]) offset += definitions[lt].totalSize;
                continue;
            }

            const isDef = (rh & 0x40) !== 0;
            const hasDev = (rh & 0x20) !== 0;
            const lt = rh & 0x0F;

            if (isDef) {
                offset++; // reserved
                const arch = buf[offset]; offset++;
                const gm = arch === 0
                    ? (buf[offset] | (buf[offset + 1] << 8))
                    : ((buf[offset] << 8) | buf[offset + 1]);
                offset += 2;
                const nf = buf[offset]; offset++;
                const fields = [];
                let totalSize = 0;
                for (let i = 0; i < nf; i++) {
                    const fn = buf[offset++], sz = buf[offset++], bt = buf[offset++];
                    fields.push({ fn, sz, off: totalSize });
                    totalSize += sz;
                }
                if (hasDev) {
                    const dc = buf[offset]; offset++;
                    for (let i = 0; i < dc; i++) {
                        offset++; totalSize += buf[offset++]; offset++;
                    }
                }
                definitions[lt] = { gm, fields, totalSize };
            } else {
                const def = definitions[lt];
                if (!def) break;

                if (def.gm === 104) {
                    let ts = null, pct = null;
                    for (const f of def.fields) {
                        const o = offset + f.off;
                        if (f.fn === 253 && f.sz === 4) {
                            const v = (buf[o] | (buf[o+1] << 8) | (buf[o+2] << 16) | (buf[o+3] << 24)) >>> 0;
                            if (v !== 0xFFFFFFFF) ts = GARMIN_EPOCH + v * 1000;
                        } else if (f.fn === 2 && f.sz === 1) {
                            const v = buf[o];
                            if (v !== 0xFF) pct = v;
                        }
                    }
                    if (ts !== null && pct !== null) {
                        snapshots.push({ time: ts, pct });
                    }
                }
                offset += def.totalSize;
            }
        }
        return snapshots;
    }

    // Extract per-trackpoint battery levels from a FIT file.
    // Sources (checked in order):
    //   1. Per-record developer fields (Connect IQ battery data field)
    //   2. Raw binary message type 104 battery snapshots (Garmin "pad")
    //   3. device_info battery_level snapshots (device_index 0 = the watch)
    //   4. device_info battery_voltage snapshots (converted to relative %)
    // Sparse snapshots are step-interpolated to each trackpoint timestamp.
    static buildBatteryLevels(data, timestamps, rawArrayBuffer) {
        const records = data.records || [];

        // 1. Per-record battery fields (Connect IQ developer fields or native)
        const perRecordSoc = [];
        let hasPerRecord = false;
        records.forEach(record => {
            if (record.position_lat !== undefined && record.position_long !== undefined) {
                const lat = record.position_lat;
                const lng = record.position_long;
                if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                    const soc = record.battery_soc ?? record.battery_level ?? null;
                    if (soc !== null) hasPerRecord = true;
                    perRecordSoc.push(soc);
                }
            }
        });
        if (hasPerRecord) return perRecordSoc;

        // 2. Raw binary message type 104 battery snapshots
        if (rawArrayBuffer) {
            const rawSnapshots = this.extractBatteryFromRaw(rawArrayBuffer);
            if (rawSnapshots.length >= 1) {
                return this.interpolateSnapshots(rawSnapshots, timestamps, s => s.pct);
            }
        }

        // 3. device_info battery_level snapshots (percentage, device_index 0)
        //    (rarely populated — most Garmin watches use message 104 instead)
        const deviceInfos = data.device_infos || [];
        const levelSnapshots = [];
        for (const di of deviceInfos) {
            if (di.battery_level != null && isFinite(di.battery_level) && di.timestamp) {
                const t = new Date(di.timestamp).getTime();
                if (isFinite(t) && (di.device_index === 0 || di.device_index === undefined)) {
                    levelSnapshots.push({ time: t, pct: di.battery_level });
                }
            }
        }
        if (levelSnapshots.length >= 1) {
            return this.interpolateSnapshots(levelSnapshots, timestamps, s => s.pct);
        }

        // 4. device_info battery_voltage snapshots (convert to relative %)
        const voltSnapshots = [];
        for (const di of deviceInfos) {
            if (di.battery_voltage != null && isFinite(di.battery_voltage) && di.timestamp) {
                const t = new Date(di.timestamp).getTime();
                if (isFinite(t)) voltSnapshots.push({ time: t, voltage: di.battery_voltage });
            }
        }
        if (voltSnapshots.length < 2) return [];

        voltSnapshots.sort((a, b) => a.time - b.time);
        const minV = Math.min(...voltSnapshots.map(s => s.voltage));
        const maxV = Math.max(...voltSnapshots.map(s => s.voltage));
        const rangeV = maxV - minV;
        return this.interpolateSnapshots(voltSnapshots, timestamps,
            s => rangeV > 0 ? ((s.voltage - minV) / rangeV) * 100 : 100);
    }

    // Step-interpolate sparse snapshots to per-trackpoint values.
    // Uses step (hold previous value) rather than linear interpolation
    // to match how battery level actually behaves (discrete steps).
    static interpolateSnapshots(snapshots, timestamps, getValue) {
        if (snapshots.length === 0) return [];
        const sorted = [...snapshots].sort((a, b) => a.time - b.time);

        return timestamps.map(ts => {
            if (!ts) return null;
            const t = ts.getTime();
            if (t <= sorted[0].time) return getValue(sorted[0]);
            if (t >= sorted[sorted.length - 1].time) return getValue(sorted[sorted.length - 1]);
            for (let i = sorted.length - 1; i >= 0; i--) {
                if (t >= sorted[i].time) return getValue(sorted[i]);
            }
            return null;
        });
    }

    // Extract HR zone boundaries from a FIT file.
    // Priority: time_in_zone (exact device boundaries) > hr_zone messages
    //         > computed from zones_target + user_profile.
    static buildHrZoneBoundaries(data) {
        const names = ['Warm Up', 'Easy', 'Aerobic', 'Threshold', 'Maximum'];

        // 1. time_in_zone messages (Garmin Fenix 9, etc.) — contain the exact
        //    zone boundaries the device used, in hr_zone_high_boundary.
        const tiz = data.time_in_zone || data.time_in_zones || [];
        if (tiz.length > 0 && tiz[0].hr_zone_high_boundary) {
            const highs = tiz[0].hr_zone_high_boundary.filter(v => v != null);
            if (highs.length >= 2) {
                return highs.slice(0, 5).map((h, i) => ({ high: h, name: names[i] || `Zone ${i + 1}` }));
            }
        }

        // 2. Explicit hr_zone messages (some devices write them)
        const hrZones = data.hr_zones || data.hr_zone || [];
        if (hrZones.length >= 2) {
            const sorted = [...hrZones].sort((a, b) =>
                (a.message_index ?? 0) - (b.message_index ?? 0));
            const boundaries = sorted
                .filter(z => z.high_bpm != null)
                .map(z => ({ high: z.high_bpm, name: z.name || null }));
            if (boundaries.length >= 2) return boundaries;
        }

        // 3. Compute from zones_target + user_profile
        const zt = data.zones_target;
        if (!zt || !zt.max_heart_rate) return null;
        const maxHR = zt.max_heart_rate;
        const restingHR = data.user_profile?.resting_heart_rate ?? null;

        if (zt.hr_calc_type === 'percent_hrr' && restingHR != null) {
            const hrr = maxHR - restingHR;
            const pcts = [0.60, 0.70, 0.80, 0.90, 1.00];
            return pcts.map((p, i) => ({
                high: Math.round(restingHR + hrr * p),
                name: names[i]
            }));
        }

        const pcts = [0.60, 0.70, 0.80, 0.90, 1.00];
        return pcts.map((p, i) => ({
            high: Math.round(maxHR * p),
            name: names[i]
        }));
    }

    // Extract power zone boundaries from a FIT file.
    // Priority: time_in_zone > power_zone messages > computed from FTP.
    static buildPowerZoneBoundaries(data) {
        const names = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'Max'];

        // 1. time_in_zone messages — exact device boundaries
        const tiz = data.time_in_zone || data.time_in_zones || [];
        if (tiz.length > 0 && tiz[0].power_zone_high_boundary) {
            const highs = tiz[0].power_zone_high_boundary.filter(v => v != null);
            if (highs.length >= 2) {
                return highs.slice(0, 5).map((h, i) => ({ high: h, name: names[i] || `Zone ${i + 1}` }));
            }
        }

        // 2. Explicit power_zone messages
        const pZones = data.power_zones || data.power_zone || [];
        if (pZones.length >= 2) {
            const sorted = [...pZones].sort((a, b) =>
                (a.message_index ?? 0) - (b.message_index ?? 0));
            const boundaries = sorted
                .filter(z => z.high_value != null)
                .map(z => ({ high: z.high_value, name: z.name || null }));
            if (boundaries.length >= 2) return boundaries;
        }

        // 3. Compute from FTP
        const zt = data.zones_target;
        if (!zt || !zt.functional_threshold_power) return null;
        const ftp = zt.functional_threshold_power;
        const pcts = [0.55, 0.75, 0.90, 1.05, 1.20];
        return pcts.map((p, i) => ({
            high: Math.round(ftp * p),
            name: names[i]
        }));
    }

    // Build a self-reported totals summary from the FIT session message, used
    // to cross-check against values recomputed from the raw track — a
    // discrepancy there is a firmware self-reporting bug by definition.
    static buildSessionSummary(data) {
        const session = (data.sessions || [])[0];
        if (!session) return null;

        const totalDistanceKm = session.total_distance !== undefined && session.total_distance !== null
            ? session.total_distance / 1000 : null;
        const totalElapsedSeconds = session.total_elapsed_time ?? session.total_timer_time ?? null;
        const totalAscent = session.total_ascent ?? null;
        const totalDescent = session.total_descent ?? null;

        if (totalDistanceKm === null && totalElapsedSeconds === null && totalAscent === null && totalDescent === null) {
            return null;
        }

        return { totalDistanceKm, totalElapsedSeconds, totalAscent, totalDescent };
    }

    static async parseFIT(arrayBuffer, color, filename) {
        const FitParser = await loadFitParser();
        return new Promise((resolve, reject) => {
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

                const device = this.buildDeviceInfo(data);
                const sessionSummary = this.buildSessionSummary(data);
                const hrZoneBoundaries = this.buildHrZoneBoundaries(data);
                const powerZoneBoundaries = this.buildPowerZoneBoundaries(data);
                // Battery levels are extracted after timestamps are collected (below)

                const coordinates = [], elevations = [], timestamps = [];
                const heartRates = [], cadences = [], powers = [], speeds = [], paces = [];
                const gpsAccuracies = [], temperatures = [];
                const verticalOscillations = [], groundContactTimes = [], verticalRatios = [];
                const groundContactBalances = [], stepLengths = [], absolutePressures = [];
                const gpsElevations = [];

                records.forEach(record => {
                    if (record.position_lat !== undefined && record.position_long !== undefined) {
                        const lat = record.position_lat;
                        const lng = record.position_long;

                        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                            coordinates.push({ lat, lng });
                            elevations.push(record.enhanced_altitude ?? record.altitude ?? null);
                            gpsElevations.push(record.altitude ?? null);
                            timestamps.push(record.timestamp ? new Date(record.timestamp) : null);
                            heartRates.push(record.heart_rate ?? null);
                            temperatures.push(record.temperature ?? null);
                            cadences.push(record.cadence !== null && record.cadence !== undefined ? record.cadence * 2 : null);
                            powers.push(record.power ?? null);
                            gpsAccuracies.push(record.gps_accuracy ?? null);
                            verticalOscillations.push(record.vertical_oscillation ?? null);
                            groundContactTimes.push(record.stance_time ?? null);
                            verticalRatios.push(record.vertical_ratio ?? null);
                            groundContactBalances.push(record.stance_time_balance ?? null);
                            stepLengths.push(record.step_length ?? null);
                            absolutePressures.push(record.absolute_pressure ?? null);

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

                const batteryLevels = this.buildBatteryLevels(data, timestamps, arrayBuffer);

                // Clean GPS data (filter outliers and smooth)
                const cleanedData = Utils.cleanGPSData(speeds, paces, coordinates, timestamps, VALIDATION.MAX_SPEED_KMH);
                const smoothedSpeeds = Utils.rollingMedian(cleanedData.speeds, 5);
                const smoothedPaces = Utils.rollingMedian(cleanedData.paces, 5);

                // Debug logging
                const nonNullSpeeds = smoothedSpeeds.filter(s => s !== null && s !== undefined);
                const countValid = (arr) => arr.filter(v => v !== null && v !== undefined).length;
                console.log('FIT File Parsed:');
                console.log(`  Total points: ${coordinates.length}`);
                console.log(`  Speed values: ${nonNullSpeeds.length} non-null of ${smoothedSpeeds.length} total`);
                console.log(`  Device: ${device ? `${device.productName || device.manufacturer} (fw ${device.firmwareVersion})` : 'not found'}`);
                console.log(`  Session summary: ${sessionSummary ? 'found' : 'not found'}`);
                console.log('  Running dynamics coverage (non-null points):', {
                    verticalOscillation: `${countValid(verticalOscillations)}/${coordinates.length}`,
                    groundContactTime: `${countValid(groundContactTimes)}/${coordinates.length}`,
                    verticalRatio: `${countValid(verticalRatios)}/${coordinates.length}`,
                    groundContactBalance: `${countValid(groundContactBalances)}/${coordinates.length}`,
                    stepLength: `${countValid(stepLengths)}/${coordinates.length}`,
                    battery: `${countValid(batteryLevels)}/${coordinates.length}`
                });
                if (records[0]) {
                    console.log('  First record\'s raw field keys (for diagnosing missing metrics):', Object.keys(records[0]));
                }

                resolve(this.createRouteData(filename, color, coordinates, elevations,
                    timestamps, heartRates, cadences, powers, smoothedSpeeds, smoothedPaces,
                    {
                        gpsAccuracies, device, sessionSummary,
                        verticalOscillations, groundContactTimes, verticalRatios,
                        groundContactBalances, stepLengths, absolutePressures,
                        batteryLevels, hrZoneBoundaries, powerZoneBoundaries,
                        gpsElevations, temperatures
                    }));
            });
        });
    }

    static createRouteData(filename, color, coordinates, elevations, timestamps,
        heartRates, cadences, powers, speeds, paces, {
            gpsAccuracies = [], device = null, sessionSummary = null,
            verticalOscillations = [], groundContactTimes = [], verticalRatios = [],
            groundContactBalances = [], stepLengths = [], absolutePressures = [],
            batteryLevels = [], hrZoneBoundaries = null, powerZoneBoundaries = null,
            gpsElevations = [], temperatures = []
        } = {}) {
        const distance = Utils.calculateDistance(coordinates);
        const elevStats = Utils.calculateElevationStats(elevations);

        let duration = null;
        const validTimestamps = timestamps.filter(t => t !== null);
        if (validTimestamps.length >= 2) {
            duration = (validTimestamps[validTimestamps.length - 1] - validTimestamps[0]) / 1000;
        }

        // Only keep gpsElevations if they meaningfully differ from elevations
        // (i.e. the file has both GPS and barometric altitude)
        let validGpsElevations = [];
        if (gpsElevations.length > 0) {
            let diffCount = 0;
            for (let i = 0; i < Math.min(gpsElevations.length, elevations.length); i++) {
                if (gpsElevations[i] != null && elevations[i] != null &&
                    Math.abs(gpsElevations[i] - elevations[i]) > 0.1) {
                    diffCount++;
                }
            }
            if (diffCount > gpsElevations.length * 0.1) {
                validGpsElevations = gpsElevations;
            }
        }

        return {
            filename,
            color,
            coordinates,
            elevations,
            gpsElevations: validGpsElevations,
            heartRates,
            cadences,
            powers,
            gpsAccuracies,
            batteryLevels,
            temperatures,
            hrZoneBoundaries,
            powerZoneBoundaries,
            device,
            sessionSummary,
            verticalOscillations,
            groundContactTimes,
            verticalRatios,
            groundContactBalances,
            stepLengths,
            absolutePressures,
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
