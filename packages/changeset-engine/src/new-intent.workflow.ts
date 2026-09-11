import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Bump,
  DecisionTypeId,
  IntentSlug,
  IntentSummary,
  type IntentUnknownPackage,
  Member,
  PackageName,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class NewIntentCommand extends S.TaggedClass<NewIntentCommand>()(
  'NewIntentCommand',
  {
    members: S.Array(Member),
    packages: S.NonEmptyArray(PackageName),
    bump: Bump,
    summary: IntentSummary,
    slug: S.optional(IntentSlug),
  },
) {}

export class IntentNamed extends S.TaggedClass<IntentNamed>()('IntentNamed', {
  packages: S.NonEmptyArray(PackageName),
  bump: Bump,
  summary: IntentSummary,
  slug: IntentSlug,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class IntentDerived extends S.TaggedClass<IntentDerived>()(
  'IntentDerived',
  {
    packages: S.NonEmptyArray(PackageName),
    bump: Bump,
    summary: IntentSummary,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const UnknownPackageCase = S.TaggedStruct('UnknownPackage', {
  package: PackageName,
})
type UnknownPackageCase = S.Schema.Type<typeof UnknownPackageCase>

const NamedCase = S.TaggedStruct('Named', {
  packages: S.NonEmptyArray(PackageName),
  bump: Bump,
  summary: IntentSummary,
  slug: IntentSlug,
})
type NamedCase = S.Schema.Type<typeof NamedCase>

const DerivedCase = S.TaggedStruct('Derived', {
  packages: S.NonEmptyArray(PackageName),
  bump: Bump,
  summary: IntentSummary,
})
type DerivedCase = S.Schema.Type<typeof DerivedCase>

type NewIntentCase = UnknownPackageCase | NamedCase | DerivedCase

const newIntentCaseOf = (command: NewIntentCommand): NewIntentCase => {
  const unknown = command.packages.find((name) => !command.members.some((member) => member.name === name))
  if (unknown !== undefined) return { _tag: 'UnknownPackage', package: unknown }
  if (command.slug !== undefined) {
    return {
      _tag: 'Named',
      packages: command.packages,
      bump: command.bump,
      summary: command.summary,
      slug: command.slug,
    }
  }
  return {
    _tag: 'Derived',
    packages: command.packages,
    bump: command.bump,
    summary: command.summary,
  }
}

export const newIntent = Workflow.make(
  NewIntentCommand,
  (
    command,
  ): Result.Result<IntentNamed | IntentDerived, IntentUnknownPackage> =>
    Match.value(newIntentCaseOf(command)).pipe(
      Match.tag(
        'UnknownPackage',
        (unknown): Result.Result<IntentDerived, IntentUnknownPackage> =>
          Result.fail({
            _tag: 'IntentUnknownPackage',
            package: unknown.package,
          }),
      ),
      Match.tag('Named', (named) =>
        Result.succeed(
          IntentNamed.make({
            packages: named.packages,
            bump: named.bump,
            summary: named.summary,
            slug: named.slug,
          }),
        )),
      Match.tag('Derived', (derived) =>
        Result.succeed(
          IntentDerived.make({
            packages: derived.packages,
            bump: derived.bump,
            summary: derived.summary,
          }),
        )),
      Match.exhaustive,
    ),
)
