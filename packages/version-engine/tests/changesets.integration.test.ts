import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitRef, RelativePath, RepoRoot, VersionRefusal } from '@systemfsoftware/release-language'
import { bumpCell, type BumpInput, BumpInput as BumpInputSchema } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const ROOT_TEXT = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function*() {
      const fs = yield* FileSystem
      return yield* fs.makeTempDirectory({ prefix: 'version-engine-changesets-' })
    }),
    NodeServices.layer,
  ),
)

const root = RepoRoot.make(ROOT_TEXT)
const base = GitRef.make('main')
const changesetDir = RelativePath.make('.changeset')
const changelogDir = '.changeset/changelogs'

const live = Layer.merge(
  Layer.mergeAll(
    WorkspaceStoreLive(root),
    SurfaceStoreLive(root),
    ChangelogStoreLive(root),
    ChangesetStoreLive({ root, changesetDir }),
    ChangesetsPortLive({ root, base }),
  ).pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
)

const ROOT_MANIFEST = `{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n`
const WORKSPACE = `packages:\n  - packages/*\n`
const CHANGESET_README = `# Changesets\n`
const ALPHA_MANIFEST = `{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n`
const BETA_MANIFEST =
  `{\n  "name": "@e2e/beta",\n  "version": "1.0.0",\n  "dependencies": {\n    "@e2e/alpha": "workspace:^1.0.0"\n  }\n}\n`
const GRITLINT_MANIFEST = `{\n  "name": "@e2e/gritlint",\n  "private": true,\n  "version": "0.3.0"\n}\n`
const CARGO_MANIFEST =
  `[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.3.0"\nedition = "2021"\n`
const CARGO_MEMBER = `[package]\nname = "gritlint"\nversion = "0.3.0"\nedition = "2021"\n`

const MANIFEST_TARGET = { file: 'package.json', surface: { kind: 'json' as const, path: 'package.json' } }

const resetTo = (files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* Effect.when(fs.remove(ROOT_TEXT, { recursive: true }), fs.exists(ROOT_TEXT))
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        const full = path.join(ROOT_TEXT, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }), { discard: true })
  })

const readFixture = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return yield* fs.readFileString(path.join(ROOT_TEXT, file))
  })

const intentFiles = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const names = yield* fs.readDirectory(path.join(ROOT_TEXT, '.changeset'))
  return names.filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
})

const bumpInputOf = (input: unknown): BumpInput => S.decodeUnknownSync(BumpInputSchema)(input)

const runBump = (input: BumpInput) =>
  Cell.run(Cell.provide(bumpCell, live), input).pipe(
    Effect.match({
      onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
      onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
    }),
  )

const failUnexpected = (message: string): never => {
  throw new Error(message)
}

Feature('Changesets versioning').body(({ scenario }) => {
  scenario(
    'A release plan moves two members and writes a changelog each',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('alpha and beta where beta depends on alpha through the workspace caret range')(
        'ready',
        () =>
          resetTo([
            ['package.json', ROOT_MANIFEST],
            ['pnpm-workspace.yaml', WORKSPACE],
            ['packages/alpha/package.json', ALPHA_MANIFEST],
            ['packages/beta/package.json', BETA_MANIFEST],
            ['.changeset/README.md', CHANGESET_README],
            ['.changeset/changelogs/.gitkeep', ''],
            ['.changeset/alpha-minor.md', '---\n"@e2e/alpha": minor\n---\n\nalpha grows a public export\n'],
            ['.changeset/beta-patch.md', '---\n"@e2e/beta": patch\n---\n\nbeta fixes a bug\n'],
          ]),
      ),
      When('the pending intents are versioned')('outcome', () =>
        runBump(bumpInputOf({
          strategy: 'changesets',
          changelogDir,
          manifest: MANIFEST_TARGET,
          surfaces: [],
        }))),
      Then('each member moves and carries its changelog, and the intents are gone')((s) =>
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Effect.gen(function*() {
              Match.value(decided.decision).pipe(
                Match.tag('VersionBumped', (bumped) => {
                  expect(bumped.version).toEqual('1.1.0')
                  expect([...bumped.moved].sort()).toEqual(['@e2e/alpha', '@e2e/beta'])
                  expect([...bumped.changelogs].sort()).toEqual([
                    '.changeset/changelogs/@e2e!alpha@1.1.0.md',
                    '.changeset/changelogs/@e2e!beta@1.0.1.md',
                  ])
                }),
                Match.tag('VersionConsumed', () => failUnexpected('expected a bump')),
                Match.tag('VersionIdle', () => failUnexpected('expected a bump')),
                Match.exhaustive,
              )
              expect(yield* readFixture('packages/alpha/package.json')).toContain('"version": "1.1.0"')
              expect(yield* readFixture('packages/beta/package.json')).toContain('"version": "1.0.1"')
              expect(yield* readFixture('packages/beta/package.json')).toContain(
                '"@e2e/alpha": "workspace:^1.1.0"',
              )
              expect(yield* intentFiles).toEqual([])
              expect(yield* readFixture('.changeset/changelogs/@e2e!alpha@1.1.0.md')).toEqual(
                '# @e2e/alpha@1.1.0\n\nalpha grows a public export\n',
              )
              expect(yield* readFixture('.changeset/changelogs/@e2e!beta@1.0.1.md')).toEqual(
                '# @e2e/beta@1.0.1\n\nbeta fixes a bug\n',
              )
            })),
          Match.tag('refused', (refused) =>
            Effect.sync(() => failUnexpected(`expected a bump, got ${refused.refusal._tag}`))),
          Match.exhaustive,
        )
      ),
    ),
  )

  scenario(
    'An intent naming a non-member is refused',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('a workspace whose intent names a package outside it')(
        'ready',
        () =>
          resetTo([
            ['package.json', ROOT_MANIFEST],
            ['pnpm-workspace.yaml', WORKSPACE],
            ['packages/alpha/package.json', ALPHA_MANIFEST],
            ['.changeset/README.md', CHANGESET_README],
            ['.changeset/changelogs/.gitkeep', ''],
            ['.changeset/ghost.md', '---\n"@e2e/ghost": minor\n---\n\nhaunt\n'],
          ]),
      ),
      When('the pending intents are versioned')('outcome', () =>
        runBump(bumpInputOf({
          strategy: 'changesets',
          changelogDir,
          manifest: MANIFEST_TARGET,
          surfaces: [],
        }))),
      Then('the unknown package is refused and the intent is kept')((s) =>
        Match.value(s.outcome).pipe(
          Match.tag('refused', (refused) =>
            Effect.gen(function*() {
              const refusal = yield* S.decodeUnknownEffect(VersionRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('VersionUnknownPackage', (unknown) => {
                  expect(unknown.package).toEqual('@e2e/ghost')
                }),
                Match.tag('VersionIntentMalformed', () => failUnexpected('expected an unknown package')),
                Match.tag('VersionSurfaceMissing', () => failUnexpected('expected an unknown package')),
                Match.tag('VersionLockStale', () => failUnexpected('expected an unknown package')),
                Match.tag('VersionCargoPackageMissing', () => failUnexpected('expected an unknown package')),
                Match.tag('RootManifestUnwritable', () => failUnexpected('expected an unknown package')),
                Match.exhaustive,
              )
              expect(yield* intentFiles).toEqual(['ghost.md'])
            })),
          Match.tag('decided', () => Effect.sync(() => failUnexpected('expected a refusal'))),
          Match.exhaustive,
        )
      ),
    ),
  )

  scenario(
    'An intent on a private member moves a cargo surface bound to it',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('a private member with an intent and a cargo surface naming it')(
        'ready',
        () =>
          resetTo([
            ['package.json', ROOT_MANIFEST],
            ['pnpm-workspace.yaml', WORKSPACE],
            ['packages/gritlint/package.json', GRITLINT_MANIFEST],
            ['crates/gritlint/Cargo.toml', CARGO_MEMBER],
            ['Cargo.toml', CARGO_MANIFEST],
            ['.changeset/README.md', CHANGESET_README],
            ['.changeset/changelogs/.gitkeep', ''],
            ['.changeset/gritlint.md', '---\n"@e2e/gritlint": minor\n---\n\ngritlint grows\n'],
          ]),
      ),
      When('the pending intents are versioned')('outcome', () =>
        runBump(bumpInputOf({
          strategy: 'changesets',
          changelogDir,
          manifest: MANIFEST_TARGET,
          surfaces: [{
            file: 'Cargo.toml',
            surface: { kind: 'cargo', path: 'Cargo.toml', package: '@e2e/gritlint' },
          }],
        }))),
      Then('the private member bumps and the cargo workspace follows it')((s) =>
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Effect.gen(function*() {
              Match.value(decided.decision).pipe(
                Match.tag('VersionBumped', (bumped) => {
                  expect(bumped.version).toEqual('0.4.0')
                  expect([...bumped.moved]).toEqual(['@e2e/gritlint'])
                }),
                Match.tag('VersionConsumed', () => failUnexpected('expected a bump')),
                Match.tag('VersionIdle', () => failUnexpected('expected a bump')),
                Match.exhaustive,
              )
              expect(yield* readFixture('packages/gritlint/package.json')).toContain('"version": "0.4.0"')
              expect(yield* readFixture('Cargo.toml')).toContain('version = "0.4.0"')
              expect(yield* readFixture('crates/gritlint/Cargo.toml')).toContain('version = "0.4.0"')
            })),
          Match.tag('refused', (refused) =>
            Effect.sync(() => failUnexpected(`expected a bump, got ${refused.refusal._tag}`))),
          Match.exhaustive,
        )
      ),
    ),
  )
})
