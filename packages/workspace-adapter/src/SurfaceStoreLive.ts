import { join } from '@std/path'
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
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const PackageSection = S.Struct({ package: S.Struct({ version: S.Unknown }) })
const WorkspaceSection = S.Struct({ workspace: S.Struct({ package: S.Struct({ version: S.Unknown }) }) })
const NIX_BINDING = /^\s*version\s*=\s*"(\d+\.\d+\.\d+)"\s*;?\s*$/gm
const TOML_SECTION = /^\s*\[(.+?)\]\s*$/
const TOML_VERSION = /^(\s*version\s*=\s*")([^"]*)(".*)$/
const JSON_INDENT = /^(\s+)"/m

type LocatedToml = { readonly sections: ReadonlyArray<string>; readonly version: unknown }

const locateToml = (parsed: unknown): LocatedToml | undefined => {
  const pkg = S.decodeUnknownOption(PackageSection)(parsed)
  const workspace = S.decodeUnknownOption(WorkspaceSection)(parsed)
  if (Option.isSome(pkg) && Option.isNone(workspace)) {
    return { sections: ['package'], version: pkg.value.package.version }
  }
  if (Option.isNone(pkg) && Option.isSome(workspace)) {
    return { sections: ['workspace.package'], version: workspace.value.workspace.package.version }
  }
  if (Option.isSome(pkg) && Option.isSome(workspace)) {
    const found: unknown = pkg.value.package.version
    const other: unknown = workspace.value.workspace.package.version
    if (typeof found === 'string' && typeof other === 'string' && found === other) {
      return { sections: ['package', 'workspace.package'], version: found }
    }
    return undefined
  }
  return undefined
}

const spliceToml = (text: string, sections: ReadonlyArray<string>, version: PackageVersion): string | undefined => {
  let current: string | undefined
  let spliced = 0
  const out = text.split('\n').map((line) => {
    const section = TOML_SECTION.exec(line)?.[1]?.trim()
    if (section !== undefined) {
      current = section
      return line
    }
    if (current !== undefined && sections.includes(current)) {
      const match = TOML_VERSION.exec(line)
      if (match !== null) {
        spliced += 1
        return `${match[1] ?? ''}${version}${match[3] ?? ''}`
      }
    }
    return line
  })
  return spliced === sections.length ? out.join('\n') : undefined
}

export const SurfaceStoreLive = (root: RepoRoot): Layer.Layer<SurfaceStore> => {
  const extractJson = (text: string, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
    Effect.gen(function*() {
      const fail = (): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return yield* Effect.fail(fail())
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !('version' in parsed)) {
        return yield* Effect.fail(fail())
      }
      const raw: unknown = parsed.version
      if (typeof raw !== 'string') return yield* Effect.fail(fail())
      return yield* S.decodeUnknownEffect(PackageVersion)(raw).pipe(Effect.mapError(fail))
    })

  const extractToml = (
    text: string,
    file: RelativePath,
    header: TomlHeader | undefined,
  ): Effect.Effect<PackageVersion, VersionRefusal> =>
    Effect.gen(function*() {
      const fail = (): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })
      let parsed: unknown
      try {
        parsed = parseToml(text)
      } catch {
        return yield* Effect.fail(fail())
      }
      let raw: unknown
      if (header === '[workspace.package]') {
        const doc = yield* S.decodeUnknownEffect(WorkspaceSection)(parsed).pipe(Effect.mapError(fail))
        raw = doc.workspace.package.version
      } else if (header === '[package]') {
        const doc = yield* S.decodeUnknownEffect(PackageSection)(parsed).pipe(Effect.mapError(fail))
        raw = doc.package.version
      } else {
        const located = locateToml(parsed)
        if (located === undefined) return yield* Effect.fail(fail())
        raw = located.version
      }
      if (typeof raw !== 'string') return yield* Effect.fail(fail())
      return yield* S.decodeUnknownEffect(PackageVersion)(raw).pipe(Effect.mapError(fail))
    })

  const extractNix = (text: string, file: RelativePath): Effect.Effect<PackageVersion, VersionRefusal> =>
    Effect.gen(function*() {
      const fail = (): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })
      const hits = [...text.matchAll(NIX_BINDING)]
      if (hits.length !== 1) return yield* Effect.fail(fail())
      const hit = hits[0]
      if (hit === undefined || hit[1] === undefined) return yield* Effect.fail(fail())
      const raw: unknown = hit[1]
      if (typeof raw !== 'string') return yield* Effect.fail(fail())
      return yield* S.decodeUnknownEffect(PackageVersion)(raw).pipe(Effect.mapError(fail))
    })

  const rewriteJson = (
    text: string,
    file: RelativePath,
    version: PackageVersion,
  ): Effect.Effect<string, VersionRefusal> =>
    Effect.gen(function*() {
      let doc: unknown
      try {
        doc = JSON.parse(text)
      } catch {
        return yield* Effect.fail({ _tag: 'VersionIntentMalformed', path: file } as const)
      }
      if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
        return yield* Effect.fail({ _tag: 'VersionIntentMalformed', path: file } as const)
      }
      const indent = text.match(JSON_INDENT)?.[1] ?? 2
      const encoded = JSON.stringify({ ...doc, version }, null, indent)
      return text.endsWith('\n') ? `${encoded}\n` : encoded
    })

  const rewriteToml = (
    text: string,
    file: RelativePath,
    header: TomlHeader | undefined,
    version: PackageVersion,
  ): Effect.Effect<string, VersionRefusal> =>
    Effect.gen(function*() {
      const fail = (): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })
      let parsed: unknown
      try {
        parsed = parseToml(text)
      } catch {
        return yield* Effect.fail(fail())
      }
      let sections: ReadonlyArray<string>
      if (header === undefined) {
        const located = locateToml(parsed)
        if (located === undefined) return yield* Effect.fail(fail())
        sections = located.sections
      } else {
        sections = [header.slice(1, -1)]
      }
      const spliced = spliceToml(text, sections, version)
      if (spliced === undefined) return yield* Effect.fail(fail())
      return spliced
    })

  const rewriteNix = (
    text: string,
    file: RelativePath,
    version: PackageVersion,
    current: PackageVersion,
  ): Effect.Effect<string, VersionRefusal> =>
    Effect.gen(function*() {
      const fail = (): VersionRefusal => ({ _tag: 'VersionIntentMalformed', path: file })
      const hits = [...text.matchAll(NIX_BINDING)]
      if (hits.length !== 1) return yield* Effect.fail(fail())
      const hit = hits[0]
      if (hit === undefined || hit.index === undefined || hit[0] === undefined) {
        return yield* Effect.fail(fail())
      }
      return `${text.slice(0, hit.index)}${hit[0].replace(current, version)}${text.slice(hit.index + hit[0].length)}`
    })

  const readSurface = (file: RelativePath, surface: VersionSurface): Effect.Effect<PackageVersion, VersionRefusal> =>
    Effect.gen(function*() {
      const full = join(root, file)
      const text = yield* Effect.tryPromise({ try: () => Deno.readTextFile(full), catch: (error) => error }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.fail({ _tag: 'VersionSurfaceMissing', path: file } as const)
            : Effect.die(error)
        ),
      )
      if (surface.kind === 'json') return yield* extractJson(text, file)
      if (surface.kind === 'toml') return yield* extractToml(text, file, surface.header)
      if (surface.kind === 'nix') return yield* extractNix(text, file)
      throw new Error(`unknown surface kind: ${JSON.stringify(surface)}`)
    })

  const writeSurface = (
    file: RelativePath,
    surface: VersionSurface,
    version: PackageVersion,
  ): Effect.Effect<SurfaceWrite, VersionRefusal> =>
    Effect.gen(function*() {
      const full = join(root, file)
      const text = yield* Effect.tryPromise({ try: () => Deno.readTextFile(full), catch: (error) => error }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.fail({ _tag: 'VersionSurfaceMissing', path: file } as const)
            : Effect.die(error)
        ),
      )
      let current: PackageVersion
      if (surface.kind === 'json') {
        current = yield* extractJson(text, file)
      } else if (surface.kind === 'toml') {
        current = yield* extractToml(text, file, surface.header)
      } else if (surface.kind === 'nix') {
        current = yield* extractNix(text, file)
      } else {
        throw new Error(`unknown surface kind: ${JSON.stringify(surface)}`)
      }
      if (current === version) return { path: file, moved: false }
      let next: string
      if (surface.kind === 'json') {
        next = yield* rewriteJson(text, file, version)
      } else if (surface.kind === 'toml') {
        next = yield* rewriteToml(text, file, surface.header, version)
      } else if (surface.kind === 'nix') {
        next = yield* rewriteNix(text, file, version, current)
      } else {
        throw new Error(`unknown surface kind: ${JSON.stringify(surface)}`)
      }
      yield* Effect.tryPromise({ try: () => Deno.writeTextFile(full, next), catch: (error) => error }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.fail({ _tag: 'VersionSurfaceMissing', path: file } as const)
            : Effect.die(error)
        ),
      )
      return { path: file, moved: true }
    })
  const writeRootManifest = (path: RelativePath, text: string): Effect.Effect<RootFile, VersionRefusal> =>
    Effect.gen(function*() {
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(join(root, path), text),
        catch: (): VersionRefusal => ({ _tag: 'RootManifestUnwritable', path }),
      })
      return { path, text }
    })

  return Layer.succeed(SurfaceStore)({ readSurface, writeSurface, writeRootManifest })
}
