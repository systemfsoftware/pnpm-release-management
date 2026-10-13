import { RegistryLive } from '@systemfsoftware/adoption-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import type { GitPort } from '@systemfsoftware/release-language'
import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { createHash } from 'node:crypto'
import { buildTarball } from './build-tarball.js'

export const registryServing = (fetch: typeof globalThis.fetch) =>
  RegistryLive.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  )

export const evidenceServing = (served: ServedTurbo, git: Layer.Layer<GitPort>) =>
  ChangeEvidenceLive.pipe(Layer.provide(git), Layer.provide(registryServing(served.fetch)))

export interface ServedTurbo {
  readonly key: string
  readonly url: string
  readonly integrity: string
  readonly requests: ReadonlyArray<string>
  readonly fetch: typeof globalThis.fetch
  readonly packagesYaml: (recordedIntegrity?: string) => string
}

export interface ServedTurboOptions {
  readonly pin: string
  readonly dryRunBody?: string
  readonly reportedVersion?: string
}

const OS: Partial<Record<NodeJS.Platform, string>> = { linux: 'linux', darwin: 'darwin', win32: 'windows' }
const CPU: Partial<Record<string, string>> = { x64: '64', arm64: 'arm64' }

const platformOf = (platform: NodeJS.Platform, arch: string): { readonly os: string; readonly cpu: string } => {
  const os = OS[platform]
  const cpu = CPU[arch]
  if (os === undefined || cpu === undefined) {
    throw new Error(`served-turbo: turbo publishes no binary for ${platform} ${arch}`)
  }
  return { os, cpu }
}

const digestOf = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

const dryRunOverPresentManifests = (version: string): string =>
  `const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.join(process.cwd(), 'packages')
const packages = []
const tasks = []
for (const dir of fs.readdirSync(root).sort()) {
  const manifest = path.join(root, dir, 'package.json')
  if (!fs.existsSync(manifest)) continue
  const text = fs.readFileSync(manifest, 'utf8')
  const name = JSON.parse(text).name
  packages.push(name)
  tasks.push({ taskId: name + '#build', package: name, hash: crypto.createHash('sha256').update(text).digest('hex'), directory: 'packages/' + dir })
}
process.stdout.write(JSON.stringify({ packages, tasks, turboVersion: '${version}' }))
`

const turboScript = (version: string, dryRun: string): string =>
  `#!/usr/bin/env node
if (process.argv[2] === '--version') {
  process.stdout.write('${version}\\n')
  process.exit(0)
}
${dryRun}`

const urlOf = (input: string | URL | Request): URL => {
  if (input instanceof Request) {
    return new URL(input.url)
  }
  return new URL(input.toString())
}

export const serveTurbo = (options: ServedTurboOptions): ServedTurbo => {
  const { os, cpu } = platformOf(process.platform, process.arch)
  const name = `@turbo/${os}-${cpu}`
  const version = options.reportedVersion ?? options.pin
  const bytes: Uint8Array = buildTarball({
    [`turbo-${os}-${process.arch}/bin/turbo`]: turboScript(
      version,
      options.dryRunBody ?? dryRunOverPresentManifests(version),
    ),
  })
  const integrity = digestOf(bytes)
  const url = `https://registry.npmjs.org/${name}/-/${name.slice(name.indexOf('/') + 1)}-${options.pin}.tgz`
  const servedPath = decodeURIComponent(new URL(url).pathname)
  const requests: Array<string> = []
  const fetch: typeof globalThis.fetch = (input) => {
    const requested = decodeURIComponent(urlOf(input).pathname)
    requests.push(requested)
    if (requested !== servedPath) {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    return Promise.resolve(
      new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }),
    )
  }
  return {
    key: `${name}@${options.pin}`,
    url,
    integrity,
    requests,
    fetch,
    packagesYaml: (recordedIntegrity = integrity) =>
      [`  '${name}@${options.pin}':`, `    resolution: {integrity: ${recordedIntegrity}}`].join('\n'),
  }
}
