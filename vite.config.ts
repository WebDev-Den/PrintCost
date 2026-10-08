import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const analyticsProxy = env.VITE_ANALYTICS_DEV_PROXY;
  if (analyticsProxy && (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(analyticsProxy) || env.VITE_USE_FIREBASE_EMULATORS !== 'true' || !env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-'))) {
    throw new Error('Локальний proxy аналітики дозволений лише з емуляторами demo-* на 127.0.0.1.');
  }
  if (command === 'build' && mode === 'production') {
    const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
    if (required.some((key) => !env[key]?.trim())) throw new Error('Заповніть Firebase web config у .env.local або змінних збірки Cloudflare перед production-збіркою.');
    if (env.VITE_USE_FIREBASE_EMULATORS === 'true' || env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) throw new Error('Production-збірка не може використовувати емулятори Firebase.');
    if (analyticsProxy || env.VITE_ANALYTICS_ENABLED === 'true') throw new Error('Тестові налаштування аналітики не можуть потрапити в production-збірку.');
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      proxy: analyticsProxy ? { '/api': { target: analyticsProxy, changeOrigin: false } } : undefined,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
