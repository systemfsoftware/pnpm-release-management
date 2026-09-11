import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/main.ts'],
  format: 'esm',
  dts: false,
  platform: 'node',
  outExtensions: () => ({ js: '.js' }),
  deps: { alwaysBundle: (id) => !id.startsWith('node:') },
})
