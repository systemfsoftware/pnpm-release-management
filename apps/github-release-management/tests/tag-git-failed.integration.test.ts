import { NodeServices } from '@effect/platform-node'
import { Reporter } from '@systemfsoftware/cli-adapter'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { renderTagRefusal } from '@systemfsoftware/github-release-management/render'
import { GitPort, ReleaseTag, RemoteName, type TagGitFailed } from '@systemfsoftware/release-language'
import { Effect, Layer, Option, Ref } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const TAG = '@scope/alpha@v1.0.0'
const REJECTION = 'refusing tag pushes in this fixture'
const EXPECTED_COMMAND = `git push origin refs/tags/${TAG}`

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make('git', args, { cwd })
      const [stdout, code] = yield* Effect.all([
        Stream.mkString(Stream.decodeText(handle.stdout)),
        handle.exitCode,
      ], { concurrency: 'unbounded' })
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
      return stdout.trim()
    }),
  )

const taggedRepo = () =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const scratch = yield* fs.makeTempDirectory({ prefix: 'tag-git-failed-' })
    const root = path.join(scratch, 'work')
    const remote = path.join(scratch, 'origin.git')
    yield* fs.makeDirectory(root, { recursive: true })
    yield* fs.writeFileString(path.join(root, 'README.md'), '# fixture\n')
    yield* git(scratch, 'init', '-q', '--bare', remote)
    const hook = path.join(remote, 'hooks', 'pre-receive')
    yield* fs.writeFileString(hook, `#!/bin/sh\necho '${REJECTION}' >&2\nexit 1\n`)
    yield* fs.chmod(hook, 0o755)
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'config', 'commit.gpgsign', 'false')
    yield* git(root, 'remote', 'add', 'origin', remote)
    yield* git(root, 'add', '-A')
    yield* git(
      root,
      '-c',
      'user.name=seed',
      '-c',
      'user.email=seed@example.invalid',
      'commit',
      '-q',
      '-m',
      'chore: seed',
    )
    yield* git(root, 'tag', TAG)
    return { scratch, root, remote }
  })

const insideRepo = <A, E, R>(root: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(root)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => process.chdir(previous)),
  )

const pushTag = Effect.gen(function*() {
  const port = yield* GitPort
  return yield* port.pushTags([ReleaseTag.make(TAG)], RemoteName.make('origin'))
})

Feature('Tagging reports a failed git push with git stderr').body(({ scenario }) => {
  scenario(
    'The origin rejects the tag push with a pre-receive hook',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a work repo whose origin refuses tag pushes from its pre-receive hook')(
        'repo',
        () => taggedRepo(),
      ),
      When('the tag is pushed with the real git adapter')(
        'run',
        (s) =>
          insideRepo(
            s.repo.root,
            Effect.match(pushTag.pipe(Effect.provide(GitLive)), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (count) => ({ _tag: 'pushed' as const, count }),
            }),
          ),
      ),
      Then('the refusal names the push command and the annotation carries the hook error')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          yield* Effect.ensuring(
            Effect.gen(function*() {
              const failure = Match.value(s.run).pipe(
                Match.tag('refused', ({ refusal }) =>
                  Match.value(refusal).pipe(
                    Match.tag('TagGitFailed', (failed) => Option.some(failed)),
                    Match.orElse(() => Option.none<TagGitFailed>()),
                  )),
                Match.orElse(() => Option.none<TagGitFailed>()),
              )
              if (Option.isNone(failure)) {
                return yield* Effect.die(new Error(`expected a TagGitFailed, got ${JSON.stringify(s.run)}`))
              }
              expect(failure.value.command).toEqual(EXPECTED_COMMAND)
              expect(failure.value.stderr).toContain(REJECTION)

              const annotations = yield* Ref.make<ReadonlyArray<string>>([])
              const exitCodes = yield* Ref.make<ReadonlyArray<number>>([])
              const reporter = Layer.succeed(Reporter, {
                emit: () => Effect.void,
                note: () => Effect.void,
                annotateError: (text: string) => Ref.update(annotations, (lines) => [...lines, text]),
                exitCode: (code: number) => Ref.update(exitCodes, (codes) => [...codes, code]),
              })
              yield* renderTagRefusal(failure.value).pipe(Effect.provide(reporter))

              const annotated = (yield* Ref.get(annotations)).join('\n')
              expect(annotated).toContain(`git command failed: ${EXPECTED_COMMAND}`)
              expect(annotated).toContain(REJECTION)
              expect(yield* Ref.get(exitCodes)).toEqual([1])
            }),
            fs.remove(s.repo.scratch, { recursive: true }).pipe(Effect.orDie),
          )
        })
      ),
    ),
  )
})
