// InsightsManager - Handles route insights and analysis
import { Utils } from './utils.js';
import { ChartManager } from './ChartManager.js';

export class InsightsManager {
    constructor() {
        this.currentInsightsRoute = null;
        this.currentInsightsIndex = null;
        this.insightsChartManager = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('closeInsightsModal').addEventListener('click', () => this.closeInsightsModal());
    }

    showInsightsModal(route, index) {
        const modal = document.getElementById('insightsModal');
        const titleEl = document.getElementById('insightsModalTitle');
        titleEl.textContent = `Insights: ${route.displayName}`;

        const tabsContainer = document.querySelector('.insights-tabs');
        const tabs = tabsContainer.querySelectorAll('.insights-tab');

        // Always show insights tab
        tabs[0].style.display = 'inline-block';
        tabs[0].setAttribute('data-metric', 'insights');

        // Show/hide other tabs based on data
        let tabIndex = 1;
        if (route.elevations.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'elevation');
            tabIndex++;
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'grade');
            tabIndex++;
        }
        if (route.speeds.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'speed');
            tabIndex++;
        }
        if (route.paces.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'pace');
            tabIndex++;
        }
        if (route.heartRates.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'heartrate');
            tabIndex++;
        }
        if (route.cadences.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'cadence');
            tabIndex++;
        }
        if (route.powers.length > 0) {
            tabs[tabIndex].style.display = 'inline-block';
            tabs[tabIndex].setAttribute('data-metric', 'power');
            tabIndex++;
        }

        // Hide unused tabs
        for (let i = tabIndex; i < tabs.length; i++) {
            tabs[i].style.display = 'none';
        }

        // Generate insights
        const insightsContent = document.getElementById('insightsTabContent');
        insightsContent.innerHTML = '<div class="insights-grid">' + this.generateInsights(route).join('') + '</div>';

        // Reset to insights tab
        tabs.forEach(t => t.classList.remove('active'));
        tabs[0].classList.add('active');
        document.getElementById('insightsTabContent').classList.add('active');
        document.getElementById('graphTabContent').classList.remove('active');

        // Clear metric-specific insights
        const metricInsightsContainer = document.getElementById('metricSpecificInsights');
        if (metricInsightsContainer) {
            metricInsightsContainer.innerHTML = '';
        }

        // Store route and index
        this.currentInsightsRoute = route;
        this.currentInsightsIndex = index;

        // Remove old event listeners by cloning
        tabs.forEach((tab) => {
            const newTab = tab.cloneNode(true);
            tab.parentNode.replaceChild(newTab, tab);
        });

        // Setup tab click handlers on the new tabs
        const newTabs = tabsContainer.querySelectorAll('.insights-tab');
        newTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const metricType = tab.getAttribute('data-metric');

                // Hide crosshair when switching tabs
                const crosshair = document.getElementById('insightsCrosshair');
                if (crosshair) {
                    crosshair.style.display = 'none';
                }

                // Update active states
                newTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                if (metricType === 'insights') {
                    document.getElementById('insightsTabContent').classList.add('active');
                    document.getElementById('graphTabContent').classList.remove('active');

                    const metricInsightsContainer = document.getElementById('metricSpecificInsights');
                    if (metricInsightsContainer) {
                        metricInsightsContainer.innerHTML = '';
                    }
                } else {
                    document.getElementById('insightsTabContent').classList.remove('active');
                    document.getElementById('graphTabContent').classList.add('active');

                    this.renderInsightGraph(route, metricType);
                }
            });
        });

        modal.classList.add('show');
    }

    renderInsightGraph(route, metricType) {
        const metricConfig = {
            elevation: { data: route.elevations, name: 'Elevation', label: 'Elevation (m)', format: v => Math.round(v) + 'm' },
            speed: { data: route.speeds, name: 'Speed', label: 'Speed (km/h)', format: v => v.toFixed(1) + ' km/h' },
            pace: { data: route.paces, name: 'Pace', label: 'Pace (min/km)', format: v => Utils.formatPace(v) },
            heartrate: { data: route.heartRates, name: 'Heart Rate', label: 'Heart Rate (bpm)', format: v => Math.round(v) + ' bpm' },
            cadence: { data: route.cadences, name: 'Cadence', label: 'Cadence (spm)', format: v => Math.round(v) + ' spm' },
            power: { data: route.powers, name: 'Power', label: 'Power (W)', format: v => Math.round(v) + 'W' },
            grade: { data: null, name: 'Grade', label: 'Grade (%)', format: v => v.toFixed(1) + '%' }
        };

        const config = metricConfig[metricType];
        if (!config) return;

        const canvas = document.getElementById('insightsChart');
        const container = canvas.parentElement;
        canvas.width = container.clientWidth || 1000;
        canvas.height = 400;

        // Initialize insights chart manager if needed
        if (!this.insightsChartManager) {
            this.insightsChartManager = this.createInsightsChartManager(canvas);
        }

        // Setup reset zoom button
        const resetZoomBtn = document.getElementById('insightsResetZoomBtn');
        const newZoomBtn = resetZoomBtn.cloneNode(true);
        resetZoomBtn.parentNode.replaceChild(newZoomBtn, resetZoomBtn);

        newZoomBtn.onclick = () => {
            this.insightsChartManager.zoomState = null;
            newZoomBtn.disabled = true;
            if (this.insightsChartManager.currentData) {
                this.insightsChartManager.drawChart(
                    this.insightsChartManager.currentData.routes,
                    this.insightsChartManager.currentData.metricType,
                    this.insightsChartManager.currentData.yAxisLabel,
                    this.insightsChartManager.currentData.formatValue
                );
            }
        };

        // Render the chart
        if (metricType === 'grade') {
            const grades = [];
            for (let i = 1; i < route.coordinates.length; i++) {
                const dist = Utils.haversineDistance(route.coordinates[i-1], route.coordinates[i]) * 1000;
                const elevChange = route.elevations[i] - route.elevations[i-1];
                grades.push(dist > 0 ? (elevChange / dist) * 100 : 0);
            }
            const routeWithGrade = { ...route, elevations: grades };
            this.insightsChartManager.drawChart([routeWithGrade], 'elevation', 'Grade (%)', v => v.toFixed(1) + '%');
        } else {
            this.insightsChartManager.drawChart([route], metricType, config.label, config.format);
        }

        // Display metric-specific insights
        this.displayMetricInsights(route, metricType);
    }

    createInsightsChartManager(canvas) {
        const manager = Object.create(ChartManager.prototype);

        manager.canvas = canvas;
        manager.ctx = canvas.getContext('2d');
        manager.modal = { classList: { add: () => {}, remove: () => {}, contains: () => false }, querySelector: () => ({ addEventListener: () => {} }) };
        manager.crosshair = document.getElementById('insightsCrosshair');
        manager.currentData = null;
        manager.zoomState = null;
        manager.dragMode = false;
        manager.selectedRouteForDrag = null;
        manager.routeOffsets = {};
        manager.isDragging = false;
        manager.isSelecting = false;
        manager.dragStartX = null;
        manager.dragStartOffset = 0;
        manager.selectionStart = null;
        manager.animationFrameId = null;
        manager.originalImage = null;

        // Setup canvas event listeners
        canvas.addEventListener('mousedown', (e) => manager.handleMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.handleInsightsMouseMove(manager, e));
        canvas.addEventListener('mouseup', (e) => this.handleInsightsMouseUp(manager, e));
        canvas.addEventListener('mouseleave', () => this.handleInsightsMouseLeave(manager));
        canvas.addEventListener('mouseenter', () => manager.handleMouseEnter());

        return manager;
    }

    handleInsightsMouseMove(manager, e) {
        const rect = manager.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const chartWidth = manager.canvas.width - 140;
        const chartHeight = manager.canvas.height - 120;

        if (manager.isSelecting && manager.selectionStart) {
            if (manager.currentData) {
                manager.drawChart(
                    manager.currentData.routes,
                    manager.currentData.metricType,
                    manager.currentData.yAxisLabel,
                    manager.currentData.formatValue
                );

                const startX = Math.min(manager.selectionStart.x, x);
                const startY = Math.min(manager.selectionStart.y, y);
                const width = Math.abs(x - manager.selectionStart.x);
                const height = Math.abs(y - manager.selectionStart.y);

                manager.ctx.strokeStyle = '#1a73e8';
                manager.ctx.fillStyle = 'rgba(26, 115, 232, 0.1)';
                manager.ctx.lineWidth = 2;
                manager.ctx.strokeRect(startX, startY, width, height);
                manager.ctx.fillRect(startX, startY, width, height);
            }
        } else if (!manager.isSelecting && manager.originalImage) {
            if (x < 70 || x > 70 + chartWidth || y < 50 || y > 50 + chartHeight) {
                if (manager.crosshair) {
                    manager.crosshair.style.display = 'none';
                }
                manager.ctx.putImageData(manager.originalImage, 0, 0);
                return;
            }

            manager.ctx.putImageData(manager.originalImage, 0, 0);

            manager.ctx.strokeStyle = 'rgba(26, 115, 232, 0.8)';
            manager.ctx.lineWidth = 2;
            manager.ctx.setLineDash([5, 5]);
            manager.ctx.beginPath();
            manager.ctx.moveTo(x, 50);
            manager.ctx.lineTo(x, 50 + chartHeight);
            manager.ctx.stroke();
            manager.ctx.setLineDash([]);

            manager.updateCrosshair(x, e.clientX, e.clientY, chartWidth);
        }
    }

    handleInsightsMouseUp(manager, e) {
        if (manager.isSelecting && manager.selectionStart) {
            const rect = manager.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const chartWidth = manager.canvas.width - 140;

            const startX = Math.min(manager.selectionStart.x, x);
            const endX = Math.max(manager.selectionStart.x, x);

            if (Math.abs(endX - startX) > 20) {
                const maxDistance = Math.max(...manager.currentData.routes.map(r => {
                    const offset = manager.routeOffsets[r.filename] || 0;
                    return r.stats.distance + offset;
                }));

                const minDistance = ((startX - 70) / chartWidth) * maxDistance;
                const maxDistanceZoom = ((endX - 70) / chartWidth) * maxDistance;

                manager.zoomState = {
                    minDistance: Math.max(0, minDistance),
                    maxDistance: Math.min(maxDistance, maxDistanceZoom)
                };

                document.getElementById('insightsResetZoomBtn').disabled = false;

                if (manager.currentData) {
                    manager.drawChart(
                        manager.currentData.routes,
                        manager.currentData.metricType,
                        manager.currentData.yAxisLabel,
                        manager.currentData.formatValue
                    );
                }
            }
        }

        manager.isSelecting = false;
        manager.selectionStart = null;
    }

    handleInsightsMouseLeave(manager) {
        manager.isSelecting = false;
        manager.selectionStart = null;
        if (manager.crosshair) {
            manager.crosshair.style.display = 'none';
        }
        if (manager.currentData) {
            manager.drawChart(
                manager.currentData.routes,
                manager.currentData.metricType,
                manager.currentData.yAxisLabel,
                manager.currentData.formatValue
            );
        }
    }

    displayMetricInsights(route, metricType) {
        const container = document.getElementById('metricSpecificInsights');
        if (!container) return;

        let textContent = '';

        switch(metricType) {
            case 'heartrate':
                textContent = this.generateHeartRateText(route);
                break;
            case 'speed':
                textContent = this.generateSpeedText(route);
                break;
            case 'pace':
                textContent = this.generatePaceText(route);
                break;
            case 'cadence':
                textContent = this.generateCadenceText(route);
                break;
            case 'elevation':
            case 'grade':
                textContent = this.generateElevationText(route);
                break;
            case 'power':
                textContent = '<p>Power analysis coming soon!</p>';
                break;
        }

        if (textContent) {
            container.innerHTML = `<div class="metric-insights-text">${textContent}</div>`;
        } else {
            container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No specific insights available</div>';
        }
    }

    closeInsightsModal() {
        document.getElementById('insightsModal').classList.remove('show');
        this.currentInsightsRoute = null;
        this.currentInsightsIndex = null;
        if (this.insightsChartManager) {
            this.insightsChartManager.zoomState = null;
            const crosshair = document.getElementById('insightsCrosshair');
            if (crosshair) {
                crosshair.style.display = 'none';
            }
        }
    }

    generateInsights(route) {
        const insights = [];

        if (route.stats.duration && route.paces.length > 10) {
            const splitInsight = this.calculateSplitAnalysis(route);
            if (splitInsight) insights.push(splitInsight);
        }

        if (route.paces.length > 10) {
            const consistencyInsight = this.calculateConsistency(route);
            if (consistencyInsight) insights.push(consistencyInsight);
        }

        if (route.paces.length > 10) {
            const segmentInsights = this.calculateBestWorstSegments(route);
            insights.push(...segmentInsights);
        }

        if (route.heartRates.length > 10) {
            const hrInsights = this.calculateHeartRateInsights(route);
            insights.push(...hrInsights);
        }

        if (route.elevations.length > 10) {
            const elevInsights = this.calculateElevationInsights(route);
            insights.push(...elevInsights);
        }

        if (route.cadences.length > 10) {
            const cadenceInsights = this.calculateCadenceInsights(route);
            insights.push(...cadenceInsights);
        }

        const quirkyStats = this.calculateQuirkyStats(route);
        insights.push(...quirkyStats);

        // Best Efforts Detection
        const bestEffortInsights = this.calculateBestEffortInsights(route);
        insights.push(...bestEffortInsights);

        // Gradient Analysis
        const gradientInsights = this.calculateGradientInsights(route);
        insights.push(...gradientInsights);

        return insights;
    }

    calculateSplitAnalysis(route) {
        const halfwayIndex = Math.floor(route.paces.length / 2);
        const firstHalf = route.paces.slice(0, halfwayIndex).filter(p => p !== null);
        const secondHalf = route.paces.slice(halfwayIndex).filter(p => p !== null);

        if (firstHalf.length === 0 || secondHalf.length === 0) return null;

        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        const diff = ((secondAvg - firstAvg) / firstAvg) * 100;
        const absDiff = Math.abs(diff);

        if (absDiff < 2) {
            return this.createInsightCard('neutral', 'Even Split', 'Perfect Execution',
                `First half: ${Utils.formatPace(firstAvg)}, Second half: ${Utils.formatPace(secondAvg)}`);
        } else if (diff < 0) {
            return this.createInsightCard('positive', 'Negative Split', `${absDiff.toFixed(1)}% Faster`,
                `Strong finish! ${Utils.formatPace(firstAvg)} → ${Utils.formatPace(secondAvg)}`);
        } else {
            return this.createInsightCard('negative', 'Positive Split', `${absDiff.toFixed(1)}% Slower`,
                `Slowed down: ${Utils.formatPace(firstAvg)} → ${Utils.formatPace(secondAvg)}`);
        }
    }

    calculateConsistency(route) {
        const validPaces = route.paces.filter(p => p !== null && p > 0 && p < 20);
        if (validPaces.length < 10) return null;

        const mean = validPaces.reduce((a, b) => a + b, 0) / validPaces.length;
        const variance = validPaces.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validPaces.length;
        const stdDev = Math.sqrt(variance);
        const cv = (stdDev / mean) * 100;

        if (cv < 10) {
            return this.createInsightCard('positive', 'Steady Eddie', `${(100 - cv).toFixed(0)}% Consistent`,
                'Excellent pacing! Less than 10% variation.');
        } else if (cv < 20) {
            return this.createInsightCard('neutral', 'Moderate Variation', `${(100 - cv).toFixed(0)}% Consistent`,
                'Decent pacing with some variation.');
        } else {
            return this.createInsightCard('negative', 'Rollercoaster Run', `${cv.toFixed(0)}% Variation`,
                'Highly variable pace - consider working on consistency.');
        }
    }

    calculateBestWorstSegments(route) {
        const insights = [];
        if (!route.paces || route.paces.length < 10) return insights;

        const validPaces = route.paces.map((p, i) => ({ pace: p, index: i }))
            .filter(p => p.pace !== null && p.pace > 2 && p.pace < 20);

        if (validPaces.length < 10) return insights;

        // Calculate distances
        let distances = [0];
        for (let i = 1; i < route.coordinates.length; i++) {
            distances.push(distances[i-1] + Utils.haversineDistance(route.coordinates[i-1], route.coordinates[i]));
        }

        const rollingWindow = Math.min(10, Math.floor(validPaces.length / 10));
        let fastestAvgPace = Infinity;
        let fastestAvgIndex = 0;

        for (let i = 0; i <= validPaces.length - rollingWindow; i++) {
            const windowPaces = validPaces.slice(i, i + rollingWindow).map(p => p.pace);
            const avgPace = windowPaces.reduce((a, b) => a + b, 0) / windowPaces.length;
            if (avgPace < fastestAvgPace) {
                fastestAvgPace = avgPace;
                fastestAvgIndex = validPaces[i + Math.floor(rollingWindow / 2)].index;
            }
        }

        if (fastestAvgPace !== Infinity && fastestAvgPace >= 2 && fastestAvgPace < 20) {
            const fastestDist = distances[fastestAvgIndex];
            insights.push(this.createInsightCard('positive', 'Fastest Pace', Utils.formatPace(fastestAvgPace),
                `Peak performance around ${Utils.formatDistance(fastestDist)}`));
        }

        return insights;
    }

    calculateHeartRateInsights(route) {
        const insights = [];
        const validHR = route.heartRates.filter(hr => hr !== null && hr >= 30 && hr <= 220);
        if (validHR.length < 10) return insights;

        const avgHR = validHR.reduce((a, b) => a + b, 0) / validHR.length;
        const maxHR = Math.max(...validHR);

        // HR Drift
        const firstQuarter = validHR.slice(0, Math.floor(validHR.length / 4));
        const lastQuarter = validHR.slice(-Math.floor(validHR.length / 4));

        if (firstQuarter.length > 0 && lastQuarter.length > 0) {
            const firstAvg = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
            const lastAvg = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
            const drift = lastAvg - firstAvg;

            if (Math.abs(drift) > 5) {
                const type = drift > 10 ? 'negative' : 'neutral';
                const driftText = drift > 0 ? `+${drift.toFixed(0)}` : drift.toFixed(0);
                insights.push(this.createInsightCard(type, 'Cardiac Drift', `${driftText} bpm`,
                    `Heart rate ${drift > 0 ? 'increased' : 'decreased'} from start to finish`));
            }
        }

        insights.push(this.createInsightCard('neutral', 'Peak Effort', `${Math.round(maxHR)} bpm`,
            `Maximum heart rate reached`));

        return insights;
    }

    calculateElevationInsights(route) {
        const insights = [];
        const validElev = route.elevations.filter(e => e !== null);
        if (validElev.length < 10) return insights;

        const maxElev = Math.max(...validElev);
        const minElev = Math.min(...validElev);
        const netElev = validElev[validElev.length - 1] - validElev[0];

        if (route.stats.elevationGain > 50) {
            insights.push(this.createInsightCard('neutral', 'Elevation Gain', `${Math.round(route.stats.elevationGain)}m`,
                `Total climbing throughout the route`));
        }

        if (Math.abs(netElev) > 20) {
            const direction = netElev < 0 ? 'Downhill' : 'Uphill';
            const type = netElev < 0 ? 'positive' : 'neutral';
            insights.push(this.createInsightCard(type, `Net ${direction}`, `${Math.abs(netElev).toFixed(0)}m`,
                `Overall ${direction.toLowerCase()} from start to finish`));
        }

        return insights;
    }

    calculateCadenceInsights(route) {
        const insights = [];
        const validCadence = route.cadences.filter(c => c !== null && c >= 50 && c <= 250);
        if (validCadence.length < 10) return insights;

        const avgCadence = validCadence.reduce((a, b) => a + b, 0) / validCadence.length;

        if (route.paces && route.paces.length > 10) {
            const validData = route.paces.map((p, i) => ({
                pace: p,
                cadence: route.cadences[i]
            })).filter(d => d.pace !== null && d.cadence !== null && d.pace > 0 && d.cadence >= 50);

            if (validData.length > 10) {
                const sorted = [...validData].sort((a, b) => a.pace - b.pace);
                const topPaces = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.1)));

                if (topPaces.length > 0) {
                    const bestCadence = topPaces.reduce((a, b) => a + b.cadence, 0) / topPaces.length;
                    insights.push(this.createInsightCard('positive', 'Optimal Cadence', `${Math.round(bestCadence)} spm`,
                        `Your fastest sections averaged this cadence`));
                }
            }
        }

        return insights;
    }

    calculateQuirkyStats(route) {
        const insights = [];

        // Estimated steps
        if (route.stats.distance && route.stats.duration) {
            const avgCadence = route.cadences.length > 0 ?
                route.cadences.filter(c => c !== null).reduce((a, b) => a + b, 0) / route.cadences.filter(c => c !== null).length :
                170;
            const durationMinutes = route.stats.duration / 60;
            const steps = Math.round(avgCadence * durationMinutes);

            insights.push(this.createInsightCard('neutral', 'Steps Taken', steps.toLocaleString(),
                'Approximate steps based on cadence'));
        }

        // Heartbeats
        if (route.heartRates.length > 0 && route.stats.duration) {
            const validHR = route.heartRates.filter(hr => hr !== null);
            if (validHR.length > 0) {
                const avgHR = validHR.reduce((a, b) => a + b, 0) / validHR.length;
                const durationMinutes = route.stats.duration / 60;
                const beats = Math.round(avgHR * durationMinutes);

                insights.push(this.createInsightCard('neutral', 'Heartbeats', beats.toLocaleString(),
                    'Total heartbeats during this run'));
            }
        }

        // Time of day
        if (route.timestamps.length > 0 && route.timestamps[0]) {
            const startTime = route.timestamps[0];
            const hour = startTime.getHours();
            let timeOfDay;

            if (hour < 6) timeOfDay = 'Early Bird';
            else if (hour < 12) timeOfDay = 'Morning';
            else if (hour < 17) timeOfDay = 'Afternoon';
            else if (hour < 20) timeOfDay = 'Evening';
            else timeOfDay = 'Night Owl';

            const timeStr = startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            insights.push(this.createInsightCard('neutral', timeOfDay, timeStr,
                `Started at ${timeStr}`));
        }

        return insights;
    }

    // Best Efforts Detection
    calculateBestEffortInsights(route) {
        const insights = [];

        // Need timestamps for best efforts calculation
        if (!route.timestamps || route.timestamps.length === 0) {
            return insights;
        }

        const bestEfforts = Utils.calculateBestEfforts(route);

        if (bestEfforts.length === 0) {
            return insights;
        }

        // Create card for each best effort
        for (const effort of bestEfforts) {
            const paceStr = Utils.formatSplitPace(effort.pace);
            const timeStr = this.formatDuration(effort.duration);
            const locationStr = `at ${effort.startKm.toFixed(1)}km`;
            const elevStr = effort.elevGain > 0 ? ` • +${Math.round(effort.elevGain)}m` : '';

            insights.push(this.createInsightCard(
                'positive',
                `Best ${effort.distanceLabel}`,
                `${timeStr} (${paceStr})`,
                `${locationStr}${elevStr}`
            ));
        }

        return insights;
    }

    formatDuration(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) {
            return 'N/A';
        }
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.round(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Gradient Analysis
    calculateGradientInsights(route) {
        const insights = [];

        // Need elevation data for gradient analysis
        if (!route.elevations || route.elevations.length < 10) {
            return insights;
        }

        const { climbs, descents } = Utils.detectSteepSections(route, 5, 0.05);

        // Find steepest climb
        if (climbs.length > 0) {
            const steepestClimb = climbs.reduce((max, c) => c.maxGrade > max.maxGrade ? c : max);
            insights.push(this.createInsightCard(
                'negative',
                'Steepest Climb',
                `${steepestClimb.maxGrade.toFixed(1)}% grade`,
                `at ${steepestClimb.startKm.toFixed(1)}km • +${Math.round(steepestClimb.elevChange)}m over ${(steepestClimb.distance * 1000).toFixed(0)}m`
            ));

            // Total climbing distance
            const totalClimbDist = climbs.reduce((sum, c) => sum + c.distance, 0);
            const totalClimbElev = climbs.reduce((sum, c) => sum + c.elevChange, 0);
            insights.push(this.createInsightCard(
                'neutral',
                'Steep Climbing',
                `${(totalClimbDist * 1000).toFixed(0)}m`,
                `${climbs.length} climb${climbs.length > 1 ? 's' : ''} >5% • +${Math.round(totalClimbElev)}m total`
            ));
        }

        // Find steepest descent
        if (descents.length > 0) {
            const steepestDescent = descents.reduce((max, d) => d.maxGrade > max.maxGrade ? d : max);
            insights.push(this.createInsightCard(
                'positive',
                'Steepest Descent',
                `${steepestDescent.maxGrade.toFixed(1)}% grade`,
                `at ${steepestDescent.startKm.toFixed(1)}km • -${Math.round(steepestDescent.elevChange)}m over ${(steepestDescent.distance * 1000).toFixed(0)}m`
            ));
        }

        // Flat terrain message if no steep sections
        if (climbs.length === 0 && descents.length === 0) {
            insights.push(this.createInsightCard(
                'positive',
                'Flat Terrain',
                'No steep sections',
                'No gradients >5% detected on this route'
            ));
        }

        return insights;
    }

    createInsightCard(type, title, value, description) {
        return `
            <div class="insight-card ${type}">
                <div class="insight-title">${title}</div>
                <div class="insight-value">${value}</div>
                <div class="insight-description">${description}</div>
            </div>
        `;
    }

    // Text generation methods for metric-specific insights
    generateHeartRateText(route) {
        if (route.heartRates.length < 10) return '';

        const validHR = route.heartRates.filter(hr => hr !== null && hr > 0);
        if (validHR.length === 0) return '';

        const avgHR = validHR.reduce((a, b) => a + b, 0) / validHR.length;
        const maxHR = Math.max(...validHR);
        const minHR = Math.min(...validHR);

        let text = '';

        // HR Drift
        const firstQuarter = validHR.slice(0, Math.floor(validHR.length / 4));
        const lastQuarter = validHR.slice(-Math.floor(validHR.length / 4));
        const firstAvg = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
        const lastAvg = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
        const drift = lastAvg - firstAvg;

        if (Math.abs(drift) > 5) {
            const driftDesc = drift > 0 ? 'increased' : 'decreased';
            text += `<p>Your heart rate ${driftDesc} by <strong>${Math.abs(drift).toFixed(0)} bpm</strong> from start to finish. `;
            if (drift > 15) {
                text += `This significant drift could indicate dehydration or fatigue.`;
            } else {
                text += `This is normal for longer efforts.`;
            }
            text += '</p>';
        }

        const hrRange = maxHR - minHR;
        text += `<p>Peak heart rate: <strong>${maxHR} bpm</strong> with a range of ${hrRange} bpm.</p>`;
        text += `<p><em>Average heart rate: ${avgHR.toFixed(0)} bpm</em></p>`;

        return text;
    }

    generateSpeedText(route) {
        if (route.speeds.length < 10) return '';

        const validSpeeds = route.speeds.filter(s => s !== null && s > 0);
        if (validSpeeds.length === 0) return '';

        const avgSpeed = validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length;

        const rollingWindow = Math.min(10, Math.floor(validSpeeds.length / 10));
        let maxAvgSpeed = 0;
        for (let i = 0; i <= validSpeeds.length - rollingWindow; i++) {
            const windowSpeeds = validSpeeds.slice(i, i + rollingWindow);
            const avgWindowSpeed = windowSpeeds.reduce((a, b) => a + b, 0) / windowSpeeds.length;
            if (avgWindowSpeed > maxAvgSpeed) maxAvgSpeed = avgWindowSpeed;
        }

        let text = `<p>Your fastest sustained effort was <strong>${maxAvgSpeed.toFixed(1)} km/h</strong> (${Utils.formatPace(60 / maxAvgSpeed)} pace).</p>`;
        text += `<p><em>Average speed: ${avgSpeed.toFixed(1)} km/h (${Utils.formatPace(60 / avgSpeed)} pace)</em></p>`;

        return text;
    }

    generatePaceText(route) {
        if (route.paces.length < 10) return '';

        let text = '';

        // Split analysis
        const halfwayIndex = Math.floor(route.paces.length / 2);
        const firstHalf = route.paces.slice(0, halfwayIndex).filter(p => p !== null);
        const secondHalf = route.paces.slice(halfwayIndex).filter(p => p !== null);

        if (firstHalf.length > 0 && secondHalf.length > 0) {
            const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            const diff = ((secondAvg - firstAvg) / firstAvg) * 100;

            if (Math.abs(diff) < 2) {
                text += `<p><strong>Nearly perfect pacing!</strong> First half: ${Utils.formatPace(firstAvg)}, Second half: ${Utils.formatPace(secondAvg)}.</p>`;
            } else if (diff < 0) {
                text += `<p>You ran a <strong>negative split</strong>, finishing ${Math.abs(diff).toFixed(1)}% faster. Impressive discipline!</p>`;
            } else {
                text += `<p>Your second half was ${diff.toFixed(1)}% slower - a common positive split pattern.</p>`;
            }
        }

        // Consistency
        const validPaces = route.paces.filter(p => p !== null && p > 0 && p < 20);
        if (validPaces.length >= 10) {
            const mean = validPaces.reduce((a, b) => a + b, 0) / validPaces.length;
            const variance = validPaces.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validPaces.length;
            const cv = (Math.sqrt(variance) / mean) * 100;

            if (cv < 10) {
                text += `<p>Your pacing was <strong>remarkably consistent</strong> with less than 10% variation.</p>`;
            } else if (cv < 20) {
                text += `<p>Your pace showed moderate variation (${cv.toFixed(0)}%).</p>`;
            } else {
                text += `<p>Your pace was quite variable (${cv.toFixed(0)}% variation) - likely due to terrain or strategic walking.</p>`;
            }
        }

        return text;
    }

    generateCadenceText(route) {
        if (route.cadences.length < 10) return '';

        const validCadence = route.cadences.filter(c => c !== null && c > 0);
        if (validCadence.length === 0) return '';

        const avgCadence = validCadence.reduce((a, b) => a + b, 0) / validCadence.length;
        let text = '';

        if (route.paces.length > 10) {
            const validData = route.paces.map((p, i) => ({
                pace: p,
                cadence: route.cadences[i]
            })).filter(d => d.pace !== null && d.cadence !== null && d.pace > 0);

            if (validData.length > 10) {
                const sorted = [...validData].sort((a, b) => a.pace - b.pace);
                const topPaces = sorted.slice(0, Math.floor(sorted.length * 0.1));
                const bestCadence = topPaces.reduce((a, b) => a + b.cadence, 0) / topPaces.length;

                text += `<p>During your fastest sections, you averaged <strong>${Math.round(bestCadence)} steps per minute</strong>. `;

                if (bestCadence > 180) {
                    text += `That's a high cadence - quick, efficient steps!`;
                } else if (bestCadence > 170) {
                    text += `This is in the sweet spot many coaches recommend.`;
                } else if (bestCadence > 160) {
                    text += `A typical distance running cadence.`;
                } else {
                    text += `Lower cadence, possibly due to terrain or hiking sections.`;
                }
                text += '</p>';
            }
        }

        text += `<p><em>Overall average cadence: ${Math.round(avgCadence)} spm</em></p>`;

        return text;
    }

    generateElevationText(route) {
        if (route.elevations.length < 10) return '';

        const validElev = route.elevations.filter(e => e !== null);
        if (validElev.length === 0) return '';

        const maxElev = Math.max(...validElev);
        const minElev = Math.min(...validElev);
        const netElev = validElev[validElev.length - 1] - validElev[0];
        const elevRange = maxElev - minElev;

        let text = '';

        if (Math.abs(netElev) > 10) {
            const direction = netElev > 0 ? 'uphill' : 'downhill';
            text += `<p>This route had a <strong>net ${Math.abs(netElev).toFixed(0)}m ${direction}</strong> bias.</p>`;
        }

        text += `<p>Elevation ranged from <strong>${minElev.toFixed(0)}m to ${maxElev.toFixed(0)}m</strong> (${elevRange.toFixed(0)}m variation). `;

        if (elevRange > 500) {
            text += `Serious vertical!`;
        } else if (elevRange > 200) {
            text += `Moderate hills.`;
        } else if (elevRange > 50) {
            text += `Gentle rolling terrain.`;
        } else {
            text += `Pretty flat!`;
        }
        text += '</p>';

        if (route.stats.elevationGain) {
            const gainPerKm = route.stats.elevationGain / (route.stats.distance / 1000);
            text += `<p><em>Total elevation gain: ${route.stats.elevationGain.toFixed(0)}m (${gainPerKm.toFixed(0)}m/km average)</em></p>`;
        }

        return text;
    }
}
