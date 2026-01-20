// ChartEventHandler - Shared event handling for chart interactions
import { Utils } from './utils.js';

export class ChartEventHandler {
    constructor(options = {}) {
        this.canvas = options.canvas;
        this.ctx = options.canvas?.getContext('2d');
        this.crosshair = options.crosshair;
        this.onRedraw = options.onRedraw || (() => {});
        this.onZoomChanged = options.onZoomChanged || (() => {});
        this.getRouteOffsets = options.getRouteOffsets || (() => ({}));
        this.getCurrentData = options.getCurrentData || (() => null);
        this.getZoomState = options.getZoomState || (() => null);
        this.setZoomState = options.setZoomState || (() => {});

        // Chart dimensions
        this.padding = { left: 70, right: 70, top: 50, bottom: 70 };

        // State
        this.isSelecting = false;
        this.selectionStart = null;
        this.originalImage = null;
    }

    // Get chart area dimensions
    getChartDimensions() {
        if (!this.canvas) return { width: 0, height: 0 };
        return {
            width: this.canvas.width - this.padding.left - this.padding.right,
            height: this.canvas.height - this.padding.top - this.padding.bottom
        };
    }

    // Check if point is within chart area
    isInChartArea(x, y) {
        const { width, height } = this.getChartDimensions();
        return x >= this.padding.left &&
               x <= this.padding.left + width &&
               y >= this.padding.top &&
               y <= this.padding.top + height;
    }

    // Start selection for zoom
    startSelection(x, y) {
        const { width } = this.getChartDimensions();
        if (x >= this.padding.left && x <= this.padding.left + width) {
            this.isSelecting = true;
            this.selectionStart = { x, y };
            return true;
        }
        return false;
    }

    // End selection and calculate zoom
    endSelection(x) {
        if (!this.isSelecting || !this.selectionStart) {
            this.resetSelection();
            return null;
        }

        const { width: chartWidth } = this.getChartDimensions();
        const startX = Math.min(this.selectionStart.x, x);
        const endX = Math.max(this.selectionStart.x, x);

        this.resetSelection();

        // Minimum selection width to trigger zoom
        if (Math.abs(endX - startX) <= 20) {
            return null;
        }

        const currentData = this.getCurrentData();
        if (!currentData) return null;

        const routeOffsets = this.getRouteOffsets();
        const maxDistance = Math.max(...currentData.routes.map(r => {
            const offset = routeOffsets[r.filename] || 0;
            return r.stats.distance + offset;
        }));

        const minDistance = ((startX - this.padding.left) / chartWidth) * maxDistance;
        const maxDistanceZoom = ((endX - this.padding.left) / chartWidth) * maxDistance;

        return {
            minDistance: Math.max(0, minDistance),
            maxDistance: Math.min(maxDistance, maxDistanceZoom)
        };
    }

    // Reset selection state
    resetSelection() {
        this.isSelecting = false;
        this.selectionStart = null;
    }

    // Draw selection rectangle during drag
    drawSelectionRect(currentX, currentY) {
        if (!this.isSelecting || !this.selectionStart || !this.ctx) return;

        // Redraw chart first
        this.onRedraw();

        const startX = Math.min(this.selectionStart.x, currentX);
        const startY = Math.min(this.selectionStart.y, currentY);
        const width = Math.abs(currentX - this.selectionStart.x);
        const height = Math.abs(currentY - this.selectionStart.y);

        this.ctx.strokeStyle = '#1a73e8';
        this.ctx.fillStyle = 'rgba(26, 115, 232, 0.1)';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(startX, startY, width, height);
        this.ctx.fillRect(startX, startY, width, height);
    }

    // Draw crosshair line
    drawCrosshairLine(x) {
        if (!this.ctx || !this.originalImage) return;

        const { height: chartHeight } = this.getChartDimensions();

        this.ctx.putImageData(this.originalImage, 0, 0);

        this.ctx.strokeStyle = 'rgba(26, 115, 232, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(x, this.padding.top);
        this.ctx.lineTo(x, this.padding.top + chartHeight);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    // Update crosshair tooltip
    updateCrosshairTooltip(x, clientX, clientY) {
        const currentData = this.getCurrentData();
        if (!currentData || !this.crosshair) return;

        const { width: chartWidth } = this.getChartDimensions();
        const zoomState = this.getZoomState();
        const routeOffsets = this.getRouteOffsets();

        const maxDist = zoomState ?
            (zoomState.maxDistance - zoomState.minDistance) :
            Math.max(...currentData.routes.map(r => {
                const offset = routeOffsets[r.filename] || 0;
                return r.stats.distance + offset;
            }));

        const mouseDistance = ((x - this.padding.left) / chartWidth) * maxDist;

        let tooltipHTML = `<div class="crosshair-distance">Distance: ${Utils.formatDistance(mouseDistance)}</div>`;
        let foundData = false;

        const processedRoutes = currentData.processedRoutes || [];
        processedRoutes.forEach(route => {
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
                            <span class="crosshair-value">${currentData.formatValue(value)}</span>
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

            // Adjust position if off-screen
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

    // Hide crosshair
    hideCrosshair() {
        if (this.crosshair) {
            this.crosshair.style.display = 'none';
        }
    }

    // Save current canvas state for crosshair overlay
    saveCanvasState() {
        if (this.ctx && this.canvas) {
            this.originalImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // Restore canvas state
    restoreCanvasState() {
        if (this.ctx && this.originalImage) {
            this.ctx.putImageData(this.originalImage, 0, 0);
        }
    }

    // Handle mouse move for selection or crosshair
    handleMouseMove(e, rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const { width: chartWidth, height: chartHeight } = this.getChartDimensions();

        if (this.isSelecting && this.selectionStart) {
            this.drawSelectionRect(x, y);
        } else if (!this.isSelecting && this.originalImage) {
            if (!this.isInChartArea(x, y)) {
                this.hideCrosshair();
                this.restoreCanvasState();
                return;
            }

            this.drawCrosshairLine(x);
            this.updateCrosshairTooltip(x, e.clientX, e.clientY);
        }
    }

    // Handle mouse up for selection end
    handleMouseUp(e, rect) {
        if (!this.isSelecting || !this.selectionStart) {
            this.resetSelection();
            return;
        }

        const x = e.clientX - rect.left;
        const zoomState = this.endSelection(x);

        if (zoomState) {
            this.setZoomState(zoomState);
            this.onZoomChanged();
        }
    }

    // Handle mouse leave
    handleMouseLeave() {
        this.resetSelection();
        this.hideCrosshair();
    }

    // Handle mouse enter
    handleMouseEnter() {
        this.saveCanvasState();
    }
}
