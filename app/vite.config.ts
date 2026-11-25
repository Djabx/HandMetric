import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// BASE : "/lifelog/" pour GitHub Pages, "/" quand la PWA est servie par le serveur.
const base = process.env.LIFELOG_BASE ?? './';

export default defineConfig({
  base,
  define: {
    // "solo" : version GitHub Pages, jamais de serveur. "auto" : détecte le serveur LifeLog.
    __LIFELOG_MODE__: JSON.stringify(process.env.LIFELOG_MODE === 'solo' ? 'solo' : 'auto'),
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'LifeLog',
        short_name: 'LifeLog',
        description: 'Les succès de ta vie, comme dans un jeu vidéo.',
        theme_color: '#6e56cf',
        background_color: '#f6f5f2',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
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
