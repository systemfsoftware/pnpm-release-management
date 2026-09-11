import { it } from '@effect/vitest'
import {
  CycleEntry,
  FsPath,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseTag,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { TagCommand, tagPackages } from '../tag-packages.workflow.js'

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

const cycleArb = fc.array(entryArb, { maxLength: 4 })
const previewArb = fc.boolean()
const capturedArb = fc.option(pathArb, { nil: undefined })
const excludedArb = fc.option(pathArb, { nil: undefined })

const tagsEqual = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

it.prop(
  '∀cycle_TagPackages_≡OneTagPerPackage',
  [cycleArb, previewArb, capturedArb, excludedArb],
  ([cycle, preview, capturedIssue, excludedIssue]) => {
    const outcome = tagPackages(
      TagCommand.make({ cycle, preview, capturedIssue, excludedIssue }),
    )
    const tags = cycle.map((entry) => entry.tag)
    if (capturedIssue !== undefined) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('CapturedListMalformed', (bad) => bad.path === capturedIssue),
        Match.tag('ExcludedListMalformed', () => false),
        Match.exhaustive,
      )
    }
    if (excludedIssue !== undefined) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('ExcludedListMalformed', (bad) => bad.path === excludedIssue),
        Match.tag('CapturedListMalformed', () => false),
        Match.exhaustive,
      )
    }
    if (Result.isSuccess(outcome) === false) {
      return false
    }
    const decision = outcome.success
    if (preview) {
      return Match.value(decision).pipe(
        Match.tag('TagPackagesPreviewed', (previewed) => tagsEqual([...previewed.tags], tags)),
        Match.tag('TagPackagesUpToDate', () => false),
        Match.tag('TagPackagesPushed', () => false),
        Match.exhaustive,
      )
    }
    if (cycle.length === 0) {
      return Match.value(decision).pipe(
        Match.tag('TagPackagesUpToDate', (upToDate) => upToDate.tags === 0),
        Match.tag('TagPackagesPreviewed', () => false),
        Match.tag('TagPackagesPushed', () => false),
        Match.exhaustive,
      )
    }
    return Match.value(decision).pipe(
      Match.tag('TagPackagesPushed', (pushed) => tagsEqual([...pushed.tags], tags)),
      Match.tag('TagPackagesPreviewed', () => false),
      Match.tag('TagPackagesUpToDate', () => false),
      Match.exhaustive,
    )
  },
)
