import { Effect } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

export const git = (cwd: string, ...args: ReadonlyArray<string>) =>
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
