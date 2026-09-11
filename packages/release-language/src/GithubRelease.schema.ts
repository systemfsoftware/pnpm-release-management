import * as S from 'effect/Schema'
import { Count, PackageName, PackageVersion, RelativePath, ReleaseTag } from './Workspace.schema.js'

export const ReleaseId = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(1)),
  S.brand('ReleaseId'),
)
export type ReleaseId = S.Schema.Type<typeof ReleaseId>

export const CreatedRelease = S.Struct({
  tag: ReleaseTag,
  id: ReleaseId,
})
export type CreatedRelease = S.Schema.Type<typeof CreatedRelease>

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

const GithubReleaseDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/GithubReleaseDecision',
)
type GithubReleaseDecisionTypeId = typeof GithubReleaseDecisionTypeId

export class GithubReleaseCreated extends S.TaggedClass<
  GithubReleaseCreated
>()(
  'GithubReleaseCreated',
  {
    created: S.NonEmptyArray(CreatedRelease),
    skipped: Count,
  },
) {
  readonly [GithubReleaseDecisionTypeId] = GithubReleaseDecisionTypeId
}

export class GithubReleaseSkipped extends S.TaggedClass<
  GithubReleaseSkipped
>()(
  'GithubReleaseSkipped',
  {
    tags: S.NonEmptyArray(ReleaseTag),
  },
) {
  readonly [GithubReleaseDecisionTypeId] = GithubReleaseDecisionTypeId
}

export class GithubReleaseAsserted extends S.TaggedClass<
  GithubReleaseAsserted
>()(
  'GithubReleaseAsserted',
  {
    count: Count,
  },
) {
  readonly [GithubReleaseDecisionTypeId] = GithubReleaseDecisionTypeId
}

export class GithubReleasePreview extends S.TaggedClass<
  GithubReleasePreview
>()(
  'GithubReleasePreview',
  {
    tags: S.NonEmptyArray(ReleaseTag),
  },
) {
  readonly [GithubReleaseDecisionTypeId] = GithubReleaseDecisionTypeId
}

export class GithubReleaseEmpty extends S.TaggedClass<GithubReleaseEmpty>()(
  'GithubReleaseEmpty',
  {
    cycle: Count,
  },
) {
  readonly [GithubReleaseDecisionTypeId] = GithubReleaseDecisionTypeId
}

export const GithubReleaseDecision = S.Union([
  GithubReleaseCreated,
  GithubReleaseSkipped,
  GithubReleaseAsserted,
  GithubReleasePreview,
  GithubReleaseEmpty,
])
export type GithubReleaseDecision = S.Schema.Type<typeof GithubReleaseDecision>

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
