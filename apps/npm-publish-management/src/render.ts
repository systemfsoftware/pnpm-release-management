import type { StatusReport, StatusRow } from '@systemfsoftware/npm-publish-engine'
import type { PackageName, RepoSlug, StatusClass, WorkspaceCommand } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import { slugText } from './workspace.js'

export const PUBLISH_NOTHING_OWED = 'every captured version is already on npm — nothing to publish'
export const TRUST_IDLE = 'every package is published and attested — nothing to do'
export const PREFLIGHT_OK = '\nPREFLIGHT OK: every publishable package exists on the registry.'
export const CHECK_OK = '\nOK: every package is published and carries provenance attestations.'

export const workspaceCommandText = (command: WorkspaceCommand): string =>
  `${command.program} ${command.args.join(' ')}`

type ReportedClass = Exclude<StatusClass, 'error'>

const STATUS_ORDER: ReadonlyArray<ReportedClass> = ['unpublished', 'no-oidc', 'stuck', 'ok']

const STATUS_HEADINGS: Readonly<Record<ReportedClass, string>> = {
  unpublished: '== UNPUBLISHED (404 on npm) ==',
  'no-oidc': '== PUBLISHED, NO OIDC ATTESTATION (latest has no provenance; trusted publisher likely unconfigured) ==',
  stuck: '== PUBLISHED + ATTESTED, BUT LOCAL AHEAD (stuck — versioned but not landed) ==',
  ok: '== PUBLISHED + ATTESTED, CURRENT ==',
}

const rowsIn = (rows: ReadonlyArray<StatusRow>, klass: StatusClass): ReadonlyArray<StatusRow> =>
  rows.filter((row) => row.class === klass)

const statusRowText = (row: StatusRow): string =>
  `  ${row.name.padEnd(55)} local ${row.local_version.padEnd(8)} npm ${
    row.npm_latest.padEnd(10)
  } provenance:${row.publishConfig_provenance}`

export const statusReportText = (report: StatusReport, registry: string, timestamp: string): string => {
  const sections = STATUS_ORDER.flatMap((klass) => [
    STATUS_HEADINGS[klass],
    ...rowsIn(report.rows, klass).map(statusRowText),
    '',
  ])
  const errorCount = rowsIn(report.rows, 'error').length
  const errorLine = Match.value(errorCount > 0).pipe(
    Match.when(true, (): ReadonlyArray<string> => [`  error:       ${errorCount}`]),
    Match.when(false, (): ReadonlyArray<string> => []),
    Match.exhaustive,
  )
  return [
    `npm publish status — ${timestamp} — registry: ${registry}`,
    `packages: ${report.rows.length}`,
    '',
    ...sections,
    '== summary ==',
    `  unpublished: ${rowsIn(report.rows, 'unpublished').length}`,
    `  no-oidc:     ${rowsIn(report.rows, 'no-oidc').length}`,
    `  stuck:       ${rowsIn(report.rows, 'stuck').length}`,
    `  ok:          ${rowsIn(report.rows, 'ok').length}`,
    ...errorLine,
  ].join('\n')
}

const listText = (lines: ReadonlyArray<string>): string =>
  Match.value(lines.length).pipe(
    Match.when(0, () => ''),
    Match.orElse(() => `${lines.join('\n')}\n`),
  )

export const filterFlagsText = (deferred: ReadonlyArray<PackageName>): string =>
  listText(deferred.map((name) => `--filter=${name}`))

export const deferredNamesText = (deferred: ReadonlyArray<PackageName>): string => listText([...deferred])

export const bootstrapInstructionsText = (deferred: ReadonlyArray<PackageName>, slug: RepoSlug): string =>
  deferred
    .map((name) =>
      [
        '',
        `  ${name}`,
        `    corepack pnpm --filter ${name} build`,
        `    corepack pnpm --filter ${name} publish --access public --no-git-checks`,
        `    npm trust github ${name} --repo ${slugText(slug)} --file release.yml --allow-publish --yes`,
      ].join('\n')
    )
    .join('\n')
