import * as S from 'effect/Schema'
import { PackageName, RelativePath } from './Workspace.schema.js'

export const Bump = S.Literals(['none', 'patch', 'minor', 'major'])
export type Bump = S.Schema.Type<typeof Bump>

export const ReleaseBump = S.Literals(['patch', 'minor', 'major'])
export type ReleaseBump = S.Schema.Type<typeof ReleaseBump>

export const IntentSummary = S.String.pipe(
  S.check(S.isPattern(/^[^\r\n]+$/)),
  S.check(S.isMinLength(1)),
  S.brand('IntentSummary'),
)
export type IntentSummary = S.Schema.Type<typeof IntentSummary>

export const IntentSlug = S.String.pipe(
  S.check(S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  S.brand('IntentSlug'),
)
export type IntentSlug = S.Schema.Type<typeof IntentSlug>

export const IntentEntry = S.Struct({
  name: PackageName,
  bump: Bump,
})
export type IntentEntry = S.Schema.Type<typeof IntentEntry>

export const IntentPackages = S.Array(IntentEntry)
export type IntentPackages = S.Schema.Type<typeof IntentPackages>

export const IntentFrontmatter = S.Record(S.String, Bump)
export type IntentFrontmatter = S.Schema.Type<typeof IntentFrontmatter>

export const Intent = S.Struct({
  path: RelativePath,
  packages: IntentPackages,
  summary: IntentSummary,
})
export type Intent = S.Schema.Type<typeof Intent>

export const IntentReleaseable = S.TaggedStruct('IntentReleaseable', {
  path: RelativePath,
  packages: IntentPackages,
  summary: IntentSummary,
  bump: ReleaseBump,
})
export type IntentReleaseable = S.Schema.Type<typeof IntentReleaseable>

export const IntentNoted = S.TaggedStruct('IntentNoted', {
  path: RelativePath,
  packages: IntentPackages,
  summary: IntentSummary,
})
export type IntentNoted = S.Schema.Type<typeof IntentNoted>

export const IntentVerdict = S.Union([IntentReleaseable, IntentNoted])
export type IntentVerdict = S.Schema.Type<typeof IntentVerdict>

export const IntentFrontmatterMalformed = S.TaggedStruct(
  'IntentFrontmatterMalformed',
  {
    path: RelativePath,
  },
)
export type IntentFrontmatterMalformed = S.Schema.Type<
  typeof IntentFrontmatterMalformed
>

export const IntentUnknownPackage = S.TaggedStruct('IntentUnknownPackage', {
  package: PackageName,
})
export type IntentUnknownPackage = S.Schema.Type<typeof IntentUnknownPackage>

export const IntentSlugTaken = S.TaggedStruct('IntentSlugTaken', {
  slug: IntentSlug,
})
export type IntentSlugTaken = S.Schema.Type<typeof IntentSlugTaken>

export const IntentRefusal = S.Union([
  IntentFrontmatterMalformed,
  IntentUnknownPackage,
  IntentSlugTaken,
])
export type IntentRefusal = S.Schema.Type<typeof IntentRefusal>
