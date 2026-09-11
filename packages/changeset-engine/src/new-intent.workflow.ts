import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { IntentUnknownPackage } from '@systemfsoftware/release-language'
import { Bump, IntentSlug, IntentSummary, Member, PackageName } from '@systemfsoftware/release-language'
import * as Array from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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

const NewIntentDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/changeset-engine/NewIntentDecision',
)
type NewIntentDecisionTypeId = typeof NewIntentDecisionTypeId

export class IntentNamed extends S.TaggedClass<IntentNamed>()('IntentNamed', {
  packages: S.NonEmptyArray(PackageName),
  bump: Bump,
  summary: IntentSummary,
  slug: IntentSlug,
}) {
  readonly [NewIntentDecisionTypeId] = NewIntentDecisionTypeId
}

export class IntentDerived extends S.TaggedClass<IntentDerived>()(
  'IntentDerived',
  {
    packages: S.NonEmptyArray(PackageName),
    bump: Bump,
    summary: IntentSummary,
  },
) {
  readonly [NewIntentDecisionTypeId] = NewIntentDecisionTypeId
}

type NewIntentDecision = IntentNamed | IntentDerived
type NewIntentVerdict = Result.Result<NewIntentDecision, IntentUnknownPackage>

const firstUnknownPackage = (
  command: NewIntentCommand,
): Option.Option<PackageName> =>
  Array.findFirst(
    command.packages,
    (name) => !Array.some(command.members, (member) => member.name === name),
  )

const refuseUnknown = (packageName: PackageName): NewIntentVerdict =>
  Result.fail<IntentUnknownPackage>({ _tag: 'IntentUnknownPackage', package: packageName })

const stageNamed = (command: NewIntentCommand, slug: IntentSlug): NewIntentVerdict =>
  Result.succeed(
    IntentNamed.make({
      packages: command.packages,
      bump: command.bump,
      summary: command.summary,
      slug,
    }),
  )

const stageDerived = (command: NewIntentCommand): NewIntentVerdict =>
  Result.succeed(
    IntentDerived.make({
      packages: command.packages,
      bump: command.bump,
      summary: command.summary,
    }),
  )

export const newIntent = Workflow.make(
  NewIntentCommand,
  (command): NewIntentVerdict =>
    Match.value({
      unknown: firstUnknownPackage(command),
      slug: Option.fromNullishOr(command.slug),
    }).pipe(
      Match.when(
        { unknown: Option.isSome },
        (facts): NewIntentVerdict => refuseUnknown(facts.unknown.value),
      ),
      Match.when(
        { slug: Option.isSome },
        (facts): NewIntentVerdict => stageNamed(command, facts.slug.value),
      ),
      Match.orElse((): NewIntentVerdict => stageDerived(command)),
    ),
)
