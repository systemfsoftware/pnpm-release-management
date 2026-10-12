import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  ChangeEvidencePort,
  GitRef,
  PathsGateUnderTurbo,
  RelativePath,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'
import { fakeGitChanging } from './__fixtures__/FakeGitPort.js'

const Feature = makeFeature({ it, layer })

const CHANGED = RelativePath.make('packages/pub/index.js')

const live = Layer.merge(ChangeEvidenceLive.pipe(Layer.provide(fakeGitChanging([CHANGED]))), NodeServices.layer)

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(
        'git',
        ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
        { cwd },
      )
      const code = yield* handle.exitCode
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
    }),
  )

const CONFIG_FILES = {
  'no turbo config': [],
  'turbo.json': ['turbo.json'],
  'turbo.jsonc': ['turbo.jsonc'],
} as const

type RootConfig = keyof typeof CONFIG_FILES

const repositoryChangingPub = (base: RootConfig, head: RootConfig) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'paths-under-turbo-' })
    const write = (file: string, text: string) =>
      Effect.flatMap(
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        () => fs.writeFileString(path.join(root, file), text),
      )
    yield* write('packages/pub/package.json', JSON.stringify({ name: '@t/pub', version: '1.0.0' }))
    yield* write(CHANGED, 'export const pub = 1\n')
    yield* Effect.forEach(CONFIG_FILES[base], (file) => write(file, '{ "tasks": { "build": {} } }\n'))
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'base')
    yield* git(root, 'tag', 'base')
    yield* Effect.forEach(CONFIG_FILES[base], (file) => fs.remove(path.join(root, file)))
    yield* Effect.forEach(CONFIG_FILES[head], (file) => write(file, '{ "tasks": { "build": {} } }\n'))
    yield* write(CHANGED, 'export const pub = 2\n')
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'change pub')
    return root
  })

const collectPathsEvidence = (root: string) =>
  Effect.flatMap(ChangeEvidencePort, (port) => port.pathsEvidence(RepoRoot.make(root), GitRef.make('base')))

const refusalOf = <E>(exit: Exit.Exit<unknown, E>): E | undefined =>
  Exit.match(exit, {
    onSuccess: () => undefined,
    onFailure: (cause) => Option.getOrUndefined(Cause.findErrorOption(cause)),
  })

const removeRepository = (root: string) =>
  Effect.flatMap(FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))

Feature('Classifying changes by directory only where turbo cannot').body(({ scenario, scenarioOutline }) => {
  scenarioOutline(
    'A repository whose root keeps <config> on both sides of the pull request is told to use turbo',
    [{ config: 'turbo.json' }, { config: 'turbo.jsonc' }] as const,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a repository whose root kept ${row.config} while a publishable package changed`)(
          'root',
          () => repositoryChangingPub(row.config, row.config),
        ),
        When('its changes are classified by directory')(
          'exit',
          (s) => Effect.exit(collectPathsEvidence(s.root)),
        ),
        Then(`the classification is refused, naming ${row.config} and the turbo fix`)((s) =>
          Effect.gen(function*() {
            const refusal = refusalOf(s.exit)
            expect(refusal).toBeInstanceOf(PathsGateUnderTurbo)
            expect(refusal).toMatchObject({ turboConfig: row.config })
            yield* removeRepository(s.root)
          })
        ),
      ),
    { scenarioLayer: live },
  )

  scenario(
    'Deleting the turbo config without committing the deletion does not reopen directory classification',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('a repository whose root kept turbo.json in both commits but whose working copy has since lost it')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repositoryChangingPub('turbo.json', 'turbo.json')
            const fs = yield* FileSystem
            const path = yield* Path
            yield* fs.remove(path.join(root, 'turbo.json'))
            return root
          }),
      ),
      When('its changes are classified by directory')('exit', (s) => Effect.exit(collectPathsEvidence(s.root))),
      Then('the classification is still refused, naming turbo.json')((s) =>
        Effect.gen(function*() {
          const refusal = refusalOf(s.exit)
          expect(refusal).toBeInstanceOf(PathsGateUnderTurbo)
          expect(refusal).toMatchObject({ turboConfig: 'turbo.json' })
          yield* removeRepository(s.root)
        })
      ),
    ),
  )

  scenarioOutline(
    'A pull request whose base has <base> and whose head has <head> is still classified by directory',
    [
      { base: 'no turbo config', head: 'no turbo config' },
      { base: 'no turbo config', head: 'turbo.json' },
      { base: 'turbo.json', head: 'no turbo config' },
    ] as const,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a repository whose root went from ${row.base} to ${row.head} while a publishable package changed`)(
          'root',
          () => repositoryChangingPub(row.base, row.head),
        ),
        When('its changes are classified by directory')('evidence', (s) => collectPathsEvidence(s.root)),
        Then('the changed publishable package is named as touched')((s) =>
          Effect.gen(function*() {
            expect(s.evidence.touched).toEqual(['@t/pub'])
            yield* removeRepository(s.root)
          })
        ),
      ),
    { scenarioLayer: live },
  )
})
