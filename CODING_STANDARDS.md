# Coding standards

Defect classes this repository has shipped and fixed, which no check here catches: oxlint's strict preset, `tsc`, the
vitest suites and the container e2e do not flag them. Each names where it came from. A class that a check comes to
cover leaves this file.

## Decide from the state you write

A step that writes shared state (a branch, a pull request, a tag, a release) decides from that state as it is when it
writes, never from the commit that started the run. A queued run's event commit can be older than the branch.
Source: `docs/solutions/workflow-issues/release-run-reopened-a-release-pr-from-its-own-older-commit.md`.

## Every outcome is reachable

A command that reconciles state (open, update, close) runs on every path where any of its outcomes can apply, not
only where there is work to add. Closing a stale release PR was reachable only from a run that had found intents.
Source: the same record.

## Match an identity exactly

A lookup selects by the whole identifier: the release branch's own pull request, a package in the owner's scope, a
trust entry whose repository and workflow file both match. A prefix, a loose filter or the first hit is a defect.
Sources: #49 (`pr` found another branch's pull request), #114 and #116 (npm trust).

## A failure names its command

A failed git or pnpm call reports the command, its exit status and its stderr, so the annotation alone says what to
reproduce. Sources: #38, #39, #43.

## A write step survives a re-run

Tag, push and release steps can run again after a partial failure and finish the job, because the phase comes from
repository state. Source: #46 (re-running `tag` after a partial push).

## Filter a tool's output before decoding it

Narrow a tool's recursive output to the set the decoder's type describes before decoding it. `pnpm ls -r` lists the
workspace root among the members. Source: `docs/solutions/runtime-errors/pnpm-root-importer-row-fails-member-enumeration.md`.

## Judge a written file with the consumer's formatter

A file the tools write into a consumer (a changelog, release notes) is checked by running the consumer's formatter
on it, not by comparing against a copied string. Sources:
`docs/solutions/logic-errors/member-changelog-space-join-fuses-intent-blocks.md`,
`docs/solutions/logic-errors/copied-expected-string-certified-unformatted-release-notes.md`.

## Pass every parameter a library entry point takes

When adapting a library function, read every parameter it takes. An `undefined` state argument turns a feature off
without an error. Source: `docs/solutions/logic-errors/release-plan-ignored-changesets-pre-mode.md` (#109).

## Release git writes run clear of consumer hooks

The release commit and its pushes carry the hooks override, because a consumer's hooks run inside them. Source:
`docs/solutions/runtime-errors/consumer-dev-shell-hooks-ran-inside-the-release-commit.md` (#74).
