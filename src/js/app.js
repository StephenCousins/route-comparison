// Main Application - GPX & FIT Route Overlay
import { Utils } from './utils.js';
import { Route } from './Route.js';
import { MapManager } from './MapManager.js';
import { AnimationManager } from './AnimationManager.js';
import { ChartManager } from './ChartManager.js';
import { FileParser } from './FileParser.js';
import { FirebaseAuthManager, FirebaseStorageManager, initializeFirebase, isFirebaseInitialized } from './FirebaseManager.js';
import { InsightsManager } from './InsightsManager.js';
import { config } from './config.js';

class RouteOverlayApp {
    constructor() {
        this.routes = [];
        this.colorIndex = 0;
        this.compareMode = false;
        this.highlightedRoute = null;
        this.currentUser = null;

        this.mapManager = null;
        this.animationManager = null;
        this.chartManager = null;
        this.insightsManager = null;
        this.authManager = null;
        this.storageManager = null;

        // Initialize Firebase first
        initializeFirebase();

        this.authManager = new FirebaseAuthManager();
        this.storageManager = new FirebaseStorageManager();

        this.setupAuthUI();
        this.chartManager = new ChartManager();
        this.insightsManager = new InsightsManager();

        this.setupDropZones();
        this.setupCompareMode();
        this.setupSidebarToggle();
    }

    initMap() {
        this.mapManager = new MapManager(document.getElementById('map'));
        this.animationManager = new AnimationManager(this.mapManager);
    }

    setupAuthUI() {
        const signInBtn = document.getElementById('signInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const userInfo = document.getElementById('userInfo');
        const userName = document.getElementById('userName');
        const savedSessionsList = document.getElementById('savedSessionsList');
        const saveBtn = document.getElementById('saveCurrentBtn');

        signInBtn.addEventListener('click', () => this.authManager.signInWithGoogle());
        signOutBtn.addEventListener('click', () => this.authManager.signOut());
        saveBtn.addEventListener('click', () => this.saveCurrentSession());

        this.authManager.onAuthStateChanged(async (user) => {
            this.currentUser = user;

            if (user) {
                signInBtn.classList.add('hidden');
                userInfo.classList.remove('hidden');
                userName.textContent = user.displayName || user.email;
                this.storageManager.setUser(user.uid);
                await this.loadSavedSessions();
            } else {
                signInBtn.classList.remove('hidden');
                userInfo.classList.add('hidden');
                savedSessionsList.innerHTML = '';
                this.storageManager.setUser(null);
            }
            this.updateUI();
        });
    }

    async loadSavedSessions() {
        const sessions = await this.storageManager.getSavedSessions();
        const list = document.getElementById('savedSessionsList');
        list.innerHTML = '';

        sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'saved-session-item';

            const info = document.createElement('div');
            info.className = 'session-info';

            const routeNames = session.routes.map(r => r.displayName || 'Unnamed').slice(0, 2);
            const moreText = session.routes.length > 2 ? ` +${session.routes.length - 2} more` : '';
            info.innerHTML = `
                <div class="session-name">${routeNames.join(', ')}${moreText}</div>
                <div class="session-meta">${session.routeCount} route${session.routeCount > 1 ? 's' : ''}</div>
            `;

            const actions = document.createElement('div');
            actions.className = 'session-actions';

            const loadBtn = document.createElement('button');
            loadBtn.className = 'session-load-btn';
            loadBtn.textContent = 'Load';
            loadBtn.onclick = () => this.loadSession(session.id);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'session-delete-btn';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('Delete this saved session?')) {
                    await this.storageManager.deleteSession(session.id);
                    await this.loadSavedSessions();
                }
            };

            actions.appendChild(loadBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    async saveCurrentSession() {
        if (this.routes.length === 0) {
            alert('No routes to save');
            return;
        }

        const routesData = this.routes.map(route => ({
            displayName: route.displayName,
            color: route.color,
            coordinates: route.coordinates,
            elevations: route.elevations,
            heartRates: route.heartRates,
            cadences: route.cadences,
            powers: route.powers,
            speeds: route.speeds,
            paces: route.paces,
            timestamps: route.timestamps,
            distance: route.stats.distance,
            elevationStats: {
                gain: route.stats.elevationGain,
                loss: route.stats.elevationLoss,
                min: route.stats.minElevation,
                max: route.stats.maxElevation
            },
            duration: route.stats.duration,
            fileName: route.filename
        }));

        const sessionId = await this.storageManager.saveRoutes(routesData);
        if (sessionId) {
            alert('Session saved!');
            await this.loadSavedSessions();
        }
    }

    async loadSession(sessionId) {
        const session = await this.storageManager.loadSession(sessionId);
        if (!session) {
            alert('Failed to load session');
            return;
        }

        // Clear existing routes
        this.routes.forEach(route => route.destroy());
        this.routes = [];
        this.colorIndex = 0;

        // Load routes from session
        for (const routeData of session.routes) {
            const route = new Route({
                filename: routeData.fileName || 'Loaded Route',
                displayName: routeData.displayName,
                color: routeData.color || Utils.colors[this.colorIndex % Utils.colors.length],
                coordinates: routeData.coordinates,
                elevations: routeData.elevations || [],
                heartRates: routeData.heartRates || [],
                cadences: routeData.cadences || [],
                powers: routeData.powers || [],
                speeds: routeData.speeds || [],
                paces: routeData.paces || [],
                timestamps: (routeData.timestamps || []).map(t => t ? new Date(t) : null),
                stats: {
                    distance: routeData.distance,
                    elevationGain: routeData.elevationStats?.gain || 0,
                    elevationLoss: routeData.elevationStats?.loss || 0,
                    minElevation: routeData.elevationStats?.min || 0,
                    maxElevation: routeData.elevationStats?.max || 0,
                    duration: routeData.duration
                }
            });

            route.createMapObjects(this.mapManager.map, this.routes.length, {
                onMouseOver: (r, e) => this.handleRouteMouseOver(r, e),
                onMouseMove: (r, e) => this.handleRouteMouseMove(r, e),
                onMouseOut: () => this.handleRouteMouseOut(),
                onClick: (r) => this.handleRouteClick(r)
            });

            this.routes.push(route);
            this.colorIndex++;
        }

        this.mapManager.fitToRoutes(this.routes);
        this.updateUI();
    }

    setupDropZones() {
        const dropZone = document.getElementById('dropZone');
        const compactDropZone = document.getElementById('compactDropZone');

        [dropZone, compactDropZone].forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('dragover');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('dragover');
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dragover');
                this.handleFiles(e.dataTransfer.files);
            });

            zone.addEventListener('click', () => {
                zone.querySelector('input').click();
            });

            zone.querySelector('input').addEventListener('change', (e) => {
                this.handleFiles(e.target.files);
            });
        });
    }

    async handleFiles(files) {
        for (const file of files) {
            try {
                const color = Utils.colors[this.colorIndex % Utils.colors.length];
                let routeData;

                if (file.name.toLowerCase().endsWith('.gpx')) {
                    const text = await file.text();
                    routeData = FileParser.parseGPX(text, color, file.name);
                } else if (file.name.toLowerCase().endsWith('.fit')) {
                    const arrayBuffer = await file.arrayBuffer();
                    routeData = await FileParser.parseFIT(arrayBuffer, color, file.name);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }

                const route = new Route(routeData);
                route.createMapObjects(this.mapManager.map, this.routes.length, {
                    onMouseOver: (r, e) => this.handleRouteMouseOver(r, e),
                    onMouseMove: (r, e) => this.handleRouteMouseMove(r, e),
                    onMouseOut: () => this.handleRouteMouseOut(),
                    onClick: (r) => this.handleRouteClick(r)
                });

                this.routes.push(route);
                this.colorIndex++;
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process ${file.name}: ${error.message}`);
            }
        }

        this.mapManager.fitToRoutes(this.routes);
        this.updateUI();
    }

    handleRouteMouseOver(route, event) {
        this.highlightRoute(route);
    }

    handleRouteMouseMove(route, event) {
        const info = route.getClosestPointInfo(event.latLng);
        this.mapManager.showTooltip(route.displayName, event.latLng, info.distance, info.time);
    }

    handleRouteMouseOut() {
        this.unhighlightRoute();
        this.mapManager.hideTooltip();
    }

    handleRouteClick(route) {
        if (this.compareMode) {
            route.selected = !route.selected;
            this.updateUI();
            this.updateComparison();
        }
    }

    highlightRoute(route) {
        if (this.highlightedRoute === route) return;

        if (this.highlightedRoute) {
            this.highlightedRoute.highlight(false);
        }

        this.highlightedRoute = route;
        route.highlight(true);

        // Update file list UI
        document.querySelectorAll('.file-item').forEach((item, index) => {
            if (this.routes[index] === route) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    }

    unhighlightRoute() {
        if (this.highlightedRoute) {
            this.highlightedRoute.highlight(false);
            this.highlightedRoute = null;
        }
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('highlighted');
        });
    }

    setupCompareMode() {
        document.getElementById('compareBtn').addEventListener('click', () => {
            this.compareMode = !this.compareMode;
            document.getElementById('compareBtn').classList.toggle('active');
            document.getElementById('compareBtn').textContent = this.compareMode ? 'Exit Compare' : 'Compare Routes';
            document.getElementById('fileList').classList.toggle('compare-mode', this.compareMode);

            if (!this.compareMode) {
                this.routes.forEach(r => r.selected = false);
                this.closeComparison();
            }
            this.updateUI();
        });
    }

    setupSidebarToggle() {
        document.getElementById('sidebarToggle').addEventListener('click', () => this.toggleSidebar());
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');

        sidebar.classList.toggle('collapsed');
        toggle.textContent = sidebar.classList.contains('collapsed') ? '>' : '<';

        setTimeout(() => {
            google.maps.event.trigger(this.mapManager.map, 'resize');
            if (this.routes.length > 0) {
                this.mapManager.fitToRoutes(this.routes);
            }
        }, 300);
    }

    updateUI() {
        const fileList = document.getElementById('fileList');
        const dropZone = document.getElementById('dropZone');
        const compactDropZone = document.getElementById('compactDropZone');
        const saveBtn = document.getElementById('saveCurrentBtn');

        // Show/hide save button
        if (this.currentUser && this.routes.length > 0) {
            saveBtn.classList.add('visible');
        } else {
            saveBtn.classList.remove('visible');
        }

        if (this.routes.length === 0) {
            fileList.classList.add('hidden');
            dropZone.classList.remove('hidden');
            compactDropZone.classList.add('hidden');
            return;
        }

        fileList.classList.remove('hidden');
        dropZone.classList.add('hidden');
        compactDropZone.classList.remove('hidden');

        fileList.innerHTML = '';
        this.routes.forEach((route, index) => {
            const item = this.createFileItem(route, index);
            fileList.appendChild(item);
        });
    }

    createFileItem(route, index) {
        const item = document.createElement('div');
        item.className = 'file-item';
        if (route.selected) item.classList.add('selected');

        // Checkbox for compare mode
        if (this.compareMode) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'compare-checkbox';
            checkbox.checked = route.selected;
            item.appendChild(checkbox);
        }

        // Header with number and color
        const header = document.createElement('div');
        header.className = 'file-header';

        const number = document.createElement('div');
        number.className = 'file-number';
        number.textContent = index + 1;
        number.style.borderColor = route.color;
        number.style.color = route.color;

        const colorBox = document.createElement('div');
        colorBox.className = 'file-color';
        colorBox.style.background = route.color;

        header.appendChild(number);
        header.appendChild(colorBox);

        // Name
        const nameContainer = document.createElement('div');
        nameContainer.className = 'file-name-container';

        const displayName = document.createElement('div');
        displayName.className = 'file-display-name';
        displayName.contentEditable = true;
        displayName.textContent = route.displayName;
        displayName.spellcheck = false;

        displayName.addEventListener('blur', () => {
            route.displayName = displayName.textContent.trim() || route.filename;
        });

        displayName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                displayName.blur();
            }
        });

        displayName.addEventListener('click', (e) => e.stopPropagation());

        const originalName = document.createElement('div');
        originalName.className = 'file-original-name';
        originalName.textContent = route.filename;

        nameContainer.appendChild(displayName);
        nameContainer.appendChild(originalName);

        // Stats
        const stats = document.createElement('div');
        stats.className = 'file-stats';
        stats.innerHTML = `
            <div class="stat-row">
                <span class="stat-label">Distance:</span>
                <span class="stat-value">${Utils.formatDistance(route.stats.distance)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Elev Gain:</span>
                <span class="stat-value">${Utils.formatElevation(route.stats.elevationGain)}</span>
            </div>
            ${route.stats.duration ? `
            <div class="stat-row">
                <span class="stat-label">Duration:</span>
                <span class="stat-value">${Utils.formatDuration(route.stats.duration)}</span>
            </div>` : ''}
        `;

        // Actions
        const actions = document.createElement('div');
        actions.className = 'file-actions';

        if (route.timestamps.some(t => t !== null)) {
            const playBtn = document.createElement('button');
            playBtn.className = 'file-play' + (route.isPlaying ? ' playing' : '');
            playBtn.textContent = route.isPlaying ? 'Pause' : 'Play';
            playBtn.onclick = (e) => {
                e.stopPropagation();
                if (route.isPlaying) {
                    this.animationManager.stop(route);
                } else {
                    this.animationManager.start(route);
                }
                this.updateUI();
            };
            actions.appendChild(playBtn);
        }

        // Insights button
        const insightsBtn = document.createElement('button');
        insightsBtn.className = 'insights-btn';
        insightsBtn.textContent = 'Insights';
        insightsBtn.onclick = (e) => {
            e.stopPropagation();
            this.insightsManager.showInsightsModal(route, index);
        };
        actions.appendChild(insightsBtn);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'file-toggle' + (route.visible ? '' : ' hidden-route');
        toggleBtn.textContent = route.visible ? 'Hide' : 'Show';
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            route.setVisible(!route.visible, this.mapManager.map);
            this.updateUI();
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            this.removeRoute(route);
        };

        actions.appendChild(toggleBtn);
        actions.appendChild(removeBtn);

        // Events
        item.addEventListener('mouseenter', () => this.highlightRoute(route));
        item.addEventListener('mouseleave', () => this.unhighlightRoute());
        item.addEventListener('click', () => {
            if (this.compareMode) {
                route.selected = !route.selected;
                this.updateUI();
                this.updateComparison();
            }
        });

        item.appendChild(header);
        item.appendChild(nameContainer);
        item.appendChild(stats);
        item.appendChild(actions);

        return item;
    }

    removeRoute(route) {
        const index = this.routes.indexOf(route);
        if (index > -1) {
            route.destroy();
            this.routes.splice(index, 1);
            this.updateUI();
            this.updateComparison();
            if (this.routes.length > 0) {
                this.mapManager.fitToRoutes(this.routes);
            }
        }
    }

    compareMetric(metricType) {
        const selectedRoutes = this.routes.filter(r => r.selected);

        const metricConfig = {
            elevation: { data: 'elevations', name: 'Elevation', label: 'Elevation (m)', format: v => Math.round(v) + 'm' },
            speed: { data: 'speeds', name: 'Speed', label: 'Speed (km/h)', format: v => v.toFixed(1) + ' km/h' },
            pace: { data: 'paces', name: 'Pace', label: 'Pace (min/km)', format: v => Utils.formatPace(v) },
            heartrate: { data: 'heartRates', name: 'Heart Rate', label: 'Heart Rate (bpm)', format: v => Math.round(v) + ' bpm' },
            cadence: { data: 'cadences', name: 'Cadence', label: 'Cadence (spm)', format: v => Math.round(v) + ' spm' },
            power: { data: 'powers', name: 'Power', label: 'Power (W)', format: v => Math.round(v) + 'W' }
        };

        const config = metricConfig[metricType];
        const validRoutes = selectedRoutes.filter(r => r[config.data] && r[config.data].length > 0);

        if (validRoutes.length < 2) {
            alert(`Please select at least 2 routes with ${config.name.toLowerCase()} data`);
            return;
        }

        this.chartManager.show(validRoutes, metricType, config.label, config.format);
    }

    compareTimeGap() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        // Check if we have at least 2 routes
        if (selectedRoutes.length < 2) {
            alert('Please select at least 2 routes to compare time gaps');
            return;
        }

        // Check if routes have timestamp data
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            alert('Time Gap analysis requires at least 2 routes with timestamp data. Routes from GPX/FIT files with recorded time are needed.');
            return;
        }

        // First selected route is the reference
        const referenceRoute = routesWithTimestamps[0];
        const comparisonRoutes = routesWithTimestamps.slice(1);

        // Calculate time gaps
        const timeGapData = Utils.calculateTimeGaps(referenceRoute, comparisonRoutes);

        if (!timeGapData || timeGapData.gaps.length === 0) {
            alert('Could not calculate time gaps. Routes may not have sufficient timestamp data.');
            return;
        }

        // Show the time gap chart
        this.chartManager.showTimeGapChart(timeGapData);
    }

    compareSplits() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        // Check if we have at least 2 routes
        if (selectedRoutes.length < 2) {
            alert('Please select at least 2 routes to compare splits');
            return;
        }

        // Check if routes have timestamp data (needed for pace)
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            alert('Split comparison requires at least 2 routes with timestamp data.');
            return;
        }

        // Calculate splits for each route
        const allSplits = routesWithTimestamps.map(route => ({
            route: route,
            splits: Utils.calculateSplits(route, 1.0)
        }));

        // Render the splits modal
        this.renderSplitsModal(allSplits);
    }

    renderSplitsModal(allSplits) {
        const modal = document.getElementById('splitsModal');
        const table = document.getElementById('splitsTable');

        // Find max number of splits across all routes
        const maxSplits = Math.max(...allSplits.map(r => r.splits.length));

        // Build table header
        let headerRow1 = '<tr><th rowspan="2" class="split-number-header">Split</th>';
        let headerRow2 = '<tr>';

        allSplits.forEach(({ route }) => {
            headerRow1 += `<th colspan="3" class="route-header">
                <div class="route-header-content">
                    <div class="route-color-dot" style="background: ${route.color}"></div>
                    <span>${route.displayName}</span>
                </div>
            </th>`;
            headerRow2 += '<th class="metric-header">Pace</th><th class="metric-header">Elev</th><th class="metric-header">HR</th>';
        });

        headerRow1 += '</tr>';
        headerRow2 += '</tr>';

        // Build table body
        let bodyRows = '';
        for (let i = 0; i < maxSplits; i++) {
            const splitNum = i + 1;
            let row = `<tr><td class="split-number">${splitNum} km</td>`;

            allSplits.forEach(({ splits }) => {
                const split = splits[i];
                if (split) {
                    const paceClass = split.isPartial ? 'partial-split' : '';
                    row += `<td class="split-pace ${paceClass}">${Utils.formatSplitPace(split.pace)}</td>`;
                    row += `<td class="split-elev">${Utils.formatSplitElevation(split.elevGain)}</td>`;
                    row += `<td class="split-hr">${Utils.formatSplitHR(split.avgHR)}</td>`;
                } else {
                    row += '<td class="split-na">-</td><td class="split-na">-</td><td class="split-na">-</td>';
                }
            });

            row += '</tr>';
            bodyRows += row;
        }

        // Add totals row
        let totalsRow = '<tr class="totals-row"><td class="split-number"><strong>Total</strong></td>';
        allSplits.forEach(({ route }) => {
            const avgPace = route.paces && route.paces.length > 0
                ? route.paces.filter(p => p !== null && !isNaN(p) && p > 0 && p < 20).reduce((a, b) => a + b, 0) /
                  route.paces.filter(p => p !== null && !isNaN(p) && p > 0 && p < 20).length
                : null;
            const avgHR = route.heartRates && route.heartRates.length > 0
                ? route.heartRates.filter(h => h !== null && !isNaN(h)).reduce((a, b) => a + b, 0) /
                  route.heartRates.filter(h => h !== null && !isNaN(h)).length
                : null;

            totalsRow += `<td class="split-pace"><strong>${Utils.formatSplitPace(avgPace)}</strong></td>`;
            totalsRow += `<td class="split-elev"><strong>${Utils.formatSplitElevation(route.stats.elevationGain)}</strong></td>`;
            totalsRow += `<td class="split-hr"><strong>${Utils.formatSplitHR(avgHR)}</strong></td>`;
        });
        totalsRow += '</tr>';

        table.innerHTML = `<thead>${headerRow1}${headerRow2}</thead><tbody>${bodyRows}${totalsRow}</tbody>`;

        // Show modal
        modal.classList.add('show');
    }

    closeSplitsModal() {
        document.getElementById('splitsModal').classList.remove('show');
    }

    compareSegment() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            alert('Please select at least 2 routes to compare segments');
            return;
        }

        // Check for timestamp data
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            alert('Segment analysis requires at least 2 routes with timestamp data.');
            return;
        }

        // Store selected routes for analysis
        this.segmentRoutes = routesWithTimestamps;

        // Find max distance across all routes for input validation hint
        const minMaxDistance = Math.min(...routesWithTimestamps.map(r => r.stats.distance));
        document.getElementById('segmentEnd').max = minMaxDistance.toFixed(1);

        // Clear previous results
        document.getElementById('segmentResults').innerHTML = '';

        // Show modal
        document.getElementById('segmentModal').classList.add('show');
    }

    analyzeSegment() {
        const startKm = parseFloat(document.getElementById('segmentStart').value);
        const endKm = parseFloat(document.getElementById('segmentEnd').value);

        // Validate inputs
        if (isNaN(startKm) || isNaN(endKm)) {
            alert('Please enter valid distance values');
            return;
        }

        if (startKm >= endKm) {
            alert('Start distance must be less than end distance');
            return;
        }

        if (startKm < 0) {
            alert('Start distance cannot be negative');
            return;
        }

        if (!this.segmentRoutes || this.segmentRoutes.length < 2) {
            alert('No routes selected for comparison');
            return;
        }

        // Calculate segment metrics for each route
        const results = this.segmentRoutes.map(route => ({
            route: route,
            metrics: Utils.calculateSegmentMetrics(route, startKm, endKm)
        }));

        // Check if all routes have valid data for this segment
        const validResults = results.filter(r => r.metrics !== null);

        if (validResults.length < 2) {
            alert(`Segment ${startKm.toFixed(1)}-${endKm.toFixed(1)} km is outside the range of one or more routes`);
            return;
        }

        // Render results
        this.renderSegmentResults(startKm, endKm, validResults);
    }

    renderSegmentResults(startKm, endKm, results) {
        const container = document.getElementById('segmentResults');
        const segmentDistance = endKm - startKm;

        // Build results table
        let html = `
            <div class="segment-header-info">
                <strong>Segment: ${startKm.toFixed(1)} km - ${endKm.toFixed(1)} km</strong>
                <span class="segment-distance">(${segmentDistance.toFixed(2)} km)</span>
            </div>
            <table class="segment-table">
                <thead>
                    <tr>
                        <th>Route</th>
                        <th>Time</th>
                        <th>Pace</th>
                        <th>Elev +</th>
                        <th>Elev -</th>
                        <th>Avg HR</th>
                    </tr>
                </thead>
                <tbody>
        `;

        results.forEach(({ route, metrics }) => {
            html += `
                <tr>
                    <td class="route-cell">
                        <div class="route-color-dot" style="background: ${route.color}"></div>
                        <span>${route.displayName}</span>
                    </td>
                    <td class="time-cell">${Utils.formatSegmentDuration(metrics.duration)}</td>
                    <td class="pace-cell">${Utils.formatSplitPace(metrics.pace)}</td>
                    <td class="elev-cell">${Utils.formatSplitElevation(metrics.elevGain)}</td>
                    <td class="elev-cell">${Utils.formatSplitElevation(-metrics.elevLoss)}</td>
                    <td class="hr-cell">${Utils.formatSplitHR(metrics.avgHR)}</td>
                </tr>
            `;
        });

        // Add difference row if exactly 2 routes
        if (results.length === 2) {
            const [r1, r2] = results;
            const timeDiff = (r2.metrics.duration || 0) - (r1.metrics.duration || 0);
            const paceDiff = (r2.metrics.pace || 0) - (r1.metrics.pace || 0);
            const elevGainDiff = (r2.metrics.elevGain || 0) - (r1.metrics.elevGain || 0);
            const elevLossDiff = (r2.metrics.elevLoss || 0) - (r1.metrics.elevLoss || 0);
            const hrDiff = (r2.metrics.avgHR || 0) - (r1.metrics.avgHR || 0);

            html += `
                <tr class="diff-row">
                    <td><strong>Difference</strong></td>
                    <td class="time-cell ${timeDiff > 0 ? 'slower' : 'faster'}">${this.formatDiff(timeDiff, 'time')}</td>
                    <td class="pace-cell ${paceDiff > 0 ? 'slower' : 'faster'}">${this.formatDiff(paceDiff, 'pace')}</td>
                    <td class="elev-cell">${this.formatDiff(elevGainDiff, 'elev')}</td>
                    <td class="elev-cell">${this.formatDiff(-elevLossDiff, 'elev')}</td>
                    <td class="hr-cell">${this.formatDiff(hrDiff, 'hr')}</td>
                </tr>
            `;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    formatDiff(value, type) {
        if (value === null || value === undefined || isNaN(value)) return 'N/A';

        const sign = value >= 0 ? '+' : '';

        switch (type) {
            case 'time':
                const mins = Math.floor(Math.abs(value) / 60);
                const secs = Math.round(Math.abs(value) % 60);
                const timeStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
                return `${sign}${value >= 0 ? '' : '-'}${timeStr}`;
            case 'pace':
                const pMins = Math.floor(Math.abs(value));
                const pSecs = Math.round((Math.abs(value) - pMins) * 60);
                return `${sign}${pMins}:${pSecs.toString().padStart(2, '0')}`;
            case 'elev':
                return `${sign}${Math.round(value)}m`;
            case 'hr':
                return `${sign}${Math.round(value)}`;
            default:
                return `${sign}${value.toFixed(1)}`;
        }
    }

    closeSegmentModal() {
        document.getElementById('segmentModal').classList.remove('show');
        this.segmentRoutes = null;
    }

    updateComparison() {
        const selectedRoutes = this.routes.filter(r => r.selected);
        const panel = document.getElementById('comparisonPanel');

        if (selectedRoutes.length < 2) {
            panel.classList.remove('show');
            return;
        }

        // Enable/disable metric buttons
        const hasMetric = (prop) => selectedRoutes.some(r => r[prop] && r[prop].length > 0);
        document.querySelectorAll('.comparison-elevation-btn').forEach(btn => {
            const metric = btn.dataset.metric;
            const propMap = {
                elevation: 'elevations',
                speed: 'speeds',
                pace: 'paces',
                heartrate: 'heartRates',
                cadence: 'cadences',
                power: 'powers'
            };
            btn.disabled = !hasMetric(propMap[metric]);
        });

        // Enable/disable Time Gap and Splits buttons based on timestamp data
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        const timeGapBtn = document.querySelector('.comparison-timegap-btn');
        if (timeGapBtn) {
            timeGapBtn.disabled = routesWithTimestamps.length < 2;
        }

        const splitsBtn = document.querySelector('.comparison-splits-btn');
        if (splitsBtn) {
            splitsBtn.disabled = routesWithTimestamps.length < 2;
        }

        const segmentBtn = document.querySelector('.comparison-segment-btn');
        if (segmentBtn) {
            segmentBtn.disabled = routesWithTimestamps.length < 2;
        }

        panel.classList.add('show');

        // Build comparison table
        const avg = (arr) => arr && arr.length > 0 ? arr.filter(v => v !== null).reduce((a, b) => a + b, 0) / arr.filter(v => v !== null).length : null;

        let html = `
            <thead>
                <tr>
                    <th>Route</th>
                    <th>Distance</th>
                    <th>Elevation Gain</th>
                    <th>Duration</th>
                    <th>Avg Heart Rate</th>
                    <th>Avg Pace</th>
                </tr>
            </thead>
            <tbody>
        `;

        selectedRoutes.forEach(route => {
            html += `
                <tr>
                    <td>
                        <div class="route-name-cell">
                            <div class="route-color-indicator" style="background: ${route.color}"></div>
                            <strong>${route.displayName}</strong>
                        </div>
                    </td>
                    <td>${Utils.formatDistance(route.stats.distance)}</td>
                    <td>${Utils.formatElevation(route.stats.elevationGain)}</td>
                    <td>${Utils.formatDuration(route.stats.duration)}</td>
                    <td>${Utils.formatHeartRate(avg(route.heartRates))}</td>
                    <td>${Utils.formatPace(avg(route.paces))}</td>
                </tr>
            `;
        });

        html += '</tbody>';
        document.getElementById('comparisonTableContent').innerHTML = html;
    }

    closeComparison() {
        document.getElementById('comparisonPanel').classList.remove('show');
    }
}

// Initialize
let app;

window.initMap = function() {
    app = new RouteOverlayApp();
    app.initMap();
    window.app = app;
};

// Expose for comparison buttons
window.compareMetric = function(type) {
    if (app) app.compareMetric(type);
};

window.closeComparison = function() {
    if (app) app.closeComparison();
};

window.compareTimeGap = function() {
    if (app) app.compareTimeGap();
};

window.compareSplits = function() {
    if (app) app.compareSplits();
};

window.closeSplitsModal = function() {
    if (app) app.closeSplitsModal();
};

window.compareSegment = function() {
    if (app) app.compareSegment();
};

window.analyzeSegment = function() {
    if (app) app.analyzeSegment();
};

window.closeSegmentModal = function() {
    if (app) app.closeSegmentModal();
};

// Load Google Maps API
export function loadGoogleMapsAPI() {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMaps.apiKey}&libraries=geometry&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', loadGoogleMapsAPI);
