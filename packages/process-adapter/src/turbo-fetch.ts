import { HttpUrl, type TurboPinUnusable } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Result, type Scope } from 'effect'
import * as S from 'effect/Schema'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { type ProcessFault, runProcess } from './ProcessRun.js'
import { parseTar } from './tar.js'
import { LOCKFILE, pinUnusable, type TurboPin } from './turbo-pin.js'

const REGISTRY = 'https://registry.npmjs.org'

export const TURBO_ENV = { TURBO_TELEMETRY_DISABLED: '1' } as const

const OS: Partial<Record<NodeJS.Platform, string>> = { linux: 'linux', darwin: 'darwin', win32: 'windows' }
const CPU: Partial<Record<string, string>> = { x64: '64', arm64: 'arm64' }

interface TurboBinary {
  readonly name: string
  readonly file: string
}

const binaryFor = (platform: NodeJS.Platform, arch: string): Result.Result<TurboBinary, TurboPinUnusable> => {
  const os = OS[platform]
  const cpu = CPU[arch]
  if (os === undefined || cpu === undefined) {
    return Result.fail(pinUnusable(`turbo publishes no binary for ${platform} ${arch}`))
  }
  return Result.succeed({ name: `@turbo/${os}-${cpu}`, file: executableFor(platform) })
}

const executableFor = (platform: NodeJS.Platform): string => {
  if (platform === 'win32') return 'turbo.exe'
  return 'turbo'
}

const integrityOf = (bytes: Uint8Array): Effect.Effect<string> =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest('SHA-512', bytes)),
    (digest) => `sha512-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`,
  )

const gunzip = (bytes: Uint8Array): Promise<ArrayBuffer> =>
  new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()

const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  return 'unknown failure'
}

const tarballUrl = (name: string, version: string, recorded: string | undefined) =>
  S.decodeUnknownResult(HttpUrl)(recorded ?? `${REGISTRY}/${name}/-/${name.split('/')[1]}-${version}.tgz`)

export interface FetchedTurbo {
  readonly program: string
  readonly key: string
}
const reasonOf = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  return 'registry request failed'
}

const downloadTurbo = (url: HttpUrl): Effect.Effect<Uint8Array, string, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.get(url).pipe(Effect.mapError(reasonOf))
    if (response.status === 404) {
      return yield* Effect.fail(`registry has no tarball at ${url}`)
    }
    const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.mapError(reasonOf))
    const buffer = yield* ok.arrayBuffer.pipe(Effect.mapError(reasonOf))
    return new Uint8Array(buffer)
  })

export const fetchTurbo = (
  pin: TurboPin,
): Effect.Effect<
  FetchedTurbo,
  TurboPinUnusable | ProcessFault,
  HttpClient.HttpClient | FileSystem.FileSystem | ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const binary = yield* Effect.fromResult(binaryFor(process.platform, process.arch))
    const key = `${binary.name}@${pin.version}`
    const resolution = pin.resolutionOf(key)
    const expected = resolution?.integrity
    if (expected === undefined) {
      return yield* Effect.fail(
        pinUnusable(
          `${LOCKFILE} records no integrity for ${key}, the turbo binary for ${process.platform} ${process.arch}`,
        ),
      )
    }
    const recorded = resolution?.tarball
    const url = yield* Effect.mapError(
      Effect.fromResult(tarballUrl(binary.name, pin.version, recorded)),
      () => pinUnusable(`cannot fetch ${key} from ${recorded}: not an http(s) URL`),
    )
    const bytes = yield* downloadTurbo(url).pipe(
      Effect.mapError((reason) => pinUnusable(`cannot fetch ${key} from ${url}: ${reason}`)),
    )
    const actual = yield* integrityOf(bytes)
    if (actual !== expected) {
      return yield* Effect.fail(
        pinUnusable(`fetched ${key} has integrity ${actual}, not the ${expected} ${LOCKFILE} records`),
      )
    }
    const entries = yield* Effect.tryPromise({
      try: async () => parseTar(new Uint8Array(await gunzip(bytes))),
      catch: (cause) => pinUnusable(`fetched ${key} is not a readable gzip tarball: ${messageOf(cause)}`),
    })
    const entry = entries.find((candidate) => {
      const [top, bin, file, ...rest] = candidate.path.split('/')
      return top !== undefined && top !== '' && bin === 'bin' && file === binary.file && rest.length === 0
    })
    if (entry === undefined) {
      return yield* Effect.fail(pinUnusable(`fetched ${key} holds no bin/${binary.file}`))
    }
    const fs = yield* FileSystem.FileSystem
    const unwritable = (cause: unknown) => pinUnusable(`cannot write the fetched ${key}: ${messageOf(cause)}`)
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'turbo-' }).pipe(Effect.mapError(unwritable))
    const program = `${dir}/${binary.file}`
    yield* fs.writeFile(program, entry.content, { mode: 0o755 }).pipe(Effect.mapError(unwritable))
    const reported = yield* runProcess({
      program,
      args: ['--version'],
      cwd: dir,
      stdio: 'captured',
      env: TURBO_ENV,
    })
    const version = reported.stdout.trim()
    if (reported.code !== 0 || version !== pin.version) {
      return yield* Effect.fail(
        pinUnusable(
          `fetched ${key} reports ${version || `exit ${reported.code}`}, not the lockfile pin ${pin.version}`,
        ),
      )
    }
    return { program, key }
  })
