import {
  GitPort,
  type IntegrityRefusal,
  LedgerEntryMismatch,
  type LedgerIdentityRefusal,
  LedgerTagMissing,
  LedgerTagMoved,
  type PackageName,
  type PackageVersion,
  type ReleaseLedgerEntry,
  type RemoteName,
  TagAnnotationLightweight,
  TagAnnotationMalformed,
  type TagRefusal,
  type TarballDigest,
  TarballIntegrity,
  TarballMissing,
  type VersionBurned,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { tagOf } from './cycle.js'
import { burnedOf, publishedRecorded, stateForVersion, tagEntryOf } from './integrity.js'
import { type IntegrityCheck } from './integrity.schema.js'

export interface ReleasedVersion {
  readonly name: PackageName
  readonly version: PackageVersion
}

export type ReleasedTarballRefusal = IntegrityRefusal | LedgerIdentityRefusal | VersionBurned | TagRefusal

const parseAnnotation = (text: string): Result.Result<TarballIntegrity, string> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    let reason = 'annotation is not JSON'
    if (cause instanceof Error) {
      reason = cause.message
    }
    return Result.fail(reason)
  }
  return Result.mapError(
    S.decodeUnknownResult(TarballIntegrity)(parsed),
    (error) => error.message,
  )
}

export const releasedTarballChecks = (
  members: ReadonlyArray<ReleasedVersion>,
  digests: ReadonlyArray<TarballDigest>,
  ledgerEntries: ReadonlyArray<ReleaseLedgerEntry>,
  remote: RemoteName,
): Effect.Effect<ReadonlyArray<IntegrityCheck>, ReleasedTarballRefusal, GitPort> =>
  Effect.gen(function*() {
    const git = yield* GitPort
    const checks: Array<IntegrityCheck> = []
    for (const member of members) {
      const version = member.version
      const tag = tagOf(member.name, version)
      const state = stateForVersion(ledgerEntries, member.name, version)
      if (state !== undefined) {
        const burned = burnedOf(member.name, version, state)
        if (burned !== undefined) {
          return yield* Effect.fail(burned)
        }
      }
      const entry = tagEntryOf(ledgerEntries, tag)
      if (entry !== undefined) {
        const commit = yield* git.tagCommit(remote, tag)
        if (Option.isNone(commit)) {
          return yield* Effect.fail(LedgerTagMissing.make({ tag }))
        }
        if (commit.value !== entry.commit) {
          return yield* Effect.fail(
            LedgerTagMoved.make({ tag, recorded: entry.commit, current: commit.value }),
          )
        }
      }
      const digest = digests.find((candidate) => candidate.name === member.name && candidate.version === version)
      if (digest === undefined) {
        return yield* Effect.fail(TarballMissing.make({ package: member.name, version }))
      }
      if (state !== undefined) {
        const recorded = publishedRecorded(state)
        if (recorded === undefined) {
          return yield* Effect.fail(burnedOf(member.name, version, state) ?? LedgerTagMissing.make({ tag }))
        }
        checks.push({
          package: member.name,
          version,
          recorded,
          current: { integrity: digest.integrity, files: digest.files },
        })
        continue
      }
      if (entry !== undefined) {
        return yield* Effect.fail(
          LedgerEntryMismatch.make({
            tag,
            recorded: entry.tag,
            current: `${member.name}@${version}`,
          }),
        )
      }
      const annotation = yield* git.tagAnnotation(remote, tag)
      if (Option.isNone(annotation)) {
        return yield* Effect.fail(TagAnnotationLightweight.make({ tag }))
      }
      const parsed = parseAnnotation(annotation.value)
      if (Result.isFailure(parsed)) {
        return yield* Effect.fail(TagAnnotationMalformed.make({ tag, reason: parsed.failure }))
      }
      checks.push({
        package: member.name,
        version,
        recorded: parsed.success,
        current: { integrity: digest.integrity, files: digest.files },
      })
    }
    return checks
  })
