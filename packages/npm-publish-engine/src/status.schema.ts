import { PackageName, PackageVersion, StatusClass } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { PublishStatusHealthy, PublishStatusOwed } from './publish-status.workflow.js'

export const PublishStatusUnpublished = S.TaggedStruct('PublishStatusUnpublished', {
  packages: S.NonEmptyArray(PackageName),
})
export type PublishStatusUnpublished = S.Schema.Type<typeof PublishStatusUnpublished>

export const PublishStatusUnattested = S.TaggedStruct('PublishStatusUnattested', {
  packages: S.NonEmptyArray(PackageName),
})
export type PublishStatusUnattested = S.Schema.Type<typeof PublishStatusUnattested>

export const PublishStatusUnreadable = S.TaggedStruct('PublishStatusUnreadable', {
  packages: S.NonEmptyArray(PackageName),
})
export type PublishStatusUnreadable = S.Schema.Type<typeof PublishStatusUnreadable>

export const PublishStatusEmpty = S.TaggedStruct('PublishStatusEmpty', {
  members: S.Int,
})
export type PublishStatusEmpty = S.Schema.Type<typeof PublishStatusEmpty>

export const PublishStatusRefusal = S.Union([
  PublishStatusUnpublished,
  PublishStatusUnattested,
  PublishStatusUnreadable,
  PublishStatusEmpty,
])
export type PublishStatusRefusal = S.Schema.Type<typeof PublishStatusRefusal>

export const StatusRow = S.Struct({
  name: PackageName,
  local_version: PackageVersion,
  npm_latest: S.String,
  class: StatusClass,
  attested: S.Literals(['yes', 'no']),
  publishConfig_provenance: S.Literals(['yes', 'no']),
})
export type StatusRow = S.Schema.Type<typeof StatusRow>

export const StatusReport = S.Struct({
  decision: S.Union([PublishStatusHealthy, PublishStatusOwed]),
  rows: S.Array(StatusRow),
  deferred: S.Array(PackageName),
})
export type StatusReport = S.Schema.Type<typeof StatusReport>
