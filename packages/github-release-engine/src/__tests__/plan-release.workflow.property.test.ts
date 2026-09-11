import { it } from '@effect/vitest'
import {
  Count,
  CycleEntry,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseTag,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { PlanCommand, planRelease } from '../plan-release.workflow.js'

const packageNameArb = fc
  .oneof(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
    fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        fc.stringMatching(/^[a-z][a-z0-9-.]{0,10}$/),
      )
      .map(([scope, name]) => `@${scope}/${name}`),
  )
  .map((name) => PackageName.make(name))

const versionArb = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([major, minor, patch]) => PackageVersion.make(`${major}.${minor}.${patch}`))

const entryArb = fc
  .tuple(packageNameArb, versionArb)
  .map(([name, version]) =>
    CycleEntry.make({
      name,
      version,
      tag: ReleaseTag.make(`${name}@v${version}`),
      changelog: RelativePath.make(`changelogs/${name}@${version}.md`),
    })
  )

const pendingArb = fc.nat({ max: 5 }).map((pending) => Count.make(pending))
const cycleArb = fc.array(entryArb, { maxLength: 4 })
const deferredArb = fc.array(packageNameArb, { maxLength: 3 })
const unknownArb = fc.array(packageNameArb, { maxLength: 2 })

const namesEqual = (
  left: ReadonlyArray<PackageName>,
  right: ReadonlyArray<PackageName>,
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

const entriesEqual = (
  left: ReadonlyArray<CycleEntry>,
  right: ReadonlyArray<CycleEntry>,
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => {
    const other = right[index]
    if (other === undefined) {
      return false
    }
    return value.tag === other.tag &&
      value.name === other.name &&
      value.version === other.version &&
      value.changelog === other.changelog
  })
}

it.prop(
  '∀state_PlanRelease_≡PhaseFromState',
  [pendingArb, cycleArb, deferredArb, unknownArb],
  ([pending, cycle, deferred, unknownDeferred]) => {
    const outcome = planRelease(
      PlanCommand.make({ pending, cycle, deferred, unknownDeferred }),
    )
    if (unknownDeferred.length > 0) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('DeferredPackagesUnknown', (bad) => namesEqual([...bad.packages], [...unknownDeferred])),
        Match.exhaustive,
      )
    }
    if (Result.isSuccess(outcome) === false) {
      return false
    }
    const decision = outcome.success
    if (cycle.length > 0) {
      return Match.value(decision).pipe(
        Match.tag('PlanReleasePublish', (publish) => entriesEqual([...publish.cycle], [...cycle])),
        Match.tag('PlanReleaseVersion', () => false),
        Match.tag('PlanReleaseSettled', () => false),
        Match.exhaustive,
      )
    }
    if (pending > 0) {
      return Match.value(decision).pipe(
        Match.tag('PlanReleaseVersion', (version) => {
          if (version.pending !== pending) {
            return false
          }
          return entriesEqual([...version.cycle], [...cycle])
        }),
        Match.tag('PlanReleasePublish', () => false),
        Match.tag('PlanReleaseSettled', () => false),
        Match.exhaustive,
      )
    }
    return Match.value(decision).pipe(
      Match.tag('PlanReleaseSettled', (settled) => {
        if (settled.pending !== pending) {
          return false
        }
        return settled.cycleCount === 0
      }),
      Match.tag('PlanReleasePublish', () => false),
      Match.tag('PlanReleaseVersion', () => false),
      Match.exhaustive,
    )
  },
)
