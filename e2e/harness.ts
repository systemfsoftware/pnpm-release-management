import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { releaseWorkflow, resolveExpressions, runStepsOf, toolStepsOf, workflowEnvOf } from './workflow-env.js'

export const IMAGE = 'pnpm-release-management-e2e:local'
export const BINS_DIR = '/opt/prm'
export const FIXTURE = '/srv/fixture'
export const ORIGIN = '/srv/origin.git'

export const GITHUB_API_URL = 'https://api.github.com'
export const GITHUB_TOKEN = 'test_token_admin'
export const GITHUB_REPOSITORY = 'admin/fixture'
export const REGISTRY = 'https://registry.npmjs.org'
export const REGISTRY_LOG = '/tmp/verdaccio/verdaccio.log'
export const REGISTRY_STORAGE = '/tmp/verdaccio/storage'
export const CI_WORKFLOW = 'ci.yml'
export const GH_DISPATCHES = '/tmp/gh-dispatches.log'
export const WORKSPACE_TARBALLS = '/tmp/workspace-tarballs'
const ARTIFACTS_DIR = '.release'
const WORKFLOW_REPOSITORY = 'systemfsoftware/pnpm-release-management'
const WORKFLOW_SHA = 'feedfacefeedfacefeedfacefeedfacefeedface'
const CALLER_LOCK_REV = '0449f15b2db9602a1dfe58bee2598adca2a726ed'

const RUNNER_BIN = '/opt/runner-bin'
const STEP_DIR = '/tmp/steps'
const WORKFLOW_RELEASE_TOOLS = '/tmp/workflow-release-tools'
const CALLER_DEVSHELL_BIN = '/tmp/caller-devshell/bin'
const RELEASE_APPS = ['changeset-management', 'version-management', 'github-release-management'] as const

const GH_STUB = `#!/bin/sh
if [ -z "$GH_TOKEN" ]; then
  echo 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.' >&2
  exit 4
fi
if [ "$1 $2" = "workflow run" ]; then
  printf '%s\\n' "$*" >> ${GH_DISPATCHES}
  exit 0
fi
echo "gh stub: only 'gh workflow run' is modelled, got: gh $*" >&2
exit 2
`

const NIX_STUB = `#!/bin/sh
case "$1" in
  develop)
    if [ "$2" != --command ]; then
      echo "nix stub: only 'nix develop --command' is modelled, got: nix $*" >&2
      exit 2
    fi
    shift 2
    PATH="${CALLER_DEVSHELL_BIN}:$PATH" exec "$@"
    ;;
  build)
    shift
    if [ $# -ne 3 ] || [ "$1" != --no-link ] || [ "$2" != --print-out-paths ]; then
      echo "nix stub: only 'nix build --no-link --print-out-paths <ref>' is modelled, got: nix build $*" >&2
      exit 2
    fi
    case "$3" in
      "github:${WORKFLOW_REPOSITORY}/${WORKFLOW_SHA}#release-tools") echo ${WORKFLOW_RELEASE_TOOLS} ;;
      .#workspace-tarballs) echo ${WORKSPACE_TARBALLS} ;;
      *)
        echo "nix stub: no flake output for $3" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;
esac
echo "nix stub: only develop and build are modelled, got: nix $*" >&2
exit 2
`

const callerLockTool = (app: string): string =>
  `#!/bin/sh
echo "${app} at ${CALLER_LOCK_REV}, the revision the caller's flake.lock pins, ran instead of the workflow's: $*" >&2
exit 1
`

export const REDIRECTED_HOSTS = [
  { host: 'api.github.com', ipAddress: '127.0.0.1' },
  { host: 'registry.npmjs.org', ipAddress: '127.0.0.1' },
]

const READY = 'curl -fsS https://api.github.com/meta > /dev/null && ' +
  'curl -fsS https://registry.npmjs.org/-/ping > /dev/null'

const GITHUB_HEADERS: ReadonlyArray<string> = [
  `Authorization: Bearer ${GITHUB_TOKEN}`,
  'Accept: application/vnd.github+json',
]

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface GitHubResponse<T> {
  status: number
  body: T | null
}

export interface CommandRecord {
  phase: string
  command: string
  cwd: string
  env: Record<string, string>
  code: number
  durationMs: number
  stdout: string
  stderr: string
}

export interface StepResult extends ExecResult {
  readonly step: string
  readonly outputs: Readonly<Record<string, string>>
}

export interface Listener {
  command(record: CommandRecord): void
}

export interface Snapshot {
  takenAt: string
  git: string
  status: string
  versions: Record<string, string>
  changesets: string
  files: string
  releases: unknown
  pulls: unknown
  registry: Record<string, unknown>
}

export interface World {
  readonly containerId: string
  currentPhase: string
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  must(command: string, options?: ExecOptions): Promise<ExecResult>
  fails(command: string, options?: ExecOptions): Promise<ExecResult>
  tool(app: string, subcommand: string, args?: string, options?: ExecOptions): Promise<ExecResult>
  job(name: string): Promise<ReadonlyArray<StepResult>>
  write(path: string, content: string): Promise<void>
  read(path: string): Promise<string>
  github<T>(path: string, decode: (input: unknown) => T): Promise<GitHubResponse<T>>
  snapshot(): Promise<Snapshot>
  archive(): Promise<string>
  keepAlive(): void
  stop(): Promise<void>
}

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

export const parseJson = (text: string): unknown => {
  const parsed: unknown = JSON.parse(text)
  return parsed
}

const RUNNER_ENV: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  GITHUB_API_URL,
  GITHUB_REPOSITORY,
}

const WORKFLOW_EXPRESSIONS: Readonly<Record<string, string>> = {
  'github.token': GITHUB_TOKEN,
  'inputs.ci-workflow': CI_WORKFLOW,
  'inputs.artifacts-dir': ARTIFACTS_DIR,
  'job.workflow_repository': WORKFLOW_REPOSITORY,
  'job.workflow_sha': WORKFLOW_SHA,
}

const RELEASE_WORKFLOW = await releaseWorkflow()
const RELEASE_TOOL_STEPS = toolStepsOf(RELEASE_WORKFLOW)

const outputsOf = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split('\n').flatMap((line) => {
      const at = line.indexOf('=')
      if (at <= 0) return []
      return [[line.slice(0, at), line.slice(at + 1)]]
    }),
  )

const shellScript = (command: string, options: ExecOptions): string => {
  const lines = Object.entries({ ...RUNNER_ENV, ...options.env }).map(([name, value]) =>
    `export ${name}=${quote(value)}`
  )
  if (options.cwd !== undefined) lines.push(`cd ${quote(options.cwd)}`)
  lines.push(command)
  return lines.join('\n')
}

const installScript = (path: string, content: string): string =>
  `cat > ${path} <<'STUB_EOF'\n${content}STUB_EOF\nchmod 0755 ${path}`

const RUNNER_SETUP = [
  `mkdir -p ${RUNNER_BIN} ${STEP_DIR} ${CALLER_DEVSHELL_BIN} ${WORKFLOW_RELEASE_TOOLS} && touch ${GH_DISPATCHES}`,
  `ln -sfn ${BINS_DIR} ${WORKFLOW_RELEASE_TOOLS}/bin`,
  installScript(`${RUNNER_BIN}/gh`, GH_STUB),
  installScript(`${RUNNER_BIN}/nix`, NIX_STUB),
  ...RELEASE_APPS.map((app) => installScript(`${CALLER_DEVSHELL_BIN}/${app}`, callerLockTool(app))),
].join('\n')

export const makeWorld = (container: StartedTestContainer, listener: Listener): World => {
  const state = { phase: 'setup', kept: false }

  const run = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const started = performance.now()
    const result = await container.exec(['sh', '-lc', shellScript(command, options)])
    const record: CommandRecord = {
      phase: state.phase,
      command,
      cwd: options.cwd ?? '(default)',
      env: options.env ?? {},
      code: result.exitCode,
      durationMs: Math.round(performance.now() - started),
      stdout: result.stdout,
      stderr: result.stderr,
    }
    listener.command(record)
    return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }

  const must = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const result = await run(command, options)
    if (result.code !== 0) throw new Error(`${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`)
    return result
  }

  const fails = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const result = await run(command, options)
    if (result.code === 0) {
      throw new Error(`expected a non-zero exit\n${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`)
    }
    return result
  }

  const writeFile = async (path: string, content: string): Promise<void> => {
    const marker = 'PRM_FIXTURE_EOF'
    if (content.includes(marker)) throw new Error(`${path} cannot contain the heredoc marker`)
    await must(
      `mkdir -p "$(dirname ${quote(path)})" && cat > ${quote(path)} <<'${marker}'\n${content}\n${marker}`,
    )
  }

  const tool = (
    app: string,
    subcommand: string,
    args = '',
    options: ExecOptions = {},
  ): Promise<ExecResult> => {
    const parts = [`${quote(`${BINS_DIR}/${app}`)} ${subcommand}`]
    if (args.length > 0) parts.push(args)
    return run(parts.join(' '), {
      cwd: FIXTURE,
      ...options,
      env: { ...workflowEnvOf(RELEASE_TOOL_STEPS, WORKFLOW_EXPRESSIONS, app, subcommand, args), ...options.env },
    })
  }

  const job = async (name: string): Promise<ReadonlyArray<StepResult>> => {
    await must(RUNNER_SETUP)
    const githubEnv = `${STEP_DIR}/${name}.env`
    await must(`: > ${quote(githubEnv)}`)
    let jobEnv: Record<string, string> = {}
    const outputs: Record<string, Record<string, string>> = {}
    const lookup = (expression: string): string | undefined => {
      const step = expression.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)$/)
      if (step?.[1] !== undefined && step[2] !== undefined) return outputs[step[1]]?.[step[2]] ?? ''
      return WORKFLOW_EXPRESSIONS[expression]
    }
    const results: Array<StepResult> = []
    for (const [index, step] of runStepsOf(RELEASE_WORKFLOW, name).entries()) {
      const script = `${STEP_DIR}/${name}-${index}.sh`
      const output = `${STEP_DIR}/${name}-${index}.output`
      await writeFile(script, resolveExpressions(step.run, lookup))
      await must(`: > ${quote(output)}`)
      const env = Object.fromEntries(
        Object.entries(step.env).map(([variable, value]) => [variable, resolveExpressions(value, lookup)]),
      )
      const result = await run(
        `PATH=${RUNNER_BIN}:$PATH bash --noprofile --norc -eo pipefail ${quote(script)}`,
        { cwd: FIXTURE, env: { ...jobEnv, ...env, GITHUB_OUTPUT: output, GITHUB_ENV: githubEnv } },
      )
      const stepOutputs = outputsOf((await must(`cat ${quote(output)}`)).stdout)
      results.push({ step: step.label, outputs: stepOutputs, ...result })
      if (result.code !== 0) return results
      if (step.id !== undefined) outputs[step.id] = stepOutputs
      jobEnv = outputsOf((await must(`cat ${quote(githubEnv)}`)).stdout)
    }
    return results
  }

  const curlJson = async (
    url: string,
    headers: ReadonlyArray<string> = [],
  ): Promise<{ status: number; body: unknown }> => {
    const result = await must(
      `curl -sS -w '\\n%{http_code}' ${headers.map((header) => `-H ${quote(header)}`).join(' ')} ` +
        quote(url),
    )
    const lines = result.stdout.trimEnd().split('\n')
    const statusText = lines.pop()
    if (statusText === undefined) throw new Error(`no status line in response from ${url}`)
    const status = Number(statusText)
    const text = lines.join('\n')
    if (text.length === 0) return { status, body: null }
    return { status, body: parseJson(text) }
  }

  const github = async <A>(path: string, decode: (input: unknown) => A): Promise<GitHubResponse<A>> => {
    const response = await curlJson(`${GITHUB_API_URL}${path}`, GITHUB_HEADERS)
    if (response.body === null) return { status: response.status, body: null }
    return { status: response.status, body: decode(response.body) }
  }

  const snapshot = async (): Promise<Snapshot> => {
    const safely = async (command: string): Promise<string> => {
      try {
        return (await run(command, { cwd: FIXTURE })).stdout
      } catch (error) {
        if (error instanceof Error) return `unavailable: ${error.message}`
        return 'unavailable: unknown error'
      }
    }

    const versionsRaw = await safely(
      'for p in packages/*/package.json; do printf "%s " "$p"; grep -m1 \'"version"\' "$p"; done',
    )

    const registry: Record<string, unknown> = {}
    for (const name of ['@e2e/alpha', '@e2e/beta']) {
      registry[name] = await tolerant(async () => (await curlJson(`${REGISTRY}/${encodeURIComponent(name)}`)).body)
    }

    const versions: Record<string, string> = {}
    for (const line of versionsRaw.split('\n')) {
      if (!line.includes('"version"')) continue
      const file = line.split(' ')[0]
      if (file === undefined || file.length === 0) continue
      versions[file] = line.match(/"version": "([^"]+)"/)?.[1] ?? '?'
    }

    return {
      takenAt: new Date().toISOString(),
      git: await safely('git log --oneline -20 && echo --- && git tag --list'),
      status: await safely('git status --porcelain'),
      versions,
      changesets: await safely('ls -la .changeset .changeset/changelogs'),
      files: await safely('find . -path ./node_modules -prune -o -type f -print | sort'),
      releases: await tolerant(async () =>
        (await curlJson(`${GITHUB_API_URL}/repos/admin/fixture/releases?per_page=100`, GITHUB_HEADERS)).body
      ),
      pulls: await tolerant(async () =>
        (await curlJson(`${GITHUB_API_URL}/repos/admin/fixture/pulls?state=all&per_page=100`, GITHUB_HEADERS)).body
      ),
      registry,
    }
  }

  const tolerant = async (fetchBody: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await fetchBody()
    } catch (error) {
      if (error instanceof Error) return { unavailable: error.message }
      return { unavailable: 'unknown error' }
    }
  }

  const archive = async (): Promise<string> => {
    const result = await must(
      'tar --exclude=node_modules --exclude=.git/objects -C /srv -czf - fixture | base64 -w0',
    )
    return result.stdout.trim()
  }

  return {
    containerId: container.getId(),
    get currentPhase(): string {
      return state.phase
    },
    set currentPhase(value: string) {
      state.phase = value
    },
    exec: run,
    must,
    fails,
    tool,
    job,
    write: writeFile,
    read: async (path: string): Promise<string> => (await must(`cat ${quote(path)}`)).stdout,
    github,
    snapshot,
    archive,
    keepAlive: (): void => {
      state.kept = true
    },
    stop: async (): Promise<void> => {
      if (state.kept) return
      await container.stop()
    },
  }
}

export const startWorld = async (repoRoot: string, listener: Listener): Promise<World> => {
  await GenericContainer.fromDockerfile(repoRoot, 'e2e/Dockerfile').build(IMAGE, {
    deleteOnExit: false,
  })

  const container = await new GenericContainer(IMAGE)
    .withBindMounts([{ source: repoRoot, target: '/prm', mode: 'ro' }])
    .withExtraHosts([...REDIRECTED_HOSTS])
    .withWorkingDir('/srv')
    .withStartupTimeout(180_000)
    .withWaitStrategy(Wait.forSuccessfulCommand(READY))
    .start()

  return makeWorld(container, listener)
}
