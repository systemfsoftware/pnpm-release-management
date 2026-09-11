import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  FsPath,
  type MemberRefusal,
  PackageVersion,
  type PinDecision,
  type PinDistributionMissing,
  type PinManifestInvalid,
  PinName,
  type PinRefusal,
  type PinVersionUnusable,
  type RepoRoot,
  SurfaceStore,
  type TargetSuffix,
  type VersionRefusal,
  WorkspaceStore,
  WorkspaceVersionAlreadyCurrent,
  WorkspaceVersionRepinned,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { PinnedManifest, PinRootManifestCommand, type PinRootManifestInput } from './pin-root-manifest.schema.js'
import {
  pinRootManifest,
  type WorkspaceVersionAlreadyCurrent as LocalAlreadyCurrent,
  type WorkspaceVersionRepinned as LocalRepinned,
} from './pin-root-manifest.workflow.js'

const INDENT = /^(\s+)"/m

class RawPin {
  constructor(
    readonly request: PinRootManifestInput,
    readonly text: string,
    readonly root: RepoRoot,
  ) {}
}

const read = (
  request: PinRootManifestInput,
): Effect.Effect<RawPin, MemberRefusal, WorkspaceStore> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const file = yield* workspace.readFileFromRoot(request.manifest)
    return new RawPin(request, file.text, workspace.root)
  })

const pinIndentOf = (text: string): string | number => text.match(INDENT)?.[1] ?? 2

const availableVersionOf = (given: string | undefined): PackageVersion | undefined => {
  if (given === undefined) return undefined
  return Result.getOrUndefined(S.decodeUnknownResult(PackageVersion)(given))
}

const suffixesCopyOf = (
  suffixes: ReadonlyArray<TargetSuffix> | undefined,
): ReadonlyArray<TargetSuffix> | undefined => {
  if (suffixes === undefined) return undefined
  return [...suffixes]
}

const suffixNamesOf = (
  suffixes: ReadonlyArray<TargetSuffix> | undefined,
  name: string,
): ReadonlyArray<string> => {
  if (suffixes === undefined) return []
  return suffixes.map((suffix) => `${name}-${suffix}`)
}

const decode = (raw: RawPin) =>
  Result.flatMap(
    Result.mapError(
      S.decodeUnknownResult(S.fromJsonString(S.Unknown))(raw.text),
      (error): PinManifestInvalid => ({
        _tag: 'PinManifestInvalid',
        path: FsPath.make(raw.request.manifest),
        reason: error.message,
      }),
    ),
    (parsed) =>
      Result.flatMap(
        S.decodeUnknownResult(S.Record(S.String, S.Unknown))(parsed),
        (manifest) =>
          Result.flatMap(
            S.decodeUnknownResult(PinnedManifest)(manifest),
            (pinned) =>
              Result.map(
                S.decodeUnknownResult(S.Array(PinName))(
                  suffixNamesOf(raw.request.suffixes, pinned.name),
                ),
                (pinNames) =>
                  PinRootManifestCommand.make({
                    _tag: 'PinRootManifestCommand',
                    manifestText: raw.text,
                    manifest,
                    packageName: pinned.name,
                    indent: pinIndentOf(raw.text),
                    trailingNewline: raw.text.endsWith('\n'),
                    requestedVersion: raw.request.requestedVersion,
                    requestedUsable: availableVersionOf(raw.request.requestedVersion),
                    declaredVersion: pinned.version,
                    declaredUsable: availableVersionOf(pinned.version),
                    suffixes: suffixesCopyOf(raw.request.suffixes),
                    pinNames,
                    repoRoot: raw.root,
                  }),
              ),
          ),
      ),
  )

const toDecision = (decision: LocalRepinned | LocalAlreadyCurrent): PinDecision =>
  Match.value(decision).pipe(
    Match.tag(
      'WorkspaceVersionRepinned',
      (repinned) =>
        WorkspaceVersionRepinned.make({
          version: repinned.version,
          pins: [...repinned.pins],
          text: repinned.text,
        }),
    ),
    Match.tag(
      'WorkspaceVersionAlreadyCurrent',
      (current) =>
        WorkspaceVersionAlreadyCurrent.make({
          version: current.version,
          pins: [...current.pins],
          text: current.text,
        }),
    ),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    LocalRepinned | LocalAlreadyCurrent,
    PinVersionUnusable | PinDistributionMissing
  >,
): Result.Result<PinDecision, PinVersionUnusable | PinDistributionMissing> => Result.map(outcome, toDecision)

const write = (
  output: Result.Result<PinDecision, PinRefusal>,
  raw: RawPin,
): Effect.Effect<PinDecision, PinRefusal | VersionRefusal, SurfaceStore> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Match.value(output.success).pipe(
    Match.tag('WorkspaceVersionAlreadyCurrent', (current) => Effect.succeed(current)),
    Match.tag('WorkspaceVersionRepinned', (repinned) =>
      Effect.gen(function*() {
        if (raw.request.dryRun === true) return repinned
        const surfaces = yield* SurfaceStore
        yield* surfaces.writeRootManifest(raw.request.manifest, repinned.text)
        return repinned
      })),
    Match.exhaustive,
  )
}

export const pinRootManifestCell = Cell.layer({
  read,
  decode,
  decide: pinRootManifest,
  encode,
  write,
})
