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
  NewIntentPackageNameMalformed,
  NewIntentPackagesEmpty,
  type NewIntentRefusal,
  type NewIntentRequest,
  NewIntentSummaryMissing,
  PackageName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Array from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { IntentDerivedStaged, IntentNamedStaged, newIntent, NewIntentCommand } from './new-intent.workflow.js'

export const NewIntentInput = Wire.wire({
  packages: Wire.mint(S.Array(S.String)),
  bump: Wire.mint(S.optional(S.String)),
  summary: Wire.mint(S.optional(S.String)),
  slug: Wire.mint(S.optional(S.String)),
})

type NewIntentRequestInput = S.Schema.Type<typeof NewIntentInput>

type RawNewIntent = {
  readonly request: NewIntentRequestInput
  readonly members: ReadonlyArray<Member>
}

type NewIntentReadError = MemberRefusal

const read = (
  request: NewIntentRequestInput,
): Effect.Effect<RawNewIntent, NewIntentReadError, WorkspaceStore> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const members = yield* workspace.listMembers()
    return { request, members }
  })

const decodeBump = (given: string | undefined): Result.Result<Bump, NewIntentRefusal> =>
  Result.mapError(
    S.decodeUnknownResult(Bump)(given),
    () => NewIntentInvalidBump.make({ given: given ?? '' }),
  )

const decodePackages = (
  given: ReadonlyArray<string>,
): Result.Result<ReadonlyArray<PackageName>, NewIntentRefusal> => {
  const [malformed, valid] = Array.separate(
    Array.map(given, (name) => Result.mapError(S.decodeUnknownResult(PackageName)(name), () => name)),
  )
  return Option.match(Array.head(malformed), {
    onNone: () => Result.succeed(valid),
    onSome: (first) => Result.fail(NewIntentPackageNameMalformed.make({ given: first })),
  })
}

const decodeSummary = (
  given: string | undefined,
  packages: ReadonlyArray<PackageName>,
): Result.Result<IntentSummary, NewIntentRefusal> =>
  Result.mapError(
    S.decodeUnknownResult(IntentSummary)(given),
    () => NewIntentSummaryMissing.make({ packages }),
  )

const normalizeSlug = (given: string): string => given.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const requestedSlug = (given: string | undefined): Option.Option<IntentSlug> =>
  Option.flatMap(
    Option.fromNullishOr(given),
    (text) => Option.getSuccess(S.decodeUnknownResult(IntentSlug)(normalizeSlug(text))),
  )

const commandOf = (
  raw: RawNewIntent,
  bump: Bump,
  packages: ReadonlyArray<PackageName>,
  summary: IntentSummary,
): Result.Result<NewIntentCommand, NewIntentRefusal> =>
  Array.match(packages, {
    onEmpty: () => Result.fail(NewIntentPackagesEmpty.make({ bump, summary })),
    onNonEmpty: (named) =>
      Result.succeed(
        NewIntentCommand.make({
          members: raw.members,
          packages: named,
          bump,
          summary,
          slug: Option.getOrUndefined(requestedSlug(raw.request.slug)),
        }),
      ),
  })

const decode = (raw: RawNewIntent): Result.Result<NewIntentCommand, NewIntentRefusal> =>
  Result.flatMap(
    decodeBump(raw.request.bump),
    (bump) =>
      Result.flatMap(decodePackages(raw.request.packages), (packages) =>
        Result.flatMap(decodeSummary(raw.request.summary, packages), (summary) =>
          commandOf(raw, bump, packages, summary))),
  )

type NewIntentStaging = Result.Result<
  IntentNamedStaged | IntentDerivedStaged,
  IntentUnknownPackage
>

type NewIntentDocument = Result.Result<NewIntentRequest, IntentUnknownPackage>

const documentOf = (staged: IntentNamedStaged | IntentDerivedStaged): NewIntentRequest =>
  Match.value(staged).pipe(
    Match.tag(
      'IntentNamedStaged',
      (named): NewIntentRequest => ({
        packages: named.packages,
        bump: named.bump,
        summary: named.summary,
        slug: named.slug,
      }),
    ),
    Match.tag(
      'IntentDerivedStaged',
      (derived): NewIntentRequest => ({
        packages: derived.packages,
        bump: derived.bump,
        summary: derived.summary,
      }),
    ),
    Match.exhaustive,
  )

const encode = (outcome: NewIntentStaging): NewIntentDocument => Result.map(outcome, documentOf)

const write = (
  document: NewIntentDocument,
): Effect.Effect<NewIntentDecision, NewIntentRefusal, ChangesetStore> =>
  Result.match(document, {
    onFailure: (refusal) => Effect.fail(refusal),
    onSuccess: (request) => Effect.flatMap(ChangesetStore, (store) => store.writeIntent(request)),
  })

export const newIntentCell = Cell.layer({
  read,
  decode,
  decide: newIntent,
  encode,
  write,
})
