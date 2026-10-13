import { RegistryLive } from '@systemfsoftware/adoption-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import type { GitPort, RegistryPort } from '@systemfsoftware/release-language'
import { Effect, Layer, type Scope } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { buildTarball } from './build-tarball.js'

export const registryServing: Layer.Layer<RegistryPort> = RegistryLive.pipe(
  Layer.provide(FetchHttpClient.layer),
)

export const evidenceServing = (git: Layer.Layer<GitPort>) =>
  ChangeEvidenceLive.pipe(Layer.provide(git), Layer.provide(registryServing))

export interface ServedTurbo {
  readonly key: string
  readonly url: string
  readonly tarballUrl: (pin: string) => string
  readonly integrity: string
  readonly requests: ReadonlyArray<string>
  readonly packagesYaml: (recording?: ServedTurboRecording) => string
}

export interface ServedTurboRecording {
  readonly integrity?: string
  readonly tarball?: string
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
if (process.env.TURBO_TELEMETRY_DISABLED !== '1') {
  process.stderr.write('telemetry not disabled\\n')
  process.exit(3)
}
if (process.argv[2] === '--version') {
  process.stdout.write('${version}\\n')
  process.exit(0)
}
${dryRun}`

interface Listener {
  readonly origin: string
  readonly close: () => Promise<void>
}

const startListener = (servedPath: string, bytes: Uint8Array, requests: Array<string>): Promise<Listener> => {
  const { promise, resolve, reject } = Promise.withResolvers<Listener>()
  const server = createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    requests.push(requested)
    if (requested !== servedPath) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
    })
    response.end(bytes)
  })
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      reject(new Error('served-turbo: the loopback listener reported no port'))
      return
    }
    resolve({
      origin: `http://127.0.0.1:${address.port}`,
      close: () => {
        const closed = Promise.withResolvers<void>()
        server.closeAllConnections()
        server.close(() => closed.resolve())
        return closed.promise
      },
    })
  })
  return promise
}

const listenerOrigin = (
  servedPath: string,
  bytes: Uint8Array,
  requests: Array<string>,
): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(() => startListener(servedPath, bytes, requests)),
    (listener) => Effect.promise(() => listener.close()),
  ).pipe(Effect.map((listener) => listener.origin))

export const serveTurbo = (options: ServedTurboOptions): Effect.Effect<ServedTurbo, never, Scope.Scope> => {
  const { os, cpu } = platformOf(process.platform, process.arch)
  const name = `@turbo/${os}-${cpu}`
  const version = options.reportedVersion ?? options.pin
  const bytes = buildTarball({
    [`turbo-${os}-${process.arch}/bin/turbo`]: turboScript(
      version,
      options.dryRunBody ?? dryRunOverPresentManifests(version),
    ),
  })
  const integrity = digestOf(bytes)
  const pathOf = (pin: string): string => `/turbo/${os}-${cpu}-${pin}.tgz`
  const requests: Array<string> = []
  return Effect.map(listenerOrigin(pathOf(options.pin), bytes, requests), (origin) => {
    const tarballUrl = (pin: string): string => `${origin}${pathOf(pin)}`
    const url = tarballUrl(options.pin)
    return {
      key: `${name}@${options.pin}`,
      url,
      tarballUrl,
      integrity,
      requests,
      packagesYaml: (recording = {}) =>
        [
          `  '${name}@${options.pin}':`,
          `    resolution: {integrity: ${recording.integrity ?? integrity}, tarball: ${recording.tarball ?? url}}`,
        ].join('\n'),
    }
  })
}
