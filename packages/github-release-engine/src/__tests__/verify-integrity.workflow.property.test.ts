import { it } from '@effect/vitest'
import { PackageName, PackageVersion, ReleaseTag } from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { exemptNames, identityCandidates } from '../integrity.js'
import { type IntegrityCheck, IntegrityCommand, verifyIntegrity } from '../verify-integrity.workflow.js'

const nameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
  .map((name) => PackageName.make(name))

const versionArb = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([major, minor, patch]) => PackageVersion.make(`${major}.${minor}.${patch}`))

const filePathArb = fc.stringMatching(/^package\/[a-z]{0,8}$/)
const hashArb = fc.stringMatching(/^sha512-[A-Za-z0-9+/=]{1,16}$/)

const filesArb = fc
  .uniqueArray(fc.tuple(filePathArb, hashArb), {
    selector: ([path]) => path,
    minLength: 1,
    maxLength: 4,
  })
  .map((entries) => Object.fromEntries(entries))

const checkOf = (args: {
  readonly name: PackageName
  readonly version: PackageVersion
  readonly recorded: { readonly integrity: string; readonly files: Record<string, string> }
  readonly current: { readonly integrity: string; readonly files: Record<string, string> }
}): IntegrityCheck => ({
  package: args.name,
  version: args.version,
  recorded: args.recorded,
  current: args.current,
})

const commandOf = (checks: ReadonlyArray<IntegrityCheck>): IntegrityCommand =>
  IntegrityCommand.make({ checks: [...checks] })

it.prop(
  '∀match_VerifyIntegrity_≡Verified',
  [nameArb, versionArb, hashArb, filesArb],
  ([name, version, integrity, files]) => {
    const outcome = verifyIntegrity(
      commandOf([checkOf({ name, version, recorded: { integrity, files }, current: { integrity, files } })]),
    )
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag('IntegrityVerified', (verified) => verified.checked === 1),
      Match.tag('IntegrityVacant', () => false),
      Match.exhaustive,
    )
  },
)

it.prop(
  '∀diff_VerifyIntegrity_⊥NamesFirstFile',
  [nameArb, versionArb, hashArb, filesArb],
  ([name, version, integrity, files]) => {
    const [first] = Object.keys(files).sort()
    if (first === undefined) return false
    const changed = { ...files, [first]: `${files[first] ?? ''}X` }
    const outcome = verifyIntegrity(
      commandOf([
        checkOf({ name, version, recorded: { integrity, files }, current: { integrity, files: changed } }),
      ]),
    )
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag(
        'TagIntegrityMismatch',
        (mismatch) => mismatch.file === first && mismatch.package === name && mismatch.version === version,
      ),
      Match.exhaustive,
    )
  },
)

const extraPathArb = fc.stringMatching(/^extra\/[a-z]{0,8}$/)

it.prop(
  '∀oneSided_VerifyIntegrity_⊥NamesExtraFile',
  [nameArb, versionArb, hashArb, filesArb, extraPathArb, hashArb],
  ([name, version, integrity, files, extra, extraHash]) => {
    const current = { ...files, [extra]: extraHash }
    const outcome = verifyIntegrity(
      commandOf([checkOf({ name, version, recorded: { integrity, files }, current: { integrity, files: current } })]),
    )
    if (Result.isSuccess(outcome)) return false
    return outcome.failure.file === extra
  },
)

it.prop(
  '∀packageJsonDiff_VerifyIntegrity_⊥NamesPackageJson',
  [nameArb, versionArb, hashArb, hashArb],
  ([name, version, recordedHash, currentHash]) => {
    if (recordedHash === currentHash) return true
    const outcome = verifyIntegrity(
      commandOf([
        checkOf({
          name,
          version,
          recorded: { integrity: recordedHash, files: { 'package/package.json': recordedHash } },
          current: { integrity: currentHash, files: { 'package/package.json': currentHash } },
        }),
      ]),
    )
    if (Result.isSuccess(outcome)) return false
    return outcome.failure.file === 'package/package.json'
  },
)

const candidatesArb = fc.uniqueArray(nameArb, { selector: (name) => name, maxLength: 4 })
const releaseNamesArb = fc.uniqueArray(nameArb, { selector: (name) => name, maxLength: 4 })

it.prop(
  '∀candidates_ExemptNames_≡PlanMoved',
  [candidatesArb, versionArb, releaseNamesArb],
  ([names, version, releases]) => {
    const candidates = names.map((name) => ({ name, version }))
    const moved = new Set(releases)
    const exempt = exemptNames(candidates, releases.map((name) => ({ name })))
    const expected = candidates.filter((candidate) => moved.has(candidate.name)).map((candidate) => candidate.name)
    if (exempt.length !== expected.length) return false
    return exempt.every((name, index) => name === expected[index])
  },
)

const identityMemberArb = fc.record({
  name: nameArb,
  version: versionArb,
  publishable: fc.boolean(),
})

const identityMembersArb = fc.uniqueArray(identityMemberArb, {
  selector: (member) => String(member.name),
  maxLength: 4,
})

const tagPairsArb = fc.uniqueArray(fc.tuple(nameArb, versionArb), {
  selector: ([name, version]) => `${name}@v${version}`,
  maxLength: 3,
})

const releaseTagsOf = (pairs: ReadonlyArray<readonly [PackageName, PackageVersion]>): ReadonlyArray<ReleaseTag> =>
  pairs.map(([name, version]) => ReleaseTag.make(`${name}@v${version}`))

const createIdentityCandidates = (
  members: ReadonlyArray<
    { readonly name: PackageName; readonly version: PackageVersion; readonly publishable: boolean }
  >,
  pairs: ReadonlyArray<readonly [PackageName, PackageVersion]>,
) => identityCandidates(members, releaseTagsOf(pairs))

it.prop(
  '∀members_IdentityCandidates_≡PublishableTagged',
  [identityMembersArb, tagPairsArb],
  ([members, pairs]) => {
    const candidates = createIdentityCandidates(members, pairs)
    const tags = releaseTagsOf(pairs)
    const expected = members.filter((member) =>
      member.publishable && tags.includes(ReleaseTag.make(`${member.name}@v${member.version}`))
    )
    if (candidates.length !== expected.length) return false
    return candidates.every((candidate, index) => candidate.name === expected[index]?.name)
  },
)

it.prop(
  '∀private_IdentityCandidates_⊥Candidate',
  [identityMembersArb, tagPairsArb],
  ([members, pairs]) => createIdentityCandidates(members, pairs).every((candidate) => candidate.publishable),
)
