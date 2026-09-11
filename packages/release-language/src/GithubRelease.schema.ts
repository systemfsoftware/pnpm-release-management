import * as S from 'effect/Schema'
import { PackageName, PackageVersion, RelativePath, ReleaseTag } from './Workspace.schema.js'

export const ReleaseId = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(1)),
  S.brand('ReleaseId'),
)
export type ReleaseId = S.Schema.Type<typeof ReleaseId>

export const ReleaseFound = S.TaggedStruct('ReleaseFound', {
  id: ReleaseId,
})
export type ReleaseFound = S.Schema.Type<typeof ReleaseFound>

export const ReleaseAbsent = S.TaggedStruct('ReleaseAbsent', {
  tag: ReleaseTag,
})
export type ReleaseAbsent = S.Schema.Type<typeof ReleaseAbsent>

export const ReleaseLookup = S.Union([ReleaseFound, ReleaseAbsent])
export type ReleaseLookup = S.Schema.Type<typeof ReleaseLookup>

export const ReleaseChangelogMissing = S.TaggedStruct(
  'ReleaseChangelogMissing',
  {
    package: PackageName,
    version: PackageVersion,
    changelog: RelativePath,
  },
)
export type ReleaseChangelogMissing = S.Schema.Type<
  typeof ReleaseChangelogMissing
>

export const ReleaseChangelogEmpty = S.TaggedStruct('ReleaseChangelogEmpty', {
  package: PackageName,
  version: PackageVersion,
  changelog: RelativePath,
})
export type ReleaseChangelogEmpty = S.Schema.Type<typeof ReleaseChangelogEmpty>

export const GithubReleaseRefusal = S.Union([
  ReleaseChangelogMissing,
  ReleaseChangelogEmpty,
])
export type GithubReleaseRefusal = S.Schema.Type<typeof GithubReleaseRefusal>
