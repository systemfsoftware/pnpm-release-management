import { gateChangesCell } from '@systemfsoftware/changeset-engine'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type Bump,
  ChangeEvidencePort,
  CommitSha,
  GitRef,
  type Intent,
  IntentSummary,
  type Member,
  PackageName,
  PackageVersion,
  type PathChange,
  type RangeCommit,
  RelativePath,
  ReleaseConfig,
  ReleaseConfigStore,
  ReleaseReplayPort,
  RepoRoot,
  type TurboComparison,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'
import { fakeChangesetStore } from './FakeChangesetStore.js'
import { fakeWorkspaceStore } from './FakeWorkspaceStore.js'

export type Tree = Readonly<Record<string, string>>

export interface FakeCommit {
  readonly sha: string
  readonly parents: ReadonlyArray<string>
  readonly tree: Tree
}

export interface FakeHistory {
  readonly mergeBase: string
  readonly commits: ReadonlyArray<FakeCommit>
  readonly range: ReadonlyArray<string>
}

const INTENT_DIR = '.changeset'

export const manifestPath = (name: string): string => `packages/${name}/package.json`

export const intentPath = (slug: string): string => `${INTENT_DIR}/${slug}.md`

export const intentText = (entries: Readonly<Record<string, Bump>>): string =>
  ['---', ...Object.entries(entries).map(([name, bump]) => `"${name}": ${bump}`), '---', '', 'A change.', ''].join('\n')

const ENTRY = /^"([^"]+)": (none|patch|minor|major)$/

const entriesOf = (text: string): ReadonlyArray<{ readonly name: string; readonly bump: Bump }> =>
  text.split('\n').flatMap((line) => {
    const match = ENTRY.exec(line)
    const name = match?.[1]
    const bump = S.decodeUnknownOption(S.Literals(['none', 'patch', 'minor', 'major']))(match?.[2])
    if (name === undefined || Option.isNone(bump)) return []
    return [{ name, bump: bump.value }]
  })

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const bumpedManifest = (name: string, bump: Bump): string => `{"name":"${name}","bump":"${bump}"}`

const modelRelease = (tree: Tree, consumed: ReadonlyArray<string>): Tree => {
  const owed: Record<string, Bump> = {}
  for (const path of consumed) {
    for (const entry of entriesOf(tree[path] ?? '')) {
      const before = owed[entry.name]
      if (before === undefined || RANK[entry.bump] > RANK[before]) owed[entry.name] = entry.bump
    }
  }
  const next: Record<string, string> = {}
  for (const [path, text] of Object.entries(tree)) {
    if (!consumed.includes(path)) next[path] = text
  }
  for (const [name, bump] of Object.entries(owed)) {
    if (bump !== 'none') next[manifestPath(name)] = bumpedManifest(name, bump)
  }
  return next
}

const shaOf = (name: string): CommitSha => CommitSha.make(Buffer.from(name.padEnd(2, '-')).toString('hex'))

const nameOf = (sha: string): string => Buffer.from(sha, 'hex').toString().replace(/-+$/, '')

const treeAt = (history: FakeHistory, sha: string): Tree => {
  const commit = history.commits.find((candidate) => candidate.sha === nameOf(sha))
  if (commit === undefined) throw new Error(`FakeHistory: no commit ${sha}`)
  return commit.tree
}

const diff = (before: Tree, after: Tree): ReadonlyArray<PathChange> =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((path): ReadonlyArray<PathChange> => {
    const was = before[path]
    const now = after[path]
    if (was === now) return []
    if (was === undefined) return [{ path: RelativePath.make(path), status: 'added' }]
    if (now === undefined) return [{ path: RelativePath.make(path), status: 'deleted' }]
    return [{ path: RelativePath.make(path), status: 'modified' }]
  })

const rangeCommitOf = (history: FakeHistory, name: string): RangeCommit => {
  const commit = history.commits.find((candidate) => candidate.sha === name)
  if (commit === undefined) throw new Error(`FakeHistory: no commit ${name}`)
  const sha = shaOf(name)
  const parents = commit.parents.map(shaOf)
  const [first, second] = parents
  if (first === undefined) return { sha, parents, changes: [], residue: [] }
  if (second === undefined) {
    return { sha, parents, changes: diff(treeAt(history, first), commit.tree), residue: [] }
  }
  const left = treeAt(history, first)
  const right = treeAt(history, second)
  const residue = Object.keys({ ...left, ...right, ...commit.tree }).sort().filter((path) =>
    commit.tree[path] !== left[path] && commit.tree[path] !== right[path]
  )
  return { sha, parents, changes: [], residue: residue.map((path) => RelativePath.make(path)) }
}

const headOf = (history: FakeHistory): string => history.range.at(-1) ?? history.mergeBase

const evidenceOf = (history: FakeHistory, turbo: TurboComparison | undefined, deleted: ReadonlyArray<string>) =>
  Layer.succeed(ChangeEvidencePort, {
    range: () => {
      const mergeBase = shaOf(history.mergeBase)
      return Effect.succeed({ head: shaOf(headOf(history)), base: mergeBase, mergeBase })
    },
    refuseUnderTurbo: () => Effect.void,
    commits: () => Effect.succeed(history.range.map((sha) => rangeCommitOf(history, sha))),
    changes: (_, from, to) => Effect.succeed(diff(treeAt(history, from), treeAt(history, to))),
    filesIn: (_, rev, dir) =>
      Effect.succeed(
        Object.keys(treeAt(history, rev)).filter((path) =>
          path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')
        ).sort().map((path) => RelativePath.make(path)),
      ),
    fileAt: (_, rev, path) => Effect.succeed(treeAt(history, rev)[path]),
    deletedMembers: () => Effect.succeed(deleted.map((name) => PackageName.make(name))),
    turbo: () => {
      if (turbo === undefined) return Effect.die(new Error('FakeHistory: no turbo comparison was given'))
      return Effect.succeed(turbo)
    },
  })

const replayOf = (history: FakeHistory) =>
  Layer.succeed(ReleaseReplayPort, {
    replay: (_, candidate) => {
      const expected = modelRelease(treeAt(history, candidate.parent), candidate.consumed)
      const divergent = diff(expected, treeAt(history, candidate.commit)).map((change) => change.path)
      return Effect.succeed({ _tag: 'ReleaseReplayed' as const, divergent })
    },
  })

const configStore = Layer.succeed(ReleaseConfigStore, {
  loadConfig: () => Effect.die(new Error('FakeHistory: loadConfig is not used by the gate')),
  parseConfig: (text) => {
    const parsed: unknown = JSON.parse(text)
    return Effect.succeed(
      S.decodeUnknownSync(ReleaseConfig)({
        base: 'main',
        branch: 'changeset-release/main',
        changesetDir: S.decodeUnknownSync(S.Struct({ changesetDir: S.String }))(parsed).changesetDir,
        versioning: { strategy: 'changesets' },
        gate: { strategy: 'paths' },
      }),
    )
  },
})

export const member = (name: string, publishable = true): Member => ({
  name: PackageName.make(name),
  dir: RelativePath.make(`packages/${name}`),
  manifest: { name: PackageName.make(name), version: PackageVersion.make('1.0.0') },
  publishable,
})

const liveIntentsOf = (tree: Tree): ReadonlyArray<Intent> =>
  Object.keys(tree).filter((path) => path.startsWith(`${INTENT_DIR}/`) && path.endsWith('.md')).sort().map((
    path,
  ) => ({
    path: RelativePath.make(path),
    packages: entriesOf(tree[path] ?? '').map((entry) => ({ name: PackageName.make(entry.name), bump: entry.bump })),
    summary: IntentSummary.make('A change.'),
  }))

export interface GateRun {
  readonly members: ReadonlyArray<Member>
  readonly history: FakeHistory
  readonly turbo?: TurboComparison
  readonly strategy?: 'paths' | 'turbo'
  readonly skipLiveness?: boolean
  readonly deleted?: ReadonlyArray<string>
}

export const gateReport = (run: GateRun) =>
  Cell.run(
    Cell.provide(Layer.mergeAll(
      fakeWorkspaceStore(run.members),
      fakeChangesetStore({ intents: liveIntentsOf(treeAt(run.history, shaOf(headOf(run.history)))) }).layer,
      evidenceOf(run.history, run.turbo, run.deleted ?? []),
      replayOf(run.history),
      configStore,
    ))(gateChangesCell),
    {
      root: RepoRoot.make('/repo'),
      ref: GitRef.make('main'),
      changesetDir: RelativePath.make(INTENT_DIR),
      strategy: run.strategy ?? 'paths',
      task: undefined,
      skipLiveness: run.skipLiveness,
    },
  )

export const linear = (base: Tree, ...steps: ReadonlyArray<(tree: Tree) => Tree>): FakeHistory => {
  const commits: Array<FakeCommit> = [{ sha: 'm0', parents: [], tree: base }]
  for (const [index, step] of steps.entries()) {
    const parent = commits.at(-1)
    if (parent === undefined) break
    commits.push({ sha: `c${index + 1}`, parents: [parent.sha], tree: step(parent.tree) })
  }
  return { mergeBase: 'm0', commits, range: commits.slice(1).map((commit) => commit.sha) }
}

export const withFiles = (files: Tree) => (tree: Tree): Tree => ({ ...tree, ...files })
