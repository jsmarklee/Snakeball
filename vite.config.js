import { defineConfig } from 'vite';

// Snakeball is a single index.html. Vite is used by the Toss (granite) build to
// bundle the inline ES module scripts and split the @apps-in-toss SDK dynamic
// imports into a lazy chunk. Relative base keeps asset URLs working inside the
// Toss webview and any sub-path hosting.
export default defineConfig({
  base: './',
  build: {
    target: 'es2018',
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
