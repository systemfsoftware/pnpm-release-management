import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  type GateIntentMissing,
  type GateUnknownPackage,
  Intent,
  Member,
  PackageName,
  RelativePath,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class GateCommand extends S.TaggedClass<GateCommand>()('GateCommand', {
  members: S.Array(Member),
  touched: S.Array(PackageName),
  intents: S.Array(Intent),
  skipLiveness: S.optional(S.Boolean),
}) {}

const GateChangesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/changeset-engine/GateChangesDecision',
)
type GateChangesDecisionTypeId = typeof GateChangesDecisionTypeId

export class ChangesVacant extends S.TaggedClass<ChangesVacant>()(
  'ChangesVacant',
  {
    members: S.Array(PackageName),
  },
) {
  readonly [GateChangesDecisionTypeId] = GateChangesDecisionTypeId
}

export class ChangesGated extends S.TaggedClass<ChangesGated>()(
  'ChangesGated',
  {
    touched: S.Array(PackageName),
  },
) {
  readonly [GateChangesDecisionTypeId] = GateChangesDecisionTypeId
}

const memberNames = (command: S.Schema.Type<typeof GateCommand>) => command.members.map((member) => member.name)

const publishableNames = (command: S.Schema.Type<typeof GateCommand>) =>
  command.members
    .filter((member) => member.publishable)
    .map((member) => member.name)

const moved = (command: S.Schema.Type<typeof GateCommand>) => {
  const publishable = publishableNames(command)
  return command.touched.filter((name) => publishable.includes(name)).sort()
}

const unnamed = (command: S.Schema.Type<typeof GateCommand>) => {
  const movedNames = moved(command)
  return movedNames.filter((name) =>
    !command.intents.some((intent) => intent.packages.some((entry) => entry.name === name))
  )
}

const foreign = (command: S.Schema.Type<typeof GateCommand>) => {
  const live = command.members.map((member) => member.name)
  return command.intents
    .flatMap((intent) => intent.packages.map((entry) => ({ path: intent.path, name: entry.name })))
    .filter((candidate) => !live.includes(candidate.name) && command.skipLiveness !== true)
}
const ForeignEntry = S.Struct({ path: RelativePath, name: PackageName })
const UnknownCase = S.TaggedStruct('Unknown', { entry: ForeignEntry })
const VacantCase = S.TaggedStruct('Vacant', { members: S.Array(PackageName) })
const MissingCase = S.TaggedStruct('Missing', { packages: S.NonEmptyArray(PackageName) })
const GatedCase = S.TaggedStruct('Gated', { touched: S.Array(PackageName) })
type GateCase =
  | S.Schema.Type<typeof UnknownCase>
  | S.Schema.Type<typeof VacantCase>
  | S.Schema.Type<typeof MissingCase>
  | S.Schema.Type<typeof GatedCase>

const firstOf = <T>(values: ReadonlyArray<T>): Option.Option<T> => Option.fromNullishOr(values[0])

const nonEmptyOf = <T>(
  values: ReadonlyArray<T>,
): Option.Option<readonly [T, ...T[]]> => Option.map(firstOf(values), (head) => [head, ...values.slice(1)] as const)

const classify = (command: S.Schema.Type<typeof GateCommand>): GateCase => {
  const unknown = firstOf(foreign(command))
  const missing = nonEmptyOf(unnamed(command))
  const touched = moved(command)
  return Match.value({ unknown, missing, touched }).pipe(
    Match.when({ unknown: Option.isSome }, ({ unknown }) => UnknownCase.make({ entry: Option.getOrThrow(unknown) })),
    Match.when(
      ({ touched }) => touched.length === 0,
      () => VacantCase.make({ members: memberNames(command) }),
    ),
    Match.when({ missing: Option.isSome }, ({ missing }) => MissingCase.make({ packages: Option.getOrThrow(missing) })),
    Match.orElse(({ touched }) => GatedCase.make({ touched })),
  )
}

export const gateChanges = Workflow.make(
  GateCommand,
  (
    command,
  ): Result.Result<ChangesGated | ChangesVacant, GateIntentMissing | GateUnknownPackage> =>
    Match.value(classify(command)).pipe(
      Match.tag('Unknown', (gateCase) =>
        Result.fail(
          {
            _tag: 'GateUnknownPackage',
            path: gateCase.entry.path,
            package: gateCase.entry.name,
          } as const,
        )),
      Match.tag('Vacant', (gateCase) => Result.succeed(ChangesVacant.make({ members: gateCase.members }))),
      Match.tag(
        'Missing',
        (gateCase) => Result.fail({ _tag: 'GateIntentMissing', packages: gateCase.packages } as const),
      ),
      Match.tag('Gated', (gateCase) => Result.succeed(ChangesGated.make({ touched: gateCase.touched }))),
      Match.exhaustive,
    ),
)
