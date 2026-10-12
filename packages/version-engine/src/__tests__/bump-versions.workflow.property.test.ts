import { it } from '@effect/vitest'
import { type Bump, Intent, Member, memberChangelogPathOf, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { deriveBump } from '../bump-derive.js'
import { bumpVersions } from '../bump-versions.workflow.js'
import { BumpCommand } from '../bump.schema.js'

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
  readonly strategy: 'changesets' | 'surfaces'
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
    manifestVersion: input.manifestVersion,
    changelogPathOf: (member, version) =>
      memberChangelogPathOf('registry', RelativePath.make(input.changelogDir), member, version),
  })
  return S.decodeUnknownSync(BumpCommand)({
    _tag: 'BumpCommand',
    strategy: input.strategy,
    intents,
    members,
    manifestVersion: input.manifestVersion,
    changelogDir: input.changelogDir,
    changelogStorage: 'registry',
    rootChangelog: input.rootChangelog,
    manifest: { file: 'package.json', surface: { kind: 'json', path: 'package.json' } },
    surfaces: [],
    consolidated: derived.consolidated,
    consolidatedNext: derived.consolidatedNext,
    moved: derived.moved,
    changelogPaths: derived.changelogPaths,
    unknownPackage: derived.unknownPackage,
    malformedPath: derived.malformedPath,
    intentCount: derived.intentCount,
    planned: [],
  })
}

const parseCore = (version: string): readonly [number, number, number] => {
  const hit = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return [Number(hit?.[1] ?? 0), Number(hit?.[2] ?? 0), Number(hit?.[3] ?? 0)]
}

const expectedNext = (
  core: readonly [number, number, number],
  rank: Bump,
): readonly [number, number, number] => {
  if (rank === 'major') {
    return [core[0] + 1, 0, 0]
  }
  if (rank === 'minor') {
    return [core[0], core[1] + 1, 0]
  }
  return [core[0], core[1], core[2] + 1]
}

const collapseRanks = (intents: ReadonlyArray<PlainIntent>): Map<string, Bump> => {
  const ranks = new Map<string, Bump>()
  for (const intent of intents) {
    for (const entry of intent.packages) {
      const current = ranks.get(entry.name) ?? 'none'
      const incoming = RANK_ORDER[entry.bump] ?? 0
      const held = RANK_ORDER[current] ?? 0
      if (incoming > held) {
        ranks.set(entry.name, entry.bump)
      }
    }
  }
  return ranks
}

const topOf = (ranks: Iterable<Bump>): Bump => {
  let top: Bump = 'none'
  for (const rank of ranks) {
    const candidate = RANK_ORDER[rank] ?? 0
    const held = RANK_ORDER[top] ?? 0
    if (candidate > held) {
      top = rank
    }
  }
  return top
}

it.prop(
  '∀cmd_BumpVersions_≡IdleZero',
  [membersArb, versionArb, relativePathArb],
  ([members, manifestVersion, changelogDir]) => {
    const command = toCommand({ strategy: 'surfaces', intents: [], members, manifestVersion, changelogDir })
    const outcome = bumpVersions(command)
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('VersionIdle', (idle) => idle.pending === 0),
      Match.orElse(() => false),
    )
  },
)
it.prop(
  '∀cmd_BumpVersions_⊥UnknownSucceeds',
  [membersArb, versionArb, relativePathArb, summaryArb],
  ([members, manifestVersion, changelogDir, summary]) => {
    const foreign = `${'a'.repeat(30)}-unknown`
    const intents: ReadonlyArray<PlainIntent> = [{
      path: 'changeset/foreign.md',
      packages: [{ name: foreign, bump: 'minor' }],
      summary,
    }]
    const command = toCommand({ strategy: 'surfaces', intents, members, manifestVersion, changelogDir })
    const outcome = bumpVersions(command)
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('VersionUnknownPackage', (unknown) => unknown.package === foreign),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_BumpVersions_⊥EmptySucceeds',
  [membersArb, versionArb, relativePathArb, summaryArb, relativePathArb],
  ([members, manifestVersion, changelogDir, summary, emptyPath]) => {
    const intents: ReadonlyArray<PlainIntent> = [{ path: emptyPath, packages: [], summary }]
    const command = toCommand({ strategy: 'surfaces', intents, members, manifestVersion, changelogDir })
    const outcome = bumpVersions(command)
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('VersionIntentMalformed', (malformed) => malformed.path === emptyPath),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_BumpVersions_≡ConsumedNone',
  [membersArb, versionArb, relativePathArb, fc.array(summaryArb, { minLength: 1, maxLength: 3 })],
  ([members, manifestVersion, changelogDir, summaries]) => {
    const names = members.map((member) => member.name)
    const intents: ReadonlyArray<PlainIntent> = summaries.map((summary, index) => ({
      path: `changeset/none-${index}.md`,
      packages: names.map((name) => ({ name, bump: 'none' as const })),
      summary,
    }))
    const command = toCommand({ strategy: 'surfaces', intents, members, manifestVersion, changelogDir })
    const outcome = bumpVersions(command)
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('VersionConsumed', (consumed) => consumed.consumed === intents.length),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_BumpVersions_≡ConsolidatedOne',
  [membersArb, versionArb, relativePathArb, summaryArb, bumpArb, bumpArb],
  ([members, manifestVersion, changelogDir, summary, firstBump, secondBump]) => {
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
    if (Result.isFailure(outcome)) {
      return false
    }
    if (consolidated === 'none') {
      return Match.value(outcome.success).pipe(
        Match.tag('VersionConsumed', () => true),
        Match.orElse(() => false),
      )
    }
    return Match.value(outcome.success).pipe(
      Match.tag('VersionBumped', (bumped) => {
        const progressed = expectedNext(parseCore(manifestVersion), consolidated)
        const nextCore = parseCore(bumped.version)
        const movedNames = [...names].sort()
        return nextCore[0] === progressed[0] &&
          nextCore[1] === progressed[1] &&
          nextCore[2] === progressed[2] &&
          [...bumped.moved].sort().join(',') === movedNames.join(',') &&
          bumped.changelogs.length === bumped.moved.length &&
          bumped.changelogs.every((path, index) =>
            path.endsWith(`@${bumped.version}.md`) &&
            path.includes((bumped.moved[index] ?? '').replaceAll('/', '!'))
          )
      }),
      Match.orElse(() => false),
    )
  },
)
