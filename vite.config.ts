import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: 'src/web',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT || loadEnv(mode, process.cwd(), '').PORT || '3001'}` },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
}));
