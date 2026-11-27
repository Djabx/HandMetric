import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// BASE : "/lifelog/" pour GitHub Pages, "/" quand la PWA est servie par le serveur.
const base = process.env.LIFELOG_BASE ?? './';

// Commit shown next to the version in About. Nix passes LIFELOG_COMMIT (no .git in the sandbox),
// GitHub Actions sets GITHUB_SHA, otherwise ask git.
function commit(): string {
  if (process.env.LIFELOG_COMMIT) return process.env.LIFELOG_COMMIT;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base,
  define: {
    // "solo" : version GitHub Pages, jamais de serveur. "auto" : détecte le serveur LifeLog.
    __LIFELOG_MODE__: JSON.stringify(process.env.LIFELOG_MODE === 'solo' ? 'solo' : 'auto'),
    __LIFELOG_COMMIT__: JSON.stringify(commit()),
  },
  plugins: [
    svelte(),
    VitePWA({
      // "prompt": the new version waits for the user's OK (see src/lib/pwa.svelte.ts), so that a
      // reload never interrupts an entry. Registration is done by that module.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'LifeLog',
        short_name: 'LifeLog',
        description: 'Compte ce qui compte. Tes habitudes, tes compteurs, tes données.',
        theme_color: '#5b3df5',
        background_color: '#f6f4ff',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/hooks\//],
      },
    }),
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { proxy: { '/api': 'http://127.0.0.1:8080', '/auth': 'http://127.0.0.1:8080', '/hooks': 'http://127.0.0.1:8080' } },
});
