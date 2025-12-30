// MapManager - Handles map interactions
import { Utils } from './utils.js';

export class MapManager {
    constructor(mapElement) {
        this.map = new google.maps.Map(mapElement, {
            center: { lat: 40, lng: -100 },
            zoom: 4,
            mapTypeControl: true,
            streetViewControl: false
        });
        this.tooltip = document.getElementById('routeTooltip');
    }

    fitToRoutes(routes) {
        const visibleRoutes = routes.filter(r => r.visible);
        if (visibleRoutes.length === 0) return;

        const bounds = new google.maps.LatLngBounds();
        visibleRoutes.forEach(route => {
            route.coordinates.forEach(coord => bounds.extend(coord));
        });
        this.map.fitBounds(bounds);
    }

    showTooltip(text, latLng, distance, time) {
        let content = `<strong>${text}</strong>`;
        if (distance !== undefined) {
            content += `<br>Distance: ${Utils.formatDistance(distance / 1000)}`;
        }
        if (time !== null && time !== undefined) {
            content += `<br>Time: ${Utils.formatDuration(time)}`;
        }

        this.tooltip.innerHTML = content;
        this.tooltip.style.display = 'block';

        const projection = this.map.getProjection();
        const point = projection.fromLatLngToPoint(latLng);
        const scale = Math.pow(2, this.map.getZoom());
        const pixelOffset = new google.maps.Point(
            Math.floor(point.x * scale),
            Math.floor(point.y * scale)
        );

        const bounds = this.map.getBounds();
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const topRight = projection.fromLatLngToPoint(ne);
        const bottomLeft = projection.fromLatLngToPoint(sw);

        const x = (pixelOffset.x - bottomLeft.x * scale);
        const y = (pixelOffset.y - topRight.y * scale);

        const mapDiv = document.getElementById('map');
        const rect = mapDiv.getBoundingClientRect();

        this.tooltip.style.left = (rect.left + x + 10) + 'px';
        this.tooltip.style.top = (rect.top + y - 30) + 'px';
    }

    hideTooltip() {
        this.tooltip.style.display = 'none';
    }
}
