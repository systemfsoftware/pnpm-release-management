import * as S from 'effect/Schema'

export class EvidenceFileUnreadable extends S.TaggedError<EvidenceFileUnreadable>()('EvidenceFileUnreadable', {
  path: S.String,
}) {}

export class EvidenceCommandFailed extends S.TaggedError<EvidenceCommandFailed>()('EvidenceCommandFailed', {
  program: S.String,
  detail: S.String,
}) {}

export class TurboPinUnusable extends S.TaggedError<TurboPinUnusable>()('TurboPinUnusable', {
  detail: S.String,
}) {}

export class WorktreeUnavailable extends S.TaggedError<WorktreeUnavailable>()('WorktreeUnavailable', {
  detail: S.String,
}) {}

export const PnpmLockfile = S.Struct({
  lockfileVersion: S.Literals(['9.0', 9]),
  importers: S.Record(
    S.String,
    S.Struct({
      devDependencies: S.optional(
        S.Record(
          S.String,
          S.Struct({
            specifier: S.NonEmptyString,
            version: S.NonEmptyString,
          }),
        ),
      ),
    }),
  ),
})
export type PnpmLockfile = S.Schema.Type<typeof PnpmLockfile>

export const InstalledTurbo = S.Struct({
  version: S.optional(S.NonEmptyString),
})
export type InstalledTurbo = S.Schema.Type<typeof InstalledTurbo>
