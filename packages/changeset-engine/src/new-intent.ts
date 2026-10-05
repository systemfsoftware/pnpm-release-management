import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  Bump,
  ChangesetStore,
  type Intent,
  IntentSlug,
  IntentSummary,
  type IntentUnknownPackage,
  type Member,
  type MemberRefusal,
  NewIntentInvalidBump,
  NewIntentPackageNameMalformed,
  NewIntentPackagesEmpty,
  type NewIntentRefusal,
  NewIntentSummaryMissing,
  PackageName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Array from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { IntentDerived, IntentNamed, newIntent, NewIntentCommand } from './new-intent.workflow.js'

const NewIntentInput = Wire.wire({
  packages: Wire.mint(S.Array(S.String)),
  bump: Wire.mint(S.optional(S.String)),
  summary: Wire.mint(S.optional(S.String)),
  slug: Wire.mint(S.optional(S.String)),
})

type NewIntentRequestInput = S.Schema.Type<typeof NewIntentInput>

type NewIntentVerdict = Result.Result<
  IntentNamed | IntentDerived,
  IntentUnknownPackage
>

const decodeBump = (
  given: string | undefined,
): Result.Result<Bump, NewIntentRefusal> =>
  Result.mapError(
    S.decodeUnknownResult(Bump)(given),
    () => NewIntentInvalidBump.make({ given: given ?? '' }),
  )

const decodePackages = (
  given: ReadonlyArray<string>,
): Result.Result<ReadonlyArray<PackageName>, NewIntentRefusal> => {
  const [malformed, valid] = Array.separate(
    Array.map(
      given,
      (name) => Result.mapError(S.decodeUnknownResult(PackageName)(name), () => name),
    ),
  )
  const first = malformed[0]
  if (first !== undefined) {
    return Result.fail(NewIntentPackageNameMalformed.make({ given: first }))
  }
  return Result.succeed(valid)
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

const requestedSlug = (given: string | undefined): IntentSlug | undefined => {
  if (given === undefined) return undefined
  const decoded = S.decodeUnknownResult(IntentSlug)(slugOf(given))
  if (Result.isFailure(decoded)) return undefined
  return decoded.success
}

const commandOf = (
  request: NewIntentRequestInput,
  members: ReadonlyArray<Member>,
): Result.Result<NewIntentCommand, NewIntentRefusal> =>
  Result.gen(function*() {
    const bump = yield* decodeBump(request.bump)
    const packages = yield* decodePackages(request.packages)
    const summary = yield* decodeSummary(request.summary, packages)
    const first = packages[0]
    if (first === undefined) {
      return yield* Result.fail(NewIntentPackagesEmpty.make({ bump, summary }))
    }
    return NewIntentCommand.make({
      members,
      packages: [first, ...packages.slice(1)],
      bump,
      summary,
      slug: requestedSlug(request.slug),
    })
  })

const read = (
  request: NewIntentRequestInput,
): Effect.Effect<
  NewIntentCommand,
  MemberRefusal | NewIntentRefusal,
  WorkspaceStore
> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const members = yield* workspace.listMembers()
    return yield* Effect.fromResult(commandOf(request, members))
  })

const write = (
  outcome: NewIntentVerdict,
): Effect.Effect<Intent, NewIntentRefusal, ChangesetStore> =>
  Result.match(outcome, {
    onFailure: (refusal) => Effect.fail(refusal),
    onSuccess: (decision) => Effect.flatMap(ChangesetStore, (store) => store.writeIntent(decision)),
  })

export const newIntentCell = Cell.layer({
  read,
  decide: newIntent,
  write,
})
