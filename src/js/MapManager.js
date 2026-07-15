// MapManager - Handles map interactions
import { Utils } from './utils.js';

// A muted, low-chrome dark style so saturated route polylines stay the
// clear focal point instead of competing with Google's default basemap
// colors. Light theme uses the Maps default (styles: []).
const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1c2027' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1c2027' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8a93a1' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c9cdd4' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1a2420' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4c6b58' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c323c' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212632' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a93a1' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#363d49' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f242c' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b8bfc9' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#252a33' }] },
    { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1a20' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a6572' }] }
];

export class MapManager {
    constructor(mapElement) {
        const theme = document.documentElement.getAttribute('data-theme');
        this.isMobile = window.matchMedia('(max-width: 768px)').matches;
        this.map = new google.maps.Map(mapElement, {
            center: { lat: 40, lng: -100 },
            zoom: 4,
            mapTypeControl: !this.isMobile,
            streetViewControl: false,
            styles: theme === 'dark' ? DARK_MAP_STYLE : []
        });
        this.tooltip = document.getElementById('routeTooltip');
        this.waybackOverlay = null;
        this.waybackSnapshots = null;
        this.setupWaybackControl();
    }

    async setupWaybackControl() {
        const container = document.createElement('div');
        container.className = 'wayback-control';

        if (this.isMobile) {
            const mapTypeSelect = document.createElement('select');
            mapTypeSelect.className = 'wayback-select';
            mapTypeSelect.innerHTML = '<option value="roadmap">Map</option><option value="satellite">Satellite</option>';
            mapTypeSelect.addEventListener('change', () => this.map.setMapTypeId(mapTypeSelect.value));
            container.appendChild(mapTypeSelect);
        }

        const select = document.createElement('select');
        select.className = 'wayback-select';
        select.innerHTML = '<option value="">Satellite: Current</option>';
        select.addEventListener('change', () => this.setWaybackYear(select.value));

        container.appendChild(select);
        this.map.controls[google.maps.ControlPosition.TOP_RIGHT].push(container);

        try {
            const res = await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json');
            const config = await res.json();

            const byYear = {};
            for (const [tileId, entry] of Object.entries(config)) {
                const match = entry.itemTitle?.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (!match) continue;
                const year = parseInt(match[1]);
                const date = match[0];
                if (!byYear[year] || date > byYear[year].date) {
                    byYear[year] = { tileId, date };
                }
            }

            this.waybackSnapshots = {};
            const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
            for (const year of years) {
                const { tileId, date } = byYear[year];
                this.waybackSnapshots[year] = tileId;
                const opt = document.createElement('option');
                opt.value = year;
                opt.textContent = `Satellite: ${year}`;
                select.appendChild(opt);
            }
        } catch (e) {
            console.warn('Failed to load Wayback imagery config:', e);
        }
    }

    setWaybackYear(year) {
        if (this.waybackOverlay) {
            this.map.overlayMapTypes.clear();
            this.waybackOverlay = null;
        }

        if (!year || !this.waybackSnapshots?.[year]) return;

        const tileId = this.waybackSnapshots[year];
        this.waybackOverlay = new google.maps.ImageMapType({
            getTileUrl: (coord, zoom) =>
                `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${tileId}/${zoom}/${coord.y}/${coord.x}`,
            tileSize: new google.maps.Size(256, 256),
            maxZoom: 23,
            name: `Wayback ${year}`
        });
        this.map.setMapTypeId('satellite');
        this.map.overlayMapTypes.insertAt(0, this.waybackOverlay);
    }

    // Called by window.toggleTheme() so the basemap follows the app theme
    // without needing to recreate the google.maps.Map instance.
    applyThemeStyle() {
        const theme = document.documentElement.getAttribute('data-theme');
        this.map.setOptions({ styles: theme === 'dark' ? DARK_MAP_STYLE : [] });
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
