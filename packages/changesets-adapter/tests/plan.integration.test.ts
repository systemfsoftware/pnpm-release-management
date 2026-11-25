import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangesetsPort, GitRef, RepoRoot } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const ROOT_MANIFEST = '{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n'
const WORKSPACE = 'packages:\n  - packages/*\n'
const ALPHA_MANIFEST = '{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n'
const BETA_MANIFEST =
  '{\n  "name": "@e2e/beta",\n  "version": "1.0.0",\n  "dependencies": {\n    "@e2e/alpha": "workspace:^1.0.0"\n  }\n}\n'
const INTENT = '---\n"@e2e/alpha": minor\n---\n\nalpha grows a public export\n'
const LIB_MANIFEST = '{\n  "name": "@e2e/lib",\n  "version": "1.2.3"\n}\n'
const PRIVATE_APP_MANIFEST =
  '{\n  "name": "@e2e/app",\n  "private": true,\n  "dependencies": {\n    "@e2e/lib": "workspace:*"\n  }\n}\n'
const UNVERSIONED_LIB_MANIFEST = '{\n  "name": "@e2e/lib"\n}\n'
const LIB_INTENT = '---\n"@e2e/lib": patch\n---\n\nlib fixes a read\n'
const APP_INTENT = '---\n"@e2e/app": patch\n---\n\napp changes\n'

const workspaceOf = (members: ReadonlyArray<readonly [string, string]>, intent: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'changesets-private-' })
    const files: ReadonlyArray<readonly [string, string]> = [
      ['package.json', ROOT_MANIFEST],
      ['pnpm-workspace.yaml', WORKSPACE],
      ['.changeset/README.md', '# Changesets\n'],
      ['.changeset/intent.md', intent],
      ...members,
    ]
    for (const [file, text] of files) {
      const full = path.join(root, file)
      yield* fs.makeDirectory(path.dirname(full), { recursive: true })
      yield* fs.writeFileString(full, text)
    }
    return RepoRoot.make(root)
  })

const withPort = <A>(root: RepoRoot, effect: Effect.Effect<A, unknown, ChangesetsPort>) =>
  effect.pipe(Effect.provide(ChangesetsPortLive({ root, base: GitRef.make('main') })))

const refusalOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.match(effect, {
    onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
    onSuccess: () => ({ _tag: 'succeeded' as const }),
  })

const ROOT_TEXT = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const dir = yield* fs.makeTempDirectory({ prefix: 'changesets-always-' })
      const files: ReadonlyArray<readonly [string, string]> = [
        ['package.json', ROOT_MANIFEST],
        ['pnpm-workspace.yaml', WORKSPACE],
        ['packages/alpha/package.json', ALPHA_MANIFEST],
        ['packages/beta/package.json', BETA_MANIFEST],
        ['.changeset/README.md', '# Changesets\n'],
        ['.changeset/alpha-minor.md', INTENT],
      ]
      for (const [file, text] of files) {
        const full = path.join(dir, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }
      return dir
    }),
    NodeServices.layer,
  ),
)

const root = RepoRoot.make(ROOT_TEXT)

const live = Layer.merge(
  ChangesetsPortLive({ root, base: GitRef.make('main') }).pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
)

Feature('Workspace dependents').body(({ scenario }) => {
  scenario(
    'A minor intent on one member moves its workspace dependents by a patch',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('alpha and beta in a workspace where beta depends on alpha through the workspace caret range')(
        'ready',
        () => Effect.void,
      ),
      When('the pending intents are planned')('outcome', () =>
        Effect.gen(function*() {
          const changesets = yield* ChangesetsPort
          return yield* changesets.plan()
        })),
      Then('alpha takes the minor and beta takes the patch')((s) =>
        Effect.sync(() => {
          const alpha = s.outcome.releases.find((release) => release.name === '@e2e/alpha')
          const beta = s.outcome.releases.find((release) => release.name === '@e2e/beta')
          expect(alpha?.type).toBe('minor')
          expect(alpha?.newVersion).toBe('1.1.0')
          expect(beta?.type).toBe('patch')
          expect(beta?.newVersion).toBe('1.0.1')
        })
      ),
    ),
  )

  scenario(
    'A release leaves a private dependent without a version unchanged',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a published library and a private application that depends on it')('root', () =>
        workspaceOf([
          ['packages/lib/package.json', LIB_MANIFEST],
          ['packages/app/package.json', PRIVATE_APP_MANIFEST],
        ], LIB_INTENT)),
      When('the library release is planned and applied')('outcome', (s) =>
        withPort(
          s.root,
          Effect.gen(function*() {
            const port = yield* ChangesetsPort
            const plan = yield* port.plan()
            yield* port.apply()
            return plan
          }),
        )),
      Then('only the library version advances')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const path = yield* Path
          expect(s.outcome.releases).toHaveLength(1)
          expect(s.outcome.releases[0]).toMatchObject({ name: '@e2e/lib', type: 'patch', newVersion: '1.2.4' })
          const lib = yield* fs.readFileString(path.join(s.root, 'packages/lib/package.json'))
          const app = yield* fs.readFileString(path.join(s.root, 'packages/app/package.json'))
          expect(lib).toContain('"version": "1.2.4"')
          expect(app).toBe(PRIVATE_APP_MANIFEST)
        })
      ),
    ),
  )

  scenario(
    'A release request for a private application is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a private application without a version')('root', () =>
        workspaceOf([
          ['packages/lib/package.json', LIB_MANIFEST],
          ['packages/app/package.json', PRIVATE_APP_MANIFEST],
        ], APP_INTENT)),
      When('planning and applying are both requested')('outcome', (s) =>
        withPort(
          s.root,
          Effect.gen(function*() {
            const port = yield* ChangesetsPort
            return yield* Effect.all({ plan: refusalOf(port.plan()), apply: refusalOf(port.apply()) })
          }),
        )),
      Then('both requests identify the private application and change nothing')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const path = yield* Path
          for (const outcome of [s.outcome.plan, s.outcome.apply]) {
            expect(outcome).toMatchObject({
              _tag: 'refused',
              refusal: { _tag: 'VersionPrivatePackage', package: '@e2e/app', path: 'packages/app' },
            })
          }
          expect(yield* fs.readFileString(path.join(s.root, 'packages/app/package.json'))).toBe(PRIVATE_APP_MANIFEST)
          expect(yield* fs.readFileString(path.join(s.root, 'packages/lib/package.json'))).toBe(LIB_MANIFEST)
        })
      ),
    ),
  )

  scenario(
    'A release request for a publishable library without a version is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a publishable library without a version')(
        'root',
        () => workspaceOf([['packages/lib/package.json', UNVERSIONED_LIB_MANIFEST]], LIB_INTENT),
      ),
      When('planning and applying are both requested')('outcome', (s) =>
        withPort(
          s.root,
          Effect.gen(function*() {
            const port = yield* ChangesetsPort
            return yield* Effect.all({ plan: refusalOf(port.plan()), apply: refusalOf(port.apply()) })
          }),
        )),
      Then('both requests identify the invalid manifest and change nothing')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const path = yield* Path
          for (const outcome of [s.outcome.plan, s.outcome.apply]) {
            expect(outcome).toMatchObject({ _tag: 'refused', refusal: { _tag: 'ManifestInvalid' } })
            expect(JSON.stringify(outcome)).toContain('packages/lib/package.json')
          }
          expect(yield* fs.readFileString(path.join(s.root, 'packages/lib/package.json'))).toBe(
            UNVERSIONED_LIB_MANIFEST,
          )
        })
      ),
    ),
  )
})
