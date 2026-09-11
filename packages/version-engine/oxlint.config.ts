import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

const decisionFileImports = [
  {
    regex: '^node:.*',
    message:
      'a decision file is pure: importing Node.js builtins via "node:" is forbidden — use an Effect service at the composition root instead',
  },
  {
    regex:
      '^(?:assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(?:/.*)?$',
    message:
      'a decision file is pure: importing Node.js builtins without the "node:" prefix is forbidden — even "node:fs" is forbidden',
  },
  {
    regex: '^@std/(?:encoding|fs|path|streams)(?:/.*)?$',
    message: 'a decision file is pure: @std modules that mirror Effect services belong at the composition root',
  },
  {
    regex: '^effect/(FileSystem|Path|Console|Clock|Random|System)$',
    message: 'a decision file is pure: these services belong at the composition root',
  },
  {
    regex: '^effect/unstable/',
    message: 'a decision file is pure: the CLI, process and HTTP runtimes stay outside it',
  },
  {
    regex: '^@effect/platform',
    message: 'a decision file is pure: platform services belong in an adapter',
  },
  {
    regex: '^@systemfsoftware/[a-z-]+-adapter$',
    message: 'a decision file is pure: it imports vocabulary, never an adapter',
  },
]

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
      rules: {
        complexity: ['error', { max: 1 }],
        'no-restricted-imports': ['error', { patterns: decisionFileImports }],
      },
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
