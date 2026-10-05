import { Cell } from '@systemfsoftware/effect-cell-types'
import { Count, PackageVersion, SurfaceStore, type VersionRefusal } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type SyncDecision, type SyncRefusal, syncSurfaces } from './sync-surfaces.workflow.js'
import { SyncCommand, type SyncInput } from './sync.schema.js'

const pinnedOf = (
  given: string | undefined,
): Result.Result<PackageVersion | undefined, S.SchemaError> => {
  if (given === undefined) return Result.succeed(undefined)
  return S.decodeUnknownResult(PackageVersion)(given)
}

const read = (
  request: SyncInput,
): Effect.Effect<SyncCommand, VersionRefusal | S.SchemaError, SurfaceStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const expected = yield* surfaces.readSurface(request.manifest.file, request.manifest.surface)
    const pinned = yield* Effect.fromResult(pinnedOf(request.version))
    const entries = yield* Effect.forEach(request.surfaces, (surface) =>
      Effect.map(
        surfaces.readSurface(surface.file, surface.surface),
        (found) => ({ file: surface.file, surface: surface.surface, found }),
      ))
    return SyncCommand.make({
      strategy: request.strategy,
      action: request.action,
      pinned,
      expected,
      manifest: request.manifest,
      entries: [...entries],
      count: Count.make(request.surfaces.length),
    })
  })

const write = (
  output: Result.Result<SyncDecision, SyncRefusal>,
  command: SyncCommand,
): Effect.Effect<SyncDecision, SyncRefusal | VersionRefusal, SurfaceStore> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Match.value(output.success).pipe(
    Match.tag('SyncAligned', (aligned) => Effect.succeed(aligned)),
    Match.tag('SyncRealigned', (realigned) =>
      Effect.gen(function*() {
        const surfaces = yield* SurfaceStore
        yield* surfaces.writeSurface(
          command.manifest.file,
          command.manifest.surface,
          realigned.version,
        )
        yield* Effect.forEach(
          command.entries,
          (entry) => surfaces.writeSurface(entry.file, entry.surface, realigned.version),
          { discard: true },
        )
        return realigned
      })),
    Match.exhaustive,
  )
}

export const syncCell = Cell.layer({
  read,
  decide: syncSurfaces,
  write,
})
