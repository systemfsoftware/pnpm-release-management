import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type PackageVersion,
  type RelativePath,
  SurfaceStore,
  SyncDecision,
  type SyncRefusal,
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

type LocalSyncDecision = LocalSyncAligned | LocalSyncRealigned

type SyncRaw = {
  readonly input: SyncInput
  readonly expected: PackageVersion
  readonly entries: ReadonlyArray<{
    readonly file: RelativePath
    readonly found: PackageVersion
  }>
  readonly count: number
}

const read = (
  input: SyncInput,
): Effect.Effect<SyncRaw, VersionRefusal, SurfaceStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const expected = yield* surfaces.readSurface(input.manifest.file, input.manifest.surface)
    const entries = yield* Effect.forEach(input.surfaces, (surface) =>
      Effect.map(
        surfaces.readSurface(surface.file, surface.surface),
        (found) => ({ file: surface.file, found }),
      ))
    return { input, expected, entries, count: input.surfaces.length }
  })

const decode = (raw: SyncRaw) =>
  S.decodeUnknownResult(SyncCommand)({
    _tag: 'SyncCommand',
    strategy: raw.input.strategy,
    action: raw.input.action,
    pinned: raw.input.version,
    expected: raw.expected,
    manifestFile: raw.input.manifest.file,
    entries: raw.entries,
    count: raw.count,
  })

const encode = (
  outcome: Result.Result<LocalSyncDecision, SyncRefusal>,
): Result.Result<LocalSyncDecision, SyncRefusal> => outcome

const write = (
  output: Result.Result<LocalSyncDecision, SyncRefusal>,
  raw: SyncRaw,
): Effect.Effect<SyncDecision, SyncRefusal | VersionRefusal, SurfaceStore> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Effect.flatMap(
    S.decodeUnknownEffect(SyncDecision)(output.success).pipe(Effect.orDie),
    (decision) =>
      Match.value(decision).pipe(
        Match.tag('SyncAligned', (aligned) => Effect.succeed(aligned)),
        Match.tag('SyncRealigned', (realigned) =>
          Effect.gen(function*() {
            const surfaces = yield* SurfaceStore
            yield* surfaces.writeSurface(raw.input.manifest.file, raw.input.manifest.surface, realigned.version)
            yield* Effect.forEach(
              raw.input.surfaces,
              (surface) => surfaces.writeSurface(surface.file, surface.surface, realigned.version),
              { discard: true },
            )
            return realigned
          })),
        Match.exhaustive,
      ),
  )
}

export const syncCell = Cell.layer({
  read,
  decode,
  decide: syncSurfaces,
  encode,
  write,
})
