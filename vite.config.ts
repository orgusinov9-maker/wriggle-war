import { defineConfig } from 'vite';

// The port the project docs point at; strict so a clash fails loudly
// instead of quietly moving somewhere else. Bound to the LAN too, so a phone
// on the same WiFi can open it for a touch-control test before it is deployed.
export default defineConfig({
  // Served from https://<user>.github.io/wriggle-war/ - relative asset paths in
  // index.html/manifest/sw are resolved against this.
  base: process.env.GITHUB_PAGES ? '/wriggle-war/' : '/',
  server: { port: 5180, strictPort: true, host: true },
});
