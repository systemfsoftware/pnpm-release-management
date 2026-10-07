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
})
