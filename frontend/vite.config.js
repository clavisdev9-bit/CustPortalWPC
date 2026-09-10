import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  // Read the backend port from the SAME root .env the backend itself reads (src/config/env.js),
  // instead of hardcoding it here. Hardcoding meant the port lived in two places that had to
  // agree by hand; when .env went back to 3000 and this file stayed on 3001, the proxy pointed
  // at nothing and every API call surfaced as "Cannot reach the server" even though the backend
  // was running fine. See BUG-28 / CR-043.
  // Fallback ke angka apa pun BERBAHAYA sejak mesin ini menjalankan dua instance portal:
  // default '3000' akan memproksikan frontend WPC ke backend CustPortalCRM, jadi SPA ini
  // menampilkan data tenant yang salah tanpa satu pun pesan error. Lebih baik mati di
  // startup daripada diam-diam benar-terlihat tapi salah tenant.
  const backendPort = loadEnv(mode, repoRoot, 'PORT').PORT;
  if (!backendPort) {
    throw new Error(
      'PORT tidak ada di .env root -- proxy /api tidak punya target yang sah. '
        + 'Isi PORT di .env root repo ini (instance CustPortalWPC: 7181).'
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 7180,
      host: true,
      // Diwarisi dari CustPortalCRM. Dua wildcard di bawah sudah mencakup tunnel ngrok
      // mana pun, jadi tidak perlu mendaftarkan subdomain spesifik satu per satu.
      allowedHosts: [
        '.ngrok-free.app',
        '.ngrok.io',
        '72.62.127.164'
      ],
      // Forwards /api/v1/* to the Express backend from this (server-side) process, not from the
      // browser -- keeps API calls same-origin as far as the browser is concerned. Without this,
      // a browser loading the SPA from anywhere other than the exact machine running the backend
      // (e.g. through an ngrok tunnel, or a LAN IP) would resolve VITE_API_BASE_URL's "localhost"
      // to itself and get "Failed to fetch" since nothing listens on that port locally.
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
