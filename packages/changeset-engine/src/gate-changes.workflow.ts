import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { GateIntentMissing, GateUnknownPackage, RelativePath } from '@systemfsoftware/release-language'
import { Intent, Member, PackageName } from '@systemfsoftware/release-language'
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

const ChangesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/changeset-engine/ChangesDecision',
)
type ChangesDecisionTypeId = typeof ChangesDecisionTypeId

export class ChangesVacant extends S.TaggedClass<ChangesVacant>()(
  'ChangesVacant',
  {
    members: S.Array(PackageName),
  },
) {
  readonly [ChangesDecisionTypeId] = ChangesDecisionTypeId
}

export class ChangesGated extends S.TaggedClass<ChangesGated>()(
  'ChangesGated',
  {
    touched: S.Array(PackageName),
  },
) {
  readonly [ChangesDecisionTypeId] = ChangesDecisionTypeId
}

type ChangesDecision = ChangesVacant | ChangesGated
type GateVerdict = Result.Result<ChangesDecision, GateUnknownPackage | GateIntentMissing>

type ForeignEntry = { readonly path: RelativePath; readonly name: PackageName }
type NonEmpty = readonly [PackageName, ...PackageName[]]

type GateFacts = {
  readonly members: ReadonlyArray<PackageName>
  readonly moved: ReadonlyArray<PackageName>
  readonly unnamed: Option.Option<NonEmpty>
  readonly foreign: Option.Option<ForeignEntry>
}

const named = (command: GateCommand, name: PackageName): boolean =>
  Array.some(
    command.intents,
    (intent) => Array.some(intent.packages, (entry) => entry.name === name),
  )

const memberNames = (command: GateCommand): ReadonlyArray<PackageName> =>
  Array.map(command.members, (member) => member.name)

const publishableNames = (command: GateCommand): ReadonlyArray<PackageName> =>
  Array.map(
    Array.filter(command.members, (member) => member.publishable),
    (member) => member.name,
  )

const moved = (command: GateCommand): ReadonlyArray<PackageName> =>
  Array.filter(
    command.touched,
    (name) => Array.contains(publishableNames(command), name),
  ).sort()

const firstNonEmpty = (names: ReadonlyArray<PackageName>): Option.Option<NonEmpty> =>
  Array.match(names, {
    onEmpty: (): Option.Option<NonEmpty> => Option.none(),
    onNonEmpty: (nonEmpty): Option.Option<NonEmpty> => Option.some(nonEmpty),
  })

const foreignEntry = (command: GateCommand): Option.Option<ForeignEntry> =>
  Match.value(command.skipLiveness).pipe(
    Match.when(true, (): Option.Option<ForeignEntry> => Option.none()),
    Match.orElse(() =>
      Array.findFirst(
        Array.flatMap(
          command.intents,
          (intent) => Array.map(intent.packages, (entry) => ({ path: intent.path, name: entry.name })),
        ),
        (entry) => !Array.contains(memberNames(command), entry.name),
      )
    ),
  )

const gateFacts = (command: GateCommand): GateFacts => {
  const names = moved(command)
  return {
    members: memberNames(command),
    moved: names,
    unnamed: firstNonEmpty(Array.filter(names, (name) => !named(command, name))),
    foreign: foreignEntry(command),
  }
}

const refuseForeign = (foreign: ForeignEntry): GateVerdict =>
  Result.fail<GateUnknownPackage>({
    _tag: 'GateUnknownPackage',
    path: foreign.path,
    package: foreign.name,
  })

const stageVacant = (members: ReadonlyArray<PackageName>): GateVerdict =>
  Result.succeed(ChangesVacant.make({ members }))

const refuseUnnamed = (packages: NonEmpty): GateVerdict =>
  Result.fail<GateIntentMissing>({ _tag: 'GateIntentMissing', packages })

const stageGated = (movedNames: ReadonlyArray<PackageName>): GateVerdict =>
  Result.succeed(ChangesGated.make({ touched: movedNames }))

export const gateChanges = Workflow.make(
  GateCommand,
  (command): GateVerdict =>
    Match.value(gateFacts(command)).pipe(
      Match.when(
        { foreign: Option.isSome },
        (facts): GateVerdict => refuseForeign(facts.foreign.value),
      ),
      Match.when(
        ({ moved: names }) => names.length === 0,
        (facts): GateVerdict => stageVacant(facts.members),
      ),
      Match.when(
        { unnamed: Option.isSome },
        (facts): GateVerdict => refuseUnnamed(facts.unnamed.value),
      ),
      Match.orElse((facts): GateVerdict => stageGated(facts.moved)),
    ),
)
