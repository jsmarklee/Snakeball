import { defineConfig } from 'vite';

// Snakeball is a single index.html. Vite is used by the Toss (granite) build to
// bundle the inline ES module scripts and split the @apps-in-toss SDK dynamic
// imports into a lazy chunk. Relative base keeps asset URLs working inside the
// Toss webview and any sub-path hosting.
export default defineConfig({
  base: './',
  // ⚠️ publicDir MUST stay false. Vite's default is <root>/public — which in this repo
  // is NOT a source dir but the gitignored Firebase Hosting staging dir that
  // `npm run sync:public` wipes and regenerates. Leaving it at the default copied
  // ~1.2 MB of already-hosted files (app-icon.png, privacy.html, terms.html) into the
  // Toss .ait, none of it reachable, and would silently merge stale hashed chunks if a
  // public/assets/ ever appeared.
  publicDir: false,
  build: {
    target: 'es2018',
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
