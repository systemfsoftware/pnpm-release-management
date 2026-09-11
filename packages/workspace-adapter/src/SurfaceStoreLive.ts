import { parse as parseToml } from '@std/toml'
import {
  PackageVersion,
  type RelativePath,
  type RepoRoot,
  type RootFile,
  SurfaceStore,
  type SurfaceWrite,
  type TomlHeader,
  type VersionRefusal,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import { readTextFile, writeTextFile } from './StoreFile.js'
import type { StoreFault } from './StoreFile.schema.js'
import { JsonDocument, JsonVersion, PackageSection, WorkspaceSection } from './Surface.schema.js'

const NIX_BINDING = /^\s*version\s*=\s*"(\d+\.\d+\.\d+)"\s*;?\s*$/gm
const TOML_SECTION = /^\s*\[(.+?)\]\s*$/
const TOML_VERSION = /^(\s*version\s*=\s*")([^"]*)(".*)$/
const JSON_INDENT = /^(\s+)"/m

type LocatedToml = { readonly sections: ReadonlyArray<string>; readonly version: unknown }

const malformed = (file: RelativePath): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })

const versionOf = (raw: unknown, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
  S.decodeUnknownEffect(PackageVersion)(raw).pipe(Effect.mapError(() => malformed(file)))

const surfaceFault = (file: RelativePath, fault: StoreFault): VersionRefusal =>
  Match.value(fault).pipe(
    Match.tag('Missing', (): VersionRefusal => ({ _tag: 'VersionSurfaceMissing', path: file })),
    Match.orElse((): VersionRefusal => malformed(file)),
  )

const parseTomlText = (text: string, file: RelativePath): Effect.Effect<Record<string, unknown>, VersionRefusal> =>
  Effect.try({
    try: () => parseToml(text),
    catch: () => malformed(file),
  })

const locateToml = (parsed: Record<string, unknown>): Option.Option<LocatedToml> => {
  const pkg = S.decodeUnknownOption(PackageSection)(parsed)
  const workspace = S.decodeUnknownOption(WorkspaceSection)(parsed)
  if (Option.isSome(pkg) && Option.isNone(workspace)) {
    return Option.some({ sections: ['package'], version: pkg.value.package.version })
  }
  if (Option.isNone(pkg) && Option.isSome(workspace)) {
    return Option.some({ sections: ['workspace.package'], version: workspace.value.workspace.package.version })
  }
  if (Option.isSome(pkg) && Option.isSome(workspace)) {
    const version = pkg.value.package.version
    if (version === workspace.value.workspace.package.version) {
      return Option.some({ sections: ['package', 'workspace.package'], version })
    }
  }
  return Option.none()
}

const nixBinding = (text: string): Option.Option<RegExpExecArray> => {
  const hits = [...text.matchAll(NIX_BINDING)]
  if (hits.length !== 1) return Option.none()
  return Option.fromNullishOr(hits.at(0))
}

const spliceToml = (
  text: string,
  sections: ReadonlyArray<string>,
  version: PackageVersion,
): Option.Option<string> => {
  const lines: Array<string> = []
  let current: string | undefined
  let spliced = 0
  for (const line of text.split('\n')) {
    const section = TOML_SECTION.exec(line)?.at(1)?.trim()
    if (section !== undefined) {
      current = section
      lines.push(line)
      continue
    }
    if (current === undefined || !sections.includes(current)) {
      lines.push(line)
      continue
    }
    const match = TOML_VERSION.exec(line)
    if (match === null) {
      lines.push(line)
      continue
    }
    spliced += 1
    lines.push(`${match.at(1) ?? ''}${version}${match.at(3) ?? ''}`)
  }
  if (spliced === sections.length) return Option.some(lines.join('\n'))
  return Option.none()
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

      const readFile = (file: RelativePath): Effect.Effect<string, VersionRefusal> =>
        readTextFile(fs, path.join(root, file)).pipe(Effect.mapError((fault) => surfaceFault(file, fault)))

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
      ): Effect.Effect<PackageVersion, VersionRefusal> =>
        Effect.gen(function*() {
          const text = yield* readFile(file)
          return yield* currentVersionOf(text, file, surface)
        })

      const writeSurface = (
        file: RelativePath,
        surface: VersionSurface,
        version: PackageVersion,
      ): Effect.Effect<SurfaceWrite, VersionRefusal> =>
        Effect.gen(function*() {
          const text = yield* readFile(file)
          const current = yield* currentVersionOf(text, file, surface)
          if (current === version) return { path: file, moved: false }
          const next = yield* rewritten(text, file, surface, version, current)
          yield* writeTextFile(fs, path.join(root, file), next, 'overwrite').pipe(
            Effect.mapError((fault) => surfaceFault(file, fault)),
          )
          return { path: file, moved: true }
        })

      const writeRootManifest = (file: RelativePath, text: string): Effect.Effect<RootFile, VersionRefusal> =>
        writeTextFile(fs, path.join(root, file), text, 'overwrite').pipe(
          Effect.mapError((): VersionRefusal => ({ _tag: 'RootManifestUnwritable', path: file })),
          Effect.as({ path: file, text }),
        )

      return { readSurface, writeSurface, writeRootManifest }
    }),
  )
