import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as S from 'effect/Schema'
import { parse } from 'yaml'
import { Workflow } from './workflow.schema.js'

const RELEASE_WORKFLOW = new URL('../.github/workflows/release.yml', import.meta.url).pathname

const TOOL_COMMAND = /nix develop --command "?(?:\S*\/)?([\w-]+)"? (\S+)([^\n]*(?:\\\n[^\n]*)*)/g

export interface ToolStep {
  readonly job: string
  readonly step: string
  readonly app: string
  readonly subcommand: string
  readonly flags: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
}

export interface RunStep {
  readonly id: string | undefined
  readonly label: string
  readonly run: string
  readonly env: Readonly<Record<string, string>>
}

const flagsOf = (args: string): ReadonlyArray<string> =>
  [...args.matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)].flatMap((match) => match[1] ?? []).sort()

const sameFlags = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((flag, index) => flag === right[index])

export const releaseWorkflow = (): Promise<Workflow> =>
  Effect.runPromise(
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const text = yield* fs.readFileString(RELEASE_WORKFLOW)
      return yield* S.decodeUnknownEffect(Workflow)(parse(text))
    }).pipe(Effect.provide(NodeServices.layer)),
  )

export const toolStepsOf = (workflow: Workflow): ReadonlyArray<ToolStep> =>
  Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
    steps.flatMap((step) =>
      [...(step.run ?? '').matchAll(TOOL_COMMAND)].map((match) => ({
        job,
        step: step.name ?? step.id ?? '(unnamed)',
        app: match[1] ?? '',
        subcommand: match[2] ?? '',
        flags: flagsOf(match[3] ?? ''),
        env: step.env ?? {},
      }))
    )
  )

export const runStepsOf = (workflow: Workflow, job: string): ReadonlyArray<RunStep> => {
  const steps = workflow.jobs[job]?.steps
  if (steps === undefined) throw new Error(`release.yml has no job ${job}`)
  return steps.flatMap((step) => {
    if (step.run === undefined) return []
    return [{ id: step.id, label: step.id ?? step.name ?? step.run, run: step.run, env: step.env ?? {} }]
  })
}

export const resolveExpressions = (
  value: string,
  lookup: (expression: string) => string | undefined,
): string =>
  value.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => {
    const resolved = lookup(expression)
    if (resolved === undefined) {
      throw new Error(`release.yml uses \${{ ${expression} }}, which the e2e cannot resolve`)
    }
    return resolved
  })

const stepsRunning = (
  steps: ReadonlyArray<ToolStep>,
  app: string,
  subcommand: string,
  args: string,
): ReadonlyArray<ToolStep> => {
  const candidates = steps.filter((step) => step.app === app && step.subcommand === subcommand)
  const flags = flagsOf(args)
  const exact = candidates.filter((step) => sameFlags(step.flags, flags))
  if (exact.length > 0) return exact
  return candidates
}

export const workflowEnvOf = (
  steps: ReadonlyArray<ToolStep>,
  expressions: Readonly<Record<string, string>>,
  app: string,
  subcommand: string,
  args: string,
): Record<string, string> =>
  Object.fromEntries(
    stepsRunning(steps, app, subcommand, args).flatMap((step) =>
      Object.entries(step.env).map((
        [name, value],
      ) => [name, resolveExpressions(value, (expression) => expressions[expression])])
    ),
  )
