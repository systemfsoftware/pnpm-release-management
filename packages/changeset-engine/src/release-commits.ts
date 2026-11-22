import {
  type CommitSha,
  isIntentPath,
  type Member,
  type PackageName,
  type RangeCommit,
  type RelativePath,
  type ReleaseCandidate,
  type ReleaseCheck,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'

export interface IntentDirs {
  readonly base: RelativePath
  readonly head: RelativePath
}

export const isIntentFile = (dirs: IntentDirs, path: string): boolean =>
  isIntentPath(dirs.base, path) || isIntentPath(dirs.head, path)

export const releaseCandidateOf = (
  commit: RangeCommit,
  baseIntents: ReadonlyArray<RelativePath>,
  dirs: IntentDirs,
): ReleaseCandidate | undefined => {
  const [parent, second] = commit.parents
  if (parent === undefined || second !== undefined) return undefined
  const intentChanges = commit.changes.filter((change) => isIntentFile(dirs, change.path))
  if (intentChanges.some((change) => change.status !== 'deleted')) return undefined
  const consumed = intentChanges.map((change) => change.path).filter((path) => baseIntents.includes(path))
  if (consumed.length === 0) return undefined
  return {
    commit: commit.sha,
    parent,
    consumed,
    intentOnly: intentChanges.length === commit.changes.length,
  }
}

export const releaseCandidatesOf = (
  commits: ReadonlyArray<RangeCommit>,
  baseIntents: ReadonlyArray<RelativePath>,
  dirs: IntentDirs,
): ReadonlyArray<ReleaseCandidate> =>
  commits.flatMap((commit) => {
    const candidate = releaseCandidateOf(commit, baseIntents, dirs)
    if (candidate === undefined) return []
    return [candidate]
  })

export const isVerifiedRelease = (check: ReleaseCheck): boolean =>
  Match.value(check.outcome).pipe(
    Match.tag('ReleaseReplayed', (replayed) => replayed.divergent.length === 0),
    Match.tag('ReleaseUnreplayed', () => false),
    Match.exhaustive,
  )

const verifiedShas = (checks: ReadonlyArray<ReleaseCheck>): ReadonlyArray<CommitSha> =>
  checks.filter(isVerifiedRelease).map((check) => check.candidate.commit)

export interface ChangedPath {
  readonly path: RelativePath
  readonly owner?: PackageName | undefined
  readonly released: boolean
}

export const changedPathsOf = (
  commits: ReadonlyArray<RangeCommit>,
  checks: ReadonlyArray<ReleaseCheck>,
  changed: ReadonlyArray<RelativePath>,
  members: ReadonlyArray<Member>,
): ReadonlyArray<ChangedPath> => {
  const verified = verifiedShas(checks)
  const releaseTouched = new Set<string>()
  const featureTouched = new Set<string>()
  for (const commit of commits) {
    const released = verified.includes(commit.sha)
    for (const change of commit.changes) {
      if (released) releaseTouched.add(change.path)
      else featureTouched.add(change.path)
    }
    for (const path of commit.residue) featureTouched.add(path)
  }
  return changed.map((path) => ({
    path,
    owner: ownerOf(members, path)?.name,
    released: releaseTouched.has(path) && !featureTouched.has(path),
  }))
}

const RELEASE_SURFACES: ReadonlyArray<string> = ['release.jsonc', 'pnpm-workspace.yaml', 'package.json']

export const staleSurfacesOf = (
  sinceParent: ReadonlyArray<RelativePath>,
  dirs: IntentDirs,
): ReadonlyArray<RelativePath> =>
  sinceParent.filter((path) =>
    RELEASE_SURFACES.includes(path) ||
    path.endsWith('/package.json') ||
    (path.startsWith(`${dirs.base}/`) && !isIntentFile(dirs, path))
  )

const ownsPath = (dir: RelativePath, path: string): boolean => path.startsWith(`${dir}/`)

const ownerOf = (members: ReadonlyArray<Member>, path: string): Member | undefined => {
  let owner: Member | undefined
  for (const member of members) {
    if (!ownsPath(member.dir, path)) continue
    if (owner === undefined || member.dir.length > owner.dir.length) owner = member
  }
  return owner
}
