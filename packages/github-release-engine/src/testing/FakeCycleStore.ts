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

const toPlainEntry = (
  item: unknown,
  dir: RelativePath,
): Record<string, string> | undefined => {
  if (typeof item === 'string') {
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
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const tag = 'tag' in item && typeof item.tag === 'string' ? item.tag : undefined
    const name = 'name' in item && typeof item.name === 'string' ? item.name : undefined
    const version = 'version' in item && typeof item.version === 'string' ? item.version : undefined
    const changelog = 'changelog' in item && typeof item.changelog === 'string'
      ? item.changelog
      : undefined
    const parsed = tag !== undefined ? splitTag(tag) : undefined
    const resolvedName = name ?? parsed?.name
    const resolvedVersion = version ?? parsed?.version
    const resolvedTag = tag ?? (name !== undefined && version !== undefined
      ? `${name}@v${version}`
      : undefined)
    if (resolvedName === undefined || resolvedVersion === undefined || resolvedTag === undefined) {
      return undefined
    }
    return {
      name: resolvedName,
      version: resolvedVersion,
      tag: resolvedTag,
      changelog: changelog ?? `${dir}/${resolvedName.replace('/', '!')}@${resolvedVersion}.md`,
    }
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
    readDeferred: (source?: FsPath | undefined) => {
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
