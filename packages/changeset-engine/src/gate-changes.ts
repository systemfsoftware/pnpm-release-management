import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  type BaseIntent,
  ChangeEvidencePort,
  type ChangeEvidenceRefusal,
  type ChangeRange,
  ChangesetStore,
  type ConfigRefusal,
  FsPath,
  GitRef,
  type Intent,
  type IntentRefusal,
  isIntentPath,
  type MemberRefusal,
  parseIntentDocument,
  RelativePath,
  type ReleaseCandidate,
  type ReleaseCheck,
  type ReleaseConfig,
  ReleaseConfigStore,
  ReleaseReplayPort,
  RepoRoot,
  TaskName,
  type TurboComparison,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  type ChangesGated,
  type ChangesVacant,
  gateChanges,
  GateCommand,
  type GateDecisionRefusal,
} from './gate-changes.workflow.js'
import { changedPathsOf, type IntentDirs, releaseCandidatesOf, staleSurfacesOf } from './release-commits.js'

const GateRequest = Wire.wire({
  root: Wire.mint(RepoRoot),
  ref: Wire.mint(GitRef),
  changesetDir: Wire.mint(RelativePath),
  strategy: Wire.mint(S.Literals(['paths', 'turbo'])),
  task: Wire.mint(S.optional(TaskName)),
  skipLiveness: Wire.mint(S.optional(S.Boolean)),
})

export interface GateReport {
  readonly ok: boolean
  readonly text: string
}

type GateRequestInput = S.Schema.Type<typeof GateRequest>

type GateReadError =
  | ChangeEvidenceRefusal
  | ConfigRefusal
  | MemberRefusal
  | IntentRefusal

type GateVerdict = Result.Result<ChangesVacant | ChangesGated, GateDecisionRefusal>

const CONFIG_FILE = RelativePath.make('release.jsonc')

const buildTask = (): TaskName => TaskName.make('build')

type Requirements = ChangeEvidencePort | ReleaseReplayPort | ReleaseConfigStore | WorkspaceStore | ChangesetStore

interface BaseRelease {
  readonly changesetDir: RelativePath
  readonly surfaces: ReadonlyArray<string>
}

const surfacePathsOf = (versioning: ReleaseConfig['versioning']): ReadonlyArray<string> => {
  const paths = versioning.surfaces.flatMap((surface): ReadonlyArray<string> => {
    if (surface.path === undefined) return []
    return [surface.path]
  })
  if (versioning.strategy === 'surfaces') return [versioning.manifest, ...paths]
  return paths
}

const baseReleaseOf = (
  request: GateRequestInput,
  range: ChangeRange,
): Effect.Effect<BaseRelease, GateReadError, ChangeEvidencePort | ReleaseConfigStore> =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    const text = yield* port.fileAt(request.root, range.mergeBase, CONFIG_FILE)
    if (text === undefined) return { changesetDir: request.changesetDir, surfaces: [] }
    const store = yield* ReleaseConfigStore
    const config = yield* store.parseConfig(text, FsPath.make(`${range.mergeBase}:${CONFIG_FILE}`))
    return { changesetDir: config.changesetDir, surfaces: surfacePathsOf(config.versioning) }
  })

const checksOf = (
  request: GateRequestInput,
  range: ChangeRange,
  dirs: IntentDirs,
  surfaces: ReadonlyArray<string>,
  candidates: ReadonlyArray<ReleaseCandidate>,
): Effect.Effect<ReadonlyArray<ReleaseCheck>, GateReadError, ChangeEvidencePort | ReleaseReplayPort> =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    const replay = yield* ReleaseReplayPort
    return yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function*() {
        const outcome = yield* replay.replay(request.root, candidate)
        if (candidate.parent === range.mergeBase) return { candidate, outcome, staleSurfaces: [] }
        const since = yield* port.changes(request.root, candidate.parent, range.mergeBase)
        return {
          candidate,
          outcome,
          staleSurfaces: staleSurfacesOf(since.map((change) => change.path), dirs, surfaces),
        }
      }))
  })

const baseIntentsOf = (
  request: GateRequestInput,
  range: ChangeRange,
  paths: ReadonlyArray<RelativePath>,
): Effect.Effect<ReadonlyArray<BaseIntent>, GateReadError, ChangeEvidencePort> =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    return yield* Effect.forEach(paths, (path) =>
      Effect.map(port.fileAt(request.root, range.mergeBase, path), (text): BaseIntent => {
        if (text === undefined) {
          return { path }
        }
        const intent = parseIntentDocument(path, text)
        if (intent === undefined) {
          return { path }
        }
        return { path, packages: intent.packages }
      }))
  })

const owedAtBaseOf = (
  dirs: IntentDirs,
  atBase: ReadonlyArray<RelativePath>,
  touchedAtBase: ReadonlyArray<RelativePath>,
): ReadonlyArray<RelativePath> => {
  if (dirs.base === dirs.head) return touchedAtBase
  return atBase
}

const turboWhenNeeded = (
  request: GateRequestInput,
  range: ChangeRange,
  featureOwned: boolean,
): Effect.Effect<TurboComparison | undefined, GateReadError, ChangeEvidencePort> =>
  Effect.gen(function*() {
    if (request.strategy !== 'turbo' || !featureOwned) return undefined
    const port = yield* ChangeEvidencePort
    return yield* port.turbo(request.root, range, request.task ?? buildTask())
  })

const read = (request: GateRequestInput): Effect.Effect<GateCommand, GateReadError, Requirements> =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    const range = yield* port.range(request.root, request.ref)
    if (request.strategy === 'paths') yield* port.refuseUnderTurbo(request.root, range)
    const commits = yield* port.commits(request.root, range)
    const baseRelease = yield* baseReleaseOf(request, range)
    const dirs: IntentDirs = { base: baseRelease.changesetDir, head: request.changesetDir }
    const atBase = (yield* port.filesIn(request.root, range.mergeBase, dirs.base)).filter((path) =>
      isIntentPath(dirs.base, path)
    )
    const checks = yield* checksOf(
      request,
      range,
      dirs,
      baseRelease.surfaces,
      releaseCandidatesOf(commits, atBase, dirs),
    )
    const net = yield* port.changes(request.root, range.mergeBase, range.head)
    const touchedAtBase = net.map((change) => change.path).filter((path) => atBase.includes(path))
    const baseIntents = yield* baseIntentsOf(request, range, owedAtBaseOf(dirs, atBase, touchedAtBase))
    const workspace = yield* WorkspaceStore
    const store = yield* ChangesetStore
    const members = yield* workspace.listMembers()
    const intents: ReadonlyArray<Intent> = yield* Effect.forEach(
      yield* store.listIntents(),
      (path) => store.readIntent(path),
    )
    const changed = changedPathsOf(commits, checks, net.map((change) => change.path), members)
    const turbo = yield* turboWhenNeeded(request, range, changed.some((change) => !change.released))
    return GateCommand.make({
      members,
      deleted: yield* port.deletedMembers(request.root, range),
      intents,
      baseIntents,
      checks,
      changed,
      turbo,
      skipLiveness: request.skipLiveness,
    })
  })

const missingGuidance = (missing: ReadonlyArray<string>): string =>
  [
    `This change moves ${missing.length} publishable package(s) that no intent names: ${missing.join(', ')}`,
    '',
    'Add a `.changeset/<slug>.md` naming each one — the frontmatter is the intent:',
    '',
    '  ---',
    missing.map((name) => `  "${name}": patch`).join('\n'),
    '  ---',
    '',
    '  <one line saying what changed for a consumer>',
    '',
    'Bumps are none | patch | minor | major. `none` records a touch that releases nothing;',
    'a devDependency-only or script-only bump is the canonical `none` class.',
  ].join('\n')

const remainingText = (remaining: string | undefined): string => {
  if (remaining === undefined) return 'no live intent names it'
  return `live intents carry only ${remaining}`
}

const refused = (text: string): GateReport => ({ ok: false, text })

const refusalReport = (refusal: GateDecisionRefusal): GateReport =>
  Match.value(refusal).pipe(
    Match.tag('GateReleaseUnreplayable', (unreplayable) =>
      refused(
        `changeset gate: release commit ${unreplayable.commit} deletes intents but the bump cannot replay it: ${unreplayable.reason}`,
      )),
    Match.tag('GateReleaseDiverged', (diverged) =>
      refused(
        [
          `changeset gate: release commit ${diverged.commit} is not what the bump writes from its parent and the intents it consumed.`,
          'These paths differ from the replayed release:',
          ...diverged.paths.map((path) => `  ${path}`),
          'Regenerate the release commit with `version-management bump`, or move other edits into their own commit.',
        ].join('\n'),
      )),
    Match.tag('GateReleaseStale', (stale) =>
      refused(
        [
          `changeset gate: release commit ${stale.commit} was cut from an older base, and the base has since changed:`,
          ...stale.paths.map((path) => `  ${path}`),
          'Regenerate the release from the current base.',
        ].join('\n'),
      )),
    Match.tag('GateBaseIntentMalformed', (malformed) =>
      refused(
        `changeset gate: ${malformed.path} is changed or deleted here, but it does not parse at the merge base, so the release it carried cannot be checked`,
      )),
    Match.tag('GateReleaseDropped', (dropped) =>
      refused(
        [
          'changeset gate: this change drops releases that intents at the merge base owe, without a release commit consuming them:',
          ...dropped.dropped.map((entry) =>
            `  ${entry.package}: ${entry.pending} owed by ${entry.intents.join(', ')}; ${
              remainingText(entry.remaining)
            }`
          ),
          'Restore the intent, or carry the same or a higher bump in a live intent.',
        ].join('\n'),
      )),
    Match.tag(
      'GateUnknownPackage',
      (unknown) =>
        refused(`${unknown.path} names non-member package "${unknown.package}" — no workspace package has that name`),
    ),
    Match.tag('GateIntentMissing', (missing) => refused(missingGuidance(missing.packages))),
    Match.exhaustive,
  )

const listLine = (label: string, names: ReadonlyArray<string>): string => {
  if (names.length === 0) return ''
  return `\nchangeset gate: ${names.length} ${label} — ${names.join(', ')}`
}

const decisionReport = (decision: ChangesVacant | ChangesGated): GateReport =>
  Match.value(decision).pipe(
    Match.tag('ChangesVacant', (vacant): GateReport => ({
      ok: true,
      text: `changeset gate: no publishable package changed (${vacant.members.length} member(s))${
        listLine('package(s) released by a verified release commit', vacant.released)
      }${listLine('package(s) deleted, nothing left to release', vacant.deleted)}`,
    })),
    Match.tag('ChangesGated', (gated): GateReport => ({
      ok: true,
      text: `changeset gate: ${gated.touched.length} publishable package(s) changed, each accounted for — ${
        gated.touched.join(', ')
      }${listLine('package(s) released by a verified release commit', gated.released)}${
        listLine('package(s) deleted, nothing left to release', gated.deleted)
      }`,
    })),
    Match.exhaustive,
  )

const reportOf = (outcome: GateVerdict): GateReport =>
  Result.match(outcome, { onFailure: refusalReport, onSuccess: decisionReport })

export const gateChangesCell = Cell.layer({
  read,
  decide: gateChanges,
  write: (outcome: GateVerdict) => Effect.succeed(reportOf(outcome)),
})
