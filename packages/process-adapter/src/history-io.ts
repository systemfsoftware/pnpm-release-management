import {
  type ChangeRange,
  CommitSha,
  EvidenceCommandFailed,
  EvidenceShallowClone,
  type GitRef,
  type PathChange,
  type RangeCommit,
  RelativePath,
  type RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { type ProcessFault, runProcess } from './ProcessRun.js'

type GitFault = EvidenceCommandFailed | ProcessFault

const gitOutcome = (root: RepoRoot, args: ReadonlyArray<string>) =>
  runProcess({ program: 'git', args, cwd: root, stdio: 'captured' })

const failed = (args: ReadonlyArray<string>, code: number, stderr: string): EvidenceCommandFailed =>
  new EvidenceCommandFailed({
    program: 'git',
    detail: `git ${args.join(' ')} exited ${code}: ${stderr.trim()}`,
  })

export const gitText = (
  root: RepoRoot,
  args: ReadonlyArray<string>,
): Effect.Effect<string, GitFault, ChildProcessSpawner> =>
  Effect.flatMap(gitOutcome(root, args), (out) => {
    if (out.code !== 0) return Effect.fail(failed(args, out.code, out.stderr))
    return Effect.succeed(out.stdout)
  })

const nulFields = (text: string): ReadonlyArray<string> => text.split('\0').filter((field) => field.length > 0)

const shaOf = (root: RepoRoot, rev: string): Effect.Effect<CommitSha, GitFault, ChildProcessSpawner> =>
  Effect.map(
    gitText(root, ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`]),
    (stdout) => CommitSha.make(stdout.trim()),
  )

export const rangeOf = (
  root: RepoRoot,
  ref: GitRef,
): Effect.Effect<ChangeRange, GitFault | EvidenceShallowClone, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const shallow = yield* gitText(root, ['rev-parse', '--is-shallow-repository'])
    if (shallow.trim() === 'true') return yield* Effect.fail(new EvidenceShallowClone({ root }))
    const head = yield* shaOf(root, 'HEAD')
    const base = yield* shaOf(root, ref)
    const mergeBase = CommitSha.make((yield* gitText(root, ['merge-base', base, head])).trim())
    return { head, base, mergeBase }
  })

const STATUS: Record<string, PathChange['status']> = { A: 'added', M: 'modified', T: 'modified', D: 'deleted' }

const statusChanges = (text: string): ReadonlyArray<PathChange> => {
  const fields = nulFields(text)
  const changes: Array<PathChange> = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = STATUS[fields[index]?.charAt(0) ?? '']
    const path = fields[index + 1]
    if (status === undefined || path === undefined) continue
    changes.push({ path: RelativePath.make(path), status })
  }
  return changes
}

export const changesBetween = (
  root: RepoRoot,
  from: string,
  to: string,
): Effect.Effect<ReadonlyArray<PathChange>, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const fork = yield* gitText(root, ['merge-base', from, to])
    const text = yield* gitText(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', fork.trim(), to])
    return statusChanges(text)
  })

const namesBetween = (
  root: RepoRoot,
  from: string,
  to: string,
): Effect.Effect<ReadonlyArray<RelativePath>, GitFault, ChildProcessSpawner> =>
  Effect.map(
    gitText(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-only', from, to]),
    (text) => nulFields(text).map((path) => RelativePath.make(path)),
  )

const MERGE_CONFLICTED = 1

const NO_COMMON_ANCESTOR = 1

const shareAncestor = (
  root: RepoRoot,
  first: CommitSha,
  second: CommitSha,
): Effect.Effect<boolean, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const args = ['merge-base', first, second]
    const out = yield* gitOutcome(root, args)
    if (out.code === 0) return true
    if (out.code === NO_COMMON_ANCESTOR) return false
    return yield* Effect.fail(failed(args, out.code, out.stderr))
  })

const mergeResidue = (
  root: RepoRoot,
  sha: CommitSha,
  first: CommitSha,
  second: CommitSha,
): Effect.Effect<ReadonlyArray<RelativePath>, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const args = ['merge-tree', '--write-tree', '--no-messages', first, second]
    const out = yield* gitOutcome(root, args)
    if (out.code !== 0 && out.code !== MERGE_CONFLICTED) return yield* Effect.fail(failed(args, out.code, out.stderr))
    const tree = out.stdout.split('\n')[0]?.trim() ?? ''
    if (tree === '') return yield* Effect.fail(failed(args, out.code, 'printed no tree'))
    return yield* namesBetween(root, tree, sha)
  })

const commitOf = (
  root: RepoRoot,
  line: string,
): Effect.Effect<RangeCommit, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const [sha = '', ...parentShas] = line.split(' ')
    const commit = CommitSha.make(sha)
    const parents = parentShas.map((parent) => CommitSha.make(parent))
    const [first, second] = parents
    if (first === undefined) {
      const changes = statusChanges(
        yield* gitText(root, ['diff-tree', '-r', '-z', '--root', '--no-renames', '--name-status', commit]),
      )
      return { sha: commit, parents, changes, residue: [] }
    }
    if (second === undefined) {
      return { sha: commit, parents, changes: yield* changesBetween(root, first, commit), residue: [] }
    }
    if (parents.length === 2) {
      const related = yield* shareAncestor(root, first, second)
      if (related) {
        return { sha: commit, parents, changes: [], residue: yield* mergeResidue(root, commit, first, second) }
      }
      return { sha: commit, parents, changes: [], residue: yield* namesBetween(root, first, commit) }
    }
    return { sha: commit, parents, changes: [], residue: yield* namesBetween(root, first, commit) }
  })

export const commitsOf = (
  root: RepoRoot,
  range: ChangeRange,
): Effect.Effect<ReadonlyArray<RangeCommit>, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const listed = yield* gitText(root, [
      'rev-list',
      '--parents',
      '--topo-order',
      '--reverse',
      range.head,
      `^${range.base}`,
    ])
    const lines = listed.split('\n').filter((line) => line.length > 0)
    return yield* Effect.forEach(lines, (line) => commitOf(root, line))
  })

export const filesIn = (
  root: RepoRoot,
  rev: CommitSha,
  dir: RelativePath,
): Effect.Effect<ReadonlyArray<RelativePath>, GitFault, ChildProcessSpawner> =>
  Effect.map(
    gitText(root, ['ls-tree', '-z', '--name-only', rev, '--', `${dir}/`]),
    (text) => nulFields(text).map((path) => RelativePath.make(path)),
  )

export const fileAt = (
  root: RepoRoot,
  rev: CommitSha,
  path: RelativePath,
): Effect.Effect<string | undefined, GitFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const listed = yield* gitText(root, ['ls-tree', '-z', '--name-only', rev, '--', path])
    if (!nulFields(listed).includes(path)) return undefined
    return yield* gitText(root, ['cat-file', 'blob', `${rev}:${path}`])
  })
