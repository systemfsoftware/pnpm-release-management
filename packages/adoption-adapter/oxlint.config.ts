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
      files: ['src/LedgerLive.ts', 'src/RegistryLive.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'vitest/no-standalone-expect': 'off', 'no-restricted-imports': 'off' },
    },
    {
      files: ['**/vitest.config.ts', '**/tsdown.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
})
