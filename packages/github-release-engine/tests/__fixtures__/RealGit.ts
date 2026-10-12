import type { RepoRoot } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'

export const git = (cwd: string, ...args: ReadonlyArray<string>) =>
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

export const SEED_IDENTITY: ReadonlyArray<string> = ['-c', 'user.name=seed', '-c', 'user.email=seed@example.invalid']

export const writeFiles = (root: string, files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        const full = path.join(root, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }), { discard: true })
  })

export const insideRepo = <A, E, R>(root: RepoRoot, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(root)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => process.chdir(previous)),
  )

const GIT_IDENTITY_VARIABLES = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'EMAIL',
] as const

export const withoutGitIdentity = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const home = yield* fs.makeTempDirectory({ prefix: 'release-git-home-' })
    const overrides: Record<string, string | undefined> = {
      HOME: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      ...Object.fromEntries(GIT_IDENTITY_VARIABLES.map((name) => [name, undefined])),
    }
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const saved = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]))
        for (const [name, value] of Object.entries(overrides)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
        return saved
      }),
      () => effect,
      (saved) =>
        Effect.sync(() => {
          for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
          }
        }),
    )
  })
