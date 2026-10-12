import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  DecisionTypeId,
  type GateIntentMissing,
  type GateUnknownPackage,
  Intent,
  Member,
  PackageName,
  RelativePath,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class GateCommand extends S.TaggedClass<GateCommand>()('GateCommand', {
  members: S.Array(Member),
  touched: S.Array(PackageName),
  deleted: S.Array(PackageName),
  intents: S.Array(Intent),
  skipLiveness: S.optional(S.Boolean),
}) {}

export class ChangesVacant extends S.TaggedClass<ChangesVacant>()(
  'ChangesVacant',
  {
    members: S.Array(PackageName),
    deleted: S.Array(PackageName),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class ChangesGated extends S.TaggedClass<ChangesGated>()(
  'ChangesGated',
  {
    touched: S.Array(PackageName),
    deleted: S.Array(PackageName),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const ForeignCase = S.TaggedStruct('Foreign', {
  path: RelativePath,
  package: PackageName,
})
type ForeignCase = S.Schema.Type<typeof ForeignCase>

const VacantCase = S.TaggedStruct('Vacant', {
  members: S.Array(PackageName),
  deleted: S.Array(PackageName),
})
type VacantCase = S.Schema.Type<typeof VacantCase>

const UnnamedCase = S.TaggedStruct('Unnamed', {
  packages: S.NonEmptyArray(PackageName),
})
type UnnamedCase = S.Schema.Type<typeof UnnamedCase>

const GatedCase = S.TaggedStruct('Gated', {
  touched: S.Array(PackageName),
  deleted: S.Array(PackageName),
})
type GatedCase = S.Schema.Type<typeof GatedCase>

type GateCase = ForeignCase | VacantCase | UnnamedCase | GatedCase

const foreignCaseOf = (
  command: GateCommand,
  memberNames: ReadonlyArray<PackageName>,
): ForeignCase | undefined => {
  if (command.skipLiveness === true) return undefined
  const entry = command.intents
    .flatMap((intent) => intent.packages.map((entry) => ({ path: intent.path, package: entry.name })))
    .find((entry) => !memberNames.includes(entry.package))
  if (entry === undefined) return undefined
  return { _tag: 'Foreign', path: entry.path, package: entry.package }
}

const movedSoFar = (command: GateCommand): ReadonlyArray<PackageName> =>
  [...command.touched]
    .filter((name) => command.members.some((member) => member.publishable && member.name === name))
    .sort()

const unnamedCaseOf = (
  command: GateCommand,
  moved: ReadonlyArray<PackageName>,
): UnnamedCase | undefined => {
  const unnamed = moved.filter((name) =>
    !command.intents.some((intent) => intent.packages.some((entry) => entry.name === name))
  )
  const first = unnamed[0]
  if (first === undefined) return undefined
  return { _tag: 'Unnamed', packages: [first, ...unnamed.slice(1)] }
}

const gateCaseOf = (command: GateCommand): GateCase => {
  const memberNames = command.members.map((member) => member.name)
  const foreign = foreignCaseOf(command, memberNames)
  if (foreign !== undefined) return foreign
  const moved = movedSoFar(command)
  if (moved.length === 0) return { _tag: 'Vacant', members: memberNames, deleted: command.deleted }
  const unnamed = unnamedCaseOf(command, moved)
  if (unnamed !== undefined) return unnamed
  return { _tag: 'Gated', touched: moved, deleted: command.deleted }
}

export const gateChanges = Workflow.make(
  GateCommand,
  (
    command,
  ): Result.Result<
    ChangesVacant | ChangesGated,
    GateUnknownPackage | GateIntentMissing
  > =>
    Match.value(gateCaseOf(command)).pipe(
      Match.tag(
        'Foreign',
        (foreign): Result.Result<ChangesVacant, GateUnknownPackage> =>
          Result.fail({
            _tag: 'GateUnknownPackage',
            path: foreign.path,
            package: foreign.package,
          }),
      ),
      Match.tag(
        'Vacant',
        (vacant) => Result.succeed(ChangesVacant.make({ members: vacant.members, deleted: vacant.deleted })),
      ),
      Match.tag(
        'Unnamed',
        (unnamed): Result.Result<ChangesGated, GateIntentMissing> =>
          Result.fail({ _tag: 'GateIntentMissing', packages: unnamed.packages }),
      ),
      Match.tag(
        'Gated',
        (gated) => Result.succeed(ChangesGated.make({ touched: gated.touched, deleted: gated.deleted })),
      ),
      Match.exhaustive,
    ),
)
