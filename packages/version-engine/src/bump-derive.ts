import type { Bump, Intent, Member, PackageName, ReleaseBump } from '@systemfsoftware/release-language'
import { Count, PackageVersion, RelativePath } from '@systemfsoftware/release-language'

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/

const coreOf = (version: string): readonly [number, number, number] => {
  const hit = CORE_PATTERN.exec(version)
  return [Number(hit?.[1] ?? '0'), Number(hit?.[2] ?? '0'), Number(hit?.[3] ?? '0')]
}

const nextCore = (current: string, rank: ReleaseBump): PackageVersion => {
  const core = coreOf(current)
  if (rank === 'major') return PackageVersion.make(`${core[0] + 1}.0.0`)
  if (rank === 'minor') return PackageVersion.make(`${core[0]}.${core[1] + 1}.0`)
  return PackageVersion.make(`${core[0]}.${core[1]}.${core[2] + 1}`)
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

type MemberNext = { readonly name: PackageName; readonly next: PackageVersion }

type ChangelogPath = { readonly name: PackageName; readonly path: RelativePath }

type Collapsed = {
  readonly packages: ReadonlyArray<CollapsedPackage>
  readonly consolidated: Bump
  readonly unknownPackage: PackageName | undefined
  readonly malformedPath: RelativePath | undefined
  readonly intentCount: Count
}

export type PnpmBumpDerivation = Collapsed & {
  readonly nexts: ReadonlyArray<MemberNext>
  readonly moved: ReadonlyArray<PackageName>
  readonly changelogPaths: ReadonlyArray<ChangelogPath>
}

export type SurfacesBumpDerivation = PnpmBumpDerivation & {
  readonly consolidatedNext: PackageVersion
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

const collapse = (
  intents: ReadonlyArray<Intent>,
  members: ReadonlyArray<Member>,
): Collapsed => {
  const known = new Set(members.map((member) => member.name))
  const byName = new Map<PackageName, { rank: Bump; summaries: Array<string> }>()
  let unknownPackage: PackageName | undefined
  let malformedPath: RelativePath | undefined
  for (const intent of intents) {
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
  return {
    packages,
    consolidated: topRank(packages.map((entry) => entry.rank)),
    unknownPackage,
    malformedPath,
    intentCount: Count.make(intents.length),
  }
}

const memberNext = (
  member: Member,
  packages: ReadonlyArray<CollapsedPackage>,
): MemberNext => {
  const collapsed = packages.find((entry) => entry.name === member.name)
  const rank = collapsed?.rank ?? 'none'
  if (rank === 'none') return { name: member.name, next: member.manifest.version }
  return { name: member.name, next: nextCore(member.manifest.version, rank) }
}

const movedMembersOf = (
  members: ReadonlyArray<Member>,
  nexts: ReadonlyArray<MemberNext>,
): ReadonlyArray<PackageName> =>
  nexts
    .filter((entry) => {
      const member = members.find((candidate) => candidate.name === entry.name)
      return member !== undefined && entry.next !== member.manifest.version
    })
    .map((entry) => entry.name)

const changelogPathsOf = (
  changelogDir: string,
  moved: ReadonlyArray<PackageName>,
  nexts: ReadonlyArray<MemberNext>,
): ReadonlyArray<ChangelogPath> =>
  moved.map((name) => {
    const entry = nexts.find((candidate) => candidate.name === name)
    const version = entry?.next ?? ''
    const flat = name.replaceAll('/', '!')
    if (version === '') return { name, path: RelativePath.make(`${changelogDir}/${flat}.md`) }
    return { name, path: RelativePath.make(`${changelogDir}/${flat}@${version}.md`) }
  })

export const derivePnpmBump = (args: {
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly changelogDir: string
}): PnpmBumpDerivation => {
  const collapsed = collapse(args.intents, args.members)
  if (collapsed.consolidated === 'none') {
    return { ...collapsed, nexts: [], moved: [], changelogPaths: [] }
  }
  const nexts = args.members.map((member) => memberNext(member, collapsed.packages))
  const moved = movedMembersOf(args.members, nexts)
  return { ...collapsed, nexts, moved, changelogPaths: changelogPathsOf(args.changelogDir, moved, nexts) }
}

export const deriveSurfacesBump = (args: {
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly changelogDir: string
  readonly manifestVersion: string
}): SurfacesBumpDerivation => {
  const collapsed = collapse(args.intents, args.members)
  if (collapsed.consolidated === 'none') {
    return {
      ...collapsed,
      consolidatedNext: PackageVersion.make(args.manifestVersion),
      nexts: [],
      moved: [],
      changelogPaths: [],
    }
  }
  const consolidatedNext = nextCore(args.manifestVersion, collapsed.consolidated)
  const nexts = args.members.map((member): MemberNext => ({ name: member.name, next: consolidatedNext }))
  const moved = nexts.map((entry) => entry.name)
  return {
    ...collapsed,
    consolidatedNext,
    nexts,
    moved,
    changelogPaths: changelogPathsOf(args.changelogDir, moved, nexts),
  }
}
