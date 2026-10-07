import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CycleEntry, DecisionTypeId, FsPath, ReleaseTag, RemoteName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class TagPreview extends S.TaggedClass<TagPreview>()('TagPreview', {
  tags: S.Array(ReleaseTag),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TagUpToDate extends S.TaggedClass<TagUpToDate>()('TagUpToDate', {
  tags: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TagPushed extends S.TaggedClass<TagPushed>()('TagPushed', {
  tags: S.NonEmptyArray(ReleaseTag),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TagCapturedMalformed extends S.TaggedError<TagCapturedMalformed>()(
  'TagCapturedMalformed',
  { path: FsPath },
) {}

export class TagExcludedMalformed extends S.TaggedError<TagExcludedMalformed>()(
  'TagExcludedMalformed',
  { path: FsPath },
) {}

export const TagAnnotation = S.Struct({
  tag: ReleaseTag,
  message: S.String,
})
export type TagAnnotation = S.Schema.Type<typeof TagAnnotation>

export class TagCommand extends S.TaggedClass<TagCommand>()('TagCommand', {
  cycle: S.Array(CycleEntry),
  annotations: S.Array(TagAnnotation),
  preview: S.Boolean,
  capturedIssue: S.optional(FsPath),
  excludedIssue: S.optional(FsPath),
  remote: RemoteName,
  output: S.optional(FsPath),
}) {}

export type TagDecision = TagPreview | TagUpToDate | TagPushed

const CapturedCase = S.TaggedStruct('CapturedBad', { path: FsPath })
const ExcludedCase = S.TaggedStruct('ExcludedBad', { path: FsPath })
const PreviewCase = S.TaggedStruct('Preview', { tags: S.Array(ReleaseTag) })
const UpToDateCase = S.TaggedStruct('UpToDate', { tags: S.Finite })
const PushCase = S.TaggedStruct('Push', { tags: S.NonEmptyArray(ReleaseTag) })
const TagCase = S.Union([CapturedCase, ExcludedCase, PreviewCase, UpToDateCase, PushCase])
type TagCase = S.Schema.Type<typeof TagCase>

const tagCaseOf = (command: TagCommand): TagCase => {
  const capturedIssue = command.capturedIssue
  if (capturedIssue !== undefined) {
    return CapturedCase.make({ path: capturedIssue })
  }
  const excludedIssue = command.excludedIssue
  if (excludedIssue !== undefined) {
    return ExcludedCase.make({ path: excludedIssue })
  }
  if (command.preview) {
    return PreviewCase.make({ tags: command.cycle.map((entry) => entry.tag) })
  }
  const [first, ...rest] = command.cycle
  if (first === undefined) {
    return UpToDateCase.make({ tags: command.cycle.length })
  }
  return PushCase.make({ tags: [first.tag, ...rest.map((entry) => entry.tag)] })
}

export const tagPackages = Workflow.make(
  TagCommand,
  (
    command,
  ): Result.Result<
    TagPreview | TagUpToDate | TagPushed,
    TagCapturedMalformed | TagExcludedMalformed
  > =>
    Match.value(tagCaseOf(command)).pipe(
      Match.tag('CapturedBad', (bad) => Result.fail(TagCapturedMalformed.make({ path: bad.path }))),
      Match.tag('ExcludedBad', (bad) => Result.fail(TagExcludedMalformed.make({ path: bad.path }))),
      Match.tag('Preview', (preview) => Result.succeed(TagPreview.make({ tags: [...preview.tags] }))),
      Match.tag('UpToDate', (upToDate) => Result.succeed(TagUpToDate.make({ tags: upToDate.tags }))),
      Match.tag('Push', (push) => Result.succeed(TagPushed.make({ tags: [...push.tags] }))),
      Match.exhaustive,
    ),
)
