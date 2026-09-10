import { assertEquals } from '@std/assert'
import { Cell } from '@systemfsoftware/effect-cell-types'
import type { Member } from '@systemfsoftware/release-language'
import {
  Count,
  FsPath,
  GitRef,
  PackageName,
  PackageVersion,
  PrTitle,
  PullRequestNumber,
  RelativePath,
  ReleaseLabel,
  ReleaseTag,
  RemoteName,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Result, Schema as S } from 'effect'
import { githubReleaseCell } from '../src/github-release.ts'
import { planCell } from '../src/plan.ts'
import { pullRequestCell } from '../src/pull-request.ts'
import { tagCell } from '../src/tag.ts'
import { makeFakeChangesetStore } from '../src/testing/FakeChangesetStore.ts'
import { makeFakeCycleStore } from '../src/testing/FakeCycleStore.ts'
import { makeFakeForge } from '../src/testing/FakeForge.ts'
import { makeFakeGit } from '../src/testing/FakeGit.ts'
import { makeFakeWorkspaceStore } from '../src/testing/FakeWorkspaceStore.ts'

const changelogDir = RelativePath.make('.changeset/changelogs')

const member = (name: string, version: string): Member => ({
  name: PackageName.make(name),
  dir: RelativePath.make(`packages/${name}`),
  manifest: { name: PackageName.make(name), version: PackageVersion.make(version) },
  publishable: true,
})

const tagOf = (name: string, version: string): ReleaseTag => ReleaseTag.make(`${name}@v${version}`)

const intentPath = (slug: string): RelativePath => RelativePath.make(`${slug}.md`)

const changelogFor = (name: string, version: string): RelativePath =>
  RelativePath.make(`.changeset/changelogs/${name}@${version}.md`)

const releaseLabel = (() => {
  const decoded = S.decodeUnknownResult(ReleaseLabel)('release')
  if (Result.isFailure(decoded)) {
    throw new Error('release label must decode')
  }
  return decoded.success
})()

const runCell = <I, A, E, R>(
  cell: Cell.Cell<I, A, E, R>,
  layer: Layer.Layer<R, never, never>,
  input: I,
): Promise<
  | { readonly outcome: 'decided'; readonly value: A }
  | { readonly outcome: 'refused'; readonly refusal: E }
> =>
  Effect.runPromise(
    Effect.match(Cell.run(Cell.provide(cell, layer), input), {
      onFailure: (refusal) => ({ outcome: 'refused', refusal }) as const,
      onSuccess: (value) => ({ outcome: 'decided', value }) as const,
    }),
  )

Deno.test('release plan sandwiches repository state into a phase', async (t) => {
  await t.step('pending intents with nothing owed versions', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      planCell,
      Layer.mergeAll(changesets, workspace, git, cycles.layer),
      { changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a plan report')
    }
    assertEquals(outcome.value.phase, 'version')
    assertEquals(outcome.value.pendingIntents, Count.make(1))
    assertEquals(outcome.value.thisCycle, Count.make(0))
    assertEquals(outcome.value.deferred, Count.make(0))
    if (outcome.value.decision._tag !== 'PlanVersion') {
      throw new Error(`expected PlanVersion, got ${outcome.value.decision._tag}`)
    }
    assertEquals(outcome.value.decision.pending, Count.make(1))
  })

  await t.step('owed tags drain before pending intents', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      planCell,
      Layer.mergeAll(changesets, workspace, git, cycles.layer),
      { changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a plan report')
    }
    assertEquals(outcome.value.phase, 'publish')
    assertEquals(outcome.value.pendingIntents, Count.make(1))
    assertEquals(outcome.value.thisCycle, Count.make(1))
    if (outcome.value.decision._tag !== 'PlanPublish') {
      throw new Error(`expected PlanPublish, got ${outcome.value.decision._tag}`)
    }
    assertEquals(outcome.value.decision.cycle.length, 1)
  })

  await t.step('nothing pending and nothing owed settles', async () => {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      planCell,
      Layer.mergeAll(changesets, workspace, git, cycles.layer),
      { changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a plan report')
    }
    assertEquals(outcome.value.phase, 'none')
    if (outcome.value.decision._tag !== 'PlanSettled') {
      throw new Error(`expected PlanSettled, got ${outcome.value.decision._tag}`)
    }
  })

  await t.step('unknown deferred names warn without failing the plan', async () => {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore({ deferredFiles: { 'deferred.txt': 'ghost\n' } })
    const outcome = await runCell(
      planCell,
      Layer.mergeAll(changesets, workspace, git, cycles.layer),
      { changelogDir, deferred: FsPath.make('deferred.txt') },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error(`unknown deferred must stay a warning, got ${outcome.refusal._tag}`)
    }
    assertEquals(outcome.value.phase, 'none')
    assertEquals(outcome.value.decision._tag, 'PlanSettled')
    assertEquals(outcome.value.pendingIntents, Count.make(0))
    assertEquals(outcome.value.thisCycle, Count.make(0))
    assertEquals(outcome.value.deferred, Count.make(1))
    assertEquals(outcome.value.unpublished, [PackageName.make('ghost')])
  })

  await t.step('missing deferred file refuses at the read', async () => {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      planCell,
      Layer.mergeAll(changesets, workspace, git, cycles.layer),
      { changelogDir, deferred: FsPath.make('nope.txt') },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected PlanCapturedMalformed')
    }
    if (outcome.refusal._tag !== 'PlanCapturedMalformed') {
      throw new Error(`expected PlanCapturedMalformed, got ${outcome.refusal._tag}`)
    }
    assertEquals(outcome.refusal.path, FsPath.make('nope.txt'))
  })
})

Deno.test('release tagging captures the cycle and pushes tags', async (t) => {
  const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]

  await t.step('owed packages are tagged and pushed', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagPushed') {
      throw new Error(`expected TagPushed, got ${outcome.value._tag}`)
    }
    assertEquals([...outcome.value.tags], [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')])
    assertEquals(git.calls.writtenTags.length, 2)
    assertEquals(git.calls.pushed.length, 1)
    assertEquals(git.calls.pushed[0]?.remote, RemoteName.make('origin'))
  })

  await t.step('dry run previews without touching git', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: true, json: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagPreview') {
      throw new Error(`expected TagPreview, got ${outcome.value._tag}`)
    }
    assertEquals([...outcome.value.tags], [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')])
    assertEquals(git.calls.writtenTags.length, 0)
    assertEquals(git.calls.pushed.length, 0)
  })

  await t.step('fully tagged workspace reports up to date', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagUpToDate') {
      throw new Error(`expected TagUpToDate, got ${outcome.value._tag}`)
    }
    assertEquals(git.calls.pushed.length, 0)
  })

  await t.step('captured file reuses the prior cycle', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore({ capturedFiles: { 'cap.json': ['alpha@v9.9.9'] } })
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagPushed') {
      throw new Error(`expected TagPushed, got ${outcome.value._tag}`)
    }
    assertEquals([...outcome.value.tags], [ReleaseTag.make('alpha@v9.9.9')])
  })

  await t.step('re-tagging a captured cycle with tags already on the remote is idempotent', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')] })
    const cycles = makeFakeCycleStore({
      capturedFiles: { 'cap.json': ['alpha@v1.0.0', 'beta@v2.0.0'] },
    })
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagPushed') {
      throw new Error(`expected TagPushed, got ${outcome.value._tag}`)
    }
    assertEquals(git.calls.writtenTags.length, 0)
    assertEquals(git.calls.pushed.length, 1)
  })

  await t.step('malformed captured file refuses', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore({ capturedFiles: { 'cap.json': 'nope' } })
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected TagCapturedMalformed')
    }
    if (outcome.refusal._tag !== 'TagCapturedMalformed') {
      throw new Error(`expected TagCapturedMalformed, got ${outcome.refusal._tag}`)
    }
    assertEquals(outcome.refusal.path, FsPath.make('cap.json'))
    assertEquals(git.calls.pushed.length, 0)
  })

  await t.step('output file captures full entries on preview', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const outcome = await runCell(
      tagCell,
      Layer.mergeAll(workspace, git, cycles.layer),
      { dryRun: false, json: false, changelogDir, output: FsPath.make('out.json') },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a tag decision')
    }
    if (outcome.value._tag !== 'TagPreview') {
      throw new Error(`expected TagPreview, got ${outcome.value._tag}`)
    }
    assertEquals(cycles.written.captured.length, 1)
    assertEquals(cycles.written.captured[0]?.path, FsPath.make('out.json'))
    assertEquals(
      cycles.written.captured[0]?.entries.map((entry) => entry.tag),
      [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')],
    )
    assertEquals(git.calls.pushed.length, 0)
  })
})

Deno.test('github releases are created from generated changelogs', async (t) => {
  const members = [member('alpha', '1.0.0')]
  const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }

  await t.step('missing releases are created and the first is promoted', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a release decision')
    }
    if (outcome.value._tag !== 'GithubReleaseCreated') {
      throw new Error(`expected GithubReleaseCreated, got ${outcome.value._tag}`)
    }
    assertEquals(outcome.value.created.length, 1)
    assertEquals(outcome.value.created[0]?.tag, tagOf('alpha', '1.0.0'))
    assertEquals(outcome.value.skipped, Count.make(0))
    assertEquals(forge.calls.created.length, 1)
    assertEquals(forge.calls.created[0]?.body, '## 1.0.0\n- fix')
    assertEquals(forge.calls.promoted.length, 1)
  })

  await t.step('existing releases are skipped', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge({ releases: [{ tag: tagOf('alpha', '1.0.0'), id: 7 }] })
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a release decision')
    }
    if (outcome.value._tag !== 'GithubReleaseSkipped') {
      throw new Error(`expected GithubReleaseSkipped, got ${outcome.value._tag}`)
    }
    assertEquals([...outcome.value.tags], [tagOf('alpha', '1.0.0')])
    assertEquals(forge.calls.created.length, 0)
    assertEquals(forge.calls.promoted.length, 0)
  })

  await t.step('assert mode checks changelogs without creating', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: true, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a release decision')
    }
    if (outcome.value._tag !== 'GithubReleaseAsserted') {
      throw new Error(`expected GithubReleaseAsserted, got ${outcome.value._tag}`)
    }
    assertEquals(outcome.value.count, Count.make(1))
    assertEquals(forge.calls.created.length, 0)
  })

  await t.step('dry run previews without creating', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: true, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a release decision')
    }
    if (outcome.value._tag !== 'GithubReleasePreview') {
      throw new Error(`expected GithubReleasePreview, got ${outcome.value._tag}`)
    }
    assertEquals([...outcome.value.tags], [tagOf('alpha', '1.0.0')])
    assertEquals(forge.calls.created.length, 0)
  })

  await t.step('empty captured set reports empty', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a release decision')
    }
    if (outcome.value._tag !== 'GithubReleaseEmpty') {
      throw new Error(`expected GithubReleaseEmpty, got ${outcome.value._tag}`)
    }
  })

  await t.step('missing changelog refuses', async () => {
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected ReleaseChangelogMissing')
    }
    if (outcome.refusal._tag !== 'ReleaseChangelogMissing') {
      throw new Error(`expected ReleaseChangelogMissing, got ${outcome.refusal._tag}`)
    }
    assertEquals(outcome.refusal.package, PackageName.make('alpha'))
  })

  await t.step('blank changelog refuses', async () => {
    const workspace = makeFakeWorkspaceStore({
      members,
      files: { [changelogFor('alpha', '1.0.0')]: '  \n ' },
    })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const outcome = await runCell(
      githubReleaseCell,
      Layer.mergeAll(workspace, git, cycles.layer, forge.layer),
      { assert: false, dryRun: false, changelogDir },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected ReleaseChangelogEmpty')
    }
    if (outcome.refusal._tag !== 'ReleaseChangelogEmpty') {
      throw new Error(`expected ReleaseChangelogEmpty, got ${outcome.refusal._tag}`)
    }
    assertEquals(outcome.refusal.package, PackageName.make('alpha'))
  })
})

Deno.test('release pull request opens, refreshes or closes', async (t) => {
  const branch = GitRef.make('changeset-release/main')
  const base = GitRef.make('main')
  const title = PrTitle.make('chore(release): version packages')

  await t.step('dirty branch without a PR creates one with the label', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      { title, base, branch, labels: [releaseLabel] },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a pull request decision')
    }
    if (outcome.value._tag !== 'PullRequestCreated') {
      throw new Error(`expected PullRequestCreated, got ${outcome.value._tag}`)
    }
    assertEquals(forge.calls.createdPullRequests.length, 1)
    assertEquals(forge.calls.createdPullRequests[0]?.head, branch)
    assertEquals(forge.calls.createdPullRequests[0]?.labels, [releaseLabel])
    assertEquals(git.calls.commits.length, 1)
    assertEquals(git.calls.branchesPushed.length, 1)
  })

  await t.step('dirty branch with a PR refreshes it with the label', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge({
      pullRequests: [{ number: 12, head: 'changeset-release/main', title: 'old' }],
    })
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      { title, base, branch, labels: [releaseLabel] },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a pull request decision')
    }
    if (outcome.value._tag !== 'PullRequestUpdated') {
      throw new Error(`expected PullRequestUpdated, got ${outcome.value._tag}`)
    }
    assertEquals(forge.calls.updatedPullRequests.length, 1)
    assertEquals(forge.calls.updatedPullRequests[0]?.number, PullRequestNumber.make(12))
    assertEquals(forge.calls.updatedPullRequests[0]?.labels, [releaseLabel])
  })

  await t.step('clean branch with a PR closes it and deletes the branch', async () => {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge({
      pullRequests: [{ number: 12, head: 'changeset-release/main', title: 'old' }],
    })
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      { title, base, branch, labels: [releaseLabel] },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a pull request decision')
    }
    if (outcome.value._tag !== 'PullRequestClosed') {
      throw new Error(`expected PullRequestClosed, got ${outcome.value._tag}`)
    }
    assertEquals(outcome.value.branch.deleted, true)
    assertEquals(forge.calls.closedPullRequests, [PullRequestNumber.make(12)])
    assertEquals(git.calls.branchesDeleted.length, 1)
  })

  await t.step('clean branch without a PR rests vacant', async () => {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      { title, base, branch, labels: [releaseLabel] },
    )
    if (outcome.outcome !== 'decided') {
      throw new Error('expected a pull request decision')
    }
    if (outcome.value._tag !== 'PullRequestVacant') {
      throw new Error(`expected PullRequestVacant, got ${outcome.value._tag}`)
    }
    assertEquals(forge.calls.createdPullRequests.length, 0)
  })

  await t.step('branch equal to base refuses', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      { title, base, branch: base, labels: [releaseLabel] },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected PullRequestHeadInvalid')
    }
    if (outcome.refusal._tag !== 'PullRequestHeadInvalid') {
      throw new Error(`expected PullRequestHeadInvalid, got ${outcome.refusal._tag}`)
    }
  })

  await t.step('unreadable body file refuses', async () => {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const outcome = await runCell(
      pullRequestCell,
      Layer.mergeAll(changesets, workspace, git, forge.layer),
      {
        title,
        base,
        branch,
        labels: [releaseLabel],
        bodyFile: RelativePath.make('notes/missing.md'),
      },
    )
    if (outcome.outcome !== 'refused') {
      throw new Error('expected PullRequestBodyUnreadable')
    }
    if (outcome.refusal._tag !== 'PullRequestBodyUnreadable') {
      throw new Error(`expected PullRequestBodyUnreadable, got ${outcome.refusal._tag}`)
    }
    assertEquals(forge.calls.createdPullRequests.length, 0)
  })
})
