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
  type VersionRefusal,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { PinnedManifest, PinRootManifestCommand, type PinRootManifestInput } from './pin-root-manifest.schema.ts'
import {
  pinRootManifest,
  type WorkspaceVersionAlreadyCurrent as LocalAlreadyCurrent,
  type WorkspaceVersionRepinned as LocalRepinned,
} from './pin-root-manifest.workflow.ts'

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

const describeCause = (cause: unknown): string => cause instanceof Error ? cause.message : 'unparseable JSON'

const read = (
  input: PinRootManifestInput,
): Effect.Effect<PinRaw, MemberRefusal | PinManifestInvalid, WorkspaceStore> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const file = yield* workspace.readFileFromRoot(input.manifest)
    const path: FsPath = yield* mustBrand(FsPath, input.manifest)
    const parsed: unknown = yield* Effect.try({
      try: () => JSON.parse(file.text),
      catch: (cause): PinManifestInvalid => ({
        _tag: 'PinManifestInvalid',
        path,
        reason: describeCause(cause),
      }),
    })
    return { input, text: file.text, parsed, root: workspace.root }
  })

const decode = (raw: PinRaw) =>
  Result.flatMap(
    S.decodeUnknownResult(S.Record(S.String, S.Unknown))(raw.parsed),
    (manifest) =>
      Result.flatMap(
        S.decodeUnknownResult(PinnedManifest)(manifest),
        (pinned) =>
          Result.map(
            S.decodeUnknownResult(S.Array(PinName))(
              raw.input.suffixes === undefined
                ? []
                : raw.input.suffixes.map((suffix) => `${pinned.name}-${suffix}`),
            ),
            (pinNames) =>
              PinRootManifestCommand.make({
                _tag: 'PinRootManifestCommand',
                manifestText: raw.text,
                manifest,
                packageName: pinned.name,
                indent: pinIndentOf(raw.text),
                trailingNewline: raw.text.endsWith('\n'),
                requestedVersion: raw.input.requestedVersion,
                requestedUsable: raw.input.requestedVersion === undefined
                  ? undefined
                  : Result.getOrUndefined(S.decodeUnknownResult(PackageVersion)(raw.input.requestedVersion)),
                declaredVersion: pinned.version,
                declaredUsable: pinned.version === undefined
                  ? undefined
                  : Result.getOrUndefined(S.decodeUnknownResult(PackageVersion)(pinned.version)),
                suffixes: raw.input.suffixes === undefined ? undefined : [...raw.input.suffixes],
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
      Effect.gen(function*() {
        if (decision._tag === 'WorkspaceVersionAlreadyCurrent') return decision
        if (raw.input.dryRun === true) return decision
        const surfaces = yield* SurfaceStore
        yield* surfaces.writeRootManifest(raw.input.manifest, decision.text)
        return decision
      }),
  )
}

export const pinRootManifestCell = Cell.layer({
  read,
  decode,
  decide: pinRootManifest,
  encode,
  write,
})
