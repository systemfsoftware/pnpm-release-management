import { type Bump, Intent, Member } from '@systemfsoftware/release-language'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { deriveBump } from './bump-derive.ts'
import { bumpVersions } from './bump-versions.workflow.ts'
import { BumpCommand } from './bump.schema.ts'

const RANK_ORDER: Record<string, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const packageNameArb = fc.oneof(
  fc.stringMatching(/^[a-z0-9~][a-z0-9._~-]{0,20}$/),
  fc.tuple(
    fc.stringMatching(/^@[a-z0-9~-][a-z0-9._~-]{0,10}$/),
    fc.stringMatching(/^[a-z0-9~][a-z0-9._~-]{0,20}$/),
  ).map(([scope, base]) => `${scope}/${base}`),
)

const coreArb = fc.tuple(
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
)

const versionArb = fc.oneof(
  coreArb.map(([major, minor, patch]) => `${major}.${minor}.${patch}`),
  fc.tuple(
    coreArb,
    fc.constantFrom('', '-alpha', '-alpha.1', '-rc.2'),
  ).map(([[major, minor, patch], suffix]) => `${major}.${minor}.${patch}${suffix}`),
)

const segmentArb = fc.stringMatching(/^[a-z0-9._~-]{1,12}$/)
const relativePathArb = fc.tuple(segmentArb, fc.array(segmentArb, { maxLength: 3 }))
  .map(([head, tail]) => [head, ...tail].join('/'))

const summaryArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ]{0,40}$/)

const bumpArb = fc.constantFrom('none', 'patch', 'minor', 'major')

const memberArb = fc.record({
  name: packageNameArb,
  dir: relativePathArb,
  manifest: fc.record({
    name: packageNameArb,
    version: versionArb,
  }),
  publishable: fc.boolean(),
})

const membersArb = fc.uniqueArray(memberArb, {
  selector: (member) => member.name,
  minLength: 1,
  maxLength: 3,
})

type PlainEntry = { readonly name: string; readonly bump: Bump }
type PlainIntent = {
  readonly path: string
  readonly packages: ReadonlyArray<PlainEntry>
  readonly summary: string
}

const toCommand = (input: {
  readonly strategy: 'pnpm' | 'surfaces'
  readonly intents: ReadonlyArray<unknown>
  readonly members: ReadonlyArray<unknown>
  readonly manifestVersion: string
  readonly changelogDir: string
  readonly rootChangelog?: string
}): BumpCommand => {
  const intents = S.decodeUnknownSync(S.Array(Intent))(input.intents)
  const members = S.decodeUnknownSync(S.Array(Member))(input.members)
  const derived = deriveBump({
    intents,
    members,
    strategy: input.strategy,
    manifestVersion: input.manifestVersion,
    changelogDir: input.changelogDir,
  })
  return S.decodeUnknownSync(BumpCommand)({
    _tag: 'BumpCommand',
    strategy: input.strategy,
    intents,
    members,
    manifestVersion: input.manifestVersion,
    changelogDir: input.changelogDir,
    rootChangelog: input.rootChangelog,
    consolidated: derived.consolidated,
    consolidatedNext: derived.consolidatedNext,
    nexts: derived.nexts,
    moved: derived.moved,
    changelogPaths: derived.changelogPaths,
    packageRanks: derived.packages,
    unknownPackage: derived.unknownPackage,
    malformedPath: derived.malformedPath,
    intentCount: derived.intentCount,
  })
}

const parseCore = (version: string): readonly [number, number, number] => {
  const hit = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return [Number(hit?.[1] ?? 0), Number(hit?.[2] ?? 0), Number(hit?.[3] ?? 0)]
}

const compareCores = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]

const expectedNext = (
  core: readonly [number, number, number],
  rank: Bump,
): readonly [number, number, number] =>
  rank === 'major'
    ? [core[0] + 1, 0, 0]
    : rank === 'minor'
    ? [core[0], core[1] + 1, 0]
    : [core[0], core[1], core[2] + 1]

const collapseRanks = (intents: ReadonlyArray<PlainIntent>): Map<string, Bump> => {
  const ranks = new Map<string, Bump>()
  for (const intent of intents) {
    for (const entry of intent.packages) {
      const current = ranks.get(entry.name) ?? 'none'
      if (RANK_ORDER[entry.bump] > RANK_ORDER[current]) ranks.set(entry.name, entry.bump)
    }
  }
  return ranks
}

const topOf = (ranks: Iterable<Bump>): Bump => {
  let top: Bump = 'none'
  for (const rank of ranks) {
    if (RANK_ORDER[rank] > RANK_ORDER[top]) top = rank
  }
  return top
}

const RUNS = { numRuns: 100 }

Deno.test('bump: empty intents idle with zero pending', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      (members, manifestVersion, changelogDir) => {
        const command = toCommand({ strategy: 'surfaces', intents: [], members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isFailure(outcome)) return false
        return outcome.success._tag === 'VersionIdle' && outcome.success.pending === 0
      },
    ),
    RUNS,
  )
})

Deno.test('bump: unknown package is refused with its name', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      summaryArb,
      (members, manifestVersion, changelogDir, summary) => {
        const foreign = `${'a'.repeat(30)}-unknown`
        const intents: ReadonlyArray<PlainIntent> = [{
          path: 'changeset/foreign.md',
          packages: [{ name: foreign, bump: 'minor' }],
          summary,
        }]
        const command = toCommand({ strategy: 'pnpm', intents, members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'VersionUnknownPackage' && outcome.failure.package === foreign
      },
    ),
    RUNS,
  )
})

Deno.test('bump: intent without packages is refused with its path', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      summaryArb,
      relativePathArb,
      (members, manifestVersion, changelogDir, summary, emptyPath) => {
        const intents: ReadonlyArray<PlainIntent> = [{ path: emptyPath, packages: [], summary }]
        const command = toCommand({ strategy: 'pnpm', intents, members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'VersionIntentMalformed' && outcome.failure.path === emptyPath
      },
    ),
    RUNS,
  )
})

Deno.test('bump: none-only intents are consumed without a version', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      fc.array(summaryArb, { minLength: 1, maxLength: 3 }),
      (members, manifestVersion, changelogDir, summaries) => {
        const names = members.map((member) => member.name)
        const intents = summaries.map((summary, index) => ({
          path: `changeset/none-${index}.md`,
          packages: names.map((name) => ({ name, bump: 'none' as Bump })),
          summary,
        }))
        const command = toCommand({ strategy: 'surfaces', intents, members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isFailure(outcome)) return false
        return outcome.success._tag === 'VersionConsumed' && outcome.success.consumed === intents.length
      },
    ),
    RUNS,
  )
})

Deno.test('bump: surfaces collapse to one consolidated next version', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      summaryArb,
      bumpArb,
      bumpArb,
      (members, manifestVersion, changelogDir, summary, firstBump, secondBump) => {
        const names = members.map((member) => member.name)
        const firstName = names[0] ?? 'pkg-fallback'
        const intents: ReadonlyArray<PlainIntent> = [
          { path: 'changeset/first.md', packages: [{ name: firstName, bump: firstBump }], summary },
          {
            path: 'changeset/second.md',
            packages: names.map((name) => ({ name, bump: secondBump })),
            summary,
          },
        ]
        const ranks = collapseRanks(intents)
        const consolidated = topOf(ranks.values())
        const command = toCommand({ strategy: 'surfaces', intents, members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isFailure(outcome)) return false
        if (consolidated === 'none') return outcome.success._tag === 'VersionConsumed'
        if (outcome.success._tag !== 'VersionBumped') return false
        const decision = outcome.success
        const progressed = expectedNext(parseCore(manifestVersion), consolidated)
        const nextCore = parseCore(decision.version)
        const movedNames = [...names].sort()
        return nextCore[0] === progressed[0] &&
          nextCore[1] === progressed[1] &&
          nextCore[2] === progressed[2] &&
          [...decision.moved].sort().join(',') === movedNames.join(',') &&
          decision.changelogs.length === decision.moved.length &&
          decision.changelogs.every((path, index) =>
            path.endsWith(`@${decision.version}.md`) &&
            path.includes((decision.moved[index] ?? '').replaceAll('/', '!'))
          )
      },
    ),
    RUNS,
  )
})

Deno.test('bump: pnpm version is the highest per-package next version', () => {
  fc.assert(
    fc.property(
      membersArb,
      versionArb,
      relativePathArb,
      summaryArb,
      (members, manifestVersion, changelogDir, summary) => {
        const ranks = members.map((_, index) => (index % 2 === 0 ? 'minor' : 'patch') as Bump)
        const intents: ReadonlyArray<PlainIntent> = members.map((member, index) => ({
          path: `changeset/pkg-${index}.md`,
          packages: [{ name: member.name, bump: ranks[index] ?? 'patch' }],
          summary,
        }))
        const command = toCommand({ strategy: 'pnpm', intents, members, manifestVersion, changelogDir })
        const outcome = bumpVersions(command)
        if (Result.isFailure(outcome)) return false
        if (outcome.success._tag !== 'VersionBumped') return false
        const decision = outcome.success
        const expectedNexts = members.map((member, index) =>
          expectedNext(parseCore(member.manifest.version), ranks[index] ?? 'patch').join('.')
        )
        const decisionCore = parseCore(decision.version)
        const decisionText = decisionCore.join('.')
        const isMaximum = expectedNexts.every((next) => compareCores(decisionCore, parseCore(next)) >= 0) &&
          expectedNexts.includes(decisionText)
        return isMaximum && decision.moved.length === members.length
      },
    ),
    RUNS,
  )
})
