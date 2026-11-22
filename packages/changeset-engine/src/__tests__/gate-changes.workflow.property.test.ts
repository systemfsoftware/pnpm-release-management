import { it } from '@effect/vitest'
import type { Bump } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as fc from 'effect/testing/FastCheck'
import {
  type FakeHistory,
  gateReport,
  intentPath,
  intentText,
  manifestPath,
  member,
  type Tree,
} from '../../tests/__fixtures__/FakeHistory.js'

const PACKAGES = ['a', 'b', 'c'] as const
const SLUGS = ['w', 'x', 'y', 'z'] as const
const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const members = PACKAGES.map((name) => member(name))

const bumpArb = fc.constantFrom<Bump>('none', 'patch', 'minor', 'major')

const entriesArb = fc.dictionary(fc.constantFrom(...PACKAGES), bumpArb, { minKeys: 1, maxKeys: 3 })

const intentsArb = fc.dictionary(fc.constantFrom(...SLUGS), entriesArb, { maxKeys: 3 })

type Intents = Readonly<Record<string, Readonly<Record<string, Bump>>>>

const baseTree = (intents: Intents): Tree => ({
  ...Object.fromEntries(PACKAGES.map((name) => [manifestPath(name), `{"name":"${name}"}`])),
  ...Object.fromEntries(Object.entries(intents).map(([slug, entries]) => [intentPath(slug), intentText(entries)])),
})

const intentFiles = (tree: Tree): Tree =>
  Object.fromEntries(Object.entries(tree).filter(([path]) => !path.startsWith('.changeset/')))

const highestOf = (intents: Intents, name: string): number =>
  Math.max(
    0,
    ...Object.values(intents).flatMap((entries) => {
      const bump = entries[name]
      if (bump === undefined) return []
      return [RANK[bump]]
    }),
  )

const conserved = (before: Intents, after: Intents): boolean =>
  PACKAGES.every((name) => highestOf(before, name) <= highestOf(after, name))

const editHistory = (before: Intents, deletedFirst: ReadonlyArray<string>, after: Intents): FakeHistory => {
  const m0 = baseTree(before)
  const c1 = Object.fromEntries(
    Object.entries(m0).filter(([path]) => !deletedFirst.map(intentPath).includes(path)),
  )
  const c2 = { ...intentFiles(m0), ...baseTree(after) }
  return {
    mergeBase: 'm0',
    commits: [
      { sha: 'm0', parents: [], tree: m0 },
      { sha: 'c1', parents: ['m0'], tree: c1 },
      { sha: 'c2', parents: ['c1'], tree: c2 },
    ],
    range: ['c1', 'c2'],
  }
}

it.effect.prop(
  '∀intentEdits_GatePasses_=EveryPackageKeepsItsHighestOwedBump',
  [intentsArb, fc.subarray([...SLUGS]), intentsArb],
  ([before, deletedFirst, after]) =>
    Effect.map(gateReport({ members, history: editHistory(before, deletedFirst, after) }), (report) => {
      if (conserved(before, after)) return report.ok
      return !report.ok && report.text.includes('drops releases')
    }),
)
