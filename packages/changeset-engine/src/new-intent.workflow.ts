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
    packages: S.Array(PackageName),
    bump: Bump,
    summary: IntentSummary,
    slug: S.optional(IntentSlug),
  },
) {}

const NewIntentStagedDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/changeset-engine/NewIntentStagedDecision',
)
type NewIntentStagedDecisionTypeId = typeof NewIntentStagedDecisionTypeId

const StagedEntry = S.Struct({
  name: PackageName,
  bump: Bump,
})

const StagedFields = {
  path: S.String,
  packages: S.Array(StagedEntry),
  bump: Bump,
  summary: IntentSummary,
}

export class IntentNamedStaged extends S.TaggedClass<IntentNamedStaged>()(
  'IntentNamedStaged',
  StagedFields,
) {
  readonly [NewIntentStagedDecisionTypeId] = NewIntentStagedDecisionTypeId
}

export class IntentDerivedStaged extends S.TaggedClass<IntentDerivedStaged>()(
  'IntentDerivedStaged',
  StagedFields,
) {
  readonly [NewIntentStagedDecisionTypeId] = NewIntentStagedDecisionTypeId
}

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(
    0,
    48,
  )
const unknownMembers = (command: S.Schema.Type<typeof NewIntentCommand>) => {
  const live = command.members.map((member) => member.name)
  return command.packages.filter((name) => !live.includes(name))
}

const derivedName = (command: S.Schema.Type<typeof NewIntentCommand>): string =>
  Option.some(slugify(command.packages.join(' '))).pipe(
    Option.filter((name) => name.length > 0),
    Option.getOrElse(() => 'changeset'),
  )

const entries = (command: S.Schema.Type<typeof NewIntentCommand>) =>
  command.packages.map((name) => ({ name, bump: command.bump }))

export const newIntent = Workflow.make(
  NewIntentCommand,
  (command): Result.Result<IntentNamedStaged | IntentDerivedStaged, IntentUnknownPackage> =>
    Array.match(unknownMembers(command), {
      onEmpty: () => Result.succeed(stage(command)),
      onNonEmpty: (unknown) =>
        Result.fail(
          {
            _tag: 'IntentUnknownPackage',
            package: unknown[0],
          } as const,
        ),
    }),
)

const stage = (
  command: S.Schema.Type<typeof NewIntentCommand>,
): IntentNamedStaged | IntentDerivedStaged =>
  Match.value({ slug: Option.fromNullishOr(command.slug) }).pipe(
    Match.when(
      { slug: Option.isSome },
      ({ slug }) =>
        IntentNamedStaged.make({
          path: `${slug.value}.md`,
          packages: entries(command),
          bump: command.bump,
          summary: command.summary,
        }),
    ),
    Match.orElse(() =>
      IntentDerivedStaged.make({
        path: `${derivedName(command)}.md`,
        packages: entries(command),
        bump: command.bump,
        summary: command.summary,
      })
    ),
  )
