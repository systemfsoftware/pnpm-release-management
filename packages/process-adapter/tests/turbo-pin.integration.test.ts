import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  ChangeEvidencePort,
  EvidenceCommandFailed,
  GitRef,
  RepoRoot,
  TaskName,
  TurboPinUnusable,
} from '@systemfsoftware/release-language'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'
import { FakeGitOnMain } from './__fixtures__/FakeGitPort.js'

const Feature = makeFeature({ it, layer })

const TURBO = '2.10.1'

const live = Layer.merge(ChangeEvidenceLive.pipe(Layer.provide(FakeGitOnMain)), NodeServices.layer)

const projectDocument = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    devDependencies:',
  '      turbo:',
  `        specifier: ^${TURBO}`,
  `        version: ${TURBO}`,
  '',
].join('\n')

const envDocument = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    configDependencies: {}',
  '    packageManagerDependencies:',
  '      pnpm:',
  '        specifier: 12.9.0',
  '        version: 12.9.0',
  '',
].join('\n')

const LOCKFILES = {
  stream: `---\n${envDocument}\n---\n${projectDocument}`,
  single: projectDocument,
  unpinned: `---\n${envDocument}`,
} as const

type Shape = keyof typeof LOCKFILES

const refusalOf = <E>(exit: Exit.Exit<unknown, E>): E | undefined =>
  Exit.match(exit, {
    onSuccess: () => undefined,
    onFailure: (cause) => Option.getOrUndefined(Cause.findErrorOption(cause)),
  })

Feature('Turbo change evidence reads its pin from the pnpm lockfile').body(({ scenario }) => {
  scenario(
    'A pnpm 12 lockfile stream and a single-document lockfile both get past the pin, and a stream without one is refused',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given(
        `three non-repository directories with turbo ${TURBO} installed: a pnpm 12 env+project stream, a single document, and an env-only stream`,
      )(
        'dirs',
        () =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const path = yield* Path
            const base = yield* fs.makeTempDirectory({ prefix: 'turbo-pin-' })
            const dir = (shape: Shape): string => path.join(base, shape)
            for (const shape of ['stream', 'single', 'unpinned'] as const) {
              yield* fs.makeDirectory(path.join(dir(shape), 'node_modules', 'turbo'), { recursive: true })
              yield* fs.writeFileString(path.join(dir(shape), 'pnpm-lock.yaml'), LOCKFILES[shape])
              yield* fs.writeFileString(
                path.join(dir(shape), 'node_modules', 'turbo', 'package.json'),
                JSON.stringify({ version: TURBO }),
              )
            }
            return { base, dir }
          }),
      ),
      When('turbo evidence is collected in each')(
        'refusals',
        (s) =>
          Effect.gen(function*() {
            const evidence = yield* ChangeEvidencePort
            const collect = (shape: Shape) =>
              Effect.exit(
                evidence.turboEvidence(RepoRoot.make(s.dirs.dir(shape)), GitRef.make('main'), TaskName.make('build')),
              )
                .pipe(Effect.map(refusalOf))
            return {
              stream: yield* collect('stream'),
              single: yield* collect('single'),
              unpinned: yield* collect('unpinned'),
            }
          }),
      ),
      Then('both lockfile shapes pass the pin and stop at git, and the env-only stream is refused at the pin')(
        (s) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            expect(s.refusals.stream).toBeInstanceOf(EvidenceCommandFailed)
            expect(s.refusals.single).toBeInstanceOf(EvidenceCommandFailed)
            expect(s.refusals.unpinned).toBeInstanceOf(TurboPinUnusable)
            yield* fs.remove(s.dirs.base, { recursive: true, force: true })
          }),
      ),
    ),
  )
})
