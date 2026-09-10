import { dirname } from '@std/path'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

export const IMAGE = 'pnpm-release-management-e2e:local'
export const APPS_DIR = '/prm/apps'
export const FIXTURE = '/srv/fixture'
export const ORIGIN = '/srv/origin.git'

export const GITHUB_API_URL = 'https://api.github.com'
export const GITHUB_TOKEN = 'test_token_admin'
export const GITHUB_REPOSITORY = 'admin/fixture'
export const REGISTRY = 'https://registry.npmjs.org'

export const REDIRECTED_HOSTS = [
  { host: 'api.github.com', ipAddress: '127.0.0.1' },
  { host: 'registry.npmjs.org', ipAddress: '127.0.0.1' },
]

const READY = 'curl -fsS https://api.github.com/meta > /dev/null && ' +
  'curl -fsS https://registry.npmjs.org/-/ping > /dev/null'

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
  write(path: string, content: string): Promise<void>
  read(path: string): Promise<string>
  github<T>(path: string): Promise<GitHubResponse<T>>
  snapshot(): Promise<Snapshot>
  archive(): Promise<string>
  keepAlive(): void
  stop(): Promise<void>
}

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

const DEFAULT_ENV: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  GITHUB_API_URL,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
}

const shellScript = (command: string, options: ExecOptions): string =>
  [
    ...Object.entries({ ...DEFAULT_ENV, ...options.env }).map(([name, value]) => `export ${name}=${quote(value)}`),
    options.cwd === undefined ? '' : `cd ${quote(options.cwd)}`,
    command,
  ]
    .filter((line) => line.length > 0)
    .join('\n')

interface ContainerExec {
  exitCode: number
  stdout: string
  stderr: string
}

export const makeWorld = (container: StartedTestContainer, listener: Listener): World => {
  const state = { phase: 'setup', kept: false }

  const run = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const started = performance.now()
    const result = await container.exec(['sh', '-lc', shellScript(command, options)])
    const exec = result as unknown as ContainerExec
    const record: CommandRecord = {
      phase: state.phase,
      command,
      cwd: options.cwd ?? '(default)',
      env: options.env ?? {},
      code: exec.exitCode,
      durationMs: Math.round(performance.now() - started),
      stdout: exec.stdout,
      stderr: exec.stderr,
    }
    listener.command(record)
    return { code: exec.exitCode, stdout: exec.stdout, stderr: exec.stderr }
  }

  const describe = (command: string, result: ExecResult): string =>
    `${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`

  const must = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const result = await run(command, options)
    if (result.code !== 0) throw new Error(describe(command, result))
    return result
  }

  const fails = async (command: string, options: ExecOptions = {}): Promise<ExecResult> => {
    const result = await run(command, options)
    if (result.code === 0) throw new Error(`expected a non-zero exit\n${describe(command, result)}`)
    return result
  }

  const writeFile = async (path: string, content: string): Promise<void> => {
    const marker = 'PRM_FIXTURE_EOF'
    if (content.includes(marker)) throw new Error(`${path} cannot contain the heredoc marker`)
    await must(
      `mkdir -p ${quote(dirname(path))} && cat > ${quote(path)} <<'${marker}'\n${content}\n${marker}`,
    )
  }

  const tool = (
    app: string,
    subcommand: string,
    args = '',
    options: ExecOptions = {},
  ): Promise<ExecResult> =>
    run(
      `${quote(`${APPS_DIR}/${app}/main.ts`)} ${subcommand}${args.length === 0 ? '' : ` ${args}`}`,
      {
        cwd: FIXTURE,
        ...options,
      },
    )

  const curlJson = async <T>(url: string, headers: readonly string[] = []): Promise<GitHubResponse<T>> => {
    const result = await must(
      `curl -sS -w '\\n%{http_code}' ${headers.map((header) => `-H ${quote(header)}`).join(' ')} ` +
        quote(url),
    )
    const lines = result.stdout.trimEnd().split('\n')
    const status = Number(lines.pop())
    const text = lines.join('\n')
    return { status, body: text.length === 0 ? null : JSON.parse(text) as T }
  }

  const github = <T>(path: string): Promise<GitHubResponse<T>> =>
    curlJson<T>(`${GITHUB_API_URL}${path}`, [
      `Authorization: Bearer ${GITHUB_TOKEN}`,
      'Accept: application/vnd.github+json',
    ])

  const tolerant = async (fetchBody: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await fetchBody()
    } catch (error) {
      return { unavailable: error instanceof Error ? error.message : String(error) }
    }
  }

  const snapshot = async (): Promise<Snapshot> => {
    const safely = async (command: string): Promise<string> => {
      try {
        return (await run(command, { cwd: FIXTURE })).stdout
      } catch (error) {
        return `unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    const versionsRaw = await safely(
      'for p in packages/*/package.json; do printf "%s " "$p"; grep -m1 \'"version"\' "$p"; done',
    )

    const registry: Record<string, unknown> = {}
    for (const name of ['@e2e/alpha', '@e2e/beta']) {
      registry[name] = await tolerant(async () =>
        (await curlJson<unknown>(`${REGISTRY}/${encodeURIComponent(name)}`)).body
      )
    }

    return {
      takenAt: new Date().toISOString(),
      git: await safely('git log --oneline -20 && echo --- && git tag --list'),
      status: await safely('git status --porcelain'),
      versions: Object.fromEntries(
        versionsRaw.split('\n').filter((line) => line.includes('"version"')).map((line) => [
          line.split(' ')[0],
          line.match(/"version": "([^"]+)"/)?.[1] ?? '?',
        ]),
      ),
      changesets: await safely('ls -la .changeset .changeset/changelogs'),
      files: await safely('find . -path ./node_modules -prune -o -type f -print | sort'),
      releases: await tolerant(async () => (await github<unknown>('/repos/admin/fixture/releases?per_page=100')).body),
      pulls: await tolerant(async () =>
        (await github<unknown>('/repos/admin/fixture/pulls?state=all&per_page=100')).body
      ),
      registry,
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
