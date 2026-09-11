import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [all],

  rules: {
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'typescript/no-non-null-assertion': 'error',
  },

  overrides: [
    {
      files: ['src/**/*.workflow.ts'],
      rules: { complexity: ['error', { max: 1 }] },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'vitest/no-standalone-expect': 'off' },
    },
    {
      files: ['**/vitest.config.ts', '**/tsdown.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
})
