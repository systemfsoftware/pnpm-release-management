import { assertEquals } from '@std/assert'
import {
  Count,
  CycleEntry,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseTag,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as fc from 'fast-check'
import { PlanCommand, planRelease } from './plan-release.workflow.ts'

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

Deno.test('plan derives the release phase from repository state', () => {
  fc.assert(
    fc.property(
      fc.nat({ max: 5 }).map((pending) => Count.make(pending)),
      fc.array(entryArb, { maxLength: 4 }),
      fc.array(packageNameArb, { maxLength: 3 }),
      fc.array(packageNameArb, { maxLength: 2 }),
      (pending, cycle, deferred, unknownDeferred) => {
        const outcome = planRelease(
          PlanCommand.make({ pending, cycle, deferred, unknownDeferred }),
        )
        if (unknownDeferred.length > 0) {
          if (!Result.isFailure(outcome)) {
            throw new Error(`expected DeferredPackagesUnknown, got ${outcome.success._tag}`)
          }
          if (outcome.failure._tag !== 'DeferredPackagesUnknown') {
            throw new Error(`expected DeferredPackagesUnknown, got ${outcome.failure._tag}`)
          }
          assertEquals([...outcome.failure.packages], [...unknownDeferred])
          return
        }
        if (!Result.isSuccess(outcome)) {
          throw new Error(`expected a decision, got ${outcome.failure._tag}`)
        }
        const decision = outcome.success
        if (cycle.length > 0) {
          if (decision._tag !== 'PlanReleasePublish') {
            throw new Error(`owed cycle must publish, got ${decision._tag}`)
          }
          assertEquals(decision.cycle, cycle)
          return
        }
        if (pending > 0) {
          if (decision._tag !== 'PlanReleaseVersion') {
            throw new Error(`pending intents must version, got ${decision._tag}`)
          }
          assertEquals(decision.pending, pending)
          assertEquals(decision.cycle, cycle)
          return
        }
        if (decision._tag !== 'PlanReleaseSettled') {
          throw new Error(`empty state must settle, got ${decision._tag}`)
        }
        assertEquals(decision.pending, pending)
        assertEquals(decision.cycleCount, 0)
      },
    ),
    { numRuns: 150 },
  )
})
