import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/main.ts'],
  format: 'esm',
  dts: false,
  platform: 'node',
  outExtensions: () => ({ js: '.js' }),
  alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
  deps: { alwaysBundle: (id) => !id.startsWith('node:') },
})
