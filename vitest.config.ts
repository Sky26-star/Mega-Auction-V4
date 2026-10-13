import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.test.ts'],
    exclude: ['node_modules', 'src/test/e2e/**'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
