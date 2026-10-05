import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type {
  CycleEntry,
  GithubReleaseRefusal,
  MemberRefusal,
  PlanRefusal,
  TagRefusal,
} from '@systemfsoftware/release-language'
import {
  Count,
  CycleStore,
  ForgePort,
  FsPath,
  GitPort,
  RelativePath,
  ReleaseTag,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf } from './cycle.js'
import {
  type CreatedRelease,
  githubRelease,
  GithubReleaseCommand,
  GithubReleaseCreated,
  type GithubReleaseDecision,
  GithubReleasePreview,
  GithubReleaseSkipped,
} from './github-release.workflow.js'

export const GithubReleaseRequest = Wire.wire({
  captured: Wire.mint(S.optional(FsPath)),
  capturedFile: Wire.mint(S.optional(FsPath)),
  assert: Wire.mint(S.Boolean),
  dryRun: Wire.mint(S.Boolean),
  changelogDir: Wire.mint(RelativePath),
})

const readCycle = (
  cycles: CycleStore,
  workspace: WorkspaceStore,
  git: GitPort,
  capturedPath: FsPath | undefined,
  changelogDir: RelativePath,
): Effect.Effect<ReadonlyArray<CycleEntry>, PlanRefusal | MemberRefusal | TagRefusal, never> => {
  if (capturedPath !== undefined) {
    return cycles.readCaptured(capturedPath)
  }
  return Effect.gen(function*() {
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(RemoteName.make('origin'))
    return cycleOf(members, tags, changelogDir)
  })
}

const read = (
  request: S.Schema.Type<typeof GithubReleaseRequest>,
): Effect.Effect<
  GithubReleaseCommand,
  MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
  WorkspaceStore | GitPort | CycleStore | ForgePort
> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const forge = yield* ForgePort
    const cycle = yield* readCycle(
      cycles,
      workspace,
      git,
      request.captured ?? request.capturedFile,
      request.changelogDir,
    )
    const slug = yield* git.repoSlug()
    const items = yield* Effect.forEach(cycle, (entry) =>
      Effect.map(
        Effect.match(workspace.readFileFromRoot(entry.changelog), {
          onFailure: () => undefined,
          onSuccess: (file) => file.text,
        }),
        (body) => ({ entry, body }),
      ))
    const released = yield* Effect.forEach(cycle, (entry) =>
      Effect.map(
        forge.releaseByTag(slug, entry.tag),
        (lookup) =>
          Match.value(lookup).pipe(
            Match.tag('ReleaseFound', () => entry.tag),
            Match.tag('ReleaseAbsent', () => undefined),
            Match.exhaustive,
          ),
      ))
    return GithubReleaseCommand.make({
      items,
      assert: request.assert,
      preview: request.dryRun,
      existing: released.filter((tag): tag is ReleaseTag => tag !== undefined),
      slug,
    })
  })

const bodyOf = (raw: GithubReleaseCommand, tag: ReleaseTag): string => {
  const item = raw.items.find((candidate) => candidate.entry.tag === tag)
  if (item === undefined) {
    return ''
  }
  if (item.body === undefined) {
    return ''
  }
  return item.body
}

const createMissing = (
  forge: ForgePort,
  raw: GithubReleaseCommand,
  tag: ReleaseTag,
): Effect.Effect<CreatedRelease | undefined, GithubReleaseRefusal, never> =>
  Effect.flatMap(forge.releaseByTag(raw.slug, tag), (lookup) =>
    Match.value(lookup).pipe(
      Match.tag('ReleaseFound', () => Effect.succeed(undefined)),
      Match.tag('ReleaseAbsent', () =>
        Effect.map(
          forge.createRelease(raw.slug, tag, bodyOf(raw, tag)),
          (id) => ({ tag, id }),
        )),
      Match.exhaustive,
    ))

const publishPreview = (
  preview: GithubReleasePreview,
  raw: GithubReleaseCommand,
): Effect.Effect<GithubReleaseDecision, GithubReleaseRefusal, ForgePort> => {
  if (raw.preview) {
    return Effect.succeed(preview)
  }
  return Effect.gen(function*() {
    const forge = yield* ForgePort
    const created = yield* Effect.forEach(preview.tags, (tag) => createMissing(forge, raw, tag))
    const published = created.filter((entry): entry is CreatedRelease => entry !== undefined)
    const [first, ...rest] = published
    if (first === undefined) {
      return GithubReleaseSkipped.make({ tags: preview.tags })
    }
    yield* forge.promoteLatest(raw.slug, first.id)
    return GithubReleaseCreated.make({
      created: [first, ...rest],
      skipped: Count.make(preview.tags.length - published.length),
    })
  })
}

const write = (
  outcome: Result.Result<GithubReleaseDecision, GithubReleaseRefusal>,
  raw: GithubReleaseCommand,
): Effect.Effect<GithubReleaseDecision, GithubReleaseRefusal, ForgePort> => {
  if (Result.isFailure(outcome)) {
    return Effect.fail(outcome.failure)
  }
  return Match.value(outcome.success).pipe(
    Match.tag('GithubReleasePreview', (preview) => publishPreview(preview, raw)),
    Match.tag('GithubReleaseCreated', (created) => Effect.succeed(created)),
    Match.tag('GithubReleaseSkipped', (skipped) => Effect.succeed(skipped)),
    Match.tag('GithubReleaseAsserted', (asserted) => Effect.succeed(asserted)),
    Match.tag('GithubReleaseEmpty', (empty) => Effect.succeed(empty)),
    Match.exhaustive,
  )
}

export const githubReleaseCell: Cell.Cell<
  S.Schema.Type<typeof GithubReleaseRequest>,
  GithubReleaseDecision,
  MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
  WorkspaceStore | GitPort | CycleStore | ForgePort
> = Cell.layer({
  read,
  decide: githubRelease,
  write,
})
