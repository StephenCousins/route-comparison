// AnimationManager - Handles route playback

export class AnimationManager {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.playbackSpeed = 1;
        this.activeAnimations = new Map();
        this.setupSpeedControl();
    }

    setupSpeedControl() {
        const slider = document.getElementById('speedSlider');
        const display = document.getElementById('speedDisplay');

        slider.addEventListener('input', () => {
            const sliderValue = parseFloat(slider.value);
            this.playbackSpeed = Math.pow(10, sliderValue * 3 / 100);

            if (this.playbackSpeed >= 100) {
                display.textContent = Math.round(this.playbackSpeed) + 'x';
            } else if (this.playbackSpeed >= 10) {
                display.textContent = this.playbackSpeed.toFixed(0) + 'x';
            } else {
                display.textContent = this.playbackSpeed.toFixed(1) + 'x';
            }

            const percentage = (sliderValue / 100) * 100;
            slider.style.background = `linear-gradient(to right, #1a73e8 0%, #1a73e8 ${percentage}%, #e0e0e0 ${percentage}%, #e0e0e0 100%)`;
        });
    }

    start(route) {
        if (!route.timestamps || route.timestamps.length === 0) {
            alert('No timestamp data available for animation');
            return false;
        }

        if (!route.animationMarker) {
            route.animationMarker = new google.maps.Marker({
                position: route.coordinates[0],
                map: this.mapManager.map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: route.color,
                    fillOpacity: 1,
                    strokeColor: 'white',
                    strokeWeight: 3
                },
                zIndex: 2000
            });
        } else {
            route.animationMarker.setPosition(route.coordinates[0]);
            route.animationMarker.setMap(this.mapManager.map);
        }

        route.isPlaying = true;
        route.animationState = {
            currentIndex: 0,
            startTime: Date.now(),
            pauseTime: 0
        };

        this.activeAnimations.set(route.id, route);
        this.animate(route);

        document.getElementById('playbackControls').classList.add('show');
        return true;
    }

    stop(route) {
        route.isPlaying = false;
        if (route.animationMarker) {
            route.animationMarker.setMap(null);
        }
        route.animationState = null;
        this.activeAnimations.delete(route.id);

        if (this.activeAnimations.size === 0) {
            document.getElementById('playbackControls').classList.remove('show');
        }
    }

    animate(route) {
        if (!route.isPlaying || !route.animationState) return;

        const state = route.animationState;
        const elapsedMs = (Date.now() - state.startTime) * this.playbackSpeed;

        const firstValidTimestamp = route.timestamps.find(t => t !== null);
        if (!firstValidTimestamp) {
            this.stop(route);
            return;
        }

        const startTimestamp = firstValidTimestamp.getTime();
        let targetIndex = 0;

        for (let i = 0; i < route.timestamps.length; i++) {
            if (route.timestamps[i]) {
                const pointTime = route.timestamps[i].getTime() - startTimestamp;
                if (pointTime <= elapsedMs) {
                    targetIndex = i;
                } else {
                    break;
                }
            }
        }

        if (targetIndex < route.coordinates.length) {
            route.animationMarker.setPosition(route.coordinates[targetIndex]);
            state.currentIndex = targetIndex;
            requestAnimationFrame(() => this.animate(route));
        } else {
            this.stop(route);
        }
    }

    destroy() {
        this.activeAnimations.forEach(route => this.stop(route));
        this.activeAnimations.clear();
    }

    // Race mode - animate multiple routes simultaneously based on elapsed time
    startRace(routes) {
        // Stop any existing animations
        this.stopAll();

        // Validate all routes have timestamps
        const validRoutes = routes.filter(r =>
            r.timestamps && r.timestamps.some(t => t !== null)
        );

        if (validRoutes.length < 2) {
            alert('Need at least 2 routes with timestamp data to race');
            return false;
        }

        this.isRacing = true;
        this.racingRoutes = validRoutes;

        // Start all routes at same moment
        const raceStartTime = Date.now();
        validRoutes.forEach(route => {
            // Create or reset animation marker
            if (!route.animationMarker) {
                route.animationMarker = new google.maps.Marker({
                    position: route.coordinates[0],
                    map: this.mapManager.map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: route.color,
                        fillOpacity: 1,
                        strokeColor: 'white',
                        strokeWeight: 3
                    },
                    zIndex: 2000
                });
            } else {
                route.animationMarker.setPosition(route.coordinates[0]);
                route.animationMarker.setMap(this.mapManager.map);
            }

            route.isPlaying = true;
            route.animationState = {
                currentIndex: 0,
                startTime: raceStartTime,  // Same start time for all
                pauseTime: 0
            };
            this.activeAnimations.set(route.id, route);
        });

        // Show playback controls
        document.getElementById('playbackControls').classList.add('show');

        // Start single animation loop for all routes
        this.animateRace();
        return true;
    }

    animateRace() {
        if (!this.isRacing) return;

        const now = Date.now();
        let allComplete = true;

        this.racingRoutes.forEach(route => {
            if (!route.isPlaying) return;

            const state = route.animationState;
            const elapsedMs = (now - state.startTime) * this.playbackSpeed;

            // Find position based on elapsed time from route start
            const targetIndex = this.findPositionAtTime(route, elapsedMs);

            if (targetIndex < route.coordinates.length) {
                route.animationMarker.setPosition(route.coordinates[targetIndex]);
                state.currentIndex = targetIndex;
                allComplete = false;
            } else {
                // Route finished
                route.isPlaying = false;
            }
        });

        if (!allComplete) {
            requestAnimationFrame(() => this.animateRace());
        } else {
            this.stopRace();
        }
    }

    findPositionAtTime(route, elapsedMs) {
        const firstValidTimestamp = route.timestamps.find(t => t !== null);
        if (!firstValidTimestamp) return route.coordinates.length;

        const startTimestamp = firstValidTimestamp.getTime();
        let targetIndex = 0;

        for (let i = 0; i < route.timestamps.length; i++) {
            if (route.timestamps[i]) {
                const pointTime = route.timestamps[i].getTime() - startTimestamp;
                if (pointTime <= elapsedMs) {
                    targetIndex = i;
                } else {
                    break;
                }
            }
        }

        return targetIndex;
    }

    stopRace() {
        this.isRacing = false;
        this.racingRoutes?.forEach(route => {
            route.isPlaying = false;
            if (route.animationMarker) {
                route.animationMarker.setMap(null);
            }
            route.animationState = null;
        });
        this.racingRoutes = null;
        this.activeAnimations.clear();
        document.getElementById('playbackControls').classList.remove('show');
    }

    stopAll() {
        if (this.isRacing) {
            this.stopRace();
        } else {
            this.activeAnimations.forEach(route => this.stop(route));
        }
    }
}
