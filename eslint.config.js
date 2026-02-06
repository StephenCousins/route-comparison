import js from "@eslint/js";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        DragEvent: "readonly",
        MouseEvent: "readonly",
        KeyboardEvent: "readonly",
        MutationObserver: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        performance: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        location: "readonly",
        history: "readonly",
        CustomEvent: "readonly",
        DOMParser: "readonly",
        XMLSerializer: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        atob: "readonly",
        btoa: "readonly",
        // Google Maps (loaded via CDN)
        google: "readonly",
        // Firebase (loaded via CDN)
        firebase: "readonly",
        // FIT parser (attached to window)
        FitParser: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    // Test file overrides
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "dist/", "build/"],
  },
];
