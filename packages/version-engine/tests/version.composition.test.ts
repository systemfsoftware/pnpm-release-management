import { assert, assertEquals } from '@std/assert'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  Intent,
  Member,
  PackageVersion,
  PinRefusal,
  type ProcessCompleted,
  type PublishRefusal,
  RelativePath,
  RepoRoot,
  SyncRefusal,
  VersionRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'
import {
  bumpCell,
  type BumpInput,
  makeFakeChangelogStore,
  makeFakeChangesetStore,
  makeFakeProcessPort,
  makeFakeSurfaceStore,
  makeFakeWorkspaceStore,
  pinRootManifestCell,
  type PinRootManifestInput,
  syncCell,
  type SyncInput,
} from '../mod.ts'
import { BumpInput as BumpInputSchema } from '../src/bump.schema.ts'
import { PinRootManifestInput as PinInputSchema } from '../src/pin-root-manifest.schema.ts'
import { SyncInput as SyncInputSchema } from '../src/sync.schema.ts'

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

const refusedOf = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.match(effect, {
    onFailure: (refusal: unknown) => ({ refused: true as const, refusal }),
    onSuccess: (decision: A) => ({ refused: false as const, decision }),
  }))

const surfacesInput = {
  manifest: { file: 'package.json', surface: jsonSurface('package.json') },
  surfaces: [
    { file: 'Cargo.toml', surface: tomlSurface('Cargo.toml') },
    { file: 'flake.nix', surface: nixSurface('flake.nix') },
  ],
}

Deno.test('bump: surfaces collapse intents, write versions, changelogs, and consume', async () => {
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({
        strategy: 'surfaces',
        changelogDir: 'changelog',
        rootChangelog: 'CHANGELOG.md',
        ...surfacesInput,
      }),
    ),
  )

  assert(decision._tag === 'VersionBumped')
  assertEquals(decision.version, '2.0.0')
  assertEquals([...decision.moved], ['a', 'b'])
  assertEquals([...decision.changelogs], ['changelog/a@2.0.0.md', 'changelog/b@2.0.0.md'])
  assertEquals(surfaces.state.versions.get(brandPath('package.json')), '2.0.0')
  assertEquals(surfaces.state.versions.get(brandPath('Cargo.toml')), '2.0.0')
  assertEquals(surfaces.state.versions.get(brandPath('flake.nix')), '2.0.0')
  assertEquals(changesets.state.intents.size, 0)
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('changelog/a@2.0.0.md')),
    '# a@2.0.0\n\nship a\n',
  )
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('changelog/b@2.0.0.md')),
    '# b@2.0.0\n\nfix b\n',
  )
  assertEquals(
    changelogs.state.rootChangelogs.get(brandPath('CHANGELOG.md')),
    '# Changelog\n\n## 2.0.0\n\n  - ship a\n  - fix b\n',
  )
  assertEquals(process.state.calls.length, 0)
})

Deno.test('bump: pnpm delegates manifest moves to the process port and records actuals', async () => {
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
    (command: WorkspaceCommand): Effect.Effect<ProcessCompleted, PublishRefusal> =>
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({ strategy: 'pnpm', changelogDir: 'changelog', ...surfacesInput }),
    ),
  )

  assert(decision._tag === 'VersionBumped')
  assertEquals(decision.version, '2.0.0')
  assertEquals([...decision.moved], ['a', 'b'])
  assertEquals(process.state.calls.length, 1)
  assertEquals(process.state.calls[0]?.program, 'pnpm')
  assertEquals(process.state.calls[0]?.args.map((arg) => `${arg}`), ['version', '-r'])
  assertEquals(changesets.state.intents.size, 0)
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('changelog/a@1.2.4.md')),
    '# a@1.2.4\n\nship a\n',
  )
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('changelog/b@0.1.1.md')),
    '# b@0.1.1\n\nfix b\n',
  )
})

Deno.test('bump: empty workspace idles and touches nothing', async () => {
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput }),
    ),
  )

  assert(decision._tag === 'VersionIdle')
  assertEquals(decision.pending, 0)
  assertEquals(surfaces.state.versions.get(brandPath('package.json')), '1.2.3')
  assertEquals(changelogs.state.memberChangelogs.size, 0)
})

Deno.test('bump: unknown package refuses and keeps every intent', async () => {
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
  const outcome = await refusedOf(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput }),
    ),
  )

  assert(outcome.refused)
  const refusal = S.decodeUnknownSync(VersionRefusal)(outcome.refusal)
  assert(refusal._tag === 'VersionUnknownPackage')
  assertEquals(refusal.package, 'ghost')
  assertEquals(changesets.state.intents.size, 1)
  assertEquals(surfaces.state.versions.get(brandPath('package.json')), '1.2.3')
})

Deno.test('bump: none-only intents are consumed without writes', async () => {
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({ strategy: 'surfaces', changelogDir: 'changelog', ...surfacesInput }),
    ),
  )

  assert(decision._tag === 'VersionConsumed')
  assertEquals(decision.consumed, 2)
  assertEquals(changesets.state.intents.size, 0)
  assertEquals(surfaces.state.versions.get(brandPath('package.json')), '1.2.3')
  assertEquals(changelogs.state.memberChangelogs.size, 0)
})

Deno.test('sync: check passes when every surface matches', async () => {
  const surfaces = makeFakeSurfaceStore(
    new Map([
      [brandPath('package.json'), brandVersion('1.2.3')],
      [brandPath('Cargo.toml'), brandVersion('1.2.3')],
      [brandPath('flake.nix'), brandVersion('1.2.3')],
    ]),
  )
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(syncCell, surfaces.layer),
      syncInputOf({ strategy: 'surfaces', action: 'check', ...surfacesInput }),
    ),
  )

  assert(decision._tag === 'SyncAligned')
  assertEquals(decision.version, '1.2.3')
  assertEquals(decision.surfaces, 2)
})

Deno.test('sync: check names each drifted surface', async () => {
  const surfaces = makeFakeSurfaceStore(
    new Map([
      [brandPath('package.json'), brandVersion('1.2.3')],
      [brandPath('Cargo.toml'), brandVersion('1.2.3')],
      [brandPath('flake.nix'), brandVersion('9.9.9')],
    ]),
  )
  const outcome = await refusedOf(
    Cell.run(
      Cell.provide(syncCell, surfaces.layer),
      syncInputOf({ strategy: 'surfaces', action: 'check', ...surfacesInput }),
    ),
  )

  assert(outcome.refused)
  const refusal = S.decodeUnknownSync(SyncRefusal)(outcome.refusal)
  assert(refusal._tag === 'SyncSurfacesDrifted')
  assertEquals(refusal.expected, '1.2.3')
  assertEquals(refusal.diffs.length, 1)
  assertEquals(refusal.diffs[0]?.path, 'flake.nix')
  assertEquals(refusal.diffs[0]?.found, '9.9.9')
  assertEquals(surfaces.state.versions.get(brandPath('flake.nix')), '9.9.9')
})

Deno.test('sync: bump rewrites the manifest and every surface', async () => {
  const surfaces = makeFakeSurfaceStore(
    new Map([
      [brandPath('package.json'), brandVersion('1.2.3')],
      [brandPath('Cargo.toml'), brandVersion('1.2.3')],
      [brandPath('flake.nix'), brandVersion('1.2.3')],
    ]),
  )
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(syncCell, surfaces.layer),
      syncInputOf({ strategy: 'surfaces', action: 'bump', version: '2.0.0', ...surfacesInput }),
    ),
  )
  assert(decision._tag === 'SyncRealigned')
  assertEquals(decision.version, '2.0.0')
  assertEquals([...decision.rewritten], ['package.json', 'Cargo.toml', 'flake.nix'])
  assertEquals(surfaces.state.versions.get(brandPath('package.json')), '2.0.0')
  assertEquals(surfaces.state.versions.get(brandPath('Cargo.toml')), '2.0.0')
  assertEquals(surfaces.state.versions.get(brandPath('flake.nix')), '2.0.0')
})

Deno.test('sync: unknown action, missing version, and wrong strategy refuse', async () => {
  const surfaces = makeFakeSurfaceStore(
    new Map([
      [brandPath('package.json'), brandVersion('1.2.3')],
      [brandPath('Cargo.toml'), brandVersion('1.2.3')],
      [brandPath('flake.nix'), brandVersion('1.2.3')],
    ]),
  )
  const provided = Cell.provide(syncCell, surfaces.layer)

  const unknown = await refusedOf(
    Cell.run(provided, syncInputOf({ strategy: 'surfaces', action: 'frobnicate', ...surfacesInput })),
  )
  assert(unknown.refused)
  assertEquals(S.decodeUnknownSync(SyncRefusal)(unknown.refusal)._tag, 'SyncActionUnknown')

  const missing = await refusedOf(
    Cell.run(provided, syncInputOf({ strategy: 'surfaces', action: 'bump', ...surfacesInput })),
  )
  assert(missing.refused)
  assertEquals(S.decodeUnknownSync(SyncRefusal)(missing.refusal)._tag, 'SyncVersionMissing')

  const mismatch = await refusedOf(
    Cell.run(provided, syncInputOf({ strategy: 'pnpm', action: 'check', ...surfacesInput })),
  )
  assert(mismatch.refused)
  assertEquals(S.decodeUnknownSync(SyncRefusal)(mismatch.refusal)._tag, 'SyncStrategyMismatch')
})

Deno.test('pin: repin persists the rewritten manifest through the surface store', async () => {
  const original = `${JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)}\n`
  const workspace = makeFakeWorkspaceStore(
    [],
    brandRoot('/test'),
    new Map([[brandPath('package.json'), original]]),
  )
  const surfaces = makeFakeSurfaceStore()
  const live = Layer.mergeAll(workspace.layer, surfaces.layer)
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(pinRootManifestCell, live),
      pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] }),
    ),
  )

  assert(decision._tag === 'WorkspaceVersionRepinned')
  assertEquals(decision.version, '1.2.3')
  assertEquals([...decision.pins], ['app-linux-x64'])
  assert(decision.text.includes('"app-linux-x64": "1.2.3"'))
  assertEquals(surfaces.state.rootManifests.get(brandPath('package.json')), decision.text)
  assertEquals(workspace.state.files.get(brandPath('package.json')), original)
})

Deno.test('pin: dry run reports the repin without persisting', async () => {
  const original = `${JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)}\n`
  const workspace = makeFakeWorkspaceStore(
    [],
    brandRoot('/test'),
    new Map([[brandPath('package.json'), original]]),
  )
  const surfaces = makeFakeSurfaceStore()
  const live = Layer.mergeAll(workspace.layer, surfaces.layer)
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(pinRootManifestCell, live),
      pinInputOf({
        manifest: 'package.json',
        requestedVersion: '1.2.3',
        suffixes: ['linux-x64'],
        dryRun: true,
      }),
    ),
  )

  assert(decision._tag === 'WorkspaceVersionRepinned')
  assertEquals(surfaces.state.rootManifests.size, 0)
})

Deno.test('pin: already-pinned manifest reports current byte-identically', async () => {
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(pinRootManifestCell, live),
      pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] }),
    ),
  )

  assert(decision._tag === 'WorkspaceVersionAlreadyCurrent')
  assertEquals(decision.text, text)
  assertEquals(surfaces.state.rootManifests.size, 0)
})

Deno.test('pin: unusable version, missing distribution, and bad manifest refuse', async () => {
  const workspace = makeFakeWorkspaceStore(
    [],
    brandRoot('/test'),
    new Map([
      [brandPath('package.json'), `${JSON.stringify({ name: 'app', version: 'bogus' }, null, 2)}\n`],
      [brandPath('broken.json'), 'not json{{{'],
    ]),
  )
  const surfaces = makeFakeSurfaceStore()
  const provided = Cell.provide(pinRootManifestCell, Layer.mergeAll(workspace.layer, surfaces.layer))

  const unusable = await refusedOf(
    Cell.run(
      provided,
      pinInputOf({ manifest: 'package.json', requestedVersion: 'nope', suffixes: ['linux-x64'] }),
    ),
  )
  assert(unusable.refused)
  assertEquals(S.decodeUnknownSync(PinRefusal)(unusable.refusal)._tag, 'PinVersionUnusable')

  const typo = await refusedOf(
    Cell.run(
      provided,
      pinInputOf({ manifest: 'package.json', requestedVersion: '1.0.0.0-typo', suffixes: ['linux-x64'] }),
    ),
  )
  assert(typo.refused)
  assertEquals(S.decodeUnknownSync(PinRefusal)(typo.refusal)._tag, 'PinVersionUnusable')

  const missing = await refusedOf(
    Cell.run(provided, pinInputOf({ manifest: 'package.json', requestedVersion: '1.2.3' })),
  )
  assert(missing.refused)
  assertEquals(S.decodeUnknownSync(PinRefusal)(missing.refusal)._tag, 'PinDistributionMissing')

  const broken = await refusedOf(
    Cell.run(
      provided,
      pinInputOf({ manifest: 'broken.json', requestedVersion: '1.2.3', suffixes: ['linux-x64'] }),
    ),
  )
  assert(broken.refused)
  assertEquals(S.decodeUnknownSync(PinRefusal)(broken.refusal)._tag, 'PinManifestInvalid')
})

Deno.test('bump: surfaces changelogs cover every moved member with fallback summaries', async () => {
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
  const decision = await Effect.runPromise(
    Cell.run(
      Cell.provide(bumpCell, live),
      bumpInputOf({
        strategy: 'surfaces',
        changelogDir: '.changeset/changelogs',
        rootChangelog: 'CHANGELOG.md',
        ...surfacesInput,
      }),
    ),
  )

  assert(decision._tag === 'VersionBumped')
  assertEquals(decision.version, '1.1.0')
  assertEquals([...decision.moved].sort(), ['@e2e/alpha', '@e2e/beta'])
  assertEquals(changesets.state.intents.size, 0)
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('.changeset/changelogs/@e2e!alpha@1.1.0.md')),
    '# @e2e/alpha@1.1.0\n\nalpha ships\n',
  )
  assertEquals(
    changelogs.state.memberChangelogs.get(brandPath('.changeset/changelogs/@e2e!beta@1.1.0.md')),
    '# @e2e/beta@1.1.0\n\nalpha ships\n',
  )
})
