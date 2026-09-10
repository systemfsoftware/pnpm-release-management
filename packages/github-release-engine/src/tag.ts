import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { CycleEntry, MemberRefusal, PackageName, PlanDeferredUnknown } from '@systemfsoftware/release-language'
import type { TagDecision, TagRefusal } from '@systemfsoftware/release-language'
import {
  Count,
  CycleStore,
  FsPath,
  GitPort,
  RelativePath,
  ReleaseTag,
  RemoteName,
  TagCapturedMalformed,
  TagExcludedMalformed,
  TagPreview,
  TagPushed,
  TagUpToDate,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { computeCycle, dropExcluded, nonEmptyArray } from './cycle.ts'
import {
  type CapturedListMalformed,
  type ExcludedListMalformed,
  TagCommand,
  tagPackages,
  type TagPackagesPreviewed,
  type TagPackagesPushed,
  type TagPackagesUpToDate,
} from './tag-packages.workflow.ts'

export const TagRequest = Wire.wire({
  captured: Wire.mint(S.optional(FsPath)),
  capturedFile: Wire.mint(S.optional(FsPath)),
  exclude: Wire.mint(S.optional(FsPath)),
  output: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  dryRun: Wire.mint(S.Boolean),
  json: Wire.mint(S.Boolean),
  changelogDir: Wire.mint(RelativePath),
})

class RawTag {
  constructor(
    readonly cycle: Array<CycleEntry>,
    readonly remote: RemoteName,
    readonly output: FsPath | undefined,
    readonly preview: boolean,
    readonly capturedIssue: FsPath | undefined,
    readonly excludedIssue: FsPath | undefined,
  ) {}
}

const read = (
  request: S.Schema.Type<typeof TagRequest>,
): Effect.Effect<
  RawTag,
  MemberRefusal | TagRefusal | PlanDeferredUnknown,
  WorkspaceStore | GitPort | CycleStore
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const capturedPath = request.captured ?? request.capturedFile
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const deferredOutcome = yield* Effect.match(cycles.readDeferred(request.exclude), {
      onFailure: (refusal) => ({ _tag: 'DeferredFailed', refusal }) as const,
      onSuccess: (entries) => ({ _tag: 'DeferredRead', entries }) as const,
    })
    let excluded: Array<PackageName> = []
    let excludedIssue: FsPath | undefined = undefined
    if (deferredOutcome._tag === 'DeferredRead') {
      excluded = [...deferredOutcome.entries]
    } else {
      const refusal = deferredOutcome.refusal
      if (refusal._tag === 'PlanCapturedMalformed') {
        excludedIssue = refusal.path
      } else {
        return yield* Effect.fail(refusal)
      }
    }
    let cycle: Array<CycleEntry> = []
    let capturedIssue: FsPath | undefined = undefined
    if (capturedPath === undefined) {
      const members = yield* workspace.listMembers()
      const tags = yield* git.remoteTags(remote)
      cycle = dropExcluded(computeCycle(members, tags, request.changelogDir), excluded)
    } else {
      const capturedOutcome = yield* Effect.match(cycles.readCaptured(capturedPath), {
        onFailure: (refusal) => ({ _tag: 'CapturedFailed', refusal }) as const,
        onSuccess: (entries) => ({ _tag: 'CapturedRead', entries }) as const,
      })
      if (capturedOutcome._tag === 'CapturedRead') {
        cycle = dropExcluded([...capturedOutcome.entries], excluded)
      } else {
        const refusal = capturedOutcome.refusal
        if (refusal._tag === 'PlanCapturedMalformed') {
          capturedIssue = refusal.path
        } else {
          return yield* Effect.fail(refusal)
        }
      }
    }
    return new RawTag(
      cycle,
      remote,
      request.output,
      request.dryRun || request.json || request.output !== undefined,
      capturedIssue,
      excludedIssue,
    )
  })

const decode = (raw: RawTag): Result.Result<TagCommand, never> =>
  Result.succeed(
    TagCommand.make({
      cycle: [...raw.cycle],
      preview: raw.preview,
      capturedIssue: raw.capturedIssue,
      excludedIssue: raw.excludedIssue,
    }),
  )

interface EncodedTag {
  readonly decision: TagDecision
  readonly tags: Array<ReleaseTag>
}

const toLanguage = (
  decision: TagPackagesPreviewed | TagPackagesUpToDate | TagPackagesPushed,
): TagDecision =>
  Match.value(decision).pipe(
    Match.tag('TagPackagesPreviewed', (previewed) =>
      TagPreview.make({ tags: nonEmptyArray(previewed.tags.map((t) => ReleaseTag.make(t))) })),
    Match.tag('TagPackagesUpToDate', (upToDate) =>
      TagUpToDate.make({ tags: Count.make(upToDate.tags) })),
    Match.tag('TagPackagesPushed', (pushed) =>
      TagPushed.make({
        tags: nonEmptyArray(pushed.tags.map((t) => ReleaseTag.make(t))),
      })),
    Match.exhaustive,
  )

const toRefusal = (bad: CapturedListMalformed | ExcludedListMalformed): TagRefusal =>
  Match.value(bad).pipe(
    Match.tag('CapturedListMalformed', (malformed) => TagCapturedMalformed.make({ path: malformed.path })),
    Match.tag('ExcludedListMalformed', (malformed) => TagExcludedMalformed.make({ path: malformed.path })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    TagPackagesPreviewed | TagPackagesUpToDate | TagPackagesPushed,
    CapturedListMalformed | ExcludedListMalformed
  >,
): Result.Result<EncodedTag, TagRefusal> =>
  Result.mapError(outcome, toRefusal).pipe(Result.map((decision) => {
    const converted = toLanguage(decision)
    return {
      decision: converted,
      tags: Match.value(converted).pipe(
        Match.tag('TagPushed', (pushed) => [...pushed.tags]),
        Match.tag('TagPreview', (preview) => [...preview.tags]),
        Match.tag('TagUpToDate', () => []),
        Match.exhaustive,
      ),
    }
  }))

const write = (
  output: Result.Result<EncodedTag, TagRefusal>,
  raw: RawTag,
): Effect.Effect<TagDecision, TagRefusal | PlanDeferredUnknown, GitPort | CycleStore> => {
  if (Result.isFailure(output)) {
    return Effect.fail(output.failure)
  }
  const encoded = output.success
  return Effect.gen(function*() {
    const git = yield* GitPort
    const cycles = yield* CycleStore
    if (raw.output !== undefined) {
      yield* Effect.catchTags(cycles.writeCaptured(raw.output, raw.cycle), {
        PlanCapturedMalformed: (malformed) => Effect.fail(TagCapturedMalformed.make({ path: malformed.path })),
        PlanDeferredUnknown: (unknown) => Effect.fail(unknown),
      })
    }
    return yield* Match.value(encoded.decision).pipe(
      Match.tag('TagPushed', (pushed) =>
        Effect.gen(function*() {
          const remote = yield* git.remoteTags(raw.remote)
          for (const releaseTag of pushed.tags) {
            if (!remote.includes(releaseTag)) {
              yield* git.writeTag(releaseTag)
            }
          }
          yield* git.pushTags([...pushed.tags], raw.remote)
          return pushed
        })),
      Match.tag('TagPreview', (preview) => Effect.succeed(preview)),
      Match.tag('TagUpToDate', (upToDate) => Effect.succeed(upToDate)),
      Match.exhaustive,
    )
  })
}

export const tagCell: Cell.Cell<
  S.Schema.Type<typeof TagRequest>,
  TagDecision,
  MemberRefusal | TagRefusal | PlanDeferredUnknown,
  WorkspaceStore | GitPort | CycleStore
> = Cell.layer({
  read,
  decode,
  decide: tagPackages,
  encode,
  write,
})
