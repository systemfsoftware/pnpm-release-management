import { defineConfig } from 'vitest/config'

const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['../../vitest.fast-check.setup.ts'],
  },
  resolve: {
    alias: [{ find: /^@systemfsoftware\/github-release-engine$/, replacement: srcUrl('index.ts') }],
  },
})
