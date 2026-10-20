import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      // 07 §8 floors for domain code; enforced from M1 onward.
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
