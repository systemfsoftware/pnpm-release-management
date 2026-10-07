import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { githubReleaseCell, planCell, pullRequestCell, tagCell } from '@systemfsoftware/github-release-engine'
import {
  Count,
  FsPath,
  GithubReleaseRefusal,
  GitRef,
  type Member,
  PackageName,
  PackageVersion,
  PlanRefusal,
  PrTitle,
  PullRequestNumber,
  PullRequestRefusal,
  RelativePath,
  ReleaseLabel,
  ReleaseTag,
  RemoteName,
  TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Result, Schema as S } from 'effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'
import { makeFakeChangesetStore } from './__fixtures__/FakeChangesetStore.js'
import { makeFakeCycleStore } from './__fixtures__/FakeCycleStore.js'
import { makeFakeForge } from './__fixtures__/FakeForge.js'
import { makeFakeGit } from './__fixtures__/FakeGit.js'
import { makeFakeWorkspaceStore } from './__fixtures__/FakeWorkspaceStore.js'

const Feature = makeFeature({ it, layer })

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

const failUnexpected = (message: string): never => {
  throw new Error(message)
}

Feature('Releasing versions to GitHub').body(({ scenario }) => {
  {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(changesets, workspace, git, cycles.layer)
    scenario(
      'Pending work with nothing owed starts versioning',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('one pending intent and no owed tags')('input', () => Effect.succeed({ changelogDir })),
        When('planning the release')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(planCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the plan enters the version phase with one pending intent')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.value.phase).toEqual('version')
              expect(decided.value.pendingIntents).toEqual(Count.make(1))
              expect(decided.value.thisCycle).toEqual(Count.make(0))
              expect(decided.value.deferred).toEqual(Count.make(0))
              Match.value(decided.value.decision).pipe(
                Match.tag('PlanVersion', (version) => {
                  expect(version.pending).toEqual(Count.make(1))
                }),
                Match.tag('PlanRelease', () => failUnexpected('expected PlanVersion')),
                Match.tag('PlanSettled', () => failUnexpected('expected PlanVersion')),
                Match.exhaustive,
              )
            }),
            Match.tag('refused', () => failUnexpected('expected a plan report')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(changesets, workspace, git, cycles.layer)
    scenario(
      'Owed tags drain before pending work',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('one pending intent and one owed tag')('input', () => Effect.succeed({ changelogDir })),
        When('planning the release')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(planCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the plan enters the publish phase with a one-item cycle')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.value.phase).toEqual('release')
              expect(decided.value.pendingIntents).toEqual(Count.make(1))
              expect(decided.value.thisCycle).toEqual(Count.make(1))
              Match.value(decided.value.decision).pipe(
                Match.tag('PlanRelease', (release) => {
                  expect(release.cycle.length).toEqual(1)
                }),
                Match.tag('PlanVersion', () => failUnexpected('expected PlanRelease')),
                Match.tag('PlanSettled', () => failUnexpected('expected PlanRelease')),
                Match.exhaustive,
              )
            }),
            Match.tag('refused', () => failUnexpected('expected a plan report')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(changesets, workspace, git, cycles.layer)
    scenario(
      'A quiet repository settles with no work',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('no pending intents and nothing owed')('input', () => Effect.succeed({ changelogDir })),
        When('planning the release')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(planCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the plan settles in the none phase')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.value.phase).toEqual('none')
              Match.value(decided.value.decision).pipe(
                Match.tag('PlanSettled', () => undefined),
                Match.tag('PlanVersion', () => failUnexpected('expected PlanSettled')),
                Match.tag('PlanRelease', () => failUnexpected('expected PlanSettled')),
                Match.exhaustive,
              )
            }),
            Match.tag('refused', () => failUnexpected('expected a plan report')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore({ deferredFiles: { 'deferred.txt': 'ghost\n' } })
    const live = Layer.mergeAll(changesets, workspace, git, cycles.layer)
    scenario(
      'Unknown deferred names warn without failing the plan',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a deferred file naming a package outside the workspace')(
          'input',
          () => Effect.succeed({ changelogDir, deferred: FsPath.make('deferred.txt') }),
        ),
        When('planning the release')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(planCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the unknown name is reported as unpublished with no failure')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.value.phase).toEqual('none')
              Match.value(decided.value.decision).pipe(
                Match.tag('PlanSettled', () => undefined),
                Match.tag('PlanVersion', () => failUnexpected('expected PlanSettled')),
                Match.tag('PlanRelease', () => failUnexpected('expected PlanSettled')),
                Match.exhaustive,
              )
              expect(decided.value.pendingIntents).toEqual(Count.make(0))
              expect(decided.value.thisCycle).toEqual(Count.make(0))
              expect(decided.value.deferred).toEqual(Count.make(1))
              expect(decided.value.unpublished).toEqual([PackageName.make('ghost')])
            }),
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PlanRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PlanCapturedMalformed', () => failUnexpected('expected a warning, not a refusal')),
                Match.tag('PlanDeferredUnknown', () => failUnexpected('expected a warning, not a refusal')),
                Match.exhaustive,
              )
            }),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [member('alpha', '1.0.0')], files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(changesets, workspace, git, cycles.layer)
    scenario(
      'A missing deferred file refuses the plan at the read',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a deferred path with no file behind it')(
          'input',
          () => Effect.succeed({ changelogDir, deferred: FsPath.make('nope.txt') }),
        ),
        When('planning the release')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(planCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the missing file is refused with its path')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PlanRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PlanCapturedMalformed', (malformed) => {
                  expect(malformed.path).toEqual(FsPath.make('nope.txt'))
                }),
                Match.tag('PlanDeferredUnknown', () => failUnexpected('expected PlanCapturedMalformed')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'Owed packages are tagged and pushed',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two owed packages with no tags on the remote')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir }),
        ),
        When('tagging the cycle')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('both tags are written and pushed once')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagPushed', (pushed) => {
                  expect([...pushed.tags]).toEqual([tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')])
                  expect(git.calls.writtenTags.length).toEqual(2)
                  expect(git.calls.pushed.length).toEqual(1)
                  expect(git.calls.pushed[0]?.remote).toEqual(RemoteName.make('origin'))
                }),
                Match.tag('TagPreview', () => failUnexpected('expected TagPushed')),
                Match.tag('TagUpToDate', () => failUnexpected('expected TagPushed')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'A dry run previews tags without touching the remote',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two owed packages with a dry run requested')(
          'input',
          () => Effect.succeed({ dryRun: true, json: false, changelogDir }),
        ),
        When('tagging the cycle')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the tags preview with no writes or pushes')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagPreview', (preview) => {
                  expect([...preview.tags]).toEqual([tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')])
                  expect(git.calls.writtenTags.length).toEqual(0)
                  expect(git.calls.pushed.length).toEqual(0)
                }),
                Match.tag('TagPushed', () => failUnexpected('expected TagPreview')),
                Match.tag('TagUpToDate', () => failUnexpected('expected TagPreview')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'A fully tagged workspace reports up to date',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('every package already tagged on the remote')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir }),
        ),
        When('tagging the cycle')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the run reports up to date with no push')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagUpToDate', () => {
                  expect(git.calls.pushed.length).toEqual(0)
                }),
                Match.tag('TagPushed', () => failUnexpected('expected TagUpToDate')),
                Match.tag('TagPreview', () => failUnexpected('expected TagUpToDate')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore({ capturedFiles: { 'cap.json': ['alpha@v9.9.9'] } })
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'A captured file reuses the prior cycle',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured file holding a prior cycle')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') }),
        ),
        When('tagging the captured cycle')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the captured tag is pushed')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagPushed', (pushed) => {
                  expect([...pushed.tags]).toEqual([ReleaseTag.make('alpha@v9.9.9')])
                }),
                Match.tag('TagPreview', () => failUnexpected('expected TagPushed')),
                Match.tag('TagUpToDate', () => failUnexpected('expected TagPushed')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')] })
    const cycles = makeFakeCycleStore({
      capturedFiles: { 'cap.json': ['alpha@v1.0.0', 'beta@v2.0.0'] },
    })
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'Re-tagging a captured cycle over pushed tags stays idempotent',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured cycle whose tags already sit on the remote')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') }),
        ),
        When('tagging the captured cycle')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('no tags are rewritten and the push still runs once')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagPushed', () => {
                  expect(git.calls.writtenTags.length).toEqual(0)
                  expect(git.calls.pushed.length).toEqual(1)
                }),
                Match.tag('TagPreview', () => failUnexpected('expected TagPushed')),
                Match.tag('TagUpToDate', () => failUnexpected('expected TagPushed')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore({ capturedFiles: { 'cap.json': 'nope' } })
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'A malformed captured file refuses tagging',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured file holding malformed text')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir, captured: FsPath.make('cap.json') }),
        ),
        When('tagging the captured cycle')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the malformed file is refused with its path')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TagRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TagCapturedMalformed', (malformed) => {
                  expect(malformed.path).toEqual(FsPath.make('cap.json'))
                  expect(git.calls.pushed.length).toEqual(0)
                }),
                Match.tag('TagExcludedMalformed', () => failUnexpected('expected TagCapturedMalformed')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0'), member('beta', '2.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'A preview with an output file captures the full entries',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two owed packages with an output file requested')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir, output: FsPath.make('out.json') }),
        ),
        When('tagging the cycle')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the preview captures both entries with no push')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('TagPreview', (preview) => {
                  expect([...preview.tags]).toEqual([tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')])
                  expect(cycles.written.captured.length).toEqual(1)
                  expect(cycles.written.captured[0]?.path).toEqual(FsPath.make('out.json'))
                  expect(cycles.written.captured[0]?.entries.map((entry) => entry.tag)).toEqual(
                    [tagOf('alpha', '1.0.0'), tagOf('beta', '2.0.0')],
                  )
                  expect(git.calls.pushed.length).toEqual(0)
                }),
                Match.tag('TagPushed', () => failUnexpected('expected TagPreview')),
                Match.tag('TagUpToDate', () => failUnexpected('expected TagPreview')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a tag decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'Missing releases are created and the first is promoted',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with a changelog and no release yet')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('one release is created with its body and promoted')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('GithubReleaseCreated', (created) => {
                  expect(created.created.length).toEqual(1)
                  expect(created.created[0].tag).toEqual(tagOf('alpha', '1.0.0'))
                  expect(created.skipped).toEqual(Count.make(0))
                  expect(forge.calls.created.length).toEqual(1)
                  expect(forge.calls.created[0]?.body).toEqual('## 1.0.0\n- fix')
                  expect(forge.calls.promoted.length).toEqual(1)
                }),
                Match.tag('GithubReleaseSkipped', () => failUnexpected('expected GithubReleaseCreated')),
                Match.tag('GithubReleaseAsserted', () => failUnexpected('expected GithubReleaseCreated')),
                Match.tag('GithubReleasePreview', () => failUnexpected('expected GithubReleaseCreated')),
                Match.tag('GithubReleaseEmpty', () => failUnexpected('expected GithubReleaseCreated')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.1.0')]
    const changelog = {
      'packages/alpha/CHANGELOG.md': '# alpha\n\n## 1.1.0\n\n- new\n\n## 1.0.0\n\n- old\n',
    }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog, storage: 'repository' })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'Under repository storage the release body is the version section of the package changelog',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package whose own CHANGELOG.md holds this version and an older one')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the release body is that version section alone')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', () => {
              expect(forge.calls.created.length).toEqual(1)
              expect(forge.calls.created[0]?.body).toEqual('## 1.1.0\n\n- new')
            }),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.1.0')]
    const changelog = { 'packages/alpha/CHANGELOG.md': '# alpha\n\n## 1.0.0\n\n- old\n' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog, storage: 'repository' })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'Under repository storage a changelog without the version section refuses the release',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package whose CHANGELOG.md has no section for its version')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the refusal names the package, version and changelog, and nothing is created')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              Match.value(refused.refusal).pipe(
                Match.tag('ReleaseChangelogMissing', (missing) => {
                  expect(missing.package).toEqual(PackageName.make('alpha'))
                  expect(missing.version).toEqual(PackageVersion.make('1.1.0'))
                  expect(missing.changelog).toEqual(RelativePath.make('packages/alpha/CHANGELOG.md'))
                }),
                Match.orElse((other) => failUnexpected(`expected ReleaseChangelogMissing, got ${other._tag}`)),
              )
              expect(forge.calls.created.length).toEqual(0)
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {}, storage: 'repository' })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const live = Layer.mergeAll(workspace, git, cycles.layer)
    scenario(
      'Under repository storage the captured cycle points at the package changelog',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('an owed package with an output file requested')(
          'input',
          () => Effect.succeed({ dryRun: false, json: false, changelogDir, output: FsPath.make('out.json') }),
        ),
        When('tagging the cycle')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(tagCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (value) => ({ _tag: 'decided' as const, value }),
          })),
        Then('the captured entry names packages/alpha/CHANGELOG.md, not a parked file')(() => {
          expect(cycles.written.captured[0]?.entries.map((entry) => entry.changelog)).toEqual(
            [RelativePath.make('packages/alpha/CHANGELOG.md')],
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge({ releases: [{ tag: tagOf('alpha', '1.0.0'), id: 7 }] })
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'Existing releases are skipped without creating',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package whose release already exists')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the existing tag is skipped with nothing created')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('GithubReleaseSkipped', (skipped) => {
                  expect([...skipped.tags]).toEqual([tagOf('alpha', '1.0.0')])
                  expect(forge.calls.created.length).toEqual(0)
                  expect(forge.calls.promoted.length).toEqual(0)
                }),
                Match.tag('GithubReleaseCreated', () => failUnexpected('expected GithubReleaseSkipped')),
                Match.tag('GithubReleaseAsserted', () => failUnexpected('expected GithubReleaseSkipped')),
                Match.tag('GithubReleasePreview', () => failUnexpected('expected GithubReleaseSkipped')),
                Match.tag('GithubReleaseEmpty', () => failUnexpected('expected GithubReleaseSkipped')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'Assert mode checks changelogs without creating anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with a changelog in assert mode')(
          'input',
          () => Effect.succeed({ assert: true, dryRun: false, changelogDir }),
        ),
        When('asserting the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the changelog count is asserted with nothing created')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('GithubReleaseAsserted', (asserted) => {
                  expect(asserted.count).toEqual(Count.make(1))
                  expect(forge.calls.created.length).toEqual(0)
                }),
                Match.tag('GithubReleaseCreated', () => failUnexpected('expected GithubReleaseAsserted')),
                Match.tag('GithubReleaseSkipped', () => failUnexpected('expected GithubReleaseAsserted')),
                Match.tag('GithubReleasePreview', () => failUnexpected('expected GithubReleaseAsserted')),
                Match.tag('GithubReleaseEmpty', () => failUnexpected('expected GithubReleaseAsserted')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'A dry run previews releases without creating anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with a changelog and a dry run requested')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: true, changelogDir }),
        ),
        When('previewing the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the tag previews with nothing created')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('GithubReleasePreview', (preview) => {
                  expect([...preview.tags]).toEqual([tagOf('alpha', '1.0.0')])
                  expect(forge.calls.created.length).toEqual(0)
                }),
                Match.tag('GithubReleaseCreated', () => failUnexpected('expected GithubReleasePreview')),
                Match.tag('GithubReleaseSkipped', () => failUnexpected('expected GithubReleasePreview')),
                Match.tag('GithubReleaseAsserted', () => failUnexpected('expected GithubReleasePreview')),
                Match.tag('GithubReleaseEmpty', () => failUnexpected('expected GithubReleasePreview')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const changelog = { [changelogFor('alpha', '1.0.0')]: '## 1.0.0\n- fix' }
    const workspace = makeFakeWorkspaceStore({ members, files: changelog })
    const git = makeFakeGit({ tags: [tagOf('alpha', '1.0.0')] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'An empty cycle reports no releases owed',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package already tagged with nothing owed')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the run reports an empty cycle')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('GithubReleaseEmpty', () => undefined),
                Match.tag('GithubReleaseCreated', () => failUnexpected('expected GithubReleaseEmpty')),
                Match.tag('GithubReleaseSkipped', () => failUnexpected('expected GithubReleaseEmpty')),
                Match.tag('GithubReleaseAsserted', () => failUnexpected('expected GithubReleaseEmpty')),
                Match.tag('GithubReleasePreview', () => failUnexpected('expected GithubReleaseEmpty')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a release decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const workspace = makeFakeWorkspaceStore({ members, files: {} })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'A missing changelog refuses the release',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with no changelog file')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the missing changelog names the package')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(GithubReleaseRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('ReleaseChangelogMissing', (missing) => {
                  expect(missing.package).toEqual(PackageName.make('alpha'))
                }),
                Match.tag('ReleaseChangelogEmpty', () => failUnexpected('expected ReleaseChangelogMissing')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = [member('alpha', '1.0.0')]
    const workspace = makeFakeWorkspaceStore({
      members,
      files: { [changelogFor('alpha', '1.0.0')]: '  \n ' },
    })
    const git = makeFakeGit({ tags: [] })
    const cycles = makeFakeCycleStore()
    const forge = makeFakeForge()
    const live = Layer.mergeAll(workspace, git, cycles.layer, forge.layer)
    scenario(
      'A blank changelog refuses the release',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with a blank changelog file')(
          'input',
          () => Effect.succeed({ assert: false, dryRun: false, changelogDir }),
        ),
        When('creating the releases')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(githubReleaseCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the blank changelog names the package')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(GithubReleaseRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('ReleaseChangelogEmpty', (empty) => {
                  expect(empty.package).toEqual(PackageName.make('alpha'))
                }),
                Match.tag('ReleaseChangelogMissing', () => failUnexpected('expected ReleaseChangelogEmpty')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const branch = GitRef.make('changeset-release/main')
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'A dirty branch without a request opens one with the label',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('pending intents with no open request')(
          'input',
          () => Effect.succeed({ title, base, branch, labels: [releaseLabel] }),
        ),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('a labelled request is created and the branch is pushed')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('PullRequestCreated', (created) => {
                  expect(forge.calls.createdPullRequests.length).toEqual(1)
                  expect(forge.calls.createdPullRequests[0]?.head).toEqual(branch)
                  expect(forge.calls.createdPullRequests[0]?.labels).toEqual([releaseLabel])
                  expect(git.calls.commits.length).toEqual(1)
                  expect(git.calls.branchesPushed.length).toEqual(1)
                  expect(created.number).toEqual(forge.calls.createdPullRequests[0]?.number)
                }),
                Match.tag('PullRequestUpdated', () => failUnexpected('expected PullRequestCreated')),
                Match.tag('PullRequestClosed', () => failUnexpected('expected PullRequestCreated')),
                Match.tag('PullRequestVacant', () => failUnexpected('expected PullRequestCreated')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pull request decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const branch = GitRef.make('changeset-release/main')
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge({
      pullRequests: [{ number: 12, head: 'changeset-release/main', title: 'old' }],
    })
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'A dirty branch with a request refreshes it with the label',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('pending intents with an open request')(
          'input',
          () => Effect.succeed({ title, base, branch, labels: [releaseLabel] }),
        ),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the open request is updated with the label')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('PullRequestUpdated', (updated) => {
                  expect(forge.calls.updatedPullRequests.length).toEqual(1)
                  expect(forge.calls.updatedPullRequests[0]?.number).toEqual(PullRequestNumber.make(12))
                  expect(forge.calls.updatedPullRequests[0]?.labels).toEqual([releaseLabel])
                  expect(updated.number).toEqual(PullRequestNumber.make(12))
                }),
                Match.tag('PullRequestCreated', () => failUnexpected('expected PullRequestUpdated')),
                Match.tag('PullRequestClosed', () => failUnexpected('expected PullRequestUpdated')),
                Match.tag('PullRequestVacant', () => failUnexpected('expected PullRequestUpdated')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pull request decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const branch = GitRef.make('changeset-release/main')
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge({
      pullRequests: [{ number: 12, head: 'changeset-release/main', title: 'old' }],
    })
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'A clean branch with a request closes it and deletes the branch',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('no pending intents with an open request')(
          'input',
          () => Effect.succeed({ title, base, branch, labels: [releaseLabel] }),
        ),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the request closes and the branch is deleted')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('PullRequestClosed', (closed) => {
                  expect(closed.branch.deleted).toEqual(true)
                  expect(forge.calls.closedPullRequests).toEqual([PullRequestNumber.make(12)])
                  expect(git.calls.branchesDeleted.length).toEqual(1)
                }),
                Match.tag('PullRequestCreated', () => failUnexpected('expected PullRequestClosed')),
                Match.tag('PullRequestUpdated', () => failUnexpected('expected PullRequestClosed')),
                Match.tag('PullRequestVacant', () => failUnexpected('expected PullRequestClosed')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pull request decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const branch = GitRef.make('changeset-release/main')
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'A clean branch without a request rests vacant',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('no pending intents and no open request')(
          'input',
          () => Effect.succeed({ title, base, branch, labels: [releaseLabel] }),
        ),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('nothing is created and the branch rests')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.value).pipe(
                Match.tag('PullRequestVacant', () => {
                  expect(forge.calls.createdPullRequests.length).toEqual(0)
                }),
                Match.tag('PullRequestCreated', () => failUnexpected('expected PullRequestVacant')),
                Match.tag('PullRequestUpdated', () => failUnexpected('expected PullRequestVacant')),
                Match.tag('PullRequestClosed', () => failUnexpected('expected PullRequestVacant')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pull request decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'A branch equal to the base is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('pending intents with the branch set to the base')(
          'input',
          () => Effect.succeed({ title, base, branch: base, labels: [releaseLabel] }),
        ),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the invalid head is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PullRequestRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PullRequestHeadInvalid', () => undefined),
                Match.tag('PullRequestBodyUnreadable', () => failUnexpected('expected PullRequestHeadInvalid')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const branch = GitRef.make('changeset-release/main')
    const base = GitRef.make('main')
    const title = PrTitle.make('chore(release): version packages')
    const changesets = makeFakeChangesetStore([intentPath('bright-panda-runs')])
    const workspace = makeFakeWorkspaceStore({ members: [], files: {} })
    const git = makeFakeGit({})
    const forge = makeFakeForge()
    const live = Layer.mergeAll(changesets, workspace, git, forge.layer)
    scenario(
      'An unreadable body file refuses the request',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('pending intents with a missing body file')('input', () =>
          Effect.succeed({
            title,
            base,
            branch,
            labels: [releaseLabel],
            bodyFile: RelativePath.make('notes/missing.md'),
          })),
        When('syncing the release request')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pullRequestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (value) => ({ _tag: 'decided' as const, value }),
            }),
        ),
        Then('the unreadable body is refused with nothing created')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PullRequestRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PullRequestBodyUnreadable', () => {
                  expect(forge.calls.createdPullRequests.length).toEqual(0)
                }),
                Match.tag('PullRequestHeadInvalid', () => failUnexpected('expected PullRequestBodyUnreadable')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }
})
