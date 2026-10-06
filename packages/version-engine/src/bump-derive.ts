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

export type BumpDerivation = {
  readonly consolidated: Bump
  readonly consolidatedNext: PackageVersion
  readonly moved: ReadonlyArray<PackageName>
  readonly changelogPaths: ReadonlyArray<{ readonly name: PackageName; readonly path: RelativePath }>
  readonly unknownPackage: PackageName | undefined
  readonly malformedPath: RelativePath | undefined
  readonly intentCount: Count
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

const changelogPathOf = (
  changelogDir: string,
  name: PackageName,
  version: PackageVersion,
): RelativePath => RelativePath.make(`${changelogDir}/${name.replaceAll('/', '!')}@${version}.md`)

export const deriveBump = (args: {
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly manifestVersion: string
  readonly changelogDir: string
}): BumpDerivation => {
  const known = new Set(args.members.map((member) => member.name))
  let consolidated: Bump = 'none'
  let unknownPackage: PackageName | undefined
  let malformedPath: RelativePath | undefined
  for (const intent of args.intents) {
    if (intent.packages.length === 0 && malformedPath === undefined) malformedPath = intent.path
    for (const entry of intent.packages) {
      if (!known.has(entry.name) && unknownPackage === undefined) unknownPackage = entry.name
      if (RANK[entry.bump] > RANK[consolidated]) consolidated = entry.bump
    }
  }
  const intentCount = Count.make(args.intents.length)
  if (consolidated === 'none') {
    return {
      consolidated,
      consolidatedNext: PackageVersion.make(args.manifestVersion),
      moved: [],
      changelogPaths: [],
      unknownPackage,
      malformedPath,
      intentCount,
    }
  }
  const consolidatedNext = nextCore(args.manifestVersion, consolidated)
  const moved = args.members.map((member) => member.name)
  return {
    consolidated,
    consolidatedNext,
    moved,
    changelogPaths: moved.map((name) => ({
      name,
      path: changelogPathOf(args.changelogDir, name, consolidatedNext),
    })),
    unknownPackage,
    malformedPath,
    intentCount,
  }
}
