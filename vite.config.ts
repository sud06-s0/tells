// vite.config.ts
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev` serves on localhost (camera works there without HTTPS).
// `npm run dev:phone` serves over HTTPS on your LAN so a phone can open it
// (phones only allow camera access on secure pages).
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: mode === 'phone' ? { host: true } : undefined,
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
}));
