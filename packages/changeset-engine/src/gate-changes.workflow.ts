import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  type GateIntentMissing,
  type GateUnknownPackage,
  Intent,
  Member,
  PackageName,
  RelativePath,
} from '@systemfsoftware/release-language'
import * as Array from 'effect/Array'
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

const UnknownCase = S.TaggedStruct('GateUnknown', {
  path: RelativePath,
  package: PackageName,
})
const VacantCase = S.TaggedStruct('GateVacant', { members: S.Array(PackageName) })
const MissingCase = S.TaggedStruct('GateMissing', {
  packages: S.NonEmptyArray(PackageName),
})
const GatedCase = S.TaggedStruct('GateGated', { touched: S.Array(PackageName) })

type GateCase =
  | S.Schema.Type<typeof UnknownCase>
  | S.Schema.Type<typeof VacantCase>
  | S.Schema.Type<typeof MissingCase>
  | S.Schema.Type<typeof GatedCase>

type GateVerdict = Result.Result<
  ChangesGated | ChangesVacant,
  GateIntentMissing | GateUnknownPackage
>

type GateSubject = S.Schema.Type<typeof GateCommand>

const memberNames = (command: GateSubject): ReadonlyArray<PackageName> =>
  Array.map(command.members, (member) => member.name)

const publishableNames = (command: GateSubject): ReadonlyArray<PackageName> =>
  Array.map(
    Array.filter(command.members, (member) => member.publishable),
    (member) => member.name,
  )

const moved = (command: GateSubject): ReadonlyArray<PackageName> =>
  Array.filter(
    command.touched,
    (name) => Array.contains(publishableNames(command), name),
  ).sort()

const unnamed = (command: GateSubject): ReadonlyArray<PackageName> =>
  Array.filter(
    moved(command),
    (name) =>
      !Array.some(
        command.intents,
        (intent) => Array.some(intent.packages, (entry) => entry.name === name),
      ),
  )

interface ForeignEntry {
  readonly path: RelativePath
  readonly name: PackageName
}

const intentEntries = (command: GateSubject): ReadonlyArray<ForeignEntry> =>
  Array.flatMap(
    command.intents,
    (intent) => Array.map(intent.packages, (entry) => ({ path: intent.path, name: entry.name })),
  )

const foreignEntries = (command: GateSubject): ReadonlyArray<ForeignEntry> =>
  Match.value(command.skipLiveness).pipe(
    Match.when(
      (skipped) => skipped === true,
      (): ReadonlyArray<ForeignEntry> => [],
    ),
    Match.orElse((): ReadonlyArray<ForeignEntry> => intentEntries(command)),
  )

const firstForeign = (command: GateSubject): Option.Option<ForeignEntry> =>
  Array.findFirst(
    foreignEntries(command),
    (entry) => !Array.contains(memberNames(command), entry.name),
  )

const nonEmpty = (
  values: ReadonlyArray<PackageName>,
): Option.Option<readonly [PackageName, ...PackageName[]]> =>
  Array.match(values, {
    onEmpty: (): Option.Option<readonly [PackageName, ...PackageName[]]> => Option.none(),
    onNonEmpty: (found): Option.Option<readonly [PackageName, ...PackageName[]]> => Option.some(found),
  })

const classifyGate = (command: GateSubject): GateCase =>
  Match.value({
    foreign: firstForeign(command),
    missing: nonEmpty(unnamed(command)),
    touched: moved(command),
  }).pipe(
    Match.when({ foreign: Option.isSome }, ({ foreign }): GateCase => {
      const entry = Option.getOrThrow(foreign)
      return UnknownCase.make({ path: entry.path, package: entry.name })
    }),
    Match.when(
      ({ touched }) => touched.length === 0,
      (): GateCase => VacantCase.make({ members: memberNames(command) }),
    ),
    Match.when(
      { missing: Option.isSome },
      ({ missing }): GateCase => MissingCase.make({ packages: Option.getOrThrow(missing) }),
    ),
    Match.orElse(
      ({ touched }): GateCase => GatedCase.make({ touched }),
    ),
  )

export const gateChanges = Workflow.make(
  GateCommand,
  (command): GateVerdict =>
    Match.value(classifyGate(command)).pipe(
      Match.tag(
        'GateUnknown',
        (found): GateVerdict =>
          Result.fail<GateUnknownPackage>({
            _tag: 'GateUnknownPackage',
            path: found.path,
            package: found.package,
          }),
      ),
      Match.tag(
        'GateVacant',
        (found): GateVerdict => Result.succeed(ChangesVacant.make({ members: found.members })),
      ),
      Match.tag(
        'GateMissing',
        (found): GateVerdict =>
          Result.fail<GateIntentMissing>({
            _tag: 'GateIntentMissing',
            packages: found.packages,
          }),
      ),
      Match.tag(
        'GateGated',
        (found): GateVerdict => Result.succeed(ChangesGated.make({ touched: found.touched })),
      ),
      Match.exhaustive,
    ),
)
