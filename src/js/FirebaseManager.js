// Firebase Authentication and Storage Managers
import { config } from './config.js';

let firebaseApp, auth, db, storage;
let firebaseInitialized = false;

export function initializeFirebase() {
    try {
        firebaseApp = firebase.initializeApp(config.firebase);
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
        firebaseInitialized = true;
        console.log('Firebase initialized successfully');
        return true;
    } catch (error) {
        console.warn('Firebase initialization failed:', error.message);
        console.log('App will work without cloud sync features');
        return false;
    }
}

export function isFirebaseInitialized() {
    return firebaseInitialized;
}

export class FirebaseAuthManager {
    constructor() {
        this.currentUser = null;
        this.onAuthStateChangedCallback = null;
    }

    async signInWithGoogle() {
        if (!firebaseInitialized) {
            alert('Firebase not configured. Please add your Firebase credentials.');
            return null;
        }

        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            this.currentUser = result.user;
            console.log('Signed in:', result.user.displayName);
            return result.user;
        } catch (error) {
            console.error('Sign in error:', error);
            alert('Sign in failed: ' + error.message);
            return null;
        }
    }

    async signOut() {
        if (!firebaseInitialized) return;

        try {
            await auth.signOut();
            this.currentUser = null;
            console.log('Signed out');
        } catch (error) {
            console.error('Sign out error:', error);
        }
    }

    onAuthStateChanged(callback) {
        if (!firebaseInitialized) return;

        this.onAuthStateChangedCallback = callback;
        auth.onAuthStateChanged((user) => {
            this.currentUser = user;
            callback(user);
        });
    }

    getCurrentUser() {
        return this.currentUser;
    }
}

export class FirebaseStorageManager {
    constructor() {
        this.userId = null;
    }

    setUser(userId) {
        this.userId = userId;
    }

    async saveRoutes(routes) {
        if (!firebaseInitialized || !this.userId) {
            console.warn('Cannot save: not logged in');
            return false;
        }

        try {
            const routesData = routes.map(route => {
                // Compress coordinates
                let compressionFactor = 1;
                const totalPoints = route.coordinates.length;

                if (totalPoints > 5000) {
                    compressionFactor = Math.ceil(totalPoints / 2500);
                }

                const compressArray = (arr) => {
                    if (!arr || arr.length === 0) return [];
                    if (compressionFactor === 1) return arr;

                    const compressed = [];
                    for (let i = 0; i < arr.length; i += compressionFactor) {
                        compressed.push(arr[i]);
                    }
                    if (compressed[compressed.length - 1] !== arr[arr.length - 1]) {
                        compressed.push(arr[arr.length - 1]);
                    }
                    return compressed;
                };

                const roundCoordinates = (coords) => {
                    return coords.map(c => ({
                        lat: Math.round(c.lat * 1000000) / 1000000,
                        lng: Math.round(c.lng * 1000000) / 1000000
                    }));
                };

                const roundArray = (arr) => {
                    if (!arr) return null;
                    return arr.map(v => v === null ? null : Math.round(v * 10) / 10);
                };

                const routeData = {
                    displayName: route.displayName || 'Unnamed Route',
                    color: route.color || '#EA4335',
                    coordinates: roundCoordinates(compressArray(route.coordinates || [])),
                    elevations: roundArray(compressArray(route.elevations || [])),
                    speeds: roundArray(compressArray(route.speeds || [])),
                    paces: roundArray(compressArray(route.paces || [])),
                    timestamps: compressArray(route.timestamps || []),
                    distance: Math.round(route.distance * 100) / 100 || 0,
                    elevationStats: route.elevationStats || { gain: 0, loss: 0, min: 0, max: 0 },
                    duration: Math.round(route.duration || 0),
                    fileName: route.fileName || 'unknown.gpx',
                    savedAt: new Date().toISOString(),
                    compressionFactor: compressionFactor,
                    originalPointCount: totalPoints
                };

                if (route.heartRates !== undefined && route.heartRates !== null) {
                    routeData.heartRates = roundArray(compressArray(route.heartRates));
                }
                if (route.cadences !== undefined && route.cadences !== null) {
                    routeData.cadences = roundArray(compressArray(route.cadences));
                }
                if (route.powers !== undefined && route.powers !== null) {
                    routeData.powers = roundArray(compressArray(route.powers));
                }

                return routeData;
            });

            const docRef = await db.collection('users').doc(this.userId).collection('sessions').add({
                routes: routesData,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                routeCount: routes.length
            });

            console.log('Routes saved:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('Save error:', error);
            alert('Failed to save routes: ' + error.message);
            return false;
        }
    }

    async getSavedSessions() {
        if (!firebaseInitialized || !this.userId) {
            return [];
        }

        try {
            const snapshot = await db.collection('users')
                .doc(this.userId)
                .collection('sessions')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            const sessions = [];
            snapshot.forEach(doc => {
                sessions.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`Loaded ${sessions.length} saved sessions`);
            return sessions;
        } catch (error) {
            console.error('Load error:', error);
            return [];
        }
    }

    async loadSession(sessionId) {
        if (!firebaseInitialized || !this.userId) {
            return null;
        }

        try {
            const doc = await db.collection('users')
                .doc(this.userId)
                .collection('sessions')
                .doc(sessionId)
                .get();

            if (doc.exists) {
                console.log('Session loaded:', sessionId);
                return doc.data();
            }
            return null;
        } catch (error) {
            console.error('Load session error:', error);
            return null;
        }
    }

    async deleteSession(sessionId) {
        if (!firebaseInitialized || !this.userId) {
            return false;
        }

        try {
            await db.collection('users')
                .doc(this.userId)
                .collection('sessions')
                .doc(sessionId)
                .delete();

            console.log('Session deleted:', sessionId);
            return true;
        } catch (error) {
            console.error('Delete error:', error);
            return false;
        }
    }
}
