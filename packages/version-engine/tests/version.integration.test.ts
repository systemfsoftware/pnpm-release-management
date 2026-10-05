import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  type CommandRefusal,
  Intent,
  Member,
  PackageVersion,
  type ProcessCompleted,
  RelativePath,
  RepoRoot,
  VersionRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import {
  bumpCell,
  type BumpInput,
  BumpInput as BumpInputSchema,
  PinRefusal,
  pinRootManifestCell,
  type PinRootManifestInput,
  PinRootManifestInput as PinInputSchema,
  syncCell,
  type SyncInput,
  SyncInput as SyncInputSchema,
  SyncRefusal,
} from '@systemfsoftware/version-engine'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
import { makeFakeChangelogStore } from './__fixtures__/FakeChangelogStore.js'
import { makeFakeChangesetStore } from './__fixtures__/FakeChangesetStore.js'
import { makeFakeProcessPort } from './__fixtures__/FakeProcessPort.js'
import { makeFakeSurfaceStore } from './__fixtures__/FakeSurfaceStore.js'
import { makeFakeWorkspaceStore } from './__fixtures__/FakeWorkspaceStore.js'

const Feature = makeFeature({ it, layer })

const brandVersion = (version: string) => S.decodeUnknownSync(PackageVersion)(version)
const brandPath = (path: string) => S.decodeUnknownSync(RelativePath)(path)
const brandRoot = (root: string) => S.decodeUnknownSync(RepoRoot)(root)

const bumpCore = (version: string): readonly [number, number, number] => {
  const hit = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return [Number(hit?.[1] ?? 0), Number(hit?.[2] ?? 0), Number(hit?.[3] ?? 0)]
}

const jsonSurface = (path: string) => ({ _tag: 'JsonSurface', kind: 'json', path })
const tomlSurface = (path: string) => ({ _tag: 'TomlSurface', kind: 'toml', path })
const nixSurface = (path: string) => ({ _tag: 'NixSurface', kind: 'nix', path })

const membersOf = (entries: ReadonlyArray<{ readonly name: string; readonly version: string }>) =>
  S.decodeUnknownSync(S.Array(Member))(
    entries.map((entry) => ({
      name: entry.name,
      dir: `packages/${entry.name}`,
      manifest: { name: entry.name, version: entry.version },
      publishable: true,
    })),
  )

const intentsOf = (
  entries: ReadonlyArray<
    { readonly path: string; readonly name: string; readonly bump: string; readonly summary: string }
  >,
) =>
  S.decodeUnknownSync(S.Array(Intent))(
    entries.map((entry) => ({
      path: entry.path,
      packages: [{ name: entry.name, bump: entry.bump }],
      summary: entry.summary,
    })),
  )

const bumpInputOf = (input: unknown): BumpInput => S.decodeUnknownSync(BumpInputSchema)(input)
const syncInputOf = (input: unknown): SyncInput => S.decodeUnknownSync(SyncInputSchema)(input)
const pinInputOf = (input: unknown): PinRootManifestInput => S.decodeUnknownSync(PinInputSchema)(input)

const failUnexpected = (message: string): never => {
  throw new Error(message)
}

const surfacesInput = {
  manifest: { file: 'package.json', surface: jsonSurface('package.json') },
  surfaces: [
    { file: 'Cargo.toml', surface: tomlSurface('Cargo.toml') },
    { file: 'flake.nix', surface: nixSurface('flake.nix') },
  ],
}

Feature('Versioning packages').body(({ scenario }) => {
  {
    const members = membersOf([
      { name: 'a', version: '1.2.3' },
      { name: 'b', version: '0.1.0' },
    ])
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore(
      new Map(
        intentsOf([
          { path: '.changeset/a-major.md', name: 'a', bump: 'major', summary: 'ship a' },
          { path: '.changeset/b-patch.md', name: 'b', bump: 'patch', summary: 'fix b' },
        ]).map((intent) => [intent.path, intent] as const),
      ),
    )
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort()
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'Two intents collapse into one consolidated version',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two releasable packages with a major and a patch intent')('input', () =>
          Effect.succeed(bumpInputOf({
            strategy: 'surfaces',
            changelogDir: 'changelog',
            rootChangelog: 'CHANGELOG.md',
            ...surfacesInput,
          }))),
        When('the pending intents are versioned together')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('both packages move to the consolidated version with changelogs')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('VersionBumped', (bumped) => {
                  expect(bumped.version).toEqual('2.0.0')
                  expect([...bumped.moved]).toEqual(['a', 'b'])
                  expect([...bumped.changelogs]).toEqual(['changelog/a@2.0.0.md', 'changelog/b@2.0.0.md'])
                  expect(surfaces.state.versions.get(brandPath('package.json'))).toEqual('2.0.0')
                  expect(surfaces.state.versions.get(brandPath('Cargo.toml'))).toEqual('2.0.0')
                  expect(surfaces.state.versions.get(brandPath('flake.nix'))).toEqual('2.0.0')
                  expect(changesets.state.intents.size).toEqual(0)
                  expect(changelogs.state.memberChangelogs.get(brandPath('changelog/a@2.0.0.md'))).toEqual(
                    '# a@2.0.0\n\nship a\n',
                  )
                  expect(changelogs.state.memberChangelogs.get(brandPath('changelog/b@2.0.0.md'))).toEqual(
                    '# b@2.0.0\n\nfix b\n',
                  )
                  expect(changelogs.state.rootChangelogs.get(brandPath('CHANGELOG.md'))).toEqual(
                    '# Changelog\n\n## 2.0.0\n\n  - ship a\n  - fix b\n',
                  )
                }),
                Match.tag('VersionConsumed', () => failUnexpected('expected a consolidated bump')),
                Match.tag('VersionIdle', () => failUnexpected('expected a consolidated bump')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a version decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = membersOf([
      { name: 'a', version: '1.2.3' },
      { name: 'b', version: '0.1.0' },
    ])
    const surfaces = makeFakeSurfaceStore(
      new Map([[brandPath('package.json'), brandVersion('1.2.3')]]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore(
      new Map(
        intentsOf([
          { path: '.changeset/a-major.md', name: 'a', bump: 'major', summary: 'ship a' },
          { path: '.changeset/b-patch.md', name: 'b', bump: 'patch', summary: 'fix b' },
        ]).map((intent) => [intent.path, intent] as const),
      ),
    )
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort(
      (command: WorkspaceCommand): Effect.Effect<ProcessCompleted, CommandRefusal> =>
        Effect.sync(() => {
          workspace.state.members.forEach((member, index) => {
            const [major, minor, patch] = bumpCore(member.manifest.version)
            const next = S.decodeUnknownSync(PackageVersion)(`${major}.${minor}.${patch + 1}`)
            workspace.state.members[index] = {
              ...member,
              manifest: { ...member.manifest, version: next },
            }
          })
          return { _tag: 'ProcessCompleted' as const, command }
        }),
    )
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'Version moves delegate to the external package manager',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two releasable packages with a manager that applies patch moves')(
          'input',
          () => Effect.succeed(bumpInputOf({ strategy: 'pnpm', changelogDir: 'changelog', ...surfacesInput })),
        ),
        When('the pending intents are versioned per package')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('changelogs record the versions the manager applied')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('VersionBumped', (bumped) => {
                  expect(bumped.version).toEqual('2.0.0')
                  expect([...bumped.moved]).toEqual(['a', 'b'])
                  expect(changesets.state.intents.size).toEqual(0)
                  expect(changelogs.state.memberChangelogs.get(brandPath('changelog/a@1.2.4.md'))).toEqual(
                    '# a@1.2.4\n\nship a\n',
                  )
                  expect(changelogs.state.memberChangelogs.get(brandPath('changelog/b@0.1.1.md'))).toEqual(
                    '# b@0.1.1\n\nfix b\n',
                  )
                }),
                Match.tag('VersionConsumed', () => failUnexpected('expected a delegated bump')),
                Match.tag('VersionIdle', () => failUnexpected('expected a delegated bump')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a version decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = membersOf([{ name: 'a', version: '1.2.3' }])
    const surfaces = makeFakeSurfaceStore(
      new Map([[brandPath('package.json'), brandVersion('1.2.3')]]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore()
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort()
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'An empty workspace idles without touching anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package with no pending intents')(
          'input',
          () => Effect.succeed(bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput })),
        ),
        When('versioning runs with nothing pending')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the run idles with zero pending and writes nothing')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('VersionIdle', (idle) => {
                  expect(idle.pending).toEqual(0)
                  expect(surfaces.state.versions.get(brandPath('package.json'))).toEqual('1.2.3')
                  expect(changelogs.state.memberChangelogs.size).toEqual(0)
                }),
                Match.tag('VersionBumped', () => failUnexpected('expected an idle run')),
                Match.tag('VersionConsumed', () => failUnexpected('expected an idle run')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a version decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = membersOf([{ name: 'a', version: '1.2.3' }])
    const surfaces = makeFakeSurfaceStore(
      new Map([[brandPath('package.json'), brandVersion('1.2.3')]]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore(
      new Map(
        intentsOf([{ path: '.changeset/ghost.md', name: 'ghost', bump: 'minor', summary: 'haunt' }])
          .map((intent) => [intent.path, intent] as const),
      ),
    )
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort()
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'An intent naming an unknown package is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('an intent for a package outside the workspace')(
          'input',
          () => Effect.succeed(bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput })),
        ),
        When('versioning runs')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
          })),
        Then('the unknown package is refused and the intent is kept')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(VersionRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('VersionUnknownPackage', (unknown) => {
                  expect(unknown.package).toEqual('ghost')
                  expect(changesets.state.intents.size).toEqual(1)
                  expect(surfaces.state.versions.get(brandPath('package.json'))).toEqual('1.2.3')
                }),
                Match.tag('VersionIntentMalformed', () => failUnexpected('expected an unknown package')),
                Match.tag('VersionSurfaceMissing', () => failUnexpected('expected an unknown package')),
                Match.tag('RootManifestUnwritable', () => failUnexpected('expected an unknown package')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = membersOf([
      { name: 'a', version: '1.2.3' },
      { name: 'b', version: '0.1.0' },
    ])
    const surfaces = makeFakeSurfaceStore(
      new Map([[brandPath('package.json'), brandVersion('1.2.3')]]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore(
      new Map(
        intentsOf([
          { path: '.changeset/none-a.md', name: 'a', bump: 'none', summary: 'note a' },
          { path: '.changeset/none-b.md', name: 'b', bump: 'none', summary: 'note b' },
        ]).map((intent) => [intent.path, intent] as const),
      ),
    )
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort()
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'Intents without a version bump are consumed quietly',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('two intents that request no version change')(
          'input',
          () => Effect.succeed(bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput })),
        ),
        When('versioning runs')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
          })),
        Then('the intents are consumed without any writes')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('VersionConsumed', (consumed) => {
                  expect(consumed.consumed).toEqual(2)
                  expect(changesets.state.intents.size).toEqual(0)
                  expect(surfaces.state.versions.get(brandPath('package.json'))).toEqual('1.2.3')
                  expect(changelogs.state.memberChangelogs.size).toEqual(0)
                }),
                Match.tag('VersionBumped', () => failUnexpected('expected consumption')),
                Match.tag('VersionIdle', () => failUnexpected('expected consumption')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a version decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'Matching surfaces pass the consistency check',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('surfaces that all match the manifest version')(
          'input',
          () => Effect.succeed(syncInputOf({ strategy: 'surfaces', action: 'check', ...surfacesInput })),
        ),
        When('the surfaces are checked')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the check aligns on the manifest version')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('SyncAligned', (aligned) => {
                  expect(aligned.version).toEqual('1.2.3')
                  expect(aligned.surfaces).toEqual(2)
                }),
                Match.tag('SyncRealigned', () => failUnexpected('expected alignment')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a sync decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('9.9.9')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'A drifted surface is reported by path',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a surface that drifted from the manifest version')(
          'input',
          () => Effect.succeed(syncInputOf({ strategy: 'surfaces', action: 'check', ...surfacesInput })),
        ),
        When('the surfaces are checked')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the drift names the expected version and the drifted file')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(SyncRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('SyncSurfacesDrifted', (drifted) => {
                  expect(drifted.expected).toEqual('1.2.3')
                  expect(drifted.diffs.length).toEqual(1)
                  expect(drifted.diffs[0].path).toEqual('flake.nix')
                  expect(drifted.diffs[0].found).toEqual('9.9.9')
                  expect(surfaces.state.versions.get(brandPath('flake.nix'))).toEqual('9.9.9')
                }),
                Match.tag('SyncStrategyMismatch', () => failUnexpected('expected drifted surfaces')),
                Match.tag('SyncVersionMissing', () => failUnexpected('expected drifted surfaces')),
                Match.tag('SyncActionUnknown', () => failUnexpected('expected drifted surfaces')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'Bumping rewrites the manifest and every surface',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('surfaces behind the pinned version')(
          'input',
          () =>
            Effect.succeed(syncInputOf({ strategy: 'surfaces', action: 'bump', version: '2.0.0', ...surfacesInput })),
        ),
        When('the surfaces are bumped to the pinned version')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('every surface carries the pinned version')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('SyncRealigned', (realigned) => {
                  expect(realigned.version).toEqual('2.0.0')
                  expect([...realigned.rewritten]).toEqual(['package.json', 'Cargo.toml', 'flake.nix'])
                  expect(surfaces.state.versions.get(brandPath('package.json'))).toEqual('2.0.0')
                  expect(surfaces.state.versions.get(brandPath('Cargo.toml'))).toEqual('2.0.0')
                  expect(surfaces.state.versions.get(brandPath('flake.nix'))).toEqual('2.0.0')
                }),
                Match.tag('SyncAligned', () => failUnexpected('expected realignment')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a sync decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'An unknown sync action is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a sync request naming an action that does not exist')(
          'input',
          () => Effect.succeed(syncInputOf({ strategy: 'surfaces', action: 'frobnicate', ...surfacesInput })),
        ),
        When('the sync runs')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
          })),
        Then('the unknown action is refused by name')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(SyncRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('SyncActionUnknown', (unknown) => {
                  expect(unknown.given).toEqual('frobnicate')
                }),
                Match.tag('SyncStrategyMismatch', () => failUnexpected('expected an unknown action')),
                Match.tag('SyncVersionMissing', () => failUnexpected('expected an unknown action')),
                Match.tag('SyncSurfacesDrifted', () => failUnexpected('expected an unknown action')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'Bumping without a version is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a bump request that names no version')(
          'input',
          () => Effect.succeed(syncInputOf({ strategy: 'surfaces', action: 'bump', ...surfacesInput })),
        ),
        When('the sync runs')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
          })),
        Then('the missing version is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(SyncRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('SyncVersionMissing', () => undefined),
                Match.tag('SyncStrategyMismatch', () => failUnexpected('expected a missing version')),
                Match.tag('SyncActionUnknown', () => failUnexpected('expected a missing version')),
                Match.tag('SyncSurfacesDrifted', () => failUnexpected('expected a missing version')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.2.3')],
        [brandPath('Cargo.toml'), brandVersion('1.2.3')],
        [brandPath('flake.nix'), brandVersion('1.2.3')],
      ]),
    )
    const live = surfaces.layer
    scenario(
      'A foreign strategy is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a check request under a foreign strategy')(
          'input',
          () => Effect.succeed(syncInputOf({ strategy: 'pnpm', action: 'check', ...surfacesInput })),
        ),
        When('the sync runs')('outcome', (s) =>
          Effect.match(Cell.run(Cell.provide(syncCell, live), s.input), {
            onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
            onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
          })),
        Then('the strategy is refused by name')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(SyncRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('SyncStrategyMismatch', (mismatch) => {
                  expect(mismatch.strategy).toEqual('pnpm')
                }),
                Match.tag('SyncVersionMissing', () => failUnexpected('expected a strategy mismatch')),
                Match.tag('SyncActionUnknown', () => failUnexpected('expected a strategy mismatch')),
                Match.tag('SyncSurfacesDrifted', () => failUnexpected('expected a strategy mismatch')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const original = `${JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)}\n`
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([[brandPath('package.json'), original]]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'A repin persists the rewritten manifest',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a root manifest behind the requested version')(
          'input',
          () =>
            Effect.succeed(
              pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] }),
            ),
        ),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('every pin and the version land in one text')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('WorkspaceVersionRepinned', (repinned) => {
                  expect(repinned.version).toEqual('1.2.3')
                  expect([...repinned.pins]).toEqual(['app-linux-x64'])
                  expect(repinned.text.includes('"app-linux-x64": "1.2.3"')).toEqual(true)
                  expect(surfaces.state.rootManifests.get(brandPath('package.json'))).toEqual(repinned.text)
                  expect(workspace.state.files.get(brandPath('package.json'))).toEqual(original)
                }),
                Match.tag('WorkspaceVersionAlreadyCurrent', () => failUnexpected('expected a repin')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pin decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const original = `${JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)}\n`
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([[brandPath('package.json'), original]]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'A dry run reports the repin without persisting',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a root manifest behind the requested version')('input', () =>
          Effect.succeed(pinInputOf({
            manifest: 'package.json',
            requestedVersion: '1.2.3',
            suffixes: ['linux-x64'],
            dryRun: true,
          }))),
        When('the root manifest is pinned as a dry run')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the repin is reported and nothing is written')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('WorkspaceVersionRepinned', () => {
                  expect(surfaces.state.rootManifests.size).toEqual(0)
                }),
                Match.tag('WorkspaceVersionAlreadyCurrent', () => failUnexpected('expected a repin report')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pin decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const text = `${
      JSON.stringify(
        {
          name: 'app',
          version: '1.2.3',
          optionalDependencies: { 'app-linux-x64': '1.2.3' },
        },
        null,
        2,
      )
    }\n`
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([[brandPath('package.json'), text]]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'An already-pinned manifest reports current',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a root manifest already carrying the requested pins')(
          'input',
          () =>
            Effect.succeed(
              pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] }),
            ),
        ),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the stored text is returned byte-identically')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('WorkspaceVersionAlreadyCurrent', (current) => {
                  expect(current.text).toEqual(text)
                  expect(surfaces.state.rootManifests.size).toEqual(0)
                }),
                Match.tag('WorkspaceVersionRepinned', () => failUnexpected('expected the current report')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a pin decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([
        [brandPath('package.json'), `${JSON.stringify({ name: 'app', version: 'bogus' }, null, 2)}\n`],
        [brandPath('broken.json'), 'not json{{{'],
      ]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'An unusable version is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a manifest carrying an unusable version')(
          'input',
          () =>
            Effect.succeed(pinInputOf({ manifest: 'package.json', requestedVersion: 'nope', suffixes: ['linux-x64'] })),
        ),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the given text is refused as unusable')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PinRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PinVersionUnusable', (unusable) => {
                  expect(unusable.given).toEqual('nope')
                }),
                Match.tag('PinDistributionMissing', () => failUnexpected('expected an unusable version')),
                Match.tag('PinManifestInvalid', () => failUnexpected('expected an unusable version')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([
        [brandPath('package.json'), `${JSON.stringify({ name: 'app', version: 'bogus' }, null, 2)}\n`],
        [brandPath('broken.json'), 'not json{{{'],
      ]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'A typoed version is refused over a usable declared version',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a usable declared version with a typoed request')('input', () =>
          Effect.succeed(
            pinInputOf({ manifest: 'package.json', requestedVersion: '1.0.0.0-typo', suffixes: ['linux-x64'] }),
          )),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the typo is refused as unusable')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PinRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PinVersionUnusable', (unusable) => {
                  expect(unusable.given).toEqual('1.0.0.0-typo')
                }),
                Match.tag('PinDistributionMissing', () => failUnexpected('expected an unusable version')),
                Match.tag('PinManifestInvalid', () => failUnexpected('expected an unusable version')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([
        [brandPath('package.json'), `${JSON.stringify({ name: 'app', version: 'bogus' }, null, 2)}\n`],
        [brandPath('broken.json'), 'not json{{{'],
      ]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'Pinning without a distribution is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a pin request with no distribution attached')(
          'input',
          () => Effect.succeed(pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3' })),
        ),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the missing distribution is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PinRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PinDistributionMissing', () => undefined),
                Match.tag('PinVersionUnusable', () => failUnexpected('expected a missing distribution')),
                Match.tag('PinManifestInvalid', () => failUnexpected('expected a missing distribution')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspaceStore(
      [],
      brandRoot('/test'),
      new Map([
        [brandPath('package.json'), `${JSON.stringify({ name: 'app', version: 'bogus' }, null, 2)}\n`],
        [brandPath('broken.json'), 'not json{{{'],
      ]),
    )
    const surfaces = makeFakeSurfaceStore()
    const live = Layer.mergeAll(workspace.layer, surfaces.layer)
    scenario(
      'An unreadable manifest is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a manifest file holding broken text')(
          'input',
          () =>
            Effect.succeed(pinInputOf({ manifest: 'broken.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] })),
        ),
        When('the root manifest is pinned')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(pinRootManifestCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the file is refused as invalid')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PinRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PinManifestInvalid', () => undefined),
                Match.tag('PinVersionUnusable', () => failUnexpected('expected an invalid manifest')),
                Match.tag('PinDistributionMissing', () => failUnexpected('expected an invalid manifest')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected a refusal')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const members = membersOf([
      { name: '@e2e/alpha', version: '1.0.0' },
      { name: '@e2e/beta', version: '1.0.0' },
    ])
    const surfaces = makeFakeSurfaceStore(
      new Map([
        [brandPath('package.json'), brandVersion('1.0.0')],
        [brandPath('Cargo.toml'), brandVersion('1.0.0')],
        [brandPath('flake.nix'), brandVersion('1.0.0')],
      ]),
    )
    const workspace = makeFakeWorkspaceStore(members, brandRoot('/test'))
    const changesets = makeFakeChangesetStore(
      new Map(
        intentsOf([{
          path: '.changeset/alpha-minor.md',
          name: '@e2e/alpha',
          bump: 'minor',
          summary: 'alpha ships',
        }]).map((intent) => [intent.path, intent] as const),
      ),
    )
    const changelogs = makeFakeChangelogStore()
    const process = makeFakeProcessPort()
    const live = Layer.mergeAll(
      surfaces.layer,
      workspace.layer,
      changesets.layer,
      changelogs.layer,
      process.layer,
    )
    scenario(
      'Moved members borrow the intent summary when they have none',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('one intent touching one of two same-versioned packages')('input', () =>
          Effect.succeed(bumpInputOf({
            strategy: 'surfaces',
            changelogDir: '.changeset/changelogs',
            rootChangelog: 'CHANGELOG.md',
            ...surfacesInput,
          }))),
        When('the pending intents are versioned together')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(bumpCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('every moved member carries the borrowed summary')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('VersionBumped', (bumped) => {
                  expect(bumped.version).toEqual('1.1.0')
                  expect([...bumped.moved].sort()).toEqual(['@e2e/alpha', '@e2e/beta'])
                  expect(changesets.state.intents.size).toEqual(0)
                  expect(
                    changelogs.state.memberChangelogs.get(brandPath('.changeset/changelogs/@e2e!alpha@1.1.0.md')),
                  ).toEqual('# @e2e/alpha@1.1.0\n\nalpha ships\n')
                  expect(
                    changelogs.state.memberChangelogs.get(brandPath('.changeset/changelogs/@e2e!beta@1.1.0.md')),
                  ).toEqual('# @e2e/beta@1.1.0\n\nalpha ships\n')
                }),
                Match.tag('VersionConsumed', () => failUnexpected('expected a consolidated bump')),
                Match.tag('VersionIdle', () => failUnexpected('expected a consolidated bump')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected a version decision')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }
})
