import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RelativePath, RepoRoot, WorkspaceStore } from '@systemfsoftware/release-language'
import { WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const scratchRoot = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const root = yield* fs.makeTempDirectory({ prefix: 'workspace-adapter-listing-' })
  yield* fs.writeFileString(path.join(root, 'package.json'), '{\n  "name": "@e2e/root",\n  "private": true\n}\n')
  yield* fs.writeFileString(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  return RepoRoot.make(root)
})

const writeMember = (root: RepoRoot, dir: string, manifest: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.join(root, dir), { recursive: true })
    yield* fs.writeFileString(path.join(root, dir, 'package.json'), manifest)
  })

const withoutPnpmOnPath = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.env['PATH']
      process.env['PATH'] = ''
      return saved
    }),
    () => effect,
    (saved) =>
      Effect.sync(() => {
        process.env['PATH'] = saved
      }),
  )

const refusalOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.match(effect, {
    onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
    onSuccess: () => ({ _tag: 'listed' as const }),
  })

Feature('A workspace listing names why it could not read the workspace').body(({ scenario }) => {
  scenario(
    'pnpm absent from PATH is refused as a command that could not start',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a workspace root')('root', () => scratchRoot),
      When('members are listed with no pnpm on PATH')('outcome', (s) =>
        withoutPnpmOnPath(
          refusalOf(
            Effect.gen(function*() {
              return yield* (yield* WorkspaceStore).listMembers()
            }).pipe(
              Effect.provide(WorkspaceStoreLive(s.root)),
            ),
          ),
        )),
      Then('the refusal names pnpm and the spawn error')((s) =>
        Effect.sync(() => {
          expect(s.outcome).toMatchObject({ _tag: 'refused', refusal: { _tag: 'CommandUnstartable', command: 'pnpm' } })
          expect(JSON.stringify(s.outcome)).toContain('ENOENT')
        })
      ),
    ),
  )

  scenario(
    'A member manifest that is not there is still refused as unreadable',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a workspace root')('root', () => scratchRoot),
      When('a missing member manifest is read')('outcome', (s) =>
        refusalOf(
          Effect.gen(function*() {
            return yield* (yield* WorkspaceStore).readManifest(RelativePath.make('packages/gone'))
          })
            .pipe(Effect.provide(WorkspaceStoreLive(s.root))),
        )),
      Then('the refusal is ManifestUnreadable at that manifest')((s) =>
        Effect.sync(() => {
          expect(s.outcome).toMatchObject({ _tag: 'refused', refusal: { _tag: 'ManifestUnreadable' } })
          expect(JSON.stringify(s.outcome)).toContain('packages/gone/package.json')
        })
      ),
    ),
  )

  scenario(
    'a private member without a version is listed as nonpublishable',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a workspace with a private member and a versioned publishable member')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* scratchRoot
            yield* writeMember(root, 'packages/private', '{\n  "name": "@e2e/private",\n  "private": true\n}\n')
            yield* writeMember(
              root,
              'packages/publishable',
              '{\n  "name": "@e2e/publishable",\n  "version": "1.2.3"\n}\n',
            )
            return root
          }),
      ),
      When('members are listed')('members', (s) =>
        Effect.gen(function*() {
          return yield* (yield* WorkspaceStore).listMembers()
        }).pipe(Effect.provide(WorkspaceStoreLive(s.root)))),
      Then('the private member has an internal version without a manifest rewrite')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const path = yield* Path
          const member = s.members.find((member) => member.name === '@e2e/private')
          expect(member).toMatchObject({
            name: '@e2e/private',
            publishable: false,
            manifest: { private: true, version: '0.0.0' },
          })
          const manifest = yield* fs.readFileString(path.join(s.root, 'packages/private/package.json'))
          expect(manifest).not.toContain('"version"')
        })
      ),
    ),
  )

  scenario(
    'a publishable member without a version is still refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a workspace with an unversioned publishable member')('root', () =>
        Effect.gen(function*() {
          const root = yield* scratchRoot
          yield* writeMember(root, 'packages/publishable', '{\n  "name": "@e2e/publishable"\n}\n')
          return root
        })),
      When('members are listed')('outcome', (s) =>
        refusalOf(
          Effect.gen(function*() {
            return yield* (yield* WorkspaceStore).listMembers()
          }).pipe(Effect.provide(WorkspaceStoreLive(s.root))),
        )),
      Then('the refusal names the publishable member manifest')((s) =>
        Effect.sync(() => {
          expect(s.outcome).toMatchObject({ _tag: 'refused', refusal: { _tag: 'ManifestInvalid' } })
          expect(JSON.stringify(s.outcome)).toContain('packages/publishable/package.json')
        })
      ),
    ),
  )
})
