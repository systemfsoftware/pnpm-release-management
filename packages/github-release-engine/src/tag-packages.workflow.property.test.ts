import { assertEquals } from '@std/assert'
import {
  CycleEntry,
  FsPath,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseTag,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as fc from 'fast-check'
import { TagCommand, tagPackages } from './tag-packages.workflow.ts'

const packageNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
  .map((name) => PackageName.make(name))

const entryArb = fc
  .tuple(
    packageNameArb,
    fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })).map(
      ([major, minor, patch]) => PackageVersion.make(`${major}.${minor}.${patch}`),
    ),
  )
  .map(([name, version]) =>
    CycleEntry.make({
      name,
      version,
      tag: ReleaseTag.make(`${name}@v${version}`),
      changelog: RelativePath.make(`changelogs/${name}@${version}.md`),
    })
  )

const pathArb = fc.string({ minLength: 1 }).map((path) => FsPath.make(path))

Deno.test('tag captures the cycle and pushes one tag per released package', () => {
  fc.assert(
    fc.property(
      fc.array(entryArb, { maxLength: 4 }),
      fc.boolean(),
      fc.option(pathArb, { nil: undefined }),
      fc.option(pathArb, { nil: undefined }),
      (cycle, preview, capturedIssue, excludedIssue) => {
        const outcome = tagPackages(
          TagCommand.make({ cycle, preview, capturedIssue, excludedIssue }),
        )
        const tags = cycle.map((entry) => entry.tag)
        if (capturedIssue !== undefined) {
          if (!Result.isFailure(outcome)) {
            throw new Error(`expected CapturedListMalformed, got ${outcome.success._tag}`)
          }
          if (outcome.failure._tag !== 'CapturedListMalformed') {
            throw new Error(`expected CapturedListMalformed, got ${outcome.failure._tag}`)
          }
          assertEquals(outcome.failure.path, capturedIssue)
          return
        }
        if (excludedIssue !== undefined) {
          if (!Result.isFailure(outcome)) {
            throw new Error(`expected ExcludedListMalformed, got ${outcome.success._tag}`)
          }
          if (outcome.failure._tag !== 'ExcludedListMalformed') {
            throw new Error(`expected ExcludedListMalformed, got ${outcome.failure._tag}`)
          }
          assertEquals(outcome.failure.path, excludedIssue)
          return
        }
        if (!Result.isSuccess(outcome)) {
          throw new Error(`expected a decision, got ${outcome.failure._tag}`)
        }
        const decision = outcome.success
        if (preview) {
          if (decision._tag !== 'TagPackagesPreviewed') {
            throw new Error(`preview mode must not push, got ${decision._tag}`)
          }
          assertEquals([...decision.tags], tags)
          return
        }
        if (cycle.length === 0) {
          if (decision._tag !== 'TagPackagesUpToDate') {
            throw new Error(`empty cycle must report up to date, got ${decision._tag}`)
          }
          assertEquals(decision.tags, 0)
          return
        }
        if (decision._tag !== 'TagPackagesPushed') {
          throw new Error(`owed cycle must push, got ${decision._tag}`)
        }
        assertEquals([...decision.tags], tags)
      },
    ),
    { numRuns: 150 },
  )
})
