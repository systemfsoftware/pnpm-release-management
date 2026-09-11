import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type PackageVersion,
  type RelativePath,
  SurfaceStore,
  type SyncActionUnknown,
  SyncAligned,
  type SyncDecision,
  SyncRealigned,
  type SyncRefusal,
  type SyncStrategyMismatch,
  type SyncSurfacesDrifted,
  type SyncVersionMissing,
  type VersionRefusal,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  type SyncAligned as LocalSyncAligned,
  type SyncRealigned as LocalSyncRealigned,
  syncSurfaces,
} from './sync-surfaces.workflow.js'
import { SyncCommand, type SyncInput } from './sync.schema.js'

class RawSync {
  constructor(
    readonly request: SyncInput,
    readonly expected: PackageVersion,
    readonly entries: ReadonlyArray<{
      readonly file: RelativePath
      readonly found: PackageVersion
    }>,
  ) {}
}

const read = (
  request: SyncInput,
): Effect.Effect<RawSync, VersionRefusal, SurfaceStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const expected = yield* surfaces.readSurface(request.manifest.file, request.manifest.surface)
    const entries = yield* Effect.forEach(request.surfaces, (surface) =>
      Effect.map(
        surfaces.readSurface(surface.file, surface.surface),
        (found) => ({ file: surface.file, found }),
      ))
    return new RawSync(request, expected, entries)
  })

const decode = (raw: RawSync) =>
  S.decodeUnknownResult(SyncCommand)({
    _tag: 'SyncCommand',
    strategy: raw.request.strategy,
    action: raw.request.action,
    pinned: raw.request.version,
    expected: raw.expected,
    manifestFile: raw.request.manifest.file,
    entries: [...raw.entries],
    count: raw.request.surfaces.length,
  })

const toDecision = (decision: LocalSyncAligned | LocalSyncRealigned): SyncDecision =>
  Match.value(decision).pipe(
    Match.tag(
      'SyncAligned',
      (aligned) => SyncAligned.make({ version: aligned.version, surfaces: aligned.surfaces }),
    ),
    Match.tag(
      'SyncRealigned',
      (realigned) => SyncRealigned.make({ version: realigned.version, rewritten: [...realigned.rewritten] }),
    ),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    LocalSyncAligned | LocalSyncRealigned,
    SyncStrategyMismatch | SyncSurfacesDrifted | SyncVersionMissing | SyncActionUnknown
  >,
): Result.Result<
  SyncDecision,
  SyncStrategyMismatch | SyncSurfacesDrifted | SyncVersionMissing | SyncActionUnknown
> => Result.map(outcome, toDecision)

const write = (
  output: Result.Result<SyncDecision, SyncRefusal>,
  raw: RawSync,
): Effect.Effect<SyncDecision, SyncRefusal | VersionRefusal, SurfaceStore> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Match.value(output.success).pipe(
    Match.tag('SyncAligned', (aligned) => Effect.succeed(aligned)),
    Match.tag('SyncRealigned', (realigned) =>
      Effect.gen(function*() {
        const surfaces = yield* SurfaceStore
        yield* surfaces.writeSurface(
          raw.request.manifest.file,
          raw.request.manifest.surface,
          realigned.version,
        )
        yield* Effect.forEach(
          raw.request.surfaces,
          (surface) => surfaces.writeSurface(surface.file, surface.surface, realigned.version),
          { discard: true },
        )
        return realigned
      })),
    Match.exhaustive,
  )
}

export const syncCell = Cell.layer({
  read,
  decode,
  decide: syncSurfaces,
  encode,
  write,
})
