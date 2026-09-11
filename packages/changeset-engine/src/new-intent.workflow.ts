import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Bump,
  IntentSlug,
  IntentSummary,
  type IntentUnknownPackage,
  Member,
  PackageName,
} from '@systemfsoftware/release-language'
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

const NewIntentStagedDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/changeset-engine/NewIntentStagedDecision',
)
type NewIntentStagedDecisionTypeId = typeof NewIntentStagedDecisionTypeId

export class IntentNamedStaged extends S.TaggedClass<IntentNamedStaged>()(
  'IntentNamedStaged',
  {
    packages: S.NonEmptyArray(PackageName),
    bump: Bump,
    summary: IntentSummary,
    slug: IntentSlug,
  },
) {
  readonly [NewIntentStagedDecisionTypeId] = NewIntentStagedDecisionTypeId
}

export class IntentDerivedStaged extends S.TaggedClass<IntentDerivedStaged>()(
  'IntentDerivedStaged',
  {
    packages: S.NonEmptyArray(PackageName),
    bump: Bump,
    summary: IntentSummary,
  },
) {
  readonly [NewIntentStagedDecisionTypeId] = NewIntentStagedDecisionTypeId
}

const UnknownCase = S.TaggedStruct('NewIntentUnknownPackage', {
  package: PackageName,
})
const NamedCase = S.TaggedStruct('NewIntentNamed', { slug: IntentSlug })
const DerivedCase = S.TaggedStruct('NewIntentDerived', {})

type NewIntentCase =
  | S.Schema.Type<typeof UnknownCase>
  | S.Schema.Type<typeof NamedCase>
  | S.Schema.Type<typeof DerivedCase>

type NewIntentStaging = Result.Result<
  IntentNamedStaged | IntentDerivedStaged,
  IntentUnknownPackage
>

type NewIntentSubject = S.Schema.Type<typeof NewIntentCommand>

const firstUnknownPackage = (command: NewIntentSubject): Option.Option<PackageName> =>
  Array.findFirst(
    command.packages,
    (name) => !Array.some(command.members, (member) => member.name === name),
  )

const classifyNewIntent = (command: NewIntentSubject): NewIntentCase =>
  Match.value({
    unknown: firstUnknownPackage(command),
    slug: Option.fromNullishOr(command.slug),
  }).pipe(
    Match.when(
      { unknown: Option.isSome },
      ({ unknown }): NewIntentCase => UnknownCase.make({ package: Option.getOrThrow(unknown) }),
    ),
    Match.when(
      { slug: Option.isSome },
      ({ slug }): NewIntentCase => NamedCase.make({ slug: Option.getOrThrow(slug) }),
    ),
    Match.orElse((): NewIntentCase => DerivedCase.make({})),
  )

export const newIntent = Workflow.make(
  NewIntentCommand,
  (command): NewIntentStaging =>
    Match.value(classifyNewIntent(command)).pipe(
      Match.tag(
        'NewIntentUnknownPackage',
        (found): NewIntentStaging =>
          Result.fail<IntentUnknownPackage>({
            _tag: 'IntentUnknownPackage',
            package: found.package,
          }),
      ),
      Match.tag(
        'NewIntentNamed',
        (found): NewIntentStaging =>
          Result.succeed(
            IntentNamedStaged.make({
              packages: command.packages,
              bump: command.bump,
              summary: command.summary,
              slug: found.slug,
            }),
          ),
      ),
      Match.tag(
        'NewIntentDerived',
        (): NewIntentStaging =>
          Result.succeed(
            IntentDerivedStaged.make({
              packages: command.packages,
              bump: command.bump,
              summary: command.summary,
            }),
          ),
      ),
      Match.exhaustive,
    ),
)
