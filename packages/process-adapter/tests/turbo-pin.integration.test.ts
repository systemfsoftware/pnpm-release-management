import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  ChangeEvidencePort,
  EvidenceCommandFailed,
  GitRef,
  RelativePath,
  RepoRoot,
  TaskName,
  TurboPinUnusable,
} from '@systemfsoftware/release-language'
import { Cause, Effect, Exit, Option } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'
import { fakeGitChanging, FakeGitOnMain } from './__fixtures__/FakeGitPort.js'
import { evidenceServing, serveTurbo } from './__fixtures__/served-turbo.js'

const Feature = makeFeature({ it, layer })

const TURBO = '2.10.1'
const OTHER_TURBO = '2.10.0'
const CHANGED = [RelativePath.make('packages/pub/index.js')]

const lockfile = (packages?: string): string => {
  const head = [
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
  ]
  if (packages === undefined) {
    return head.join('\n')
  }
  return [...head, 'packages:', '', packages, ''].join('\n')
}

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
  stream: `---\n${envDocument}\n---\n${lockfile()}`,
  single: lockfile(),
  unpinned: `---\n${envDocument}`,
} as const

type Shape = keyof typeof LOCKFILES

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

const writeAt = (root: string, file: string, text: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true })
    yield* fs.writeFileString(path.join(root, file), text)
  })

const repositoryWith = (lockfileText: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'turbo-pin-' })
    yield* writeAt(root, 'packages/pub/package.json', JSON.stringify({ name: '@t/pub', version: '1.0.0' }))
    yield* writeAt(root, 'packages/pub/index.js', 'export const pub = 1\n')
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'base')
    yield* git(root, 'tag', 'base')
    yield* writeAt(root, 'packages/pub/package.json', JSON.stringify({ name: '@t/pub', version: '1.1.0' }))
    yield* writeAt(root, 'packages/pub/index.js', 'export const pub = 2\n')
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'change pub')
    yield* fs.writeFileString(path.join(root, 'pnpm-lock.yaml'), lockfileText)
    return root
  })

const repositoryServingThePin = Effect.gen(function*() {
  const served = serveTurbo({ pin: TURBO })
  return { served, root: yield* repositoryWith(lockfile(served.packagesYaml())) }
})

const repositoryServingAnotherVersion = Effect.gen(function*() {
  const served = serveTurbo({ pin: TURBO, reportedVersion: OTHER_TURBO })
  return { served, root: yield* repositoryWith(lockfile(served.packagesYaml())) }
})

const repositoryRecordingForeignBytes = Effect.gen(function*() {
  const served = serveTurbo({ pin: TURBO })
  const foreign = serveTurbo({ pin: TURBO, reportedVersion: OTHER_TURBO })
  return { served, root: yield* repositoryWith(lockfile(served.packagesYaml(foreign.integrity))) }
})

const repositoryRecordingNoPlatformPackage = Effect.gen(function*() {
  const served = serveTurbo({ pin: TURBO })
  return { served, root: yield* repositoryWith(lockfile()) }
})

const removeRepository = (root: string) =>
  Effect.flatMap(FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))

const turboEvidenceAt = (root: string, ref: string) =>
  Effect.flatMap(
    ChangeEvidencePort,
    (port) => port.turboEvidence(RepoRoot.make(root), GitRef.make(ref), TaskName.make('build')),
  )

const refusalOf = <E>(exit: Exit.Exit<unknown, E>): E | undefined =>
  Exit.match(exit, {
    onSuccess: () => undefined,
    onFailure: (cause) => Option.getOrUndefined(Cause.findErrorOption(cause)),
  })

const detailOf = (refusal: unknown): string => {
  if (refusal instanceof TurboPinUnusable) {
    return refusal.detail
  }
  return ''
}

Feature('Turbo change evidence runs the turbo the lockfile pins').body(({ scenario }) => {
  scenario(
    'A pnpm 12 lockfile stream and a single-document lockfile both get past the pin, and a stream without one is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given(
        'three non-repository directories holding a pnpm 12 env+project lockfile stream, a single-document lockfile, and an env-only stream',
      )(
        'dirs',
        () =>
          Effect.gen(function*() {
            const served = serveTurbo({ pin: TURBO })
            const fs = yield* FileSystem
            const path = yield* Path
            const base = yield* fs.makeTempDirectory({ prefix: 'turbo-pin-' })
            const dir = (shape: Shape): string => path.join(base, shape)
            for (const shape of ['stream', 'single', 'unpinned'] as const) {
              yield* fs.makeDirectory(dir(shape), { recursive: true })
              yield* fs.writeFileString(path.join(dir(shape), 'pnpm-lock.yaml'), LOCKFILES[shape])
            }
            return { base, dir, served }
          }),
      ),
      When('turbo evidence is collected in each')(
        'refusals',
        (s) =>
          Effect.gen(function*() {
            const provided = evidenceServing(s.dirs.served, FakeGitOnMain)
            const collect = (shape: Shape) =>
              Effect.exit(turboEvidenceAt(s.dirs.dir(shape), 'main')).pipe(
                Effect.map(refusalOf),
                Effect.provide(provided),
              )
            return {
              stream: yield* collect('stream'),
              single: yield* collect('single'),
              unpinned: yield* collect('unpinned'),
            }
          }),
      ),
      Then(
        'both lockfile shapes pass the pin and stop at git, the env-only stream is refused at the pin, and no registry is asked',
      )((s) =>
        Effect.gen(function*() {
          expect(s.refusals.stream).toBeInstanceOf(EvidenceCommandFailed)
          expect(s.refusals.single).toBeInstanceOf(EvidenceCommandFailed)
          expect(s.refusals.unpinned).toBeInstanceOf(TurboPinUnusable)
          expect(detailOf(s.refusals.unpinned)).toBe(
            "change-evidence: no lockfileVersion 9.0 document in pnpm-lock.yaml pins 'turbo' as a root devDependency",
          )
          expect(s.dirs.served.requests).toEqual([])
          yield* removeRepository(s.dirs.base)
        })
      ),
    ),
  )

  scenario(
    'A repository with no install is judged by the turbo its lockfile pins',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given(
        'a repository whose head changes a package, with no node_modules, and a registry serving the turbo its lockfile pins',
      )('fixture', () => repositoryServingThePin),
      When('turbo evidence is collected against base')(
        'evidence',
        (s) =>
          turboEvidenceAt(s.fixture.root, 'base').pipe(
            Effect.provide(evidenceServing(s.fixture.served, fakeGitChanging(CHANGED))),
          ),
      ),
      Then('the fetched binary judges both sides, the pin is the engine version, and the registry was asked once')(
        (s) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            expect(s.evidence.members.map((member) => member.name)).toEqual(['@t/pub'])
            expect(s.evidence.touched).toEqual(['@t/pub'])
            expect(s.evidence.raw).toMatchObject({ strategy: 'turbo', engineVersion: TURBO })
            expect(s.fixture.served.requests).toEqual([new URL(s.fixture.served.url).pathname])
            expect(yield* fs.exists(`${s.fixture.root}/node_modules`)).toBe(false)
            yield* removeRepository(s.fixture.root)
          }),
      ),
    ),
  )

  scenario(
    'A fetched turbo that reports another version than the lockfile pins is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a repository whose lockfile pins a turbo the registry serves as another version')(
        'fixture',
        () => repositoryServingAnotherVersion,
      ),
      When('turbo evidence is collected against base')(
        'exit',
        (s) =>
          Effect.exit(turboEvidenceAt(s.fixture.root, 'base')).pipe(
            Effect.provide(evidenceServing(s.fixture.served, fakeGitChanging(CHANGED))),
          ),
      ),
      Then('the refusal names the reported version and the pinned one')((s) =>
        Effect.gen(function*() {
          const refusal = refusalOf(s.exit)
          expect(refusal).toBeInstanceOf(TurboPinUnusable)
          expect(detailOf(refusal)).toBe(
            `change-evidence: fetched ${s.fixture.served.key} reports ${OTHER_TURBO}, not the lockfile pin ${TURBO}`,
          )
          yield* removeRepository(s.fixture.root)
        })
      ),
    ),
  )

  scenario(
    'Fetched bytes that do not hash to the integrity the lockfile records are refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a repository whose lockfile records the integrity of a turbo the registry did not serve')(
        'fixture',
        () => repositoryRecordingForeignBytes,
      ),
      When('turbo evidence is collected against base')(
        'exit',
        (s) =>
          Effect.exit(turboEvidenceAt(s.fixture.root, 'base')).pipe(
            Effect.provide(evidenceServing(s.fixture.served, fakeGitChanging(CHANGED))),
          ),
      ),
      Then('the refusal names the fetched integrity against the recorded one')((s) =>
        Effect.gen(function*() {
          const refusal = refusalOf(s.exit)
          expect(refusal).toBeInstanceOf(TurboPinUnusable)
          const detail = detailOf(refusal)
          expect(detail.startsWith(`change-evidence: fetched ${s.fixture.served.key} has integrity sha512-`)).toBe(true)
          expect(detail.endsWith('pnpm-lock.yaml records')).toBe(true)
          yield* removeRepository(s.fixture.root)
        })
      ),
    ),
  )

  scenario(
    'A lockfile that records no integrity for the platform turbo is refused before any fetch',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a repository whose lockfile pins turbo but records no platform package')(
        'fixture',
        () => repositoryRecordingNoPlatformPackage,
      ),
      When('turbo evidence is collected against base')(
        'exit',
        (s) =>
          Effect.exit(turboEvidenceAt(s.fixture.root, 'base')).pipe(
            Effect.provide(evidenceServing(s.fixture.served, fakeGitChanging(CHANGED))),
          ),
      ),
      Then('the refusal names the package and the platform, and the registry is never asked')((s) =>
        Effect.gen(function*() {
          const refusal = refusalOf(s.exit)
          expect(refusal).toBeInstanceOf(TurboPinUnusable)
          expect(detailOf(refusal)).toBe(
            `change-evidence: pnpm-lock.yaml records no integrity for ${s.fixture.served.key}, the turbo binary for ${process.platform} ${process.arch}`,
          )
          expect(s.fixture.served.requests).toEqual([])
          yield* removeRepository(s.fixture.root)
        })
      ),
    ),
  )
})
