import * as S from 'effect/Schema'

const PackageResolution = S.Struct({
  integrity: S.optional(S.NonEmptyString),
  tarball: S.optional(S.NonEmptyString),
})

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
  packages: S.optional(
    S.Record(
      S.String,
      S.Struct({ resolution: S.optional(PackageResolution) }),
    ),
  ),
})
export type PnpmLockfile = S.Schema.Type<typeof PnpmLockfile>
export type PackageResolution = S.Schema.Type<typeof PackageResolution>
