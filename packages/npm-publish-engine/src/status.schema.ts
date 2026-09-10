import { PackageName, PackageVersion, PublishStatusDecision, StatusClass } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const StatusMode = S.Literals(['report', 'check', 'preflight'])
export type StatusMode = S.Schema.Type<typeof StatusMode>

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
  decision: PublishStatusDecision,
  rows: S.Array(StatusRow),
  deferred: S.Array(PackageName),
})
export type StatusReport = S.Schema.Type<typeof StatusReport>
