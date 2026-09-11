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
import * as S from 'effect/Schema'
import { CapturedText } from './Cycle.schema.js'
import { readTextFile, writeTextFile } from './StoreFile.js'

const capturedDocument = (cycle: ReadonlyArray<CycleEntry>): string => `${JSON.stringify(cycle, null, 2)}\n`

const deferredDocument = (deferred: ReadonlyArray<PackageName>): string => {
  if (deferred.length === 0) return ''
  return `${deferred.join('\n')}\n`
}

export const CycleStoreLive: Layer.Layer<CycleStore, never, FileSystem> = Layer.effect(
  CycleStore,
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const malformed = (file: FsPath): PlanRefusal => ({ _tag: 'PlanCapturedMalformed', path: file })

    const readCaptured = (file: FsPath): Effect.Effect<ReadonlyArray<CycleEntry>, PlanRefusal> =>
      Effect.gen(function*() {
        const text = yield* readTextFile(fs, file).pipe(Effect.mapError(() => malformed(file)))
        return yield* S.decodeUnknownEffect(CapturedText)(text).pipe(Effect.mapError(() => malformed(file)))
      })

    const writeCaptured = (file: FsPath, cycle: ReadonlyArray<CycleEntry>): Effect.Effect<Count, PlanRefusal> =>
      writeTextFile(fs, file, capturedDocument(cycle), 'overwrite').pipe(
        Effect.mapError(() => malformed(file)),
        Effect.as(Count.make(cycle.length)),
      )

    const readDeferred = (source?: FsPath): Effect.Effect<ReadonlyArray<PackageName>, PlanRefusal> =>
      Effect.gen(function*() {
        if (source === undefined) return []
        const text = yield* readTextFile(fs, source).pipe(Effect.mapError(() => malformed(source)))
        const deferred: Array<PackageName> = []
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed === '') continue
          deferred.push(
            yield* S.decodeUnknownEffect(PackageName)(trimmed).pipe(Effect.mapError(() => malformed(source))),
          )
        }
        return deferred
      })

    const writeDeferred = (file: FsPath, deferred: ReadonlyArray<PackageName>): Effect.Effect<Count, PlanRefusal> =>
      writeTextFile(fs, file, deferredDocument(deferred), 'overwrite').pipe(
        Effect.mapError(() => malformed(file)),
        Effect.as(Count.make(deferred.length)),
      )

    return { readCaptured, writeCaptured, readDeferred, writeDeferred }
  }),
)
