import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

export const IMAGE = 'pnpm-release-management-e2e:local'
export const BINS_DIR = '/opt/prm'
export const FIXTURE = '/srv/fixture'
export const ORIGIN = '/srv/origin.git'

export const GITHUB_API_URL = 'https://api.github.com'
export const GITHUB_TOKEN = 'test_token_admin'
export const GITHUB_REPOSITORY = 'admin/fixture'

export const REDIRECTED_HOSTS = [
  { host: 'api.github.com', ipAddress: '127.0.0.1' },
]

const READY = 'curl -fsS https://api.github.com/meta > /dev/null'

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

const DEFAULT_ENV: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  GITHUB_API_URL,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
}

const shellScript = (command: string, options: ExecOptions): string => {
  const lines = Object.entries({ ...DEFAULT_ENV, ...options.env }).map(([name, value]) =>
    `export ${name}=${quote(value)}`
  )
  if (options.cwd !== undefined) lines.push(`cd ${quote(options.cwd)}`)
  lines.push(command)
  return lines.join('\n')
}

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
    })
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
