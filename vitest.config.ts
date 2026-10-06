import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['e2e/**', '**/node_modules/**'],
    setupFiles: ['./vitest.fast-check.setup.ts'],
  },
})
