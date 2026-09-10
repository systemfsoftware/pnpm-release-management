import { assertEquals } from '@std/assert'
import { CycleEntry, PackageName, PackageVersion, RelativePath, ReleaseTag } from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as fc from 'fast-check'
import { githubRelease, GithubReleaseCommand } from './github-release.workflow.ts'

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

Deno.test('githubRelease creates releases from generated changelogs', () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const outcome = githubRelease(
        GithubReleaseCommand.make(input),
      )
      const tags = input.items.map((item) => item.entry.tag)
      if (input.items.length === 0) {
        if (!Result.isSuccess(outcome) || outcome.success._tag !== 'GithubReleasesEmpty') {
          throw new Error('empty captured set must report empty')
        }
        assertEquals(outcome.success.cycle, 0)
        return
      }
      const missing = input.items.find((item) => item.body === undefined)
      if (missing !== undefined) {
        if (!Result.isFailure(outcome)) {
          throw new Error(`missing changelog must refuse, got ${outcome.success._tag}`)
        }
        assertEquals(outcome.failure._tag, 'ChangelogFileMissing')
        assertEquals(outcome.failure.package, missing.entry.name)
        assertEquals(outcome.failure.changelog, missing.entry.changelog)
        return
      }
      const blank = input.items.find(
        (item) => item.body !== undefined && item.body.trim().length === 0,
      )
      if (blank !== undefined) {
        if (!Result.isFailure(outcome)) {
          throw new Error(`empty changelog must refuse, got ${outcome.success._tag}`)
        }
        assertEquals(outcome.failure._tag, 'ChangelogFileEmpty')
        assertEquals(outcome.failure.package, blank.entry.name)
        assertEquals(outcome.failure.changelog, blank.entry.changelog)
        return
      }
      if (!Result.isSuccess(outcome)) {
        throw new Error(`valid changelogs must decide, got ${outcome.failure._tag}`)
      }
      const decision = outcome.success
      if (input.assert) {
        if (decision._tag !== 'GithubReleasesAsserted') {
          throw new Error(`assert mode must assert, got ${decision._tag}`)
        }
        assertEquals(decision.count, input.items.length)
        return
      }
      if (input.preview) {
        if (decision._tag !== 'GithubReleasesPreviewed') {
          throw new Error(`dry run must preview, got ${decision._tag}`)
        }
        assertEquals([...decision.tags], tags)
        return
      }
      const remaining = input.items
        .filter((item) => !input.existing.includes(item.entry.tag))
        .map((item) => item.entry.tag)
      if (remaining.length === 0) {
        if (decision._tag !== 'GithubReleasesSkipped') {
          throw new Error(`released cycle must skip, got ${decision._tag}`)
        }
        assertEquals([...decision.tags], tags)
        return
      }
      if (decision._tag !== 'GithubReleasesPreviewed') {
        throw new Error(`owed releases must propose creation, got ${decision._tag}`)
      }
      assertEquals([...decision.tags], remaining)
    }),
    { numRuns: 150 },
  )
})
