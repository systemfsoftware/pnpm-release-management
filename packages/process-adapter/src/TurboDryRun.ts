import { type TaskName } from '@systemfsoftware/release-language'
import * as HashMap from 'effect/HashMap'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type DryRun, DryRunDocument, TurboDryRunDrifted, TurboDryRunUnreadable } from './TurboDryRun.schema.js'

export const decodeDryRun = (
  stdout: string,
  context: string,
): Result.Result<DryRunDocument, TurboDryRunUnreadable> =>
  Result.mapError(
    S.decodeResult(S.fromJsonString(DryRunDocument))(stdout),
    (error) => new TurboDryRunUnreadable({ context, reason: error.message }),
  )

export const dryRunView = (
  document: DryRunDocument,
  context: string,
  task: TaskName,
): Result.Result<DryRun, TurboDryRunDrifted> => {
  const requested = document.tasks.filter((entry) => entry.taskId.endsWith(`#${task}`))
  const matrix = HashMap.fromIterable(
    requested.map((entry): readonly [string, string] => [
      entry.package,
      entry.hash,
    ]),
  )
  if (HashMap.size(matrix) !== requested.length) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: `turbo scheduled ${task} more than once for one package`,
      }),
    )
  }
  if (document.packages.length === 0) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: 'turbo enumerated no workspace packages',
      }),
    )
  }
  if (HashMap.isEmpty(matrix)) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: `${document.packages.length} package(s) enumerated but no #${task} task parsed`,
      }),
    )
  }
  return Result.succeed({
    packages: document.packages,
    matrix,
    dirs: HashMap.fromIterable(
      requested.flatMap((entry) => {
        const directory = entry.directory
        if (directory === undefined) {
          return []
        }
        return [[entry.package, directory]]
      }),
    ),
    engineVersion: document.turboVersion ?? null,
  })
}
