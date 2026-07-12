// Route class - Encapsulates route data and map objects
import { Utils } from './utils.js';

export class Route {
    constructor(data) {
        this.id = Date.now() + Math.random();
        this.filename = data.filename;
        this.displayName = data.displayName || data.filename.replace(/\.(gpx|fit)$/i, '').replace(/_/g, ' ');
        this.color = data.color;
        this.coordinates = data.coordinates;
        this.elevations = data.elevations || [];
        this.heartRates = data.heartRates || [];
        this.cadences = data.cadences || [];
        this.powers = data.powers || [];
        this.gpsAccuracies = data.gpsAccuracies || [];
        this.device = data.device || null;
        this.speeds = data.speeds || [];
        this.paces = data.paces || [];
        this.timestamps = data.timestamps || [];
        this.stats = data.stats;
        this.visible = true;
        this.selected = true; // included in the comparison by default; uncheck to exclude
        this.isPlaying = false;

        // Map objects
        this.polyline = null;
        this.startMarker = null;
        this.animationMarker = null;

        // Animation state
        this.animationState = null;

        // Overlay state — pace heatmap and GPS-deviation heatmap are mutually
        // exclusive alternate renderings of this route, drawn as many small
        // colored polylines instead of one flat-color polyline.
        this.overlayMode = null; // null | 'pace' | 'deviation'
        this.overlayPolylines = [];
        this.deviationResult = null; // cached Utils.calculateCrossTrackDeviation() output
    }

    createMapObjects(map, index, handlers) {
        this.polyline = new google.maps.Polyline({
            path: this.coordinates,
            geodesic: true,
            strokeColor: this.color,
            strokeOpacity: 1.0,
            strokeWeight: 5,
            map: map
        });

        this.startMarker = new google.maps.Marker({
            position: this.coordinates[0],
            map: map,
            label: {
                text: String(index + 1),
                color: 'white',
                fontWeight: 'bold',
                fontSize: '12px'
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: this.color,
                fillOpacity: 1,
                strokeColor: 'white',
                strokeWeight: 2
            },
            zIndex: 1000
        });

        // Attach event handlers
        this.polyline.addListener('mouseover', (e) => handlers.onMouseOver(this, e));
        this.polyline.addListener('mousemove', (e) => handlers.onMouseMove(this, e));
        this.polyline.addListener('mouseout', () => handlers.onMouseOut());
        this.polyline.addListener('click', () => handlers.onClick(this));
    }

    setVisible(visible, map) {
        this.visible = visible;
        if (this.overlayMode) {
            this.overlayPolylines.forEach(p => p.setMap(visible ? map : null));
            this.polyline.setMap(null);
        } else {
            this.polyline.setMap(visible ? map : null);
        }
        this.startMarker.setMap(visible ? map : null);
    }

    highlight(highlight) {
        const weight = highlight ? 8 : 5;
        if (this.overlayMode) {
            this.overlayPolylines.forEach(p => p.setOptions({ strokeWeight: weight }));
        } else {
            this.polyline.setOptions({ strokeWeight: weight, strokeOpacity: 1.0 });
        }
    }

    getClosestPointInfo(latLng) {
        let minDistance = Infinity;
        let closestIndex = 0;

        for (let i = 0; i < this.coordinates.length; i++) {
            const coord = this.coordinates[i];
            const distance = google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(coord.lat, coord.lng),
                latLng
            );

            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }

        // Calculate cumulative distance to this point
        let distanceToPoint = 0;
        for (let i = 1; i <= closestIndex; i++) {
            const prev = this.coordinates[i - 1];
            const curr = this.coordinates[i];
            distanceToPoint += google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(prev.lat, prev.lng),
                new google.maps.LatLng(curr.lat, curr.lng)
            );
        }

        // Calculate elapsed time to this point
        let timeToPoint = null;
        if (this.timestamps.length > closestIndex && this.timestamps[0] && this.timestamps[closestIndex]) {
            const startTime = this.timestamps[0];
            const currentTime = this.timestamps[closestIndex];
            timeToPoint = (currentTime - startTime) / 1000;
        }

        return {
            index: closestIndex,
            distance: distanceToPoint,
            time: timeToPoint
        };
    }

    // Overlay methods — decimate to ~500 segments and color each one, replacing
    // the single flat-color polyline. Pace and deviation overlays share this
    // shape; only the per-segment color source differs.
    createPaceOverlay(map) {
        this.clearOverlayPolylines();

        // Need pace data
        if (!this.paces || this.paces.length < 2) {
            return false;
        }

        // Get valid paces for min/max calculation
        const validPaces = this.paces.filter(p => p !== null && p > 0 && p < 30);
        if (validPaces.length === 0) {
            return false;
        }

        const minPace = Math.min(...validPaces);
        const maxPace = Math.max(...validPaces);

        // Decimate for performance (max ~500 segments)
        const step = Math.max(1, Math.floor(this.coordinates.length / 500));

        for (let i = 0; i < this.coordinates.length - step; i += step) {
            const endIdx = Math.min(i + step, this.coordinates.length - 1);

            // Get average pace for this segment
            let paceSum = 0;
            let paceCount = 0;
            for (let j = i; j <= endIdx; j++) {
                if (this.paces[j] !== null && this.paces[j] > 0) {
                    paceSum += this.paces[j];
                    paceCount++;
                }
            }
            const avgPace = paceCount > 0 ? paceSum / paceCount : (minPace + maxPace) / 2;

            const color = Utils.getPaceColor(avgPace, minPace, maxPace);

            const segment = new google.maps.Polyline({
                path: [this.coordinates[i], this.coordinates[endIdx]],
                geodesic: true,
                strokeColor: color,
                strokeOpacity: 1.0,
                strokeWeight: 5,
                map: map
            });

            this.overlayPolylines.push(segment);
        }

        return true;
    }

    // perPointDeviations/maxDeviation come from Utils.calculateCrossTrackDeviation().
    createDeviationOverlay(map, perPointDeviations, maxDeviation) {
        this.clearOverlayPolylines();

        if (!perPointDeviations || perPointDeviations.length < 2) {
            return false;
        }

        const step = Math.max(1, Math.floor(this.coordinates.length / 500));

        for (let i = 0; i < this.coordinates.length - step; i += step) {
            const endIdx = Math.min(i + step, this.coordinates.length - 1);

            let sum = 0;
            let count = 0;
            for (let j = i; j <= endIdx; j++) {
                if (perPointDeviations[j] !== null && perPointDeviations[j] !== undefined) {
                    sum += perPointDeviations[j];
                    count++;
                }
            }
            const avgDeviation = count > 0 ? sum / count : null;

            const color = Utils.getDeviationColor(avgDeviation, maxDeviation);

            const segment = new google.maps.Polyline({
                path: [this.coordinates[i], this.coordinates[endIdx]],
                geodesic: true,
                strokeColor: color,
                strokeOpacity: 1.0,
                strokeWeight: 5,
                map: map
            });

            this.overlayPolylines.push(segment);
        }

        return true;
    }

    toggleHeatmap(map) {
        if (this.overlayMode === 'pace') {
            this.clearOverlayPolylines();
            this.overlayMode = null;
            if (this.visible) {
                this.polyline.setMap(map);
            }
        } else {
            const success = this.createPaceOverlay(map);
            if (success) {
                this.overlayMode = 'pace';
                this.polyline.setMap(null);
            }
        }
        return this.overlayMode === 'pace';
    }

    // result is the object returned by Utils.calculateCrossTrackDeviation().
    toggleDeviationOverlay(map, result) {
        if (this.overlayMode === 'deviation') {
            this.clearOverlayPolylines();
            this.overlayMode = null;
            if (this.visible) {
                this.polyline.setMap(map);
            }
        } else {
            const maxDeviation = result.stats.p95 || result.stats.max;
            const success = this.createDeviationOverlay(map, result.perPointDeviations, maxDeviation);
            if (success) {
                this.overlayMode = 'deviation';
                this.polyline.setMap(null);
            }
        }
        return this.overlayMode === 'deviation';
    }

    clearOverlayPolylines() {
        this.overlayPolylines.forEach(p => {
            p.setMap(null);
        });
        this.overlayPolylines = [];
    }

    hasPaceData() {
        return this.paces && this.paces.some(p => p !== null && p > 0);
    }

    destroy() {
        if (this.polyline) {
            google.maps.event.clearInstanceListeners(this.polyline);
            this.polyline.setMap(null);
            this.polyline = null;
        }
        if (this.startMarker) {
            this.startMarker.setMap(null);
            this.startMarker = null;
        }
        if (this.animationMarker) {
            this.animationMarker.setMap(null);
            this.animationMarker = null;
        }
        this.clearOverlayPolylines();
        this.overlayMode = null;
        this.animationState = null;
    }
}
