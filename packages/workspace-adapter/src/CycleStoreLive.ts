import {
  Count,
  CycleEntry,
  CycleStore,
  type FsPath,
  PackageName,
  type PlanRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export const CycleStoreLive: Layer.Layer<CycleStore> = Layer.succeed(CycleStore)({
  readCaptured: (path: FsPath) =>
    Effect.gen(function*() {
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(path),
        catch: (): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path }),
      })
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return yield* Effect.fail({ _tag: 'PlanCapturedMalformed', path } as const)
      }
      return yield* S.decodeUnknownEffect(S.Array(CycleEntry))(parsed).pipe(
        Effect.mapError((): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path })),
      )
    }),

  writeCaptured: (path: FsPath, cycle: ReadonlyArray<CycleEntry>) =>
    Effect.gen(function*() {
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(path, `${JSON.stringify(cycle, null, 2)}\n`),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.fail({ _tag: 'PlanCapturedMalformed', path } as const)
            : Effect.die(error)
        ),
      )
      return yield* S.decodeUnknownEffect(Count)(cycle.length).pipe(Effect.orDie)
    }),

  readDeferred: (source?: FsPath | undefined) =>
    Effect.gen(function*() {
      if (source === undefined) return []
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(source),
        catch: (): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path: source }),
      })
      const deferred: Array<PackageName> = []
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        deferred.push(
          yield* S.decodeUnknownEffect(PackageName)(trimmed).pipe(
            Effect.mapError((): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path: source })),
          ),
        )
      }
      return deferred
    }),

  writeDeferred: (path: FsPath, deferred: ReadonlyArray<PackageName>) =>
    Effect.gen(function*() {
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(path, deferred.length === 0 ? '' : `${deferred.join('\n')}\n`),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.fail({ _tag: 'PlanCapturedMalformed', path } as const)
            : Effect.die(error)
        ),
      )
      return yield* S.decodeUnknownEffect(Count)(deferred.length).pipe(Effect.orDie)
    }),
})
