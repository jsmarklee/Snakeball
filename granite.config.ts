import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'snakeball',
  brand: {
    displayName: '스네이크볼',
    primaryColor: '#63f8cf',
    // Toss requires an absolute, publicly-reachable icon URL. Replace with the
    // hosted app icon once the Firebase Hosting site is live.
    icon: 'https://snakeball-game.web.app/app-icon.png',
  },
  web: {
    // The Toss sandbox app on the phone resolves this host string verbatim, so
    // 'localhost'/'0.0.0.0' both fail. Use the dev machine's LAN IP (visible in
    // the `vite` output as "Network: http://192.168.x.x:5173/").
    host: '192.168.0.120',
    port: 5173,
    commands: {
      // Port 5173 is mandatory — the sandbox app only discovers 5173.
      dev: 'vite --host 0.0.0.0 --port 5173',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
  webViewProps: {
    type: 'game',
  },
});
