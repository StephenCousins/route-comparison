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
import { showToast } from './toast.js';

class RouteOverlayApp {
    constructor() {
        this.routes = [];
        this.colorIndex = 0;
        // Comparison is automatic: every loaded route is included by default and
        // the panel opens as soon as 2+ are selected. This flag tracks when the
        // user has manually dismissed the panel so it doesn't reappear until they
        // change the selection or reopen it.
        this.comparisonDismissed = false;
        this.highlightedRoute = null;
        this.currentUser = null;

        // Auto-Align results, keyed by route.filename. Distance offsets (km)
        // seed the metric charts' drag-to-align; time offsets (seconds) feed
        // Time Gap/Race. Neither ever mutates the underlying route data.
        this.autoAlignOffsets = {};
        this.routeTimeOffsets = {};
        this.autoAlignConfidence = {};

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
        this.setupSessionsModal();
        this.setupPlaybackControls();
        this.setupModalDismissal();
    }

    // Every modal can now be closed with Escape or a backdrop click, reusing its
    // own .modal-close handler so any per-modal cleanup still runs.
    setupModalDismissal() {
        const modalIds = [
            'elevationModal', 'insightsModal', 'splitsModal', 'segmentModal', 'sessionsModal',
            'deviationModal', 'distanceDriftModal', 'runningDynamicsModal', 'sessionCheckModal',
            'hrValidationModal', 'dropoutModal'
        ];
        const closeModal = (m) => {
            const btn = m.querySelector('.modal-close');
            if (btn) btn.click(); else m.classList.remove('show');
        };
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const open = modalIds.map(id => document.getElementById(id)).find(m => m && m.classList.contains('show'));
            if (open) closeModal(open);
        });
        modalIds.forEach(id => {
            const m = document.getElementById(id);
            if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
        });
    }

    // A single Stop button that halts whatever is playing — a race or a
    // single-route animation (stopAll covers both and hides the controls).
    setupPlaybackControls() {
        document.getElementById('stopPlaybackBtn').addEventListener('click', () => {
            this.animationManager.stopAll();
            this.updateUI();
        });
    }

    // Saved sessions live in a modal so they don't clutter the sidebar during
    // analysis. The "Load Session" button only appears when signed in with 1+
    // saved sessions (see loadSavedSessions).
    setupSessionsModal() {
        document.getElementById('loadSessionBtn').addEventListener('click', () => this.openSessionsModal());
        document.getElementById('closeSessionsModal').addEventListener('click', () => this.closeSessionsModal());
        document.getElementById('sessionsModal').addEventListener('click', (e) => {
            if (e.target.id === 'sessionsModal') this.closeSessionsModal();
        });
    }

    async openSessionsModal() {
        // Open immediately with a loading state so a slow fetch doesn't make the
        // button feel dead, then populate.
        document.getElementById('sessionsEmptyState').classList.add('hidden');
        document.getElementById('savedSessionsList').innerHTML =
            '<div class="sessions-loading">Loading sessions…</div>';
        document.getElementById('sessionsModal').classList.add('show');
        await this.loadSavedSessions();
    }

    closeSessionsModal() {
        document.getElementById('sessionsModal').classList.remove('show');
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
        const userAvatar = document.getElementById('userAvatar');
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
                if (user.photoURL) {
                    userAvatar.src = user.photoURL;
                    userAvatar.classList.remove('hidden');
                } else {
                    userAvatar.classList.add('hidden');
                }
                this.storageManager.setUser(user.uid);
                await this.loadSavedSessions();
            } else {
                signInBtn.classList.remove('hidden');
                userInfo.classList.add('hidden');
                savedSessionsList.innerHTML = '';
                document.getElementById('loadSessionBtn').classList.remove('visible');
                this.closeSessionsModal();
                this.storageManager.setUser(null);
            }
            this.updateUI();
        });
    }

    // Firestore returns Timestamp objects (not plain Dates) for both
    // top-level fields and array elements — .toDate() is the modern shape,
    // .seconds the raw shape some cached/older data can have. A bare
    // `new Date(t)` silently produces Invalid Date for either, which breaks
    // anything reading route.timestamps (Time Gap, Splits, Segment, Race)
    // for every point in a loaded session, not just some of them.
    parseFirestoreTimestamp(t) {
        if (!t) return null;
        if (typeof t.toDate === 'function') return t.toDate();
        if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
        return new Date(t);
    }

    async loadSavedSessions() {
        const sessions = await this.storageManager.getSavedSessions();
        const list = document.getElementById('savedSessionsList');
        list.innerHTML = '';

        // Show the "Load Session" button only when signed in with saved sessions,
        // and reflect the count. Empty-state text covers the "deleted them all" case.
        const hasSessions = sessions.length > 0;
        const loadBtn = document.getElementById('loadSessionBtn');
        loadBtn.textContent = hasSessions ? `Load Session (${sessions.length})` : 'Load Session';
        loadBtn.classList.toggle('visible', hasSessions && !!this.currentUser);
        document.getElementById('sessionsEmptyState').classList.toggle('hidden', hasSessions);

        sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'saved-session-item';

            const info = document.createElement('div');
            info.className = 'session-info';

            const routeNames = session.routes.map(r => r.displayName || 'Unnamed').slice(0, 2);
            const moreText = session.routes.length > 2 ? ` +${session.routes.length - 2} more` : '';
            // Show the saved date — the most useful way to tell similar sessions apart.
            const createdDate = this.parseFirestoreTimestamp(session.createdAt);
            const dateStr = createdDate
                ? createdDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : '';
            info.innerHTML = `
                <div class="session-name">${routeNames.join(', ')}${moreText}</div>
                <div class="session-meta">${session.routeCount} route${session.routeCount > 1 ? 's' : ''}${dateStr ? ' · ' + dateStr : ''}</div>
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
            showToast('No routes to save');
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
            gpsAccuracies: route.gpsAccuracies,
            sessionSummary: route.sessionSummary,
            verticalOscillations: route.verticalOscillations,
            groundContactTimes: route.groundContactTimes,
            verticalRatios: route.verticalRatios,
            groundContactBalances: route.groundContactBalances,
            stepLengths: route.stepLengths,
            absolutePressures: route.absolutePressures,
            // Serial number is truncated before it ever leaves the browser —
            // saved sessions may end up in reports shared outside the account.
            device: route.device ? {
                manufacturer: route.device.manufacturer,
                productName: route.device.productName,
                firmwareVersion: route.device.firmwareVersion,
                serialNumber: route.device.serialNumber ? String(route.device.serialNumber).slice(-4) : null
            } : null,
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
            showToast('Session saved!', 'success');
            await this.loadSavedSessions();
        }
    }

    async loadSession(sessionId) {
        // Loading replaces whatever is on the map — confirm if that would discard
        // routes the user is currently working with.
        if (this.routes.length > 0 &&
            !confirm('Load this session? Your current routes will be replaced.')) {
            return;
        }

        const session = await this.storageManager.loadSession(sessionId);
        if (!session) {
            showToast('Failed to load session', 'error');
            return;
        }

        // Clear existing routes
        this.routes.forEach(route => route.destroy());
        this.routes = [];
        this.colorIndex = 0;
        // Alignment state is keyed by filename, not route identity — a loaded
        // session with a same-named file (common with generic FIT filenames)
        // would otherwise silently inherit an unrelated route's offsets.
        this.autoAlignOffsets = {};
        this.routeTimeOffsets = {};
        this.autoAlignConfidence = {};

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
                gpsAccuracies: routeData.gpsAccuracies || [],
                device: routeData.device || null,
                sessionSummary: routeData.sessionSummary || null,
                verticalOscillations: routeData.verticalOscillations || [],
                groundContactTimes: routeData.groundContactTimes || [],
                verticalRatios: routeData.verticalRatios || [],
                groundContactBalances: routeData.groundContactBalances || [],
                stepLengths: routeData.stepLengths || [],
                absolutePressures: routeData.absolutePressures || [],
                speeds: routeData.speeds || [],
                paces: routeData.paces || [],
                timestamps: (routeData.timestamps || []).map(t => this.parseFirestoreTimestamp(t)),
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
        this.comparisonDismissed = false;
        this.updateUI();
        this.updateComparison();
        this.closeSessionsModal();
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
                    showToast(`Unsupported file type: ${file.name}`);
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
                showToast(`Failed to process ${file.name}: ${error.message}`, "error");
            }
        }

        this.mapManager.fitToRoutes(this.routes);
        this.comparisonDismissed = false;
        this.updateUI();
        this.updateComparison();
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
        // Clicking a route's line on the map opens that route's insights, rather
        // than silently toggling its inclusion in the comparison.
        const index = this.routes.indexOf(route);
        this.insightsManager.showInsightsModal(route, index);
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

    // The header button now just shows or re-opens the comparison panel — there
    // is no separate "compare mode" any more; selection is always live.
    setupCompareMode() {
        document.getElementById('compareBtn').addEventListener('click', () => {
            const panelShown = document.getElementById('comparisonPanel').classList.contains('show');
            if (panelShown) {
                this.closeComparison();
            } else {
                this.comparisonDismissed = false;
                this.updateComparison();
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
        const compareBtn = document.getElementById('compareBtn');
        const compareHint = document.getElementById('compareHint');

        // Show/hide save button
        if (this.currentUser && this.routes.length > 0) {
            saveBtn.classList.add('visible');
        } else {
            saveBtn.classList.remove('visible');
        }

        // Prominent "Compare N routes" button: only meaningful with 2+ selected.
        // Label reflects whether the panel is (about to be) open.
        const selectedCount = this.routes.filter(r => r.selected).length;
        const panelWillShow = selectedCount >= 2 && !this.comparisonDismissed;
        if (selectedCount >= 2) {
            compareBtn.classList.add('visible');
            compareBtn.textContent = panelWillShow ? 'Hide comparison' : `Compare ${selectedCount} routes`;
        } else {
            compareBtn.classList.remove('visible');
        }

        // Nudge when a single file is loaded — comparison needs a second one.
        if (this.routes.length === 1) {
            compareHint.textContent = 'Add one more file to compare them';
            compareHint.classList.add('visible');
        } else {
            compareHint.classList.remove('visible');
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

        // Always-visible "include in comparison" checkbox.
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'compare-checkbox';
        checkbox.checked = route.selected;
        checkbox.title = 'Include in comparison';
        checkbox.setAttribute('aria-label', `Include ${route.displayName} in comparison`);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', () => {
            route.selected = checkbox.checked;
            this.comparisonDismissed = false;
            this.updateUI();
            this.updateComparison();
        });
        item.appendChild(checkbox);

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
        displayName.title = 'Click to rename';
        displayName.setAttribute('role', 'textbox');
        displayName.setAttribute('aria-label', 'Route name (click to rename)');

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
            ${route.device ? `
            <div class="stat-row">
                <span class="stat-label">Device:</span>
                <span class="stat-value">${route.device.productName || route.device.manufacturer || 'Unknown'}${route.device.firmwareVersion ? ` · fw ${route.device.firmwareVersion}` : ''}</span>
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

        // Heatmap button (only if pace data available). Also reflects a
        // deviation heatmap turned on from the Deviation modal — otherwise
        // there'd be no visible indicator here that an overlay is active once
        // that modal is closed, and clicking this would silently replace it.
        if (route.hasPaceData()) {
            const isDeviationActive = route.overlayMode === 'deviation';
            const heatmapBtn = document.createElement('button');
            heatmapBtn.className = 'heatmap-btn' + (route.overlayMode ? ' active' : '');
            heatmapBtn.textContent = isDeviationActive ? 'Deviation On' : (route.overlayMode === 'pace' ? 'Heatmap On' : 'Heatmap');
            if (isDeviationActive) {
                heatmapBtn.title = 'A GPS deviation heatmap is active on this route (from the Deviation modal) — click to switch to the pace heatmap';
            }
            heatmapBtn.onclick = (e) => {
                e.stopPropagation();
                route.toggleHeatmap(this.mapManager.map);
                this.updateUI();
            };
            actions.appendChild(heatmapBtn);
        }

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

        // Events. Selection (include-in-comparison) is owned solely by the
        // checkbox — clicking the card body instead zooms the map to this route,
        // a useful "focus" action that also can't accidentally drop it from the
        // comparison.
        item.addEventListener('mouseenter', () => this.highlightRoute(route));
        item.addEventListener('mouseleave', () => this.unhighlightRoute());
        item.addEventListener('click', () => {
            if (route.visible) this.mapManager.fitToRoutes([route]);
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
            // A stale alignment must not silently apply if this filename is
            // reused by a different route added later.
            delete this.autoAlignOffsets[route.filename];
            delete this.routeTimeOffsets[route.filename];
            delete this.autoAlignConfidence[route.filename];
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
            power: { data: 'powers', name: 'Power', label: 'Power (W)', format: v => Math.round(v) + 'W' },
            gpsaccuracy: { data: 'gpsAccuracies', name: 'GPS Accuracy', label: 'GPS Accuracy (m)', format: v => Math.round(v) + 'm' }
        };

        const config = metricConfig[metricType];
        const validRoutes = selectedRoutes.filter(r => r[config.data] && r[config.data].length > 0);

        if (validRoutes.length < 2) {
            showToast(`Please select at least 2 routes with ${config.name.toLowerCase()} data`);
            return;
        }

        this.chartManager.show(validRoutes, metricType, config.label, config.format, this.autoAlignOffsets);
    }

    compareTimeGap() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        // Check if we have at least 2 routes
        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to compare time gaps');
            return;
        }

        // Check if routes have timestamp data
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            showToast('Time Gap analysis requires at least 2 routes with timestamp data. Routes from GPX/FIT files with recorded time are needed.');
            return;
        }

        // First selected route is the reference
        const referenceRoute = routesWithTimestamps[0];
        const comparisonRoutes = routesWithTimestamps.slice(1);

        // Calculate time gaps, applying both Auto-Align offsets — distance and
        // time must be corrected together, or a route that started recording
        // late shows a bogus constant gap instead of a smaller/zero one.
        const timeGapData = Utils.calculateTimeGaps(referenceRoute, comparisonRoutes, 0.1, this.routeTimeOffsets, this.autoAlignOffsets);

        if (!timeGapData || timeGapData.gaps.length === 0) {
            showToast('Could not calculate time gaps. Routes may not have sufficient timestamp data.');
            return;
        }

        // Warn when a comparison route's confidence says this isn't really a
        // same-run comparison — a literal head-to-head gap isn't meaningful then.
        const differentDayRoutes = comparisonRoutes.filter(r =>
            this.autoAlignConfidence[r.filename] && this.autoAlignConfidence[r.filename].sameDayComparison === false
        );
        const note = differentDayRoutes.length > 0
            ? ' — different-day comparison, gaps reflect pace difference only, not a real head-to-head start'
            : '';

        // Show the time gap chart
        this.chartManager.showTimeGapChart(timeGapData, note);
    }

    compareSplits() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        // Check if we have at least 2 routes
        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to compare splits');
            return;
        }

        // Check if routes have timestamp data (needed for pace)
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            showToast('Split comparison requires at least 2 routes with timestamp data.');
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

        // Calculate cumulative times for each route
        const cumulativeTimes = allSplits.map(({ splits }) => {
            const times = [];
            let cumulative = 0;
            for (const split of splits) {
                if (split.duration !== null) {
                    cumulative += split.duration;
                }
                times.push(cumulative);
            }
            return times;
        });

        // Reference route is the first one (index 0)
        const referenceIdx = 0;

        // Build table header
        let headerRow1 = '<tr><th rowspan="2" class="split-number-header">Split</th>';
        let headerRow2 = '<tr>';

        allSplits.forEach(({ route }, routeIdx) => {
            // First route has 4 columns (Time, Pace, Elev, HR)
            // Other routes have 5 columns (Time, Gap, Pace, Elev, HR)
            const colSpan = routeIdx === referenceIdx ? 4 : 5;
            headerRow1 += `<th colspan="${colSpan}" class="route-header">
                <div class="route-header-content">
                    <div class="route-color-dot" style="background: ${route.color}"></div>
                    <span>${route.displayName}</span>
                    ${routeIdx === referenceIdx ? '<span class="reference-badge" title="Reference route — all time gaps are measured against this one (the first selected route)">REF</span>' : ''}
                </div>
            </th>`;

            headerRow2 += '<th class="metric-header time-header">Time</th>';
            if (routeIdx !== referenceIdx) {
                headerRow2 += '<th class="metric-header gap-header">Gap</th>';
            }
            headerRow2 += '<th class="metric-header">Pace</th><th class="metric-header">Elev</th><th class="metric-header">HR</th>';
        });

        headerRow1 += '</tr>';
        headerRow2 += '</tr>';

        // Build table body
        let bodyRows = '';
        for (let i = 0; i < maxSplits; i++) {
            const splitNum = i + 1;
            let row = `<tr><td class="split-number">${splitNum} km</td>`;

            // Get reference cumulative time for this split
            const refCumTime = cumulativeTimes[referenceIdx][i];

            allSplits.forEach(({ splits }, routeIdx) => {
                const split = splits[i];
                const cumTime = cumulativeTimes[routeIdx][i];

                if (split) {
                    const paceClass = split.isPartial ? 'partial-split' : '';

                    // Time column (cumulative)
                    row += `<td class="split-time">${Utils.formatSplitTime(cumTime)}</td>`;

                    // Gap column (only for non-reference routes)
                    if (routeIdx !== referenceIdx) {
                        const gap = cumTime - refCumTime;
                        const gapClass = gap < 0 ? 'split-gap-ahead' : gap > 0 ? 'split-gap-behind' : 'split-gap-even';
                        row += `<td class="split-gap ${gapClass}">${Utils.formatSplitGap(gap)}</td>`;
                    }

                    row += `<td class="split-pace ${paceClass}">${Utils.formatSplitPace(split.pace)}</td>`;
                    row += `<td class="split-elev">${Utils.formatSplitElevation(split.elevGain)}</td>`;
                    row += `<td class="split-hr">${Utils.formatSplitHR(split.avgHR)}</td>`;
                } else {
                    row += '<td class="split-na">-</td>';
                    if (routeIdx !== referenceIdx) {
                        row += '<td class="split-na">-</td>';
                    }
                    row += '<td class="split-na">-</td><td class="split-na">-</td><td class="split-na">-</td>';
                }
            });

            row += '</tr>';
            bodyRows += row;
        }

        // Add totals row
        let totalsRow = '<tr class="totals-row"><td class="split-number"><strong>Total</strong></td>';
        allSplits.forEach(({ route, splits }, routeIdx) => {
            const avgPace = route.paces && route.paces.length > 0
                ? route.paces.filter(p => p !== null && !isNaN(p) && p > 0 && p < 20).reduce((a, b) => a + b, 0) /
                  route.paces.filter(p => p !== null && !isNaN(p) && p > 0 && p < 20).length
                : null;
            const avgHR = route.heartRates && route.heartRates.length > 0
                ? route.heartRates.filter(h => h !== null && !isNaN(h)).reduce((a, b) => a + b, 0) /
                  route.heartRates.filter(h => h !== null && !isNaN(h)).length
                : null;

            // Total time
            const totalTime = route.stats.duration;
            const refTotalTime = allSplits[referenceIdx].route.stats.duration;

            totalsRow += `<td class="split-time"><strong>${Utils.formatSplitTime(totalTime)}</strong></td>`;

            // Total gap (only for non-reference routes)
            if (routeIdx !== referenceIdx) {
                const totalGap = totalTime - refTotalTime;
                const gapClass = totalGap < 0 ? 'split-gap-ahead' : totalGap > 0 ? 'split-gap-behind' : 'split-gap-even';
                totalsRow += `<td class="split-gap ${gapClass}"><strong>${Utils.formatSplitGap(totalGap)}</strong></td>`;
            }

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

    // Every comparison feature (Time Gap, Splits, Segment, Race, Deviation,
    // Auto-Align, Distance Drift) must agree on the same reference route for a
    // given selection — otherwise an Auto-Align offset computed against one
    // route gets silently applied as if it were relative to a different one.
    // Time-indexed features can only use a route that has timestamps, so if
    // any selected route has them, the first such route wins; only when NONE
    // do (Deviation still works without timestamps) does plain selection order apply.
    pickReferenceRoute(selectedRoutes) {
        const withTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );
        return withTimestamps.length > 0 ? withTimestamps[0] : selectedRoutes[0];
    }

    compareDeviation() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to compare GPS deviation');
            return;
        }

        const referenceRoute = this.pickReferenceRoute(selectedRoutes);
        const comparisonRoutes = selectedRoutes.filter(r => r !== referenceRoute);

        const results = comparisonRoutes
            .map(route => ({ route, result: Utils.calculateCrossTrackDeviation(route, referenceRoute) }))
            .filter(({ result }) => result && result.stats.mean !== null);

        if (results.length === 0) {
            showToast('Could not calculate GPS deviation — routes may not overlap.');
            return;
        }

        // Cache each route's deviation result so the map heatmap toggle doesn't recompute it.
        results.forEach(({ route, result }) => { route.deviationResult = result; });

        this.renderDeviationModal(referenceRoute, results);
    }

    renderDeviationModal(referenceRoute, results) {
        const modal = document.getElementById('deviationModal');
        const table = document.getElementById('deviationTable');

        const headerRow = '<tr><th>Route</th><th>Mean</th><th>Median</th><th>P95</th><th>Max</th><th>Coverage</th><th>Map</th></tr>';

        const routeLabel = (route, isReference) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
                ${isReference ? '<span class="reference-badge" title="Reference route — all deviations are measured against this one">REF</span>' : ''}
                ${!isReference ? this.confidenceBadgeHtml(route) : ''}
            </div>`;

        const refRow = `<tr><td>${routeLabel(referenceRoute, true)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;

        const bodyRows = results.map(({ route, result }) => {
            const total = result.perPointDeviations.length;
            const confident = result.perPointDeviations.filter(d => d !== null).length;
            const coveragePct = total > 0 ? Math.round((confident / total) * 100) : 0;
            const active = route.overlayMode === 'deviation';
            return `<tr>
                <td>${routeLabel(route, false)}</td>
                <td>${Utils.formatDeviation(result.stats.mean)}</td>
                <td>${Utils.formatDeviation(result.stats.median)}</td>
                <td>${Utils.formatDeviation(result.stats.p95)}</td>
                <td>${Utils.formatDeviation(result.stats.max)}</td>
                <td>${coveragePct}%</td>
                <td><button class="deviation-heatmap-toggle${active ? ' active' : ''}" data-route-id="${route.id}">${active ? 'Hide' : 'Show'}</button></td>
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${refRow}${bodyRows}</tbody>`;

        table.querySelectorAll('.deviation-heatmap-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const route = this.routes.find(r => String(r.id) === btn.dataset.routeId);
                if (!route || !route.deviationResult) return;
                const isOn = route.toggleDeviationOverlay(this.mapManager.map, route.deviationResult);
                btn.textContent = isOn ? 'Hide' : 'Show';
                btn.classList.toggle('active', isOn);
                // The sidebar's own Heatmap button also reflects overlayMode —
                // refresh it now so it doesn't show stale state until some
                // unrelated action happens to re-render the sidebar.
                this.updateUI();
            });
        });

        modal.classList.add('show');
    }

    closeDeviationModal() {
        document.getElementById('deviationModal').classList.remove('show');
    }

    confidenceBadgeHtml(route) {
        const c = this.autoAlignConfidence[route.filename];
        if (!c) return '';
        return `<span class="confidence-badge confidence-${c.level}" title="Auto-Align confidence: ${c.level}">${c.level}</span>`;
    }

    // Computes a distance offset (for the metric charts) and, when the two
    // routes' start times are close enough to plausibly be the same run, a
    // time offset (for Time Gap/Race) between the reference route (see
    // pickReferenceRoute) and every other selected route. Never touches route
    // data — manual drag-to-align in the chart modal remains a full override.
    autoAlign() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to auto-align');
            return;
        }

        const referenceRoute = this.pickReferenceRoute(selectedRoutes);
        const testRoutes = selectedRoutes.filter(r => r !== referenceRoute);
        const summaries = [];

        // Reset before recomputing — otherwise a route auto-aligned against a
        // DIFFERENT reference in an earlier run (e.g. selection changed and the
        // reference itself changed) leaves a stale offset that silently applies
        // wherever autoAlignOffsets/routeTimeOffsets is read, including for the
        // reference route itself if it was a test route last time.
        this.autoAlignOffsets = {};
        this.routeTimeOffsets = {};
        this.autoAlignConfidence = {};

        testRoutes.forEach(route => {
            const result = Utils.calculateAutoAlignment(route, referenceRoute);

            if (!result || result.distanceOffsetKm === null) {
                delete this.autoAlignOffsets[route.filename];
                delete this.routeTimeOffsets[route.filename];
                delete this.autoAlignConfidence[route.filename];
                summaries.push(`${route.displayName}: could not align (no confident overlap with the reference route)`);
                return;
            }

            this.autoAlignOffsets[route.filename] = result.distanceOffsetKm;
            if (result.timeOffsetSeconds !== null) {
                this.routeTimeOffsets[route.filename] = result.timeOffsetSeconds;
            } else {
                delete this.routeTimeOffsets[route.filename];
            }
            this.autoAlignConfidence[route.filename] = { ...result.confidence, sameDayComparison: result.sameDayComparison };

            const level = result.confidence.level;
            const parts = [`${level.charAt(0).toUpperCase()}${level.slice(1)} confidence`];
            if (result.confidence.avgDeviation !== null) {
                parts.push(`${Utils.formatDeviation(result.confidence.avgDeviation)} avg deviation`);
            }
            if (result.timeOffsetSeconds !== null) {
                parts.push(`${Utils.formatTimeDelta(result.timeOffsetSeconds)} time offset`);
            } else {
                parts.push('different-day comparison — distance aligned only, Race/Time Gap won\'t reflect a real head-to-head');
            }
            if (!result.confidence.monotonic) {
                parts.push('possible loop/out-and-back course — verify alignment manually');
            }
            summaries.push(`${route.displayName}: ${parts.join(', ')}`);
        });

        showToast(summaries.join('\n'), 'success', 7000);
    }

    compareDistanceDrift() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to compare distance drift');
            return;
        }

        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            showToast('Distance Drift requires at least 2 routes with timestamp data.');
            return;
        }

        const referenceRoute = routesWithTimestamps[0];
        const comparisonRoutes = routesWithTimestamps.slice(1);

        const driftData = Utils.calculateDistanceDrift(referenceRoute, comparisonRoutes, 10, this.routeTimeOffsets, this.autoAlignOffsets);

        if (!driftData || driftData.drifts.length === 0) {
            showToast('Could not calculate distance drift. Routes may not have sufficient timestamp data.');
            return;
        }

        this.renderDistanceDriftModal(driftData);
    }

    renderDistanceDriftModal(driftData) {
        const modal = document.getElementById('distanceDriftModal');
        const table = document.getElementById('distanceDriftTable');

        const headerRow = '<tr><th>Route</th><th>End Distance</th><th>Drift</th><th>Drift %</th><th>Max Drift</th></tr>';

        const routeLabel = (route, isReference) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
                ${isReference ? '<span class="reference-badge" title="Reference route — all drift is measured against this one (the first selected route)">REF</span>' : ''}
            </div>`;

        const lastPoint = driftData.drifts[driftData.drifts.length - 1];
        const refRow = `<tr><td>${routeLabel(driftData.referenceRoute, true)}</td><td>${Utils.formatDistance(lastPoint.referenceDistance)}</td><td>—</td><td>—</td><td>—</td></tr>`;

        const compRoutes = new Map();
        driftData.drifts.forEach(point => point.comparisons.forEach(c => {
            if (!compRoutes.has(c.route.id)) compRoutes.set(c.route.id, c.route);
        }));

        const bodyRows = [...compRoutes.values()].map(route => {
            const last = lastPoint.comparisons.find(c => c.route.id === route.id);
            if (!last) return '';

            const allDrifts = driftData.drifts
                .map(p => p.comparisons.find(c => c.route.id === route.id)?.drift)
                .filter(d => d !== undefined);
            const maxAbsDrift = Math.max(...allDrifts.map(d => Math.abs(d)));
            // Snap floating-point noise (e.g. -1e-13 from offset-corrected
            // subtraction) to exactly 0 so it doesn't render as "-0".
            const drift = Math.abs(last.drift) < 1e-6 ? 0 : last.drift;
            const driftPct = lastPoint.referenceDistance > 0 ? (drift / lastPoint.referenceDistance) * 100 : 0;
            const cls = drift > 0 ? 'drift-positive' : drift < 0 ? 'drift-negative' : '';

            return `<tr>
                <td>${routeLabel(route, false)}</td>
                <td>${Utils.formatDistance(last.distance)}</td>
                <td class="${cls}">${drift > 0 ? '+' : ''}${Utils.formatDistance(drift)}</td>
                <td class="${cls}">${driftPct > 0 ? '+' : ''}${driftPct.toFixed(1)}%</td>
                <td>${Utils.formatDistance(maxAbsDrift)}</td>
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${refRow}${bodyRows}</tbody>`;
        modal.classList.add('show');
    }

    closeDistanceDriftModal() {
        document.getElementById('distanceDriftModal').classList.remove('show');
    }

    // Unlike Deviation/Distance Drift, this isn't a "vs reference" comparison —
    // each selected route just shows its own averages side by side, so any
    // route (FIT-only) can appear as a peer row.
    compareRunningDynamics() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 1) {
            showToast('Please select at least 1 route to view running dynamics');
            return;
        }

        // Any one of the 5 fields having data is enough — don't assume
        // vertical oscillation specifically is present just because some
        // other dynamics field is (see calculateRunningDynamicsSummary).
        const DYNAMICS_FIELDS = ['verticalOscillations', 'groundContactTimes', 'verticalRatios', 'groundContactBalances', 'stepLengths'];
        const routesWithData = selectedRoutes.filter(r =>
            DYNAMICS_FIELDS.some(field => (r[field] || []).some(v => v !== null && v !== undefined))
        );

        if (routesWithData.length === 0) {
            showToast('None of the selected routes have running dynamics data (FIT files only, needs a footpod or the watch\'s own accelerometer feature).');
            return;
        }

        this.renderRunningDynamicsModal(routesWithData);
    }

    renderRunningDynamicsModal(routes) {
        const modal = document.getElementById('runningDynamicsModal');
        const table = document.getElementById('runningDynamicsTable');

        const headerRow = '<tr><th>Route</th><th>Vert. Osc.</th><th>GCT</th><th>GCT Balance</th><th>Vert. Ratio</th><th>Step Length</th><th>Coverage</th></tr>';

        const routeLabel = (route) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
            </div>`;

        const bodyRows = routes.map(route => {
            const summary = Utils.calculateRunningDynamicsSummary(route);
            const coveragePct = Math.round(summary.coverage * 100);
            return `<tr>
                <td>${routeLabel(route)}</td>
                <td>${Utils.formatVerticalOscillation(summary.verticalOscillation)}</td>
                <td>${Utils.formatGroundContactTime(summary.groundContactTime)}</td>
                <td>${Utils.formatPercent(summary.groundContactBalance)}</td>
                <td>${Utils.formatPercent(summary.verticalRatio)}</td>
                <td>${Utils.formatStepLength(summary.stepLength)}</td>
                <td>${coveragePct}%</td>
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;
        modal.classList.add('show');
    }

    closeRunningDynamicsModal() {
        document.getElementById('runningDynamicsModal').classList.remove('show');
    }

    // Per-route self-consistency check, not a "vs reference" comparison —
    // each FIT route checks its own device-reported totals against what's
    // recomputed from its own track.
    compareSessionCheck() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 1) {
            showToast('Please select at least 1 route to run a session self-check');
            return;
        }

        const routesWithSession = selectedRoutes.filter(r => r.sessionSummary);

        if (routesWithSession.length === 0) {
            showToast('None of the selected routes have a FIT session summary to check against (GPX files don\'t have one).');
            return;
        }

        this.renderSessionCheckModal(routesWithSession);
    }

    renderSessionCheckModal(routes) {
        const modal = document.getElementById('sessionCheckModal');
        const table = document.getElementById('sessionCheckTable');

        const hasAnyBaro = routes.some(r => Utils.calculateSessionCheck(r)?.baroAscent);
        const headerRow = `<tr><th>Route</th><th>Distance</th><th>Duration</th><th>Ascent</th><th>Descent</th>${hasAnyBaro ? '<th>Baro Ascent</th>' : ''}</tr>`;

        const routeLabel = (route) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
            </div>`;

        const diffClass = (value) => value > 0 ? 'value-positive' : value < 0 ? 'value-negative' : '';
        const diffCell = (diffEntry, formatter) => {
            if (!diffEntry || diffEntry.diff === null) return '<td>N/A</td>';
            return `<td class="${diffClass(diffEntry.diff)}">${formatter(diffEntry.diff)}</td>`;
        };

        const bodyRows = routes.map(route => {
            const check = Utils.calculateSessionCheck(route);
            if (!check) return '';

            const distanceDiffM = check.distanceKm.diff !== null ? check.distanceKm.diff * 1000 : null;

            return `<tr>
                <td>${routeLabel(route)}</td>
                <td class="${diffClass(distanceDiffM)}">${distanceDiffM !== null ? this.formatDiff(distanceDiffM, 'elev') : 'N/A'}</td>
                ${diffCell(check.durationSeconds, v => this.formatDiff(v, 'time'))}
                ${diffCell(check.ascent, v => this.formatDiff(v, 'elev'))}
                ${diffCell(check.descent, v => this.formatDiff(v, 'elev'))}
                ${hasAnyBaro ? diffCell(check.baroAscent, v => this.formatDiff(v, 'elev')) : ''}
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;
        modal.classList.add('show');
    }

    closeSessionCheckModal() {
        document.getElementById('sessionCheckModal').classList.remove('show');
    }

    compareHrValidation() {
        const selectedRoutes = this.routes.filter(r => r.selected);
        const routesWithHR = selectedRoutes.filter(r => r.heartRates && r.heartRates.some(h => h !== null));

        if (routesWithHR.length < 2) {
            showToast('HR validation requires at least 2 routes with heart rate data.');
            return;
        }

        // First selected route with HR data is the reference — matches the
        // convention pickReferenceRoute uses for timestamp-dependent features.
        const referenceRoute = routesWithHR[0];
        const comparisonRoutes = routesWithHR.slice(1);

        const results = comparisonRoutes.map(route => ({
            route,
            hrComparison: Utils.calculateHrComparison(referenceRoute, route, this.routeTimeOffsets),
            cadenceLockFlags: Utils.detectCadenceLock(route)
        }));

        this.renderHrValidationModal(referenceRoute, results);
    }

    renderHrValidationModal(referenceRoute, results) {
        const modal = document.getElementById('hrValidationModal');
        const table = document.getElementById('hrValidationTable');

        const headerRow = '<tr><th>Route</th><th>Mean Abs Error</th><th>Bias</th><th>Cadence-Lock</th></tr>';

        const routeLabel = (route, isReference) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
                ${isReference ? '<span class="reference-badge" title="Reference route — HR is compared against this one">REF</span>' : ''}
            </div>`;

        const cadenceLockSummary = (flags) => {
            if (flags.length === 0) return 'None';
            const totalPoints = flags.reduce((sum, f) => sum + f.pointCount, 0);
            return `${flags.length} section${flags.length > 1 ? 's' : ''} (${totalPoints} pts)`;
        };

        const refFlags = Utils.detectCadenceLock(referenceRoute);
        const refRow = `<tr>
            <td>${routeLabel(referenceRoute, true)}</td>
            <td>—</td>
            <td>—</td>
            <td class="${refFlags.length > 0 ? 'value-negative' : ''}">${cadenceLockSummary(refFlags)}</td>
        </tr>`;

        const bodyRows = results.map(({ route, hrComparison, cadenceLockFlags }) => {
            // Not Utils.formatHeartRate — it treats 0 as falsy and would show
            // "N/A" for a perfect (zero-error) match instead of "0 bpm".
            const mae = hrComparison ? `${Math.round(hrComparison.meanAbsoluteError)} bpm` : 'N/A';
            const bias = hrComparison
                ? `${hrComparison.bias >= 0 ? '+' : ''}${hrComparison.bias.toFixed(1)} bpm`
                : 'N/A';
            return `<tr>
                <td>${routeLabel(route, false)}</td>
                <td>${mae}</td>
                <td>${bias}</td>
                <td class="${cadenceLockFlags.length > 0 ? 'value-negative' : ''}">${cadenceLockSummary(cadenceLockFlags)}</td>
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${refRow}${bodyRows}</tbody>`;
        modal.classList.add('show');
    }

    closeHrValidationModal() {
        document.getElementById('hrValidationModal').classList.remove('show');
    }

    compareDropout() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 1) {
            showToast('Please select at least 1 route to run dropout diagnostics');
            return;
        }

        this.renderDropoutModal(selectedRoutes);
    }

    renderDropoutModal(routes) {
        const modal = document.getElementById('dropoutModal');
        const table = document.getElementById('dropoutTable');

        const headerRow = '<tr><th>Route</th><th>Typical Interval</th><th>Recording Gaps</th><th>Sensor Dropouts</th></tr>';

        const routeLabel = (route) => `
            <div class="route-header-content">
                <div class="route-color-dot" style="background: ${route.color}"></div>
                <span>${route.displayName}</span>
            </div>`;

        const METRIC_LABELS = { heartRate: 'HR', cadence: 'Cadence', power: 'Power', gpsAccuracy: 'GPS Acc.' };

        const bodyRows = routes.map(route => {
            const diag = Utils.calculateDropoutDiagnostics(route);

            const intervalText = diag.typicalIntervalSeconds !== null
                ? `${diag.typicalIntervalSeconds.toFixed(1)}s`
                : 'N/A';

            const gapsText = diag.gaps.length === 0
                ? 'None'
                : `${diag.gaps.length} gap${diag.gaps.length > 1 ? 's' : ''}, ${Math.round(diag.gaps.reduce((s, g) => s + g.gapSeconds, 0))}s total`;

            const dropoutParts = Object.entries(diag.nullRuns)
                .filter(([, runs]) => runs.length > 0)
                .map(([metric, runs]) => `${METRIC_LABELS[metric] || metric} ×${runs.length}`);
            const dropoutText = dropoutParts.length > 0 ? dropoutParts.join(', ') : 'None';

            return `<tr>
                <td>${routeLabel(route)}</td>
                <td>${intervalText}</td>
                <td class="${diag.gaps.length > 0 ? 'value-negative' : ''}">${gapsText}</td>
                <td class="${dropoutParts.length > 0 ? 'value-negative' : ''}">${dropoutText}</td>
            </tr>`;
        }).join('');

        table.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;
        modal.classList.add('show');
    }

    closeDropoutModal() {
        document.getElementById('dropoutModal').classList.remove('show');
    }

    compareSegment() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to compare segments');
            return;
        }

        // Check for timestamp data
        const routesWithTimestamps = selectedRoutes.filter(r =>
            r.timestamps && r.timestamps.length > 0 && r.timestamps.some(t => t !== null)
        );

        if (routesWithTimestamps.length < 2) {
            showToast('Segment analysis requires at least 2 routes with timestamp data.');
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
            showToast('Please enter valid distance values');
            return;
        }

        if (startKm >= endKm) {
            showToast('Start distance must be less than end distance');
            return;
        }

        if (startKm < 0) {
            showToast('Start distance cannot be negative');
            return;
        }

        if (!this.segmentRoutes || this.segmentRoutes.length < 2) {
            showToast('No routes selected for comparison');
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
            showToast(`Segment ${startKm.toFixed(1)}-${endKm.toFixed(1)} km is outside the range of one or more routes`);
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

    startRace() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Select at least 2 routes to race');
            return;
        }

        const success = this.animationManager.startRace(selectedRoutes, this.routeTimeOffsets);
        if (success) {
            // The comparison panel (bottom sheet) would otherwise cover the map
            // and the playback controls during the race.
            this.closeComparison();
            this.updateUI();
        }
    }

    stopRace() {
        this.animationManager.stopRace();
        this.updateUI();
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
                power: 'powers',
                gpsaccuracy: 'gpsAccuracies'
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

        const driftBtn = document.querySelector('.comparison-drift-btn');
        if (driftBtn) {
            driftBtn.disabled = routesWithTimestamps.length < 2;
        }

        const raceBtn = document.querySelector('.comparison-race-btn');
        if (raceBtn) {
            raceBtn.disabled = routesWithTimestamps.length < 2;
        }

        // Deviation and Auto-Align only need coordinates (no timestamps), unlike the four above.
        const deviationBtn = document.querySelector('.comparison-deviation-btn');
        if (deviationBtn) {
            deviationBtn.disabled = selectedRoutes.length < 2;
        }

        const autoAlignBtn = document.querySelector('.comparison-autoalign-btn');
        if (autoAlignBtn) {
            autoAlignBtn.disabled = selectedRoutes.length < 2;
        }

        // Dynamics/Session Check/Dropout are per-route summaries, not a
        // "vs reference" comparison — any 1+ selected routes works (in
        // practice the panel itself only shows at 2+ selected anyway).
        const dynamicsBtn = document.querySelector('.comparison-dynamics-btn');
        if (dynamicsBtn) {
            dynamicsBtn.disabled = selectedRoutes.length < 1;
        }

        const sessionCheckBtn = document.querySelector('.comparison-sessioncheck-btn');
        if (sessionCheckBtn) {
            sessionCheckBtn.disabled = selectedRoutes.length < 1;
        }

        const dropoutBtn = document.querySelector('.comparison-dropout-btn');
        if (dropoutBtn) {
            dropoutBtn.disabled = selectedRoutes.length < 1;
        }

        const routesWithHeartRate = selectedRoutes.filter(r => r.heartRates && r.heartRates.some(h => h !== null));
        const hrValidationBtn = document.querySelector('.comparison-hrvalidation-btn');
        if (hrValidationBtn) {
            hrValidationBtn.disabled = routesWithHeartRate.length < 2;
        }

        // Auto-open unless the user has explicitly dismissed the panel.
        panel.classList.toggle('show', !this.comparisonDismissed);

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
        this.comparisonDismissed = true;
        document.getElementById('comparisonPanel').classList.remove('show');
        this.updateUI();
    }

    exportComparisonCSV() {
        const selectedRoutes = this.routes.filter(r => r.selected);

        if (selectedRoutes.length < 2) {
            showToast('Please select at least 2 routes to export');
            return;
        }

        const avg = (arr) => arr && arr.length > 0
            ? arr.filter(v => v !== null && !isNaN(v)).reduce((a, b) => a + b, 0) / arr.filter(v => v !== null && !isNaN(v)).length
            : null;

        // CSV headers
        const headers = [
            'Route Name',
            'Distance (km)',
            'Duration',
            'Avg Pace (min/km)',
            'Elevation Gain (m)',
            'Elevation Loss (m)',
            'Avg Heart Rate (bpm)',
            'Avg Cadence (spm)',
            'Avg Power (W)'
        ];

        // Build rows
        const rows = selectedRoutes.map(route => {
            const avgHR = avg(route.heartRates);
            const avgPace = avg(route.paces);
            const avgCadence = avg(route.cadences);
            const avgPower = avg(route.powers);

            return [
                `"${route.displayName.replace(/"/g, '""')}"`,
                (route.stats.distance / 1000).toFixed(2),
                route.stats.duration ? Utils.formatDuration(route.stats.duration) : 'N/A',
                avgPace ? Utils.formatPace(avgPace) : 'N/A',
                Math.round(route.stats.elevationGain),
                Math.round(route.stats.elevationLoss),
                avgHR ? Math.round(avgHR) : 'N/A',
                avgCadence ? Math.round(avgCadence) : 'N/A',
                avgPower ? Math.round(avgPower) : 'N/A'
            ];
        });

        // Build CSV content
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `route-comparison-${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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

window.compareDeviation = function() {
    if (app) app.compareDeviation();
};

window.closeDeviationModal = function() {
    if (app) app.closeDeviationModal();
};

window.autoAlign = function() {
    if (app) app.autoAlign();
};

window.compareDistanceDrift = function() {
    if (app) app.compareDistanceDrift();
};

window.compareRunningDynamics = function() {
    if (app) app.compareRunningDynamics();
};

window.closeRunningDynamicsModal = function() {
    if (app) app.closeRunningDynamicsModal();
};

window.compareSessionCheck = function() {
    if (app) app.compareSessionCheck();
};

window.closeSessionCheckModal = function() {
    if (app) app.closeSessionCheckModal();
};

window.compareHrValidation = function() {
    if (app) app.compareHrValidation();
};

window.closeHrValidationModal = function() {
    if (app) app.closeHrValidationModal();
};

window.compareDropout = function() {
    if (app) app.compareDropout();
};

window.closeDropoutModal = function() {
    if (app) app.closeDropoutModal();
};

window.closeDistanceDriftModal = function() {
    if (app) app.closeDistanceDriftModal();
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

window.startRace = function() {
    if (app) app.startRace();
};

window.stopRace = function() {
    if (app) app.stopRace();
};

window.exportComparisonCSV = function() {
    if (app) app.exportComparisonCSV();
};

// Load Google Maps API
export function loadGoogleMapsAPI() {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMaps.apiKey}&v=weekly&libraries=geometry&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => console.error('Failed to load Google Maps API');
    document.head.appendChild(script);
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', loadGoogleMapsAPI);
