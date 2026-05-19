import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/security-scope-guard.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: [],
    passWithNoTests: false,
  },
});
