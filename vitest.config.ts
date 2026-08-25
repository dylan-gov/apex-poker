import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // The engine is deterministic; nothing here should need more than a few seconds.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/engine/src/**/*.ts'],
      // index.ts is re-exports and types.ts is type declarations: neither
      // emits runtime code to cover.
      exclude: ['packages/engine/src/index.ts', 'packages/engine/src/types.ts', '**/*.d.ts'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
