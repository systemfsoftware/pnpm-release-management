import {
  type CommitSha,
  type EvidenceRefusal,
  RelativePath,
  RepoRoot,
  WorktreeUnavailable,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem } from 'effect'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { gitText } from './history-io.js'
import { runProcess } from './ProcessRun.js'

const WORKTREE_PREFIX = 'changeset-replay-'

const LF_ONLY: ReadonlyArray<string> = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false']

type Requirements = FileSystem.FileSystem | ChildProcessSpawner

export const inWorktreeAt = <A, E, R>(
  root: RepoRoot,
  rev: CommitSha,
  use: (dir: RepoRoot) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | EvidenceRefusal, R | Requirements> =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectory({ prefix: WORKTREE_PREFIX }).pipe(
      Effect.mapError((error) =>
        new WorktreeUnavailable({ detail: `cannot create a worktree directory: ${error.message}` })
      ),
    )
    const added = yield* runProcess({
      program: 'git',
      args: ['worktree', 'add', '--detach', '--force', dir, rev],
      cwd: root,
      stdio: 'captured',
    })
    if (added.code !== 0) {
      yield* fs.remove(dir, { recursive: true }).pipe(Effect.ignore)
      return yield* Effect.fail(new WorktreeUnavailable({ detail: `git worktree failed: ${added.stderr.trim()}` }))
    }
    return yield* Effect.ensuring(
      use(RepoRoot.make(dir)),
      runProcess({ program: 'git', args: ['worktree', 'remove', '--force', dir], cwd: root, stdio: 'captured' }).pipe(
        Effect.ignore,
      ),
    )
  }))

const nulPaths = (text: string): ReadonlyArray<RelativePath> =>
  text.split('\0').filter((path) => path.length > 0).map((path) => RelativePath.make(path))

export const stagedDivergence = (
  dir: RepoRoot,
  created: ReadonlyArray<RelativePath>,
  commit: CommitSha,
): Effect.Effect<ReadonlyArray<RelativePath>, EvidenceRefusal, ChildProcessSpawner> =>
  Effect.gen(function*() {
    yield* gitText(dir, [...LF_ONLY, 'add', '--update'])
    if (created.length > 0) {
      const untracked = nulPaths(
        yield* gitText(dir, [
          '--literal-pathspecs',
          'ls-files',
          '-z',
          '--others',
          '--exclude-standard',
          '--',
          ...created,
        ]),
      )
      if (untracked.length > 0) yield* gitText(dir, [...LF_ONLY, '--literal-pathspecs', 'add', '--', ...untracked])
    }
    const tree = (yield* gitText(dir, [...LF_ONLY, 'write-tree'])).trim()
    return nulPaths(
      yield* gitText(dir, ['diff-tree', '-r', '-z', '--no-renames', '--name-only', tree, `${commit}^{tree}`]),
    )
  })
