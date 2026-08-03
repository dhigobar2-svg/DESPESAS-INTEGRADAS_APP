import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      // PWA: o service worker guarda o "shell" do app (HTML, JS, CSS, ícones)
      // para que ele abra sem internet. Os dados continuam vindo do banco via
      // /api/data quando online e do localStorage quando offline — o service
      // worker NUNCA guarda respostas de /api, senão mostraria dados velhos.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icons/*.png'],
        manifest: {
          id: '/',
          name: 'Despesas Integradas',
          short_name: 'Despesas',
          description:
            'Controle de despesas colaborativo, com sincronização automática e uso offline.',
          lang: 'pt-BR',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f8fafc',
          theme_color: '#059669',
          categories: ['finance', 'productivity'],
          // Atalhos do ícone instalado (pressionar e segurar no Android):
          // caem em /?tela=… e o App.tsx abre direto a tela pedida.
          shortcuts: [
            {
              name: 'Nova despesa',
              short_name: 'Nova despesa',
              description: 'Lançar uma despesa agora',
              url: '/?tela=expenses&novo=1',
              icons: [{src: '/icons/icon-192.png', sizes: '192x192'}],
            },
            {
              name: 'Entradas / Receitas',
              short_name: 'Entradas',
              description: 'Ver e lançar entradas',
              url: '/?tela=incomes',
              icons: [{src: '/icons/icon-192.png', sizes: '192x192'}],
            },
          ],
          icons: [
            {src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
            {src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
            {src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable'},
            {src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
          ],
        },
        workbox: {
          // Pré-carrega todo o build, inclusive os chunks das abas lazy — sem
          // isso, abrir "Configurações" offline pela primeira vez quebraria.
          globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
          navigateFallback: '/index.html',
          // Requisições de dados e do socket jamais podem cair no fallback.
          navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/health$/],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // Fonte Inter (importada no index.css): cacheia depois do 1º uso
              // para o app não perder a tipografia offline.
              urlPattern: ({url}) =>
                url.origin === 'https://fonts.googleapis.com' ||
                url.origin === 'https://fonts.gstatic.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts',
                expiration: {maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365},
                cacheableResponse: {statuses: [0, 200]},
              },
            },
          ],
        },
        devOptions: {
          // Em desenvolvimento o service worker fica desligado: ele brigaria
          // com o HMR do Vite servindo arquivos antigos do cache.
          enabled: false,
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
