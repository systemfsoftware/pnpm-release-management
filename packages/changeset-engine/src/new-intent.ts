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
import { IntentDerived, IntentNamed, newIntent, NewIntentCommand } from './new-intent.workflow.js'

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

type NewIntentVerdict = Result.Result<
  IntentNamed | IntentDerived,
  IntentUnknownPackage
>

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

const slugOf = (given: string): string => given.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const requestedSlug = (given: string | undefined): Option.Option<IntentSlug> =>
  Option.flatMap(
    Option.fromNullishOr(given),
    (text) => Option.getSuccess(S.decodeUnknownResult(IntentSlug)(slugOf(text))),
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
  Result.gen(function*() {
    const bump = yield* decodeBump(raw.request.bump)
    const packages = yield* decodePackages(raw.request.packages)
    const summary = yield* decodeSummary(raw.request.summary, packages)
    return yield* commandOf(raw, bump, packages, summary)
  })

const requestOf = (decision: IntentNamed | IntentDerived): NewIntentRequest =>
  Match.value(decision).pipe(
    Match.tag(
      'IntentNamed',
      (named): NewIntentRequest => ({
        packages: named.packages,
        bump: named.bump,
        summary: named.summary,
        slug: named.slug,
      }),
    ),
    Match.tag(
      'IntentDerived',
      (derived): NewIntentRequest => ({
        packages: derived.packages,
        bump: derived.bump,
        summary: derived.summary,
      }),
    ),
    Match.exhaustive,
  )

const encode = (outcome: NewIntentVerdict): Result.Result<NewIntentRequest, IntentUnknownPackage> =>
  Result.map(outcome, requestOf)

const write = (
  document: Result.Result<NewIntentRequest, IntentUnknownPackage>,
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
