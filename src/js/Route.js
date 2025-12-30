// Route class - Encapsulates route data and map objects

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
        this.speeds = data.speeds || [];
        this.paces = data.paces || [];
        this.timestamps = data.timestamps || [];
        this.stats = data.stats;
        this.visible = true;
        this.selected = false;
        this.isPlaying = false;

        // Map objects
        this.polyline = null;
        this.startMarker = null;
        this.animationMarker = null;

        // Animation state
        this.animationState = null;
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
        this.polyline.setMap(visible ? map : null);
        this.startMarker.setMap(visible ? map : null);
    }

    highlight(highlight) {
        if (highlight) {
            this.polyline.setOptions({ strokeWeight: 8, strokeOpacity: 1.0 });
        } else {
            this.polyline.setOptions({ strokeWeight: 5, strokeOpacity: 1.0 });
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
        this.animationState = null;
    }
}
