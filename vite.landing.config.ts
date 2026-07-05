import { defineConfig } from "vite";

/**
 * Standalone build for the waitlist landing page (landing/), kept separate
 * from the Tauri app's vite.config.ts so `npm run tauri dev|build` is
 * untouched. Shares the app's public/ assets (body GLBs, FFL wasm + .dat)
 * and imports straight from src/ (styles, fflRenderer, types).
 *
 *   npm run dev:landing     # http://localhost:5173
 *   npm run build:landing   # static site in dist-landing/
 */
export default defineConfig({
  root: "landing",
  publicDir: "../public",
  // Mii data files are imported as URLs (see landing/main.ts).
  assetsInclude: ["**/*.ffsd"],
  build: {
    outDir: "../dist-landing",
    emptyOutDir: true,
  },
});
