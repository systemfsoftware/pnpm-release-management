import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type {
  CycleEntry,
  MemberRefusal,
  PackageName,
  PlanDeferredUnknown,
  TagRefusal,
  TarballRefusal,
} from '@systemfsoftware/release-language'
import {
  CycleStore,
  FsPath,
  GitPort,
  RelativePath,
  RemoteName,
  type TarballDigest,
  TarballMissing,
  TarballPort,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf, dropExcluded } from './cycle.js'
import {
  type TagAnnotation,
  TagCapturedMalformed,
  TagCommand,
  type TagDecision,
  tagPackages,
  type TagPushed,
} from './tag-packages.workflow.js'

export const TagRequest = Wire.wire({
  captured: Wire.mint(S.optional(FsPath)),
  capturedFile: Wire.mint(S.optional(FsPath)),
  exclude: Wire.mint(S.optional(FsPath)),
  output: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  tarballs: Wire.mint(FsPath),
  dryRun: Wire.mint(S.Boolean),
  json: Wire.mint(S.Boolean),
  changelogDir: Wire.mint(RelativePath),
})

interface ExclusionScan {
  readonly names: ReadonlyArray<PackageName>
  readonly issue: FsPath | undefined
}

interface CycleScan {
  readonly entries: ReadonlyArray<CycleEntry>
  readonly issue: FsPath | undefined
}

const readExclusion = (
  cycles: CycleStore,
  source: FsPath | undefined,
): Effect.Effect<ExclusionScan, PlanDeferredUnknown, never> =>
  Effect.matchEffect(cycles.readDeferred(source), {
    onFailure: (refusal) =>
      Match.value(refusal).pipe(
        Match.tag('PlanCapturedMalformed', (malformed) => Effect.succeed({ names: [], issue: malformed.path })),
        Match.tag('PlanDeferredUnknown', (unknown) => Effect.fail(unknown)),
        Match.exhaustive,
      ),
    onSuccess: (names) => Effect.succeed({ names: [...names], issue: undefined }),
  })

const readCaptured = (
  cycles: CycleStore,
  path: FsPath,
  excluded: ReadonlyArray<PackageName>,
): Effect.Effect<CycleScan, PlanDeferredUnknown, never> =>
  Effect.matchEffect(cycles.readCaptured(path), {
    onFailure: (refusal) =>
      Match.value(refusal).pipe(
        Match.tag('PlanCapturedMalformed', (malformed) => Effect.succeed({ entries: [], issue: malformed.path })),
        Match.tag('PlanDeferredUnknown', (unknown) => Effect.fail(unknown)),
        Match.exhaustive,
      ),
    onSuccess: (entries) => Effect.succeed({ entries: dropExcluded(entries, excluded), issue: undefined }),
  })

const readLive = (input: {
  readonly workspace: WorkspaceStore
  readonly git: GitPort
  readonly remote: RemoteName
  readonly changelogDir: RelativePath
  readonly excluded: ReadonlyArray<PackageName>
}): Effect.Effect<CycleScan, MemberRefusal | TagRefusal, never> =>
  Effect.gen(function*() {
    const members = yield* input.workspace.listMembers()
    const tags = yield* input.git.remoteTags(input.remote)
    return {
      entries: dropExcluded(cycleOf(members, tags, input.changelogDir), input.excluded),
      issue: undefined,
    }
  })

const readCycle = (input: {
  readonly cycles: CycleStore
  readonly workspace: WorkspaceStore
  readonly git: GitPort
  readonly remote: RemoteName
  readonly capturedPath: FsPath | undefined
  readonly changelogDir: RelativePath
  readonly excluded: ReadonlyArray<PackageName>
}): Effect.Effect<CycleScan, MemberRefusal | TagRefusal | PlanDeferredUnknown, never> => {
  const capturedPath = input.capturedPath
  if (capturedPath !== undefined) {
    return readCaptured(input.cycles, capturedPath, input.excluded)
  }
  return readLive(input)
}

const annotationsOf = (
  entries: ReadonlyArray<CycleEntry>,
  digests: ReadonlyArray<TarballDigest>,
): Result.Result<ReadonlyArray<TagAnnotation>, TarballRefusal> => {
  const annotations: Array<TagAnnotation> = []
  for (const entry of entries) {
    const digest = digests.find((candidate) => candidate.name === entry.name && candidate.version === entry.version)
    if (digest === undefined) {
      return Result.fail(TarballMissing.make({ package: entry.name, version: entry.version }))
    }
    annotations.push({
      tag: entry.tag,
      message: JSON.stringify({ integrity: digest.integrity, files: digest.files }),
    })
  }
  return Result.succeed(annotations)
}

const read = (
  request: S.Schema.Type<typeof TagRequest>,
): Effect.Effect<
  TagCommand,
  MemberRefusal | TagRefusal | PlanDeferredUnknown | TarballRefusal,
  WorkspaceStore | GitPort | CycleStore | TarballPort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const tarballs = yield* TarballPort
    const exclusion = yield* readExclusion(cycles, request.exclude)
    const scan = yield* readCycle({
      cycles,
      workspace,
      git,
      remote,
      capturedPath: request.captured ?? request.capturedFile,
      changelogDir: request.changelogDir,
      excluded: exclusion.names,
    })
    let digests: ReadonlyArray<TarballDigest> = []
    if (scan.entries.length > 0) {
      digests = yield* tarballs.read(request.tarballs)
    }
    const annotations = yield* Effect.fromResult(annotationsOf(scan.entries, digests))
    return TagCommand.make({
      cycle: [...scan.entries],
      annotations: [...annotations],
      preview: request.dryRun || request.json || request.output !== undefined,
      capturedIssue: scan.issue,
      excludedIssue: exclusion.issue,
      remote,
      output: request.output,
    })
  })

const captureCycle = (
  raw: TagCommand,
): Effect.Effect<void, TagRefusal | PlanDeferredUnknown, CycleStore> => {
  const output = raw.output
  if (output === undefined) {
    return Effect.void
  }
  return Effect.gen(function*() {
    const cycles = yield* CycleStore
    yield* Effect.mapError(cycles.writeCaptured(output, raw.cycle), (refusal) =>
      Match.value(refusal).pipe(
        Match.tag('PlanCapturedMalformed', (malformed) => TagCapturedMalformed.make({ path: malformed.path })),
        Match.tag('PlanDeferredUnknown', (unknown) => unknown),
        Match.exhaustive,
      ))
  })
}

const pushTags = (raw: TagCommand, pushed: TagPushed): Effect.Effect<TagPushed, TagRefusal, GitPort> =>
  Effect.gen(function*() {
    const git = yield* GitPort
    const remote = yield* git.remoteTags(raw.remote)
    yield* Effect.forEach(
      raw.annotations.filter((annotation) =>
        pushed.tags.includes(annotation.tag) && remote.includes(annotation.tag) === false
      ),
      (annotation) => git.writeTag(annotation.tag, annotation.message),
      { discard: true },
    )
    yield* git.pushTags([...pushed.tags], raw.remote)
    return pushed
  })

const write = (
  outcome: Result.Result<TagDecision, TagRefusal>,
  raw: TagCommand,
): Effect.Effect<TagDecision, TagRefusal | PlanDeferredUnknown, GitPort | CycleStore> => {
  if (Result.isFailure(outcome)) {
    return Effect.fail(outcome.failure)
  }
  const decision = outcome.success
  return Effect.gen(function*() {
    yield* captureCycle(raw)
    return yield* Match.value(decision).pipe(
      Match.tag('TagPushed', (pushed) => pushTags(raw, pushed)),
      Match.tag('TagPreview', (preview) => Effect.succeed(preview)),
      Match.tag('TagUpToDate', (upToDate) => Effect.succeed(upToDate)),
      Match.exhaustive,
    )
  })
}

export const tagCell: Cell.Cell<
  S.Schema.Type<typeof TagRequest>,
  TagDecision,
  MemberRefusal | TagRefusal | PlanDeferredUnknown | TarballRefusal,
  WorkspaceStore | GitPort | CycleStore | TarballPort
> = Cell.layer({
  read,
  decide: tagPackages,
  write,
})
