import type { Bump, Intent, Member, PackageName, RelativePath, ReleaseBump } from '@systemfsoftware/release-language'

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/

export type CollapsedPackage = {
  readonly name: PackageName
  readonly rank: Bump
  readonly summaries: ReadonlyArray<string>
}

export type BumpDerivation = {
  readonly unknownPackage: PackageName | undefined
  readonly malformedPath: RelativePath | undefined
  readonly packages: ReadonlyArray<CollapsedPackage>
  readonly consolidated: Bump
  readonly consolidatedNext: string
  readonly nexts: ReadonlyArray<{ readonly name: PackageName; readonly next: string }>
  readonly moved: ReadonlyArray<PackageName>
  readonly changelogPaths: ReadonlyArray<{ readonly name: PackageName; readonly path: string }>
  readonly intentCount: number
  readonly fallbackSummary: string
  readonly rootBullets: string
}

const topRank = (bumps: ReadonlyArray<Bump>): Bump => {
  let top: Bump = 'none'
  for (const bump of bumps) {
    if (RANK[bump] > RANK[top]) top = bump
  }
  return top
}

export const nextCore = (current: string, rank: ReleaseBump): string => {
  const hit = CORE_PATTERN.exec(current)
  const major = Number(hit?.[1] ?? '0')
  const minor = Number(hit?.[2] ?? '0')
  const patch = Number(hit?.[3] ?? '0')
  const bumped: Record<ReleaseBump, string> = {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }
  return bumped[rank]
}

export const deriveBump = (args: {
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly strategy: 'pnpm' | 'surfaces'
  readonly manifestVersion: string
  readonly changelogDir: string
}): BumpDerivation => {
  const known = new Set(args.members.map((member) => member.name))
  let unknownPackage: PackageName | undefined
  let malformedPath: RelativePath | undefined
  const byName = new Map<PackageName, { rank: Bump; summaries: Array<string> }>()
  for (const intent of args.intents) {
    if (intent.packages.length === 0 && malformedPath === undefined) malformedPath = intent.path
    for (const entry of intent.packages) {
      if (!known.has(entry.name) && unknownPackage === undefined) unknownPackage = entry.name
      const slot: { rank: Bump; summaries: Array<string> } = byName.get(entry.name) ?? {
        rank: 'none',
        summaries: [],
      }
      if (RANK[entry.bump] > RANK[slot.rank]) slot.rank = entry.bump
      if (entry.bump !== 'none') slot.summaries.push(intent.summary)
      byName.set(entry.name, slot)
    }
  }
  const packages = [...byName.entries()].map(([name, slot]) => ({
    name,
    rank: slot.rank,
    summaries: slot.summaries,
  }))
  const consolidated = topRank(packages.map((entry) => entry.rank))
  if (consolidated === 'none') {
    return {
      unknownPackage,
      malformedPath,
      packages,
      consolidated,
      consolidatedNext: args.manifestVersion,
      nexts: [],
      moved: [],
      changelogPaths: [],
      intentCount: args.intents.length,
      fallbackSummary: '',
      rootBullets: '',
    }
  }
  const bumpedCore = nextCore(args.manifestVersion, consolidated)
  const nexts = args.members.map((member) => {
    const collapsed = packages.find((entry) => entry.name === member.name)
    const rank = collapsed?.rank ?? 'none'
    if (args.strategy === 'surfaces') {
      return { name: member.name, next: bumpedCore }
    }
    if (rank === 'none') {
      return { name: member.name, next: member.manifest.version }
    }
    return { name: member.name, next: nextCore(member.manifest.version, rank) }
  })
  const movedNames = nexts.filter((entry) => {
    if (args.strategy === 'surfaces') return true
    const member = args.members.find((candidate) => candidate.name === entry.name)
    return member !== undefined && entry.next !== member.manifest.version
  }).map((entry) => entry.name)
  const changelogPaths = movedNames.map((name) => {
    const entry = nexts.find((candidate) => candidate.name === name)
    const version = entry?.next ?? ''
    const flat = name.replaceAll('/', '!')
    if (version === '') {
      return { name, path: `${args.changelogDir}/${flat}.md` }
    }
    return { name, path: `${args.changelogDir}/${flat}@${version}.md` }
  })
  const fallbackSummary = args.intents.flatMap((intent) => intent.packages.map(() => intent.summary)).join(' ')
  const rootBullets = args.intents.filter((intent) => intent.packages.some((entry) => entry.bump !== 'none')).map((
    intent,
  ) => `  - ${intent.summary}`).join('\n')
  return {
    unknownPackage,
    malformedPath,
    packages,
    consolidated,
    consolidatedNext: bumpedCore,
    moved: movedNames,
    nexts,
    changelogPaths,
    intentCount: args.intents.length,
    fallbackSummary,
    rootBullets,
  }
}
