#!/bin/bash

# Generate config.js from environment variables
cat > src/js/config.js << EOF
// Auto-generated from environment variables
export const config = {
    firebase: {
        apiKey: "${FIREBASE_API_KEY}",
        authDomain: "${FIREBASE_AUTH_DOMAIN}",
        projectId: "${FIREBASE_PROJECT_ID}",
        storageBucket: "${FIREBASE_STORAGE_BUCKET}",
        messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
        appId: "${FIREBASE_APP_ID}"
    },
    googleMaps: {
        apiKey: "${GOOGLE_MAPS_API_KEY}"
    }
};
EOF

echo "✅ Generated config.js from environment variables"

# Start the server
exec serve -s src -l ${PORT:-3000}
