import { Cell, Wire } from '@systemfsoftware/effect-cell-types'

import {
  Bump,
  ChangesetStore,
  IntentSlug,
  IntentSummary,
  type IntentUnknownPackage,
  type Member,
  type MemberRefusal,
  type NewIntentDecision,
  NewIntentInvalidBump,
  NewIntentPackageNameMalformed as NewIntentPackageNameMalformedSchema,
  NewIntentPackagesEmpty,
  type NewIntentRefusal,
  NewIntentSummaryMissing,
  PackageName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Array from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { IntentDerivedStaged, IntentNamedStaged } from './new-intent.workflow.ts'
import { newIntent, NewIntentCommand } from './new-intent.workflow.ts'

export const NewIntentInput = Wire.wire({
  packages: Wire.mint(S.Array(S.String)),
  bump: Wire.mint(S.optional(S.String)),
  summary: Wire.mint(S.optional(S.String)),
  slug: Wire.mint(S.optional(S.String)),
})

type RawNewIntent = {
  readonly request: S.Schema.Type<typeof NewIntentInput>
  readonly members: ReadonlyArray<Member>
}

type NewIntentReadError = MemberRefusal

const read = (
  request: S.Schema.Type<typeof NewIntentInput>,
): Effect.Effect<RawNewIntent, NewIntentReadError, WorkspaceStore> =>
  Effect.map(
    Effect.flatMap(WorkspaceStore, (workspace) => workspace.listMembers()),
    (members) => ({ request, members }),
  )
const normalizeSlug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const slugOf = (given: string | undefined) =>
  Option.flatMap(
    Option.fromNullishOr(given),
    (value) => Option.getSuccess(S.decodeUnknownResult(IntentSlug)(normalizeSlug(value))),
  )

const decodeNames = (raw: RawNewIntent) => {
  const names = raw.request.packages.map(
    (given) => ({ given, decoded: S.decodeUnknownResult(PackageName)(given) }),
  )
  const malformed = names.filter((name) => Result.isFailure(name.decoded))
  const valid = names.flatMap((name) => Option.toArray(Option.getSuccess(name.decoded)))
  return { malformed, valid }
}

const decode = (
  raw: RawNewIntent,
): Result.Result<InstanceType<typeof NewIntentCommand>, NewIntentRefusal> => {
  const names = decodeNames(raw)
  const bump = S.decodeUnknownResult(Bump)(raw.request.bump)
  if (Result.isFailure(bump)) {
    return Result.fail(NewIntentInvalidBump.make({ given: raw.request.bump ?? '' }))
  }
  if (names.malformed.length > 0) {
    return Result.fail(
      NewIntentPackageNameMalformedSchema.make({ given: names.malformed[0].given }),
    )
  }
  const summary = S.decodeUnknownResult(IntentSummary)(raw.request.summary)
  if (Result.isFailure(summary)) {
    return Result.fail(NewIntentSummaryMissing.make({ packages: names.valid }))
  }
  if (names.valid.length === 0) {
    return Result.fail(
      NewIntentPackagesEmpty.make({ bump: bump.success, summary: summary.success }),
    )
  }
  return Result.succeed(
    NewIntentCommand.make({
      members: [...raw.members],
      packages: names.valid,
      bump: bump.success,
      summary: summary.success,
      slug: Option.getOrUndefined(slugOf(raw.request.slug)),
    }),
  )
}

const encode = (
  outcome: Result.Result<IntentNamedStaged | IntentDerivedStaged, IntentUnknownPackage>,
): Result.Result<IntentNamedStaged | IntentDerivedStaged, IntentUnknownPackage> => outcome
const write = (
  outcome: Result.Result<IntentNamedStaged | IntentDerivedStaged, IntentUnknownPackage>,
  raw: RawNewIntent,
): Effect.Effect<NewIntentDecision, NewIntentRefusal, ChangesetStore> => {
  if (Result.isFailure(outcome)) return Effect.fail(outcome.failure)
  const staged = outcome.success
  return Array.match(staged.packages, {
    onEmpty: () => Effect.die(new Error('a staged intent names at least one package')),
    onNonEmpty: (entries) => {
      const [head, ...tail] = entries
      const request: {
        packages: [PackageName, ...PackageName[]]
        bump: Bump
        summary: IntentSummary
        slug?: IntentSlug | undefined
      } = {
        packages: [head.name, ...tail.map((entry) => entry.name)],
        bump: staged.bump,
        summary: staged.summary,
        slug: Option.getOrUndefined(slugOf(raw.request.slug)),
      }
      return Effect.flatMap(ChangesetStore, (store) => store.writeIntent(request))
    },
  })
}

export const newIntentCell = Cell.layer({
  read,
  decode,
  decide: newIntent,
  encode,
  write,
})
