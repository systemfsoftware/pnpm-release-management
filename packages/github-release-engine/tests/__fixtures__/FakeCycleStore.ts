import type { CycleEntry, FsPath, PackageName } from '@systemfsoftware/release-language'
import {
  Count,
  CycleEntry as CycleEntrySchema,
  CycleStore,
  PackageName as PackageNameSchema,
  PlanCapturedMalformed,
  RelativePath,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export interface FakeCycleFiles {
  readonly capturedFiles?: Record<string, unknown>
  readonly deferredFiles?: Record<string, string>
  readonly changelogDir?: RelativePath
}

export interface FakeCycleWrites {
  readonly captured: Array<{ readonly path: FsPath; readonly entries: Array<CycleEntry> }>
  readonly deferred: Array<{ readonly path: FsPath; readonly names: Array<PackageName> }>
}

const splitTag = (tag: string): { name: string; version: string } | undefined => {
  const at = tag.lastIndexOf('@v')
  if (at === -1) {
    return undefined
  }
  return { name: tag.slice(0, at), version: tag.slice(at + 2) }
}

const stringToPlain = (item: string, dir: RelativePath): Record<string, string> | undefined => {
  const parts = splitTag(item)
  if (parts === undefined) {
    return undefined
  }
  return {
    name: parts.name,
    version: parts.version,
    tag: item,
    changelog: `${dir}/${parts.name.replace('/', '!')}@${parts.version}.md`,
  }
}

const extractRawFields = (item: object): {
  readonly tag: string | undefined
  readonly name: string | undefined
  readonly version: string | undefined
  readonly changelog: string | undefined
} => {
  let tag: string | undefined = undefined
  if ('tag' in item) {
    if (typeof item.tag === 'string') {
      tag = item.tag
    }
  }
  let name: string | undefined = undefined
  if ('name' in item) {
    if (typeof item.name === 'string') {
      name = item.name
    }
  }
  let version: string | undefined = undefined
  if ('version' in item) {
    if (typeof item.version === 'string') {
      version = item.version
    }
  }
  let changelog: string | undefined = undefined
  if ('changelog' in item) {
    if (typeof item.changelog === 'string') {
      changelog = item.changelog
    }
  }
  return { tag, name, version, changelog }
}

const resolveTagParts = (fields: {
  readonly tag: string | undefined
  readonly name: string | undefined
  readonly version: string | undefined
}): { readonly name: string; readonly version: string; readonly tag: string } | undefined => {
  let parsed: { name: string; version: string } | undefined = undefined
  if (fields.tag !== undefined) {
    parsed = splitTag(fields.tag)
  }
  let resolvedName: string | undefined = fields.name
  if (resolvedName === undefined) {
    resolvedName = parsed?.name
  }
  let resolvedVersion: string | undefined = fields.version
  if (resolvedVersion === undefined) {
    resolvedVersion = parsed?.version
  }
  let resolved: string | undefined = fields.tag
  if (resolved === undefined) {
    if (fields.name !== undefined) {
      if (fields.version !== undefined) {
        resolved = `${fields.name}@v${fields.version}`
      }
    }
  }
  if (resolvedName === undefined || resolvedVersion === undefined || resolved === undefined) {
    return undefined
  }
  return { name: resolvedName, version: resolvedVersion, tag: resolved }
}

const objectToPlain = (item: object, dir: RelativePath): Record<string, string> | undefined => {
  const fields = extractRawFields(item)
  const resolved = resolveTagParts(fields)
  if (resolved === undefined) {
    return undefined
  }
  let changelogPath: string = `${dir}/${resolved.name.replace('/', '!')}@${resolved.version}.md`
  if (fields.changelog !== undefined) {
    changelogPath = fields.changelog
  }
  return {
    name: resolved.name,
    version: resolved.version,
    tag: resolved.tag,
    changelog: changelogPath,
  }
}

const toPlainEntry = (
  item: unknown,
  dir: RelativePath,
): Record<string, string> | undefined => {
  if (typeof item === 'string') {
    return stringToPlain(item, dir)
  }
  if (typeof item === 'object' && item !== null && Array.isArray(item) === false) {
    return objectToPlain(item, dir)
  }
  return undefined
}

export const makeFakeCycleStore = (files: FakeCycleFiles = {}) => {
  const dir = files.changelogDir ?? RelativePath.make('.changeset/changelogs')
  const written: FakeCycleWrites = { captured: [], deferred: [] }
  const layer = Layer.succeed(CycleStore, {
    readCaptured: (path: FsPath) => {
      const raw = files.capturedFiles?.[path]
      if (!Array.isArray(raw)) {
        return Effect.fail(PlanCapturedMalformed.make({ path }))
      }
      const plains = raw.map((item) => toPlainEntry(item, dir))
      if (plains.some((entry) => entry === undefined)) {
        return Effect.fail(PlanCapturedMalformed.make({ path }))
      }
      const decoded = S.decodeUnknownResult(S.Array(CycleEntrySchema))(plains)
      if (Result.isFailure(decoded)) {
        return Effect.fail(PlanCapturedMalformed.make({ path }))
      }
      return Effect.succeed([...decoded.success])
    },
    writeCaptured: (path: FsPath, cycle: ReadonlyArray<CycleEntry>) => {
      written.captured.push({ path, entries: [...cycle] })
      return Effect.succeed(Count.make(cycle.length))
    },
    readDeferred: (source?: FsPath) => {
      if (source === undefined) {
        return Effect.succeed([])
      }
      const text = files.deferredFiles?.[source]
      if (text === undefined) {
        return Effect.fail(PlanCapturedMalformed.make({ path: source }))
      }
      const names = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
      const decoded = S.decodeUnknownResult(S.Array(PackageNameSchema))(names)
      if (Result.isFailure(decoded)) {
        return Effect.fail(PlanCapturedMalformed.make({ path: source }))
      }
      return Effect.succeed([...decoded.success])
    },
    writeDeferred: (path: FsPath, deferred: ReadonlyArray<PackageName>) => {
      written.deferred.push({ path, names: [...deferred] })
      return Effect.succeed(Count.make(deferred.length))
    },
  })
  return { layer, written }
}
