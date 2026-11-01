import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['../../vitest.fast-check.setup.ts'],
  },
  resolve: {
    alias: [{
      find: /^@systemfsoftware\/github-release-management\/render$/,
      replacement: new URL('./src/render.ts', import.meta.url).pathname,
    }],
  },
})
