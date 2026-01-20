import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.js'],
        globals: true
    },
    resolve: {
        alias: {
            '@': '/src/js'
        }
    }
});
