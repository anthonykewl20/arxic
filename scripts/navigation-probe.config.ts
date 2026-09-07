import { defineConfig } from 'vitest/config';

// Explicit diagnostic: a non-reproducing run is inconclusive, not a CI product failure.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['apps/web/src/__tests__/navigation-errors.real-world.test.probe.ts'],
  },
});
