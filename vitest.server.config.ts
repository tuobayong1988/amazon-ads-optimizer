import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@assets': path.resolve(__dirname, './attached_assets'),
      '@db': path.resolve(__dirname, './db'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'server/_archived_v149', 'client/**'],
  },
});
