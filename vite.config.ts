import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*.{js,mjs,css,html,json,jsonc}': 'vp check --fix',
    '*.md': 'markdownlint-cli2 --fix',
    '*.sh': 'shellcheck',
  },
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 100,
    tabWidth: 2,
    trailingComma: 'es5',
    arrowParens: 'always',
    endOfLine: 'lf',
    ignorePatterns: ['**/*.md', 'images/**', 'coverage/**', 'dist/**', '**/*.min.*'],
  },
  lint: {
    ignorePatterns: ['images/**', 'coverage/**', 'dist/**', '**/*.min.*'],
    categories: { correctness: 'error', perf: 'warn' },
    plugins: ['oxc', 'import'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    overrides: [{ files: ['test/**'], rules: { 'no-delete-var': 'off' } }],
  },
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
      include: ['app.js', 'timer-core.js', 'main.js', 'tools/generate-bg-video.mjs'],
      // Emit entries for files with no test hits too, so fallow sees real 0%
      // coverage rather than missing data.
      all: true,
    },
  },
});
