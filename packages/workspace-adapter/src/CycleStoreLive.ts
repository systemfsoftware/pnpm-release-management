import {
  Count,
  CycleEntry,
  CycleStore,
  type FsPath,
  PackageName,
  type PlanRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

export const CycleStoreLive: Layer.Layer<CycleStore, never, FileSystem> = Layer.effect(
  CycleStore,
  Effect.map(FileSystem, (fs) => ({
    readCaptured: (cyclePath: FsPath) =>
      Effect.gen(function*() {
        const text = yield* fs.readFileString(cyclePath).pipe(
          Effect.catchTag(
            'PlatformError',
            (): Effect.Effect<never, PlanRefusal> =>
              Effect.fail({ _tag: 'PlanCapturedMalformed', path: cyclePath } as const),
          ),
        )
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return yield* Effect.fail({ _tag: 'PlanCapturedMalformed', path: cyclePath } as const)
        }
        return yield* S.decodeUnknownEffect(S.Array(CycleEntry))(parsed).pipe(
          Effect.mapError((): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path: cyclePath })),
        )
      }),

    writeCaptured: (cyclePath: FsPath, cycle: ReadonlyArray<CycleEntry>) =>
      Effect.gen(function*() {
        yield* fs.writeFileString(cyclePath, `${JSON.stringify(cycle, null, 2)}\n`).pipe(
          Effect.catchTag('PlatformError', (error) =>
            Match.value(error.reason).pipe(
              Match.tag('NotFound', () => Effect.fail({ _tag: 'PlanCapturedMalformed', path: cyclePath } as const)),
              Match.orElse(() => Effect.die(error)),
            )),
        )
        return yield* S.decodeUnknownEffect(Count)(cycle.length).pipe(Effect.orDie)
      }),

    readDeferred: (source?: FsPath) =>
      Effect.gen(function*() {
        if (source === undefined) return []
        const text = yield* fs.readFileString(source).pipe(
          Effect.catchTag(
            'PlatformError',
            (): Effect.Effect<never, PlanRefusal> =>
              Effect.fail({ _tag: 'PlanCapturedMalformed', path: source } as const),
          ),
        )
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

    writeDeferred: (deferredPath: FsPath, deferred: ReadonlyArray<PackageName>) =>
      Effect.gen(function*() {
        let text = `${deferred.join('\n')}\n`
        if (deferred.length === 0) {
          text = ''
        }
        yield* fs.writeFileString(deferredPath, text).pipe(
          Effect.catchTag('PlatformError', (error) =>
            Match.value(error.reason).pipe(
              Match.tag('NotFound', () => Effect.fail({ _tag: 'PlanCapturedMalformed', path: deferredPath } as const)),
              Match.orElse(() => Effect.die(error)),
            )),
        )
        return yield* S.decodeUnknownEffect(Count)(deferred.length).pipe(Effect.orDie)
      }),
  })),
)
