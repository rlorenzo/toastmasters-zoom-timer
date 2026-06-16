import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // app.js binds to the DOM and dispatches events, so tests run in jsdom.
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    coverage: {
      // Istanbul format is what `fallow health --coverage` consumes
      // (coverage/coverage-final.json). v8/c8 native format is not accepted.
      provider: 'istanbul',
      reporter: ['text', 'json'],
      reportsDirectory: 'coverage',
      include: ['app.js', 'timer-core.js', 'main.js'],
      // Emit entries for files with no test hits too, so fallow sees real 0%
      // coverage rather than missing data.
      all: true,
    },
  },
});
