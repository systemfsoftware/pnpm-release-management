import type { Bump, Intent, Member, PackageName, RelativePath, ReleaseBump } from '@systemfsoftware/release-language'

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/

const coreOf = (version: string): readonly [number, number, number] => {
  const hit = CORE_PATTERN.exec(version)
  return [Number(hit?.[1] ?? '0'), Number(hit?.[2] ?? '0'), Number(hit?.[3] ?? '0')]
}

const nextCore = (current: string, rank: ReleaseBump): string => {
  const core = coreOf(current)
  if (rank === 'major') return `${core[0] + 1}.0.0`
  if (rank === 'minor') return `${core[0]}.${core[1] + 1}.0`
  return `${core[0]}.${core[1]}.${core[2] + 1}`
}

const topRank = (ranks: ReadonlyArray<Bump>): Bump =>
  ranks.reduce<Bump>((top, rank) => {
    if (RANK[rank] > RANK[top]) return rank
    return top
  }, 'none')

export type CollapsedPackage = {
  readonly name: PackageName
  readonly rank: Bump
  readonly summaries: ReadonlyArray<string>
}

export type BumpDerivation = {
  readonly packages: ReadonlyArray<CollapsedPackage>
  readonly consolidated: Bump
  readonly consolidatedNext: string
  readonly nexts: ReadonlyArray<{ readonly name: PackageName; readonly next: string }>
  readonly moved: ReadonlyArray<PackageName>
  readonly changelogPaths: ReadonlyArray<{ readonly name: PackageName; readonly path: string }>
  readonly unknownPackage: PackageName | undefined
  readonly malformedPath: RelativePath | undefined
  readonly intentCount: number
}

export const fallbackSummaryOf = (intents: ReadonlyArray<Intent>): string =>
  intents.flatMap((intent) => intent.packages.map(() => intent.summary)).join(' ')

export const rootBulletsOf = (intents: ReadonlyArray<Intent>): string =>
  intents
    .filter((intent) => intent.packages.some((entry) => entry.bump !== 'none'))
    .map((intent) => `  - ${intent.summary}`)
    .join('\n')

export const summaryForPackage = (intents: ReadonlyArray<Intent>, name: PackageName): string => {
  const own = intents.flatMap((intent) =>
    intent.packages
      .filter((entry) => entry.name === name && entry.bump !== 'none')
      .map(() => intent.summary)
  )
  if (own.length > 0) return own.join(' ')
  return fallbackSummaryOf(intents)
}

const nextOf = (
  strategy: 'pnpm' | 'surfaces',
  member: Member,
  packages: ReadonlyArray<CollapsedPackage>,
  bumpedCore: string,
): { readonly name: PackageName; readonly next: string } => {
  if (strategy === 'surfaces') return { name: member.name, next: bumpedCore }
  const collapsed = packages.find((entry) => entry.name === member.name)
  const rank = collapsed?.rank ?? 'none'
  if (rank === 'none') return { name: member.name, next: member.manifest.version }
  return { name: member.name, next: nextCore(member.manifest.version, rank) }
}

const movedOf = (
  strategy: 'pnpm' | 'surfaces',
  members: ReadonlyArray<Member>,
  nexts: ReadonlyArray<{ readonly name: PackageName; readonly next: string }>,
): ReadonlyArray<PackageName> => {
  if (strategy === 'surfaces') return nexts.map((entry) => entry.name)
  return nexts
    .filter((entry) => {
      const member = members.find((candidate) => candidate.name === entry.name)
      return member !== undefined && entry.next !== member.manifest.version
    })
    .map((entry) => entry.name)
}

const changelogPathsOf = (
  changelogDir: string,
  moved: ReadonlyArray<PackageName>,
  nexts: ReadonlyArray<{ readonly name: PackageName; readonly next: string }>,
): ReadonlyArray<{ readonly name: PackageName; readonly path: string }> =>
  moved.map((name) => {
    const entry = nexts.find((candidate) => candidate.name === name)
    const version = entry?.next ?? ''
    const flat = name.replaceAll('/', '!')
    if (version === '') return { name, path: `${changelogDir}/${flat}.md` }
    return { name, path: `${changelogDir}/${flat}@${version}.md` }
  })

export const deriveBump = (args: {
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly strategy: 'pnpm' | 'surfaces'
  readonly manifestVersion: string
  readonly changelogDir: string
}): BumpDerivation => {
  const known = new Set(args.members.map((member) => member.name))
  const byName = new Map<PackageName, { rank: Bump; summaries: Array<string> }>()
  let unknownPackage: PackageName | undefined
  let malformedPath: RelativePath | undefined
  for (const intent of args.intents) {
    if (intent.packages.length === 0 && malformedPath === undefined) malformedPath = intent.path
    for (const entry of intent.packages) {
      if (!known.has(entry.name) && unknownPackage === undefined) unknownPackage = entry.name
      const slot = byName.get(entry.name) ?? { rank: 'none', summaries: [] }
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
  const intentCount = args.intents.length
  if (consolidated === 'none') {
    return {
      packages,
      consolidated,
      consolidatedNext: args.manifestVersion,
      nexts: [],
      moved: [],
      changelogPaths: [],
      unknownPackage,
      malformedPath,
      intentCount,
    }
  }
  const bumpedCore = nextCore(args.manifestVersion, consolidated)
  const nexts = args.members.map((member) => nextOf(args.strategy, member, packages, bumpedCore))
  const moved = movedOf(args.strategy, args.members, nexts)
  return {
    packages,
    consolidated,
    consolidatedNext: bumpedCore,
    nexts,
    moved,
    changelogPaths: changelogPathsOf(args.changelogDir, moved, nexts),
    unknownPackage,
    malformedPath,
    intentCount,
  }
}
