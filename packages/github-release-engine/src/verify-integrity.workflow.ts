import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, PackageVersion, TarballIntegrity } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const IntegrityCheck = S.Struct({
  package: PackageName,
  version: PackageVersion,
  recorded: TarballIntegrity,
  current: TarballIntegrity,
})
export type IntegrityCheck = S.Schema.Type<typeof IntegrityCheck>

export class IntegrityCommand extends S.TaggedClass<IntegrityCommand>()('IntegrityCommand', {
  checks: S.Array(IntegrityCheck),
}) {}

export class IntegrityVerified extends S.TaggedClass<IntegrityVerified>()('IntegrityVerified', {
  checked: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class IntegrityVacant extends S.TaggedClass<IntegrityVacant>()('IntegrityVacant', {
  candidates: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TagIntegrityMismatch extends S.TaggedError<TagIntegrityMismatch>()(
  'TagIntegrityMismatch',
  {
    package: PackageName,
    version: PackageVersion,
    recorded: S.String,
    current: S.String,
    file: S.String,
  },
) {}

export type IntegrityDecision = IntegrityVerified | IntegrityVacant

const firstDifferingFile = (
  recorded: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): string | undefined => {
  const paths = [...Object.keys(recorded), ...Object.keys(current)].sort()
  return paths.find((path) => recorded[path] !== current[path])
}

const VacantCase = S.TaggedStruct('VacantCase', { candidates: S.Finite })
const MismatchCase = S.TaggedStruct('MismatchCase', { check: IntegrityCheck, file: S.String })
const VerifiedCase = S.TaggedStruct('VerifiedCase', { checked: S.Finite })
const IntegrityCase = S.Union([VacantCase, MismatchCase, VerifiedCase])
type IntegrityCase = S.Schema.Type<typeof IntegrityCase>

const checkCase = (command: IntegrityCommand): IntegrityCase => {
  if (command.checks.length === 0) {
    return VacantCase.make({ candidates: command.checks.length })
  }
  const mismatch = command.checks.find((check) => {
    const file = firstDifferingFile(check.recorded.files, check.current.files)
    return file !== undefined || check.recorded.integrity !== check.current.integrity
  })
  if (mismatch !== undefined) {
    const file = firstDifferingFile(mismatch.recorded.files, mismatch.current.files)
    return MismatchCase.make({ check: mismatch, file: file ?? '' })
  }
  return VerifiedCase.make({ checked: command.checks.length })
}

export const verifyIntegrity: Workflow.Workflow<
  IntegrityCommand,
  IntegrityDecision,
  TagIntegrityMismatch
> = Workflow.make(IntegrityCommand, (command) =>
  Match.value(checkCase(command)).pipe(
    Match.tag('VacantCase', (vacant) => Result.succeed(IntegrityVacant.make({ candidates: vacant.candidates }))),
    Match.tag('MismatchCase', (mismatch) =>
      Result.fail(
        TagIntegrityMismatch.make({
          package: mismatch.check.package,
          version: mismatch.check.version,
          recorded: mismatch.check.recorded.integrity,
          current: mismatch.check.current.integrity,
          file: mismatch.file,
        }),
      )),
    Match.tag('VerifiedCase', (verified) => Result.succeed(IntegrityVerified.make({ checked: verified.checked }))),
    Match.exhaustive,
  ))
