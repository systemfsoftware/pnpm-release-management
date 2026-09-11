import { it } from '@effect/vitest'
import { CycleEntry, PackageName, PackageVersion, RelativePath, ReleaseTag } from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { githubRelease, GithubReleaseCommand } from '../github-release.workflow.js'

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

const bodyArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.stringMatching(/^[a-zA-Z0-9.#-]+$/),
)

const freshTagArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
    fc.nat({ max: 20 }),
  )
  .map(([name, version]) => ReleaseTag.make(`zz-${name}@v${version}.0.0`))

const inputArb = fc
  .record({
    items: fc.array(
      fc.tuple(entryArb, bodyArb).map(([entry, body]) => ({ entry, body })),
      { maxLength: 4 },
    ),
    assert: fc.boolean(),
    preview: fc.boolean(),
  })
  .chain(({ items, assert, preview }) => {
    const itemTags = items.map((item) => item.entry.tag)
    return fc
      .record({
        selection: fc.array(fc.boolean(), {
          minLength: itemTags.length,
          maxLength: itemTags.length,
        }),
        extras: fc.array(freshTagArb, { maxLength: 2 }),
      })
      .map(({ selection, extras }) => ({
        items,
        assert,
        preview,
        existing: [
          ...itemTags.filter((_, index) => selection[index] === true),
          ...extras,
        ],
      }))
  })

const tagsEqual = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<ReleaseTag>,
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

it.prop('∀notes_GithubRelease_≡CreatesFromChangelogs', [inputArb], ([input]) => {
  const outcome = githubRelease(
    GithubReleaseCommand.make(input),
  )
  const tags = input.items.map((item) => item.entry.tag)
  if (input.items.length === 0) {
    if (Result.isSuccess(outcome) === false) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('GithubReleasesEmpty', (empty) => empty.cycle === 0),
      Match.tag('GithubReleasesCreated', () => false),
      Match.tag('GithubReleasesSkipped', () => false),
      Match.tag('GithubReleasesAsserted', () => false),
      Match.tag('GithubReleasesPreviewed', () => false),
      Match.exhaustive,
    )
  }
  const missing = input.items.find((item) => item.body === undefined)
  if (missing !== undefined) {
    if (Result.isFailure(outcome) === false) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('ChangelogFileMissing', (bad) => {
        if (bad.package !== missing.entry.name) {
          return false
        }
        return bad.changelog === missing.entry.changelog
      }),
      Match.tag('ChangelogFileEmpty', () => false),
      Match.exhaustive,
    )
  }
  const blank = input.items.find(
    (item) => item.body !== undefined && item.body.trim().length === 0,
  )
  if (blank !== undefined) {
    if (Result.isFailure(outcome) === false) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('ChangelogFileEmpty', (bad) => {
        if (bad.package !== blank.entry.name) {
          return false
        }
        return bad.changelog === blank.entry.changelog
      }),
      Match.tag('ChangelogFileMissing', () => false),
      Match.exhaustive,
    )
  }
  if (Result.isSuccess(outcome) === false) {
    return false
  }
  const decision = outcome.success
  if (input.assert) {
    return Match.value(decision).pipe(
      Match.tag('GithubReleasesAsserted', (asserted) => asserted.count === input.items.length),
      Match.tag('GithubReleasesCreated', () => false),
      Match.tag('GithubReleasesSkipped', () => false),
      Match.tag('GithubReleasesPreviewed', () => false),
      Match.tag('GithubReleasesEmpty', () => false),
      Match.exhaustive,
    )
  }
  if (input.preview) {
    return Match.value(decision).pipe(
      Match.tag('GithubReleasesPreviewed', (previewed) => tagsEqual([...previewed.tags], tags)),
      Match.tag('GithubReleasesCreated', () => false),
      Match.tag('GithubReleasesSkipped', () => false),
      Match.tag('GithubReleasesAsserted', () => false),
      Match.tag('GithubReleasesEmpty', () => false),
      Match.exhaustive,
    )
  }
  const remaining = input.items
    .filter((item) => input.existing.includes(item.entry.tag) === false)
    .map((item) => item.entry.tag)
  if (remaining.length === 0) {
    return Match.value(decision).pipe(
      Match.tag('GithubReleasesSkipped', (skipped) => tagsEqual([...skipped.tags], tags)),
      Match.tag('GithubReleasesCreated', () => false),
      Match.tag('GithubReleasesAsserted', () => false),
      Match.tag('GithubReleasesPreviewed', () => false),
      Match.tag('GithubReleasesEmpty', () => false),
      Match.exhaustive,
    )
  }
  return Match.value(decision).pipe(
    Match.tag('GithubReleasesPreviewed', (previewed) => tagsEqual([...previewed.tags], remaining)),
    Match.tag('GithubReleasesCreated', () => false),
    Match.tag('GithubReleasesSkipped', () => false),
    Match.tag('GithubReleasesAsserted', () => false),
    Match.tag('GithubReleasesEmpty', () => false),
    Match.exhaustive,
  )
})
