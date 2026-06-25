import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // The shipped sources the tests actually exercise. The old glob pointed at
      // 'src/**/*.ts' — which never existed — so coverage measured nothing.
      include: ['js/content.js', 'catalog-utils.js', 'catalog.js', 'src/**/*.js'],
      exclude: ['**/*.d.ts'],
    },
  },
});
