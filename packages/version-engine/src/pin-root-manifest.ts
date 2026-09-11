import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  FsPath,
  type MemberRefusal,
  PackageVersion,
  PinDecision,
  type PinManifestInvalid,
  PinName,
  type PinRefusal,
  type RepoRoot,
  SurfaceStore,
  type TargetSuffix,
  type VersionRefusal,
  WorkspaceStore,
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

type LocalPinDecision = LocalRepinned | LocalAlreadyCurrent

type PinRaw = {
  readonly input: PinRootManifestInput
  readonly text: string
  readonly parsed: unknown
  readonly root: RepoRoot
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

const pinIndentOf = (text: string): string | number => text.match(INDENT)?.[1] ?? 2

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  return 'unparseable JSON'
}

const read = (
  input: PinRootManifestInput,
): Effect.Effect<PinRaw, MemberRefusal | PinManifestInvalid, WorkspaceStore> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const file = yield* workspace.readFileFromRoot(input.manifest)
    const path: FsPath = yield* mustBrand(FsPath, input.manifest)
    const parsed: unknown = yield* Effect.try({
      try: (): unknown => JSON.parse(file.text),
      catch: (cause): PinManifestInvalid => ({
        _tag: 'PinManifestInvalid',
        path,
        reason: describeCause(cause),
      }),
    })
    return { input, text: file.text, parsed, root: workspace.root }
  })

const suffixNamesOf = (
  suffixes: ReadonlyArray<string> | undefined,
  name: string,
): ReadonlyArray<string> => {
  if (suffixes === undefined) return []
  return suffixes.map((suffix) => `${name}-${suffix}`)
}

const requestedUsableOf = (requestedVersion: string | undefined): PackageVersion | undefined => {
  if (requestedVersion === undefined) return undefined
  return Result.getOrUndefined(S.decodeUnknownResult(PackageVersion)(requestedVersion))
}

const declaredUsableOf = (declaredVersion: string | undefined): PackageVersion | undefined => {
  if (declaredVersion === undefined) return undefined
  return Result.getOrUndefined(S.decodeUnknownResult(PackageVersion)(declaredVersion))
}

const suffixesCopyOf = (
  suffixes: ReadonlyArray<TargetSuffix> | undefined,
): ReadonlyArray<TargetSuffix> | undefined => {
  if (suffixes === undefined) return undefined
  return [...suffixes]
}

const decode = (raw: PinRaw) =>
  Result.flatMap(
    S.decodeUnknownResult(S.Record(S.String, S.Unknown))(raw.parsed),
    (manifest) =>
      Result.flatMap(
        S.decodeUnknownResult(PinnedManifest)(manifest),
        (pinned) =>
          Result.map(
            S.decodeUnknownResult(S.Array(PinName))(suffixNamesOf(raw.input.suffixes, pinned.name)),
            (pinNames) =>
              PinRootManifestCommand.make({
                _tag: 'PinRootManifestCommand',
                manifestText: raw.text,
                manifest,
                packageName: pinned.name,
                indent: pinIndentOf(raw.text),
                trailingNewline: raw.text.endsWith('\n'),
                requestedVersion: raw.input.requestedVersion,
                requestedUsable: requestedUsableOf(raw.input.requestedVersion),
                declaredVersion: pinned.version,
                declaredUsable: declaredUsableOf(pinned.version),
                suffixes: suffixesCopyOf(raw.input.suffixes),
                pinNames,
                repoRoot: raw.root,
              }),
          ),
      ),
  )
const encode = (
  outcome: Result.Result<LocalPinDecision, PinRefusal>,
): Result.Result<LocalPinDecision, PinRefusal> => outcome

const write = (
  output: Result.Result<LocalPinDecision, PinRefusal>,
  raw: PinRaw,
): Effect.Effect<PinDecision, PinRefusal | VersionRefusal, SurfaceStore> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Effect.flatMap(
    S.decodeUnknownEffect(PinDecision)(output.success).pipe(Effect.orDie),
    (decision) =>
      Match.value(decision).pipe(
        Match.tag('WorkspaceVersionAlreadyCurrent', (current) => Effect.succeed(current)),
        Match.tag('WorkspaceVersionRepinned', (repinned) =>
          Effect.gen(function*() {
            if (raw.input.dryRun === true) return repinned
            const surfaces = yield* SurfaceStore
            yield* surfaces.writeRootManifest(raw.input.manifest, repinned.text)
            return repinned
          })),
        Match.exhaustive,
      ),
  )
}

export const pinRootManifestCell = Cell.layer({
  read,
  decode,
  decide: pinRootManifest,
  encode,
  write,
})
