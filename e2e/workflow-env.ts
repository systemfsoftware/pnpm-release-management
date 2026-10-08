import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const RELEASE_WORKFLOW = new URL('../.github/workflows/release.yml', import.meta.url)

const TOOL_COMMAND = /nix develop --command (\S+) (\S+)([^\n]*(?:\\\n[^\n]*)*)/g

export interface ToolStep {
  readonly job: string
  readonly step: string
  readonly app: string
  readonly subcommand: string
  readonly flags: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
}

interface WorkflowStep {
  readonly name?: string
  readonly id?: string
  readonly run?: string
  readonly env?: Record<string, string>
}

interface Workflow {
  readonly jobs: Record<string, { readonly steps?: ReadonlyArray<WorkflowStep> }>
}

const flagsOf = (args: string): ReadonlyArray<string> =>
  [...args.matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)].flatMap((match) => match[1] === undefined ? [] : [match[1]]).sort()

const sameFlags = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((flag, index) => flag === right[index])

export const releaseToolSteps = (): ReadonlyArray<ToolStep> => {
  const workflow = parse(readFileSync(RELEASE_WORKFLOW, 'utf8')) as Workflow
  return Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
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
}

export const workflowEnvOf = (
  steps: ReadonlyArray<ToolStep>,
  expressions: Readonly<Record<string, string>>,
  app: string,
  subcommand: string,
  args: string,
): Record<string, string> => {
  const candidates = steps.filter((step) => step.app === app && step.subcommand === subcommand)
  const flags = flagsOf(args)
  const exact = candidates.filter((step) => sameFlags(step.flags, flags))
  const chosen = exact.length > 0 ? exact : candidates
  const resolve = (value: string): string =>
    value.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => {
      const resolved = expressions[expression]
      if (resolved === undefined) {
        throw new Error(`release.yml uses \${{ ${expression} }}, which the e2e cannot resolve`)
      }
      return resolved
    })
  return Object.fromEntries(
    chosen.flatMap((step) => Object.entries(step.env).map(([name, value]) => [name, resolve(value)])),
  )
}
