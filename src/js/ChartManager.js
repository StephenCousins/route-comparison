// ChartManager - Handles elevation/metric charts
import { Utils } from './utils.js';

export class ChartManager {
    constructor() {
        this.canvas = document.getElementById('elevationChart');
        this.ctx = this.canvas.getContext('2d');
        this.modal = document.getElementById('elevationModal');
        this.crosshair = document.getElementById('chartCrosshair');

        this.currentData = null;
        this.zoomState = null;
        this.dragMode = false;
        this.selectedRouteForDrag = null;
        this.routeOffsets = {};

        this.isDragging = false;
        this.isSelecting = false;
        this.dragStartX = null;
        this.dragStartOffset = 0;
        this.selectionStart = null;
        this.animationFrameId = null;
        this.originalImage = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());

        document.getElementById('dragModeBtn').addEventListener('click', () => this.toggleDragMode());
        document.getElementById('resetZoomBtn').addEventListener('click', () => this.resetZoom());
        document.getElementById('resetOffsetsBtn').addEventListener('click', () => this.resetOffsets());

        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.canvas.addEventListener('mouseenter', () => this.handleMouseEnter());
    }

    show(routes, metricType, yAxisLabel, formatValue) {
        document.getElementById('modalTitle').textContent =
            `${yAxisLabel.split('(')[0].trim()} ${routes.length > 1 ? `Comparison (${routes.length} routes)` : `Profile: ${routes[0].displayName}`}`;
        this.modal.classList.add('show');
        this.drawChart(routes, metricType, yAxisLabel, formatValue);
    }

    close() {
        this.modal.classList.remove('show');
        this.zoomState = null;
        this.currentData = null;
        this.dragMode = false;
        this.selectedRouteForDrag = null;
        this.routeOffsets = {};
        this.isDragging = false;
        this.isSelecting = false;
        this.originalImage = null;

        document.getElementById('resetZoomBtn').disabled = true;
        document.getElementById('resetOffsetsBtn').disabled = true;
        document.getElementById('dragModeBtn').classList.remove('active');
        document.getElementById('dragModeBtn').textContent = 'Drag to Align';

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    toggleDragMode() {
        this.dragMode = !this.dragMode;
        const btn = document.getElementById('dragModeBtn');
        const instructions = document.getElementById('zoomInstructions');

        if (this.dragMode) {
            btn.classList.add('active');
            btn.textContent = 'Drag Mode Active';
            this.canvas.classList.add('drag-mode');
            instructions.textContent = 'Click a route in the legend, then drag it horizontally to align';
        } else {
            btn.classList.remove('active');
            btn.textContent = 'Drag to Align';
            this.canvas.classList.remove('drag-mode');
            this.selectedRouteForDrag = null;
            instructions.textContent = 'Click and drag to zoom into a region';
        }
        this.updateLegend();
    }

    resetZoom() {
        this.zoomState = null;
        document.getElementById('resetZoomBtn').disabled = true;
        if (this.currentData) {
            this.drawChart(
                this.currentData.routes,
                this.currentData.metricType,
                this.currentData.yAxisLabel,
                this.currentData.formatValue
            );
        }
    }

    resetOffsets() {
        this.routeOffsets = {};
        document.getElementById('resetOffsetsBtn').disabled = true;
        if (this.currentData) {
            this.drawChart(
                this.currentData.routes,
                this.currentData.metricType,
                this.currentData.yAxisLabel,
                this.currentData.formatValue
            );
        }
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const chartWidth = this.canvas.width - 140;

        if (x >= 70 && x <= 70 + chartWidth) {
            if (this.dragMode && this.selectedRouteForDrag !== null) {
                this.isDragging = true;
                this.dragStartX = x;
                const routeId = this.currentData.routes[this.selectedRouteForDrag].filename;
                this.dragStartOffset = this.routeOffsets[routeId] || 0;
                this.canvas.classList.add('dragging');
            } else if (!this.dragMode) {
                this.isSelecting = true;
                const y = e.clientY - rect.top;
                this.selectionStart = { x, y };
            }
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const chartWidth = this.canvas.width - 140;
        const chartHeight = this.canvas.height - 120;

        if (this.isDragging && this.selectedRouteForDrag !== null) {
            const pixelDiff = x - this.dragStartX;
            const maxDistance = Math.max(...this.currentData.routes.map(r => {
                const offset = this.routeOffsets[r.filename] || 0;
                return r.stats.distance + offset;
            }));
            const distanceDiff = (pixelDiff / chartWidth) * maxDistance;
            const routeId = this.currentData.routes[this.selectedRouteForDrag].filename;
            this.routeOffsets[routeId] = this.dragStartOffset + distanceDiff;

            document.getElementById('resetOffsetsBtn').disabled = false;

            if (!this.animationFrameId) {
                this.animationFrameId = requestAnimationFrame(() => {
                    if (this.currentData) {
                        this.drawChart(
                            this.currentData.routes,
                            this.currentData.metricType,
                            this.currentData.yAxisLabel,
                            this.currentData.formatValue
                        );
                    }
                    this.animationFrameId = null;
                });
            }
        } else if (this.isSelecting && this.selectionStart) {
            if (this.currentData) {
                this.drawChart(
                    this.currentData.routes,
                    this.currentData.metricType,
                    this.currentData.yAxisLabel,
                    this.currentData.formatValue
                );

                const startX = Math.min(this.selectionStart.x, x);
                const startY = Math.min(this.selectionStart.y, y);
                const width = Math.abs(x - this.selectionStart.x);
                const height = Math.abs(y - this.selectionStart.y);

                this.ctx.strokeStyle = '#1a73e8';
                this.ctx.fillStyle = 'rgba(26, 115, 232, 0.1)';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(startX, startY, width, height);
                this.ctx.fillRect(startX, startY, width, height);
            }
        } else if (!this.isDragging && !this.isSelecting && this.originalImage) {
            if (x < 70 || x > 70 + chartWidth || y < 50 || y > 50 + chartHeight) {
                this.crosshair.style.display = 'none';
                this.ctx.putImageData(this.originalImage, 0, 0);
                return;
            }

            this.ctx.putImageData(this.originalImage, 0, 0);

            this.ctx.strokeStyle = 'rgba(26, 115, 232, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(x, 50);
            this.ctx.lineTo(x, 50 + chartHeight);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.updateCrosshair(x, e.clientX, e.clientY, chartWidth);
        }
    }

    handleMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.canvas.classList.remove('dragging');
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            if (this.currentData) {
                this.drawChart(
                    this.currentData.routes,
                    this.currentData.metricType,
                    this.currentData.yAxisLabel,
                    this.currentData.formatValue
                );
            }
        } else if (this.isSelecting && this.selectionStart) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const chartWidth = this.canvas.width - 140;

            const startX = Math.min(this.selectionStart.x, x);
            const endX = Math.max(this.selectionStart.x, x);

            if (Math.abs(endX - startX) > 20) {
                const maxDistance = Math.max(...this.currentData.routes.map(r => {
                    const offset = this.routeOffsets[r.filename] || 0;
                    return r.stats.distance + offset;
                }));

                const minDistance = ((startX - 70) / chartWidth) * maxDistance;
                const maxDistanceZoom = ((endX - 70) / chartWidth) * maxDistance;

                this.zoomState = {
                    minDistance: Math.max(0, minDistance),
                    maxDistance: Math.min(maxDistance, maxDistanceZoom)
                };

                document.getElementById('resetZoomBtn').disabled = false;

                if (this.currentData) {
                    this.drawChart(
                        this.currentData.routes,
                        this.currentData.metricType,
                        this.currentData.yAxisLabel,
                        this.currentData.formatValue
                    );
                }
            }
        }

        this.isSelecting = false;
        this.selectionStart = null;
    }

    handleMouseLeave() {
        if (this.isDragging) {
            this.isDragging = false;
            this.canvas.classList.remove('dragging');
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        }
        this.isSelecting = false;
        this.selectionStart = null;
        this.crosshair.style.display = 'none';
    }

    handleMouseEnter() {
        if (this.currentData) {
            this.originalImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    updateCrosshair(x, clientX, clientY, chartWidth) {
        if (!this.currentData) return;

        const maxDist = this.zoomState ?
            (this.zoomState.maxDistance - this.zoomState.minDistance) :
            Math.max(...this.currentData.routes.map(r => {
                const offset = this.routeOffsets[r.filename] || 0;
                return r.stats.distance + offset;
            }));

        const mouseDistance = ((x - 70) / chartWidth) * maxDist;

        let tooltipHTML = `<div class="crosshair-distance">Distance: ${Utils.formatDistance(mouseDistance)}</div>`;
        let foundData = false;

        this.currentData.processedRoutes.forEach(route => {
            let closestIdx = -1;
            let closestDiff = Infinity;

            for (let i = 0; i < route.cumulativeDistances.length; i++) {
                const diff = Math.abs(route.cumulativeDistances[i] - mouseDistance);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestIdx = i;
                }
            }

            if (closestIdx >= 0 && closestIdx < route.metricData.length) {
                const value = route.metricData[closestIdx];
                if (value !== null && value !== undefined) {
                    foundData = true;
                    tooltipHTML += `
                        <div class="crosshair-route">
                            <div class="crosshair-color" style="background: ${route.color}"></div>
                            <span>${route.displayName}:</span>
                            <span class="crosshair-value">${this.currentData.formatValue(value)}</span>
                        </div>
                    `;
                }
            }
        });

        if (foundData) {
            this.crosshair.innerHTML = tooltipHTML;
            this.crosshair.style.display = 'block';
            this.crosshair.style.left = (clientX + 15) + 'px';
            this.crosshair.style.top = (clientY + 15) + 'px';

            setTimeout(() => {
                const rect = this.crosshair.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    this.crosshair.style.left = (clientX - rect.width - 15) + 'px';
                }
                if (rect.bottom > window.innerHeight) {
                    this.crosshair.style.top = (clientY - rect.height - 15) + 'px';
                }
            }, 0);
        } else {
            this.crosshair.style.display = 'none';
        }
    }

    drawChart(routes, metricType, yAxisLabel, formatValue) {
        this.currentData = { routes, metricType, yAxisLabel, formatValue, processedRoutes: [] };

        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        const padding = { left: 70, right: 70, top: 50, bottom: 70 };
        const chartWidth = this.canvas.width - padding.left - padding.right;
        const chartHeight = this.canvas.height - padding.top - padding.bottom;

        // Process route data
        const processedRoutes = routes.map(route => {
            const distances = [0];
            for (let i = 1; i < route.coordinates.length; i++) {
                distances.push(distances[i-1] + Utils.haversineDistance(route.coordinates[i-1], route.coordinates[i]));
            }

            let metricData = [];
            switch(metricType) {
                case 'elevation': metricData = route.elevations; break;
                case 'speed': metricData = route.speeds; break;
                case 'pace': metricData = route.paces; break;
                case 'heartrate': metricData = route.heartRates; break;
                case 'cadence': metricData = route.cadences; break;
                case 'power': metricData = route.powers; break;
            }

            const totalDist = distances[distances.length - 1];
            const { windowSize, decimationFactor } = Utils.getAdaptiveSmoothingParams(totalDist);
            const smoothed = Utils.smoothData(metricData, windowSize);
            const { data: finalData, distances: finalDistances } = Utils.decimateData(smoothed, distances, decimationFactor);

            const offset = this.routeOffsets[route.filename] || 0;
            return {
                ...route,
                cumulativeDistances: finalDistances.map(d => d + offset),
                metricData: finalData,
                totalDistance: totalDist
            };
        });

        this.currentData.processedRoutes = processedRoutes;

        // Apply zoom if active
        let chartRoutes = processedRoutes;
        if (this.zoomState) {
            chartRoutes = processedRoutes.map(route => ({
                ...route,
                metricData: route.metricData.filter((_, i) => {
                    const dist = route.cumulativeDistances[i];
                    return dist >= this.zoomState.minDistance && dist <= this.zoomState.maxDistance;
                }),
                cumulativeDistances: route.cumulativeDistances
                    .filter(d => d >= this.zoomState.minDistance && d <= this.zoomState.maxDistance)
                    .map(d => d - this.zoomState.minDistance)
            }));
        }

        // Calculate ranges
        let globalMin = Infinity, globalMax = -Infinity, maxDistance = 0;
        chartRoutes.forEach(route => {
            if (route.metricData.length > 0) {
                const validData = route.metricData.filter(d => d !== null && !isNaN(d));
                if (validData.length > 0) {
                    globalMin = Math.min(globalMin, ...validData);
                    globalMax = Math.max(globalMax, ...validData);
                }
            }
            maxDistance = Math.max(maxDistance, ...route.cumulativeDistances);
        });

        const range = globalMax - globalMin;
        globalMin -= range * 0.1;
        globalMax += range * 0.1;
        const adjustedRange = globalMax - globalMin;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            this.ctx.beginPath();
            this.ctx.moveTo(padding.left, y);
            this.ctx.lineTo(padding.left + chartWidth, y);
            this.ctx.stroke();

            const value = globalMax - (adjustedRange / 5) * i;
            this.ctx.fillStyle = '#666';
            this.ctx.font = '11px sans-serif';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(formatValue(value).split(' ')[0], padding.left - 8, y + 4);
        }

        for (let i = 0; i <= 10; i++) {
            const x = padding.left + (chartWidth / 10) * i;
            this.ctx.beginPath();
            this.ctx.moveTo(x, padding.top);
            this.ctx.lineTo(x, padding.top + chartHeight);
            this.ctx.stroke();

            const dist = (maxDistance / 10) * i;
            this.ctx.fillStyle = '#666';
            this.ctx.font = '11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(Utils.formatDistance(dist), x, this.canvas.height - padding.bottom + 20);
        }

        // Draw routes
        chartRoutes.forEach(route => {
            if (routes.length === 1) {
                // Fill area for single route
                this.ctx.strokeStyle = route.color;
                this.ctx.fillStyle = route.color + '25';
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(padding.left, this.canvas.height - padding.bottom);

                for (let i = 0; i < route.metricData.length; i++) {
                    if (route.metricData[i] !== null) {
                        const x = padding.left + (route.cumulativeDistances[i] / maxDistance) * chartWidth;
                        const y = padding.top + chartHeight - ((route.metricData[i] - globalMin) / adjustedRange) * chartHeight;
                        this.ctx.lineTo(x, y);
                    }
                }

                const lastX = padding.left + (route.cumulativeDistances[route.cumulativeDistances.length - 1] / maxDistance) * chartWidth;
                this.ctx.lineTo(lastX, this.canvas.height - padding.bottom);
                this.ctx.closePath();
                this.ctx.fill();
            }

            // Draw line
            this.ctx.strokeStyle = route.color;
            this.ctx.lineWidth = 1.5;
            this.ctx.globalAlpha = 0.9;
            this.ctx.beginPath();

            let firstPoint = true;
            for (let i = 0; i < route.metricData.length; i++) {
                if (route.metricData[i] !== null) {
                    const x = padding.left + (route.cumulativeDistances[i] / maxDistance) * chartWidth;
                    const y = padding.top + chartHeight - ((route.metricData[i] - globalMin) / adjustedRange) * chartHeight;
                    if (firstPoint) {
                        this.ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        this.ctx.lineTo(x, y);
                    }
                }
            }
            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0;
        });

        // Draw axes
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(padding.left, padding.top);
        this.ctx.lineTo(padding.left, padding.top + chartHeight);
        this.ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        this.ctx.stroke();

        // Labels
        this.ctx.save();
        this.ctx.translate(20, this.canvas.height / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillStyle = '#666';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(yAxisLabel, 0, 0);
        this.ctx.restore();

        this.ctx.fillStyle = '#333';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Distance', this.canvas.width / 2, this.canvas.height - 10);

        this.updateLegend();
        this.originalImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    updateLegend() {
        if (!this.currentData) return;

        const legend = document.getElementById('chartLegend');
        legend.innerHTML = '';

        this.currentData.routes.forEach((route, index) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            if (this.selectedRouteForDrag === index) item.classList.add('active');

            const color = document.createElement('div');
            color.className = 'legend-color';
            color.style.background = route.color;

            const label = document.createElement('span');
            label.className = 'legend-label';
            label.textContent = `${route.displayName} (${Utils.formatDistance(route.stats.distance)})`;

            const offset = this.routeOffsets[route.filename] || 0;
            if (Math.abs(offset) > 0.01) {
                const offsetSpan = document.createElement('span');
                offsetSpan.className = 'legend-offset';
                offsetSpan.textContent = offset >= 0 ? `+${Utils.formatDistance(offset)}` : Utils.formatDistance(offset);
                label.appendChild(offsetSpan);
            }

            item.appendChild(color);
            item.appendChild(label);

            if (this.dragMode) {
                item.style.cursor = 'pointer';
                item.onclick = () => {
                    this.selectedRouteForDrag = this.selectedRouteForDrag === index ? null : index;
                    this.updateLegend();
                };
            }

            legend.appendChild(item);
        });
    }
}
