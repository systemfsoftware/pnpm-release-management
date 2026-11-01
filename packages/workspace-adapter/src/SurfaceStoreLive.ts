import { parse as parseToml } from '@std/toml'
import {
  PackageVersion,
  RelativePath,
  type RepoRoot,
  type RootFile,
  RootManifestUnwritable,
  SurfaceStore,
  type SurfaceWrite,
  type TomlHeader,
  VersionIntentMalformed,
  type VersionRefusal,
  type VersionSurface,
  VersionSurfaceMissing,
} from '@systemfsoftware/release-language'
import { Effect, HashSet, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import {
  type CargoArtifact,
  type CargoInput,
  currentCargoVersion,
  memberGlobsOf,
  planCargoBump,
  workspaceVersionOf,
} from './CargoSurface.js'
import { isRegularFile, overwriteTextFile, readDirectoryEntries, readTextFile } from './StoreFile.js'
import type { StoreFault } from './StoreFile.schema.js'
import { JsonDocument, JsonVersion, PackageSection, WorkspaceSection } from './Surface.schema.js'
import { spliceToml } from './TomlEdit.js'

const NIX_BINDING = /^\s*version\s*=\s*"(\d+\.\d+\.\d+)"\s*;?\s*$/gm
const JSON_INDENT = /^(\s+)"/m

type LocatedToml = { readonly sections: ReadonlyArray<string>; readonly version: unknown }

const malformed = (file: RelativePath): VersionRefusal => VersionIntentMalformed.make({ path: file })

const versionOf = (raw: unknown, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
  S.decodeUnknownEffect(PackageVersion)(raw).pipe(Effect.mapError(() => malformed(file)))

const surfaceFault = (file: RelativePath, fault: StoreFault): VersionRefusal =>
  Match.value(fault).pipe(
    Match.tag('Missing', () => VersionSurfaceMissing.make({ path: file })),
    Match.orElse(() => malformed(file)),
  )

const parseTomlText = (text: string, file: RelativePath): Effect.Effect<Record<string, unknown>, VersionRefusal> =>
  Effect.try({
    try: () => parseToml(text),
    catch: () => malformed(file),
  })

const locateToml = (parsed: Record<string, unknown>): Option.Option<LocatedToml> => {
  const pkg = S.decodeUnknownOption(PackageSection)(parsed)
  const workspace = S.decodeUnknownOption(WorkspaceSection)(parsed)
  if (Option.isSome(pkg) && Option.isSome(workspace)) {
    const version = pkg.value.package.version
    if (version !== workspace.value.workspace.package.version) return Option.none()
    return Option.some({ sections: ['package', 'workspace.package'], version })
  }
  if (Option.isSome(pkg)) return Option.some({ sections: ['package'], version: pkg.value.package.version })
  if (Option.isSome(workspace)) {
    return Option.some({ sections: ['workspace.package'], version: workspace.value.workspace.package.version })
  }
  return Option.none()
}

const nixBinding = (text: string): Option.Option<RegExpExecArray> => {
  const hits = [...text.matchAll(NIX_BINDING)]
  if (hits.length !== 1) return Option.none()
  return Option.fromNullishOr(hits.at(0))
}

const extractJson = (text: string, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
  Effect.gen(function*() {
    const document = yield* S.decodeUnknownEffect(JsonVersion)(text).pipe(Effect.mapError(() => malformed(file)))
    return yield* versionOf(document.version, file)
  })

const extractToml = (
  text: string,
  file: RelativePath,
  header: TomlHeader | undefined,
): Effect.Effect<PackageVersion, VersionRefusal> =>
  Effect.gen(function*() {
    const parsed = yield* parseTomlText(text, file)
    if (header === '[workspace.package]') {
      const section = yield* S.decodeUnknownEffect(WorkspaceSection)(parsed).pipe(
        Effect.mapError(() => malformed(file)),
      )
      return yield* versionOf(section.workspace.package.version, file)
    }
    if (header === '[package]') {
      const section = yield* S.decodeUnknownEffect(PackageSection)(parsed).pipe(Effect.mapError(() => malformed(file)))
      return yield* versionOf(section.package.version, file)
    }
    const located = locateToml(parsed)
    if (Option.isNone(located)) return yield* Effect.fail(malformed(file))
    return yield* versionOf(located.value.version, file)
  })

const extractNix = (text: string, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
  Effect.gen(function*() {
    const hit = nixBinding(text)
    if (Option.isNone(hit)) return yield* Effect.fail(malformed(file))
    const raw = hit.value.at(1)
    if (raw === undefined) return yield* Effect.fail(malformed(file))
    return yield* versionOf(raw, file)
  })

const rewriteJson = (
  text: string,
  file: RelativePath,
  version: PackageVersion,
): Effect.Effect<string, VersionRefusal> =>
  Effect.gen(function*() {
    const document = yield* S.decodeUnknownEffect(JsonDocument)(text).pipe(Effect.mapError(() => malformed(file)))
    const indent = text.match(JSON_INDENT)?.at(1) ?? 2
    const encoded = JSON.stringify({ ...document, version }, null, indent)
    if (text.endsWith('\n')) return `${encoded}\n`
    return encoded
  })

const rewriteToml = (
  text: string,
  file: RelativePath,
  header: TomlHeader | undefined,
  version: PackageVersion,
): Effect.Effect<string, VersionRefusal> =>
  Effect.gen(function*() {
    const parsed = yield* parseTomlText(text, file)
    let sections: ReadonlyArray<string>
    if (header === undefined) {
      const located = locateToml(parsed)
      if (Option.isNone(located)) return yield* Effect.fail(malformed(file))
      sections = located.value.sections
    } else {
      sections = [header.slice(1, -1)]
    }
    const spliced = spliceToml(text, sections, version)
    if (Option.isNone(spliced)) return yield* Effect.fail(malformed(file))
    return spliced.value
  })

const rewriteNix = (
  text: string,
  file: RelativePath,
  version: PackageVersion,
  current: PackageVersion,
): Effect.Effect<string, VersionRefusal> =>
  Effect.gen(function*() {
    const hit = nixBinding(text)
    if (Option.isNone(hit)) return yield* Effect.fail(malformed(file))
    const matched = hit.value.at(0)
    if (matched === undefined) return yield* Effect.fail(malformed(file))
    const { index } = hit.value
    return `${text.slice(0, index)}${matched.replace(current, version)}${text.slice(index + matched.length)}`
  })

export const SurfaceStoreLive = (root: RepoRoot): Layer.Layer<SurfaceStore, never, FileSystem | Path> =>
  Layer.effect(
    SurfaceStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      const brandRelative = (value: string, file: RelativePath): Effect.Effect<RelativePath, VersionRefusal> =>
        S.decodeUnknownEffect(RelativePath)(value).pipe(Effect.mapError(() => malformed(file)))

      const absent = <A>(effect: Effect.Effect<A, StoreFault>): Effect.Effect<A | undefined, never> =>
        effect.pipe(
          Effect.map((value): A | undefined => value),
          Effect.catchTags({
            Missing: () => Effect.succeed(undefined),
            AlreadyExists: () => Effect.succeed(undefined),
            Unavailable: () => Effect.succeed(undefined),
          }),
        )

      const readDirEntries = (full: string): Effect.Effect<ReadonlyArray<string>, never> =>
        absent(readDirectoryEntries(fs, full)).pipe(Effect.map((entries) => entries ?? []))

      const walkGlob = (dir: string, segments: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, never> =>
        Effect.gen(function*() {
          const head = segments.at(0)
          if (head === undefined) return [dir]
          const rest = segments.slice(1)
          if (head === '**') {
            const here = yield* walkGlob(dir, rest)
            const entries = yield* readDirEntries(dir)
            const nested = yield* Effect.forEach(
              entries,
              (name) => walkGlob(path.join(dir, name), segments),
              { concurrency: 'unbounded' },
            )
            return [...here, ...nested.flat()]
          }
          if (head === '*') {
            const entries = yield* readDirEntries(dir)
            const matched = yield* Effect.forEach(
              entries,
              (name) => walkGlob(path.join(dir, name), rest),
              { concurrency: 'unbounded' },
            )
            return matched.flat()
          }
          return yield* walkGlob(path.join(dir, head), rest)
        })

      const expandMembers = (
        file: RelativePath,
        globs: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<RelativePath>, VersionRefusal> =>
        Effect.gen(function*() {
          const base = path.join(root, path.dirname(file))
          const perGlob = yield* Effect.forEach(
            globs,
            (glob) =>
              Effect.gen(function*() {
                const segments = glob.split('/').filter((segment) => segment.length > 0)
                const dirs = yield* walkGlob(base, segments)
                const manifests = yield* Effect.forEach(
                  dirs,
                  (dir) =>
                    Effect.gen(function*() {
                      const manifest = path.join(dir, 'Cargo.toml')
                      const exists = yield* absent(isRegularFile(fs, manifest))
                      if (exists !== true) return Option.none<string>()
                      return Option.some(path.relative(root, manifest))
                    }),
                  { concurrency: 'unbounded' },
                )
                return manifests.flatMap((entry): ReadonlyArray<string> => {
                  if (Option.isSome(entry)) return [entry.value]
                  return []
                })
              }),
            { concurrency: 'unbounded' },
          )
          const unique = HashSet.fromIterable(perGlob.flat())
          return yield* Effect.forEach([...unique], (value) => brandRelative(value, file), {
            concurrency: 'unbounded',
          })
        })

      const readCargoInput = (file: RelativePath): Effect.Effect<CargoInput, VersionRefusal> =>
        Effect.gen(function*() {
          const manifestText = yield* readTextFile(fs, path.join(root, file)).pipe(
            Effect.mapError((fault) => surfaceFault(file, fault)),
          )
          yield* workspaceVersionOf(manifestText, file)
          const memberFiles = yield* expandMembers(file, memberGlobsOf(manifestText))
          const members = yield* Effect.forEach(
            memberFiles,
            (memberFile) =>
              absent(readTextFile(fs, path.join(root, memberFile))).pipe(
                Effect.map((memberText): Option.Option<CargoArtifact> => {
                  if (memberText === undefined) return Option.none()
                  return Option.some({ file: memberFile, text: memberText })
                }),
              ),
            { concurrency: 'unbounded' },
          )
          const lockFile = yield* brandRelative(path.join(path.dirname(file), 'Cargo.lock'), file)
          const lockText = yield* absent(readTextFile(fs, path.join(root, lockFile))).pipe(
            Effect.map((text): Option.Option<CargoArtifact> => {
              if (text === undefined) return Option.none()
              return Option.some({ file: lockFile, text })
            }),
          )
          return {
            manifest: { file, text: manifestText },
            members: members.flatMap((entry): ReadonlyArray<CargoArtifact> => {
              if (Option.isSome(entry)) return [entry.value]
              return []
            }),
            lock: Option.getOrUndefined(lockText),
          }
        })

      const readCargo = (file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
        readCargoInput(file).pipe(Effect.flatMap(currentCargoVersion))

      const writeCargo = (file: RelativePath, version: PackageVersion): Effect.Effect<SurfaceWrite, VersionRefusal> =>
        Effect.gen(function*() {
          const input = yield* readCargoInput(file)
          const writes = yield* planCargoBump(input, version)
          yield* Effect.forEach(
            writes,
            (write) =>
              overwriteTextFile(fs, path.join(root, write.file), write.text).pipe(
                Effect.mapError((fault) => surfaceFault(write.file, fault)),
              ),
            { discard: true },
          )
          return { path: file, moved: writes.length > 0 }
        })

      const currentVersionOf = (
        text: string,
        file: RelativePath,
        surface: VersionSurface,
      ): Effect.Effect<PackageVersion, VersionRefusal> => {
        if (surface.kind === 'json') return extractJson(text, file)
        if (surface.kind === 'toml') return extractToml(text, file, surface.header)
        return extractNix(text, file)
      }

      const rewritten = (
        text: string,
        file: RelativePath,
        surface: VersionSurface,
        version: PackageVersion,
        current: PackageVersion,
      ): Effect.Effect<string, VersionRefusal> => {
        if (surface.kind === 'json') return rewriteJson(text, file, version)
        if (surface.kind === 'toml') return rewriteToml(text, file, surface.header, version)
        return rewriteNix(text, file, version, current)
      }

      const readSurface = (
        file: RelativePath,
        surface: VersionSurface,
      ): Effect.Effect<PackageVersion, VersionRefusal> => {
        if (surface.kind === 'cargo') return readCargo(file)
        return Effect.gen(function*() {
          const text = yield* readTextFile(fs, path.join(root, file)).pipe(
            Effect.mapError((fault) => surfaceFault(file, fault)),
          )
          return yield* currentVersionOf(text, file, surface)
        })
      }

      const writeSurface = (
        file: RelativePath,
        surface: VersionSurface,
        version: PackageVersion,
      ): Effect.Effect<SurfaceWrite, VersionRefusal> => {
        if (surface.kind === 'cargo') return writeCargo(file, version)
        return Effect.gen(function*() {
          const text = yield* readTextFile(fs, path.join(root, file)).pipe(
            Effect.mapError((fault) => surfaceFault(file, fault)),
          )
          const current = yield* currentVersionOf(text, file, surface)
          if (current === version) return { path: file, moved: false }
          const next = yield* rewritten(text, file, surface, version, current)
          yield* overwriteTextFile(fs, path.join(root, file), next).pipe(
            Effect.mapError((fault) => surfaceFault(file, fault)),
          )
          return { path: file, moved: true }
        })
      }

      const writeRootManifest = (file: RelativePath, text: string): Effect.Effect<RootFile, VersionRefusal> =>
        overwriteTextFile(fs, path.join(root, file), text).pipe(
          Effect.mapError(() => RootManifestUnwritable.make({ path: file })),
          Effect.as({ path: file, text }),
        )

      return { readSurface, writeSurface, writeRootManifest }
    }),
  )
