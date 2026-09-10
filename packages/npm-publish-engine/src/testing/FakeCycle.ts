import * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export interface FakeCycleEntry {
  readonly name: string
  readonly version: string
}

export interface FakeCycleSeed {
  readonly captured?: Record<string, ReadonlyArray<FakeCycleEntry>>
  readonly malformed?: ReadonlyArray<string>
  readonly deferred?: ReadonlyArray<string>
}

export interface FakeCycleWrite {
  readonly path: string
  readonly size: number
}

export interface FakeCycle {
  readonly layer: Layer.Layer<Lang.CycleStore>
  readonly writes: Array<FakeCycleWrite>
}

export const makeFakeCycleStore = (seed: FakeCycleSeed = {}): FakeCycle => {
  const captured = seed.captured ?? {}
  const malformed: Record<string, true> = Object.fromEntries(
    (seed.malformed ?? []).map((path): [string, true] => [path, true]),
  )
  const deferred = seed.deferred ?? []
  const writes: Array<FakeCycleWrite> = []

  const layer = Layer.succeed(Lang.CycleStore, {
    readCaptured: (path) => {
      const entries = captured[path]
      if (entries === undefined || malformed[path] === true) {
        return Effect.fail(
          S.decodeSync(Lang.PlanCapturedMalformed)({ _tag: 'PlanCapturedMalformed', path }),
        )
      }
      return Effect.succeed(
        entries.map((entry) => ({
          name: S.decodeSync(Lang.PackageName)(entry.name),
          version: S.decodeSync(Lang.PackageVersion)(entry.version),
          tag: S.decodeSync(Lang.ReleaseTag)(`${entry.name}@${entry.version}`),
          changelog: S.decodeSync(Lang.RelativePath)('CHANGELOG.md'),
        })),
      )
    },
    writeCaptured: (path, cycle) => {
      writes.push({ path, size: cycle.length })
      return Effect.succeed(S.decodeSync(Lang.Count)(cycle.length))
    },
    readDeferred: (_source) => Effect.succeed(deferred.map((name) => S.decodeSync(Lang.PackageName)(name))),
    writeDeferred: (path, names) => {
      writes.push({ path, size: names.length })
      return Effect.succeed(S.decodeSync(Lang.Count)(names.length))
    },
  })

  return { layer, writes }
}
