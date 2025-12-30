// Configuration file for GPX Route Overlay
// Copy this file to config.js and fill in your credentials
// IMPORTANT: Never commit config.js to version control

export const config = {
    // Firebase Configuration
    // Get these values from Firebase Console > Project Settings > General > Your apps
    firebase: {
        apiKey: "YOUR_FIREBASE_API_KEY",
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID"
    },

    // Google Maps Configuration
    // Get this from Google Cloud Console > APIs & Services > Credentials
    googleMaps: {
        apiKey: "YOUR_GOOGLE_MAPS_API_KEY"
    }
};
