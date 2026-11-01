import { FsPath, type TarballDigest, TarballPort, TarballUnreadable } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { ManifestFields } from './manifest.schema.js'
import { parseTar } from './tar.js'

const digest = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  return 'unreadable tarball'
}

const digestOf = (
  source: FsPath,
  bytes: Uint8Array,
): Effect.Effect<TarballDigest, TarballUnreadable> =>
  Effect.gen(function*() {
    const refusable = (reason: string): TarballUnreadable => TarballUnreadable.make({ path: source, reason })
    const entries = yield* Effect.try({
      try: () => parseTar(gunzipSync(bytes)),
      catch: (cause) => refusable(messageOf(cause)),
    })
    const manifest = entries.find((entry) => entry.path === 'package/package.json')
    if (manifest === undefined) {
      return yield* Effect.fail(refusable('package/package.json is missing from the tarball'))
    }
    const text = new TextDecoder().decode(manifest.content)
    const decoded = S.decodeUnknownResult(S.fromJsonString(ManifestFields))(text)
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(refusable(decoded.failure.message))
    }
    const files: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.path.endsWith('/')) continue
      files[entry.path] = digest(entry.content)
    }
    return {
      name: decoded.success.name,
      version: decoded.success.version,
      integrity: digest(bytes),
      files,
    }
  })

const readOne = (
  fs: FileSystem,
  path: Path,
  dir: FsPath,
  name: string,
): Effect.Effect<TarballDigest, TarballUnreadable> =>
  Effect.gen(function*() {
    const full = path.join(dir, name)
    const bytes = yield* fs.readFile(full).pipe(
      Effect.mapError((cause) => TarballUnreadable.make({ path: FsPath.make(full), reason: cause.message })),
    )
    return yield* digestOf(FsPath.make(full), bytes)
  })

const readTarballs = (
  fs: FileSystem,
  path: Path,
  dir: FsPath,
): Effect.Effect<ReadonlyArray<TarballDigest>, TarballUnreadable> =>
  Effect.gen(function*() {
    const names = yield* fs.readDirectory(dir).pipe(
      Effect.mapError((cause) => TarballUnreadable.make({ path: dir, reason: cause.message })),
    )
    const tarballs = [...names].filter((name) => name.endsWith('.tgz')).sort()
    return yield* Effect.forEach(tarballs, (name) => readOne(fs, path, dir, name))
  })

export const TarballLive: Layer.Layer<TarballPort, never, FileSystem | Path> = Layer.effect(
  TarballPort,
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return {
      read: (dir: FsPath) => readTarballs(fs, path, dir),
      digest: (source: FsPath, bytes: Uint8Array) => digestOf(source, bytes),
      sha256: (bytes: Uint8Array) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
    }
  }),
)
