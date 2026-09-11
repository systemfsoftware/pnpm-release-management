import * as S from 'effect/Schema'

export const PackageName = S.String.pipe(
  S.check(
    S.isPattern(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/),
  ),
  S.brand('PackageName'),
)
export type PackageName = S.Schema.Type<typeof PackageName>

export const PackageVersion = S.String.pipe(
  S.check(
    S.isPattern(
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?:[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    ),
  ),
  S.brand('PackageVersion'),
)
export type PackageVersion = S.Schema.Type<typeof PackageVersion>

export const RelativePath = S.String.pipe(
  S.check(S.isPattern(/^(?![/])(?!\s*$).+/)),
  S.brand('RelativePath'),
)
export type RelativePath = S.Schema.Type<typeof RelativePath>

export const FsPath = S.NonEmptyString.pipe(S.brand('FsPath'))
export type FsPath = S.Schema.Type<typeof FsPath>

export const RepoRoot = S.String.pipe(
  S.check(S.isPattern(/^\//)),
  S.brand('RepoRoot'),
)
export type RepoRoot = S.Schema.Type<typeof RepoRoot>

export const GitRef = S.String.pipe(
  S.check(S.isPattern(/^[A-Za-z0-9._/-]+$/)),
  S.brand('GitRef'),
)
export type GitRef = S.Schema.Type<typeof GitRef>

export const ReleaseTag = S.String.pipe(
  S.check(S.isPattern(/^\S+$/)),
  S.brand('ReleaseTag'),
)
export type ReleaseTag = S.Schema.Type<typeof ReleaseTag>

export const OwnerName = S.String.pipe(
  S.check(S.isPattern(/^[A-Za-z0-9_.-]+$/)),
  S.brand('OwnerName'),
)
export type OwnerName = S.Schema.Type<typeof OwnerName>

export const RepoName = S.String.pipe(
  S.check(S.isPattern(/^[A-Za-z0-9_.-]+$/)),
  S.brand('RepoName'),
)
export type RepoName = S.Schema.Type<typeof RepoName>

export const HttpUrl = S.String.pipe(
  S.check(S.isPattern(/^https?:\/\/[^\s/$.?#].[^\s]*$/)),
  S.brand('HttpUrl'),
)
export type HttpUrl = S.Schema.Type<typeof HttpUrl>

export const Count = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(0)),
  S.brand('Count'),
)
export type Count = S.Schema.Type<typeof Count>

export const ScriptCommand = S.NonEmptyString.pipe(S.brand('ScriptCommand'))
export type ScriptCommand = S.Schema.Type<typeof ScriptCommand>

export const PackageManifest = S.Struct({
  name: PackageName,
  version: PackageVersion,
  private: S.optional(S.Boolean),
  publishConfig: S.optional(S.Struct({
    provenance: S.optional(S.Boolean),
    access: S.optional(S.Literals(['public', 'restricted'])),
  })),
  scripts: S.optional(S.Record(S.NonEmptyString, ScriptCommand)),
  repository: S.optional(
    S.Union([
      S.NonEmptyString,
      S.Struct({
        type: S.NonEmptyString,
        url: S.NonEmptyString,
      }),
    ]),
  ),
})
export type PackageManifest = S.Schema.Type<typeof PackageManifest>

export const Member = S.Struct({
  name: PackageName,
  dir: RelativePath,
  manifest: PackageManifest,
  publishable: S.Boolean,
})
export type Member = S.Schema.Type<typeof Member>

export const RootFile = S.Struct({
  path: RelativePath,
  text: S.String,
})
export type RootFile = S.Schema.Type<typeof RootFile>

export const ManifestUnreadable = S.TaggedStruct('ManifestUnreadable', {
  path: FsPath,
})
export type ManifestUnreadable = S.Schema.Type<typeof ManifestUnreadable>

export const ManifestInvalid = S.TaggedStruct('ManifestInvalid', {
  path: FsPath,
  reason: S.String,
})
export type ManifestInvalid = S.Schema.Type<typeof ManifestInvalid>

export const MemberRefusal = S.Union([ManifestUnreadable, ManifestInvalid])
export type MemberRefusal = S.Schema.Type<typeof MemberRefusal>
