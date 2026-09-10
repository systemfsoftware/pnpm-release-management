import {
  Count,
  type CycleEntry,
  CycleStore,
  type FsPath,
  type PackageName,
  type PlanRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export type FakeCycleState = {
  readonly captured: Map<FsPath, ReadonlyArray<CycleEntry>>
  readonly deferred: Array<PackageName>
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

export const makeFakeCycleStore = (
  captured: ReadonlyMap<FsPath, ReadonlyArray<CycleEntry>> = new Map(),
  deferred: ReadonlyArray<PackageName> = [],
): { readonly layer: Layer.Layer<CycleStore>; readonly state: FakeCycleState } => {
  const liveCaptured = new Map(captured)
  const liveDeferred = [...deferred]
  const layer = Layer.succeed(CycleStore, {
    readCaptured: (path: FsPath) =>
      Effect.suspend(() => {
        const found = liveCaptured.get(path)
        return found === undefined
          ? Effect.fail({ _tag: 'PlanCapturedMalformed', path } as const)
          : Effect.succeed(found)
      }),
    writeCaptured: (path: FsPath, cycle: ReadonlyArray<CycleEntry>) =>
      Effect.flatMap(
        mustBrand(Count, cycle.length),
        (count): Effect.Effect<Count, PlanRefusal> => {
          liveCaptured.set(path, [...cycle])
          return Effect.succeed(count)
        },
      ),
    readDeferred: (_source?: FsPath | undefined) => Effect.succeed([...liveDeferred]),
    writeDeferred: (_path: FsPath, next: ReadonlyArray<PackageName>) =>
      Effect.flatMap(
        mustBrand(Count, next.length),
        (count): Effect.Effect<Count, PlanRefusal> => {
          liveDeferred.length = 0
          liveDeferred.push(...next)
          return Effect.succeed(count)
        },
      ),
  })
  return { layer, state: { captured: liveCaptured, deferred: liveDeferred } }
}
