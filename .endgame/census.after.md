# endgame census — /home/ryan/Documents/projects/systemfsoftware/pnpm-release-management

Telltale only. Classify each hit (SF1). Pick one slice (SF3).
Witness files (tests/fixtures) observed, not slice targets: 21

## intercept candidates

- `apps/changeset-management/oxlint.config.ts`
- `apps/changeset-management/src/Invocation.schema.ts`
- `apps/changeset-management/src/main.ts`
- `apps/changeset-management/tsdown.config.ts`
- `apps/git-hooks/oxlint.config.ts`
- `apps/git-hooks/src/Invocation.schema.ts`
- `apps/git-hooks/src/main.ts`
- `apps/git-hooks/tsdown.config.ts`
- `apps/github-release-management/oxlint.config.ts`
- `apps/github-release-management/src/Lines.schema.ts`
- `apps/github-release-management/src/Lines.ts`
- `apps/github-release-management/src/Refusal.schema.ts`
- `apps/github-release-management/src/Refusal.ts`
- `apps/github-release-management/src/Render.ts`
- `apps/github-release-management/src/Workspace.ts`
- `apps/github-release-management/src/main.ts`
- `apps/github-release-management/tsdown.config.ts`
- `apps/npm-publish-management/oxlint.config.ts`
- `apps/npm-publish-management/src/boundary.schema.ts`
- `apps/npm-publish-management/src/main.ts`
- `apps/npm-publish-management/tsdown.config.ts`
- `apps/version-management/oxlint.config.ts`
- `apps/version-management/src/directive.schema.ts`
- `apps/version-management/src/main.ts`
- `apps/version-management/src/refusal.schema.ts`
- `apps/version-management/src/render.ts`
- `apps/version-management/src/request.ts`
- `apps/version-management/tsdown.config.ts`
- `packages/changeset-engine/src/index.ts`
- `packages/cli-adapter/src/index.ts`
- `packages/git-adapter/src/index.ts`
- `packages/git-hooks-engine/src/index.ts`
- `packages/github-adapter/src/index.ts`
- `packages/github-release-engine/src/index.ts`
- `packages/npm-publish-engine/src/index.ts`
- `packages/process-adapter/src/index.ts`
- `packages/registry-adapter/src/index.ts`
- `packages/release-language/src/index.ts`
- `packages/version-engine/src/index.ts`
- `packages/workspace-adapter/src/index.ts`

## domain-named folders (SF10 — do not fix by renaming)

- (none)

## hits

| path                                                                    | line | telltale      | track | shape    | snippet                                                                                                            |
| ----------------------------------------------------------------------- | ---- | ------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/changeset-management/src/main.ts`                                 | 121  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/changeset-management/src/main.ts`                                 | 142  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/changeset-management/src/main.ts`                                 | 184  | cell-run      | E     | railway  | `Cell.run(Cell.provide(newIntentCell, storesOf(context)), {`                                                       |
| `apps/changeset-management/src/main.ts`                                 | 207  | cell-run      | E     | railway  | `Cell.run(Cell.provide(gateChangesCell, storesOf(context)), {`                                                     |
| `apps/git-hooks/src/main.ts`                                            | 187  | cell-run      | E     | railway  | `Effect.flatMap((scripts) => Cell.run(stagedChecksCell, { scripts })),`                                            |
| `apps/git-hooks/src/main.ts`                                            | 217  | cell-run      | E     | railway  | `Effect.flatMap((request) => Cell.run(commitMessageCell, request)),`                                               |
| `apps/github-release-management/src/Lines.ts`                           | 19   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/main.ts`                            | 57   | two-run-gen   | E     | railway  | `> = Effect.gen(function*() {`                                                                                     |
| `apps/github-release-management/src/main.ts`                            | 118  | cell-run      | E     | railway  | `Cell.run(`                                                                                                        |
| `apps/github-release-management/src/main.ts`                            | 131  | two-run-gen   | E     | railway  | `const land: Effect.Effect<void, PullRequestRefusal, GitPort> = Effect.gen(function*() {`                          |
| `apps/github-release-management/src/main.ts`                            | 152  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/main.ts`                            | 161  | cell-run      | E     | railway  | `const report = yield* Cell.run(Cell.provide(planCell, MainLive), request)`                                        |
| `apps/github-release-management/src/main.ts`                            | 178  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/main.ts`                            | 193  | cell-run      | E     | railway  | `const decision = yield* Cell.run(Cell.provide(tagCell, MainLive), request)`                                       |
| `apps/github-release-management/src/main.ts`                            | 207  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/main.ts`                            | 218  | cell-run      | E     | railway  | `const decision = yield* Cell.run(Cell.provide(githubReleaseCell, MainLive), request)`                             |
| `apps/github-release-management/src/main.ts`                            | 233  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/main.ts`                            | 260  | cell-run      | E     | railway  | `const decision = yield* Cell.run(Cell.provide(pullRequestCell, MainLive), request)`                               |
| `apps/github-release-management/src/Workspace.ts`                       | 29   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/github-release-management/src/Workspace.ts`                       | 48   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 70   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 117  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 383  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 389  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 460  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 477  | cell-run      | E     | railway  | `const decision = yield* Cell.run(Cell.provide(publishPackagesCell, live), request)`                               |
| `apps/npm-publish-management/src/main.ts`                               | 505  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `apps/npm-publish-management/src/main.ts`                               | 515  | cell-run      | E     | railway  | `const report = yield* Cell.run(`                                                                                  |
| `apps/npm-publish-management/src/main.ts`                               | 526  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 530  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 538  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 555  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 557  | new-class     | C     | sandwich | `yield* reporter.emit(statusReportText(report, registryValue, new Date(now).toISOString()))`                       |
| `apps/npm-publish-management/src/main.ts`                               | 585  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/npm-publish-management/src/main.ts`                               | 604  | cell-run      | E     | railway  | `const decision = yield* Cell.run(`                                                                                |
| `apps/version-management/src/main.ts`                                   | 53   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/version-management/src/main.ts`                                   | 91   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/version-management/src/main.ts`                                   | 96   | cell-run      | E     | railway  | `return yield* Cell.run(Cell.provide(bumpCell, storesLive(root, config.changesetDir)), request)`                   |
| `apps/version-management/src/main.ts`                                   | 104  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/version-management/src/main.ts`                                   | 115  | cell-run      | E     | railway  | `const outcome = yield* Cell.run(`                                                                                 |
| `apps/version-management/src/main.ts`                                   | 128  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `apps/version-management/src/main.ts`                                   | 150  | cell-run      | E     | railway  | `const outcome = yield* Cell.run(`                                                                                 |
| `e2e/harness.ts`                                                        | 130  | new-class     | C     | sandwich | `if (result.code !== 0) throw new Error(`${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`)`      |
| `e2e/harness.ts`                                                        | 137  | new-class     | C     | sandwich | `throw new Error(`expected a non-zero exit\n${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`)`   |
| `e2e/harness.ts`                                                        | 144  | new-class     | C     | sandwich | `if (content.includes(marker)) throw new Error(`${path} cannot contain the heredoc marker`)`                       |
| `e2e/harness.ts`                                                        | 174  | new-class     | C     | sandwich | `if (statusText === undefined) throw new Error(`no status line in response from ${url}`)`                          |
| `e2e/harness.ts`                                                        | 215  | new-class     | C     | sandwich | `takenAt: new Date().toISOString(),`                                                                               |
| `e2e/harness.ts`                                                        | 279  | new-class     | C     | sandwich | `const container = await new GenericContainer(IMAGE)`                                                              |
| `e2e/session.ts`                                                        | 69   | two-run-gen   | E     | railway  | `const program = Effect.gen(function*() {`                                                                         |
| `e2e/session.ts`                                                        | 90   | new-class     | C     | sandwich | `const writer = new Writer()`                                                                                      |
| `e2e/session.ts`                                                        | 92   | new-class     | C     | sandwich | `const session = new Session(options, world, writer)`                                                              |
| `packages/changeset-engine/src/gate-changes.ts`                         | 67   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/changeset-engine/src/gate-changes.ts`                         | 140  | cell-layer    | C     | sandwich | `export const gateChangesCell = Cell.layer({`                                                                      |
| `packages/changeset-engine/src/gate-changes.workflow.ts`                | 120  | workflow-make | B     | decide   | `export const gateChanges = Workflow.make(`                                                                        |
| `packages/changeset-engine/src/new-intent.ts`                           | 52   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/changeset-engine/src/new-intent.ts`                           | 154  | cell-layer    | C     | sandwich | `export const newIntentCell = Cell.layer({`                                                                        |
| `packages/changeset-engine/src/new-intent.workflow.ts`                  | 79   | workflow-make | B     | decide   | `export const newIntent = Workflow.make(`                                                                          |
| `packages/changeset-engine/src/testing/FakeChangesetStore.ts`           | 37   | new-class     | C     | sandwich | `readReadme: () => Effect.die(new Error('FakeChangesetStore.readReadme is not used by these cells')),`             |
| `packages/changeset-engine/src/testing/FakeChangesetStore.ts`           | 38   | new-class     | C     | sandwich | `deleteIntents: () => Effect.die(new Error('FakeChangesetStore.deleteIntents is not used by these cells')),`       |
| `packages/changeset-engine/src/testing/FakeWorkspaceStore.ts`           | 9    | new-class     | C     | sandwich | `readManifest: () => Effect.die(new Error('FakeWorkspaceStore.readManifest is not used by these cells')),`         |
| `packages/changeset-engine/src/testing/FakeWorkspaceStore.ts`           | 10   | new-class     | C     | sandwich | `readFileFromRoot: () => Effect.die(new Error('FakeWorkspaceStore.readFileFromRoot is not used by these cells')),` |
| `packages/changeset-engine/vitest.config.ts`                            | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/cli-adapter/vitest.config.ts`                                 | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/git-adapter/src/GitLive.ts`                                   | 128  | two-run-gen   | E     | railway  | `Effect.scoped(Effect.gen(function*() {`                                                                           |
| `packages/git-adapter/vitest.config.ts`                                 | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/git-hooks-engine/src/commit-message.ts`                       | 139  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/git-hooks-engine/src/commit-message.workflow.ts`              | 456  | workflow-make | B     | decide   | `export const commitMessage = Workflow.make(`                                                                      |
| `packages/git-hooks-engine/src/staged-checks.ts`                        | 81   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/git-hooks-engine/src/staged-checks.ts`                        | 126  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/git-hooks-engine/src/staged-checks.ts`                        | 144  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/git-hooks-engine/src/staged-checks.ts`                        | 168  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/git-hooks-engine/src/staged-checks.workflow.ts`               | 108  | workflow-make | B     | decide   | `export const stagedChecks = Workflow.make(`                                                                       |
| `packages/git-hooks-engine/src/testing/FakeGitPort.ts`                  | 12   | new-class     | C     | sandwich | `Effect.die(new Error(`FakeGitPort: ${method} is not implemented`))`                                               |
| `packages/git-hooks-engine/vitest.config.ts`                            | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/github-adapter/src/ForgeLive.ts`                              | 45   | new-class     | C     | sandwich | `new Error(`${asked} failed: the host threw a value that is not an error`),`                                       |
| `packages/github-adapter/src/ForgeLive.ts`                              | 52   | new-class     | C     | sandwich | `new Error(`${asked} failed: ${host.success.message ?? 'the host gave no detail'}`),`                              |
| `packages/github-adapter/src/ForgeLive.ts`                              | 80   | new-class     | C     | sandwich | `onNone: () => Effect.die(new Error(`${asked} failed: the host answered ${String(NOT_FOUND)}`)),`                  |
| `packages/github-adapter/src/ForgeLive.ts`                              | 96   | new-class     | C     | sandwich | `const client = new Octokit(options)`                                                                              |
| `packages/github-adapter/vitest.config.ts`                              | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/github-release-engine/src/github-release.ts`                  | 77   | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/github-release-engine/src/github-release.ts`                  | 91   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/github-release.ts`                  | 248  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/github-release-engine/src/github-release.ts`                  | 286  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/github-release-engine/src/github-release.workflow.ts`         | 189  | workflow-make | B     | decide   | `export const githubRelease = Workflow.make(`                                                                      |
| `packages/github-release-engine/src/plan-release.workflow.ts`           | 76   | workflow-make | B     | decide   | `export const planRelease = Workflow.make(`                                                                        |
| `packages/github-release-engine/src/plan.ts`                            | 59   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/plan.ts`                            | 154  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/github-release-engine/src/pull-request.ts`                    | 98   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/pull-request.ts`                    | 182  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/github-release-engine/src/pull-request.ts`                    | 208  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/pull-request.ts`                    | 216  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/pull-request.ts`                    | 235  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/github-release-engine/src/pull-request.workflow.ts`           | 115  | workflow-make | B     | decide   | `export const pullRequest = Workflow.make(`                                                                        |
| `packages/github-release-engine/src/tag-packages.workflow.ts`           | 102  | workflow-make | B     | decide   | `export const tagPackages = Workflow.make(`                                                                        |
| `packages/github-release-engine/src/tag.ts`                             | 106  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/tag.ts`                             | 138  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/tag.ts`                             | 213  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/github-release-engine/src/tag.ts`                             | 225  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/github-release-engine/src/tag.ts`                             | 245  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/github-release-engine/src/tag.ts`                             | 261  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/github-release-engine/vitest.config.ts`                       | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/npm-publish-engine/src/assess-launcher-readiness.workflow.ts` | 70   | workflow-make | B     | decide   | `export const assessLauncherReadiness = Workflow.make(`                                                            |
| `packages/npm-publish-engine/src/assess-staged-publish.workflow.ts`     | 91   | workflow-make | B     | decide   | `export const assessStagedPublish = Workflow.make(`                                                                |
| `packages/npm-publish-engine/src/evaluate-trust-state.workflow.ts`      | 83   | workflow-make | B     | decide   | `export const evaluateTrustState = Workflow.make(`                                                                 |
| `packages/npm-publish-engine/src/plan-staged-work.workflow.ts`          | 127  | workflow-make | B     | decide   | `export const planStagedWork = Workflow.make(`                                                                     |
| `packages/npm-publish-engine/src/publish-packages.ts`                   | 80   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/publish-packages.ts`                   | 103  | new-class     | C     | sandwich | `new PublishCommand({`                                                                                             |
| `packages/npm-publish-engine/src/publish-packages.ts`                   | 169  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/npm-publish-engine/src/publish-packages.workflow.ts`          | 104  | workflow-make | B     | decide   | `export const publishPackages = Workflow.make(`                                                                    |
| `packages/npm-publish-engine/src/publish-status.ts`                     | 40   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/publish-status.ts`                     | 45   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/publish-status.ts`                     | 55   | new-class     | C     | sandwich | `new StatusCommand({`                                                                                              |
| `packages/npm-publish-engine/src/publish-status.ts`                     | 162  | cell-layer    | C     | sandwich | `> = Cell.layer({`                                                                                                 |
| `packages/npm-publish-engine/src/publish-status.workflow.ts`            | 234  | workflow-make | B     | decide   | `export const publishStatus = Workflow.make(`                                                                      |
| `packages/npm-publish-engine/src/select-trust-candidates.workflow.ts`   | 122  | workflow-make | B     | decide   | `export const selectTrustCandidates = Workflow.make(`                                                              |
| `packages/npm-publish-engine/src/split-dry-run.workflow.ts`             | 118  | workflow-make | B     | decide   | `export const splitDryRun = Workflow.make(`                                                                        |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 83   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 88   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 117  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 175  | cell-layer    | C     | sandwich | `const selectionCell = Cell.layer({`                                                                               |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 179  | new-class     | C     | sandwich | `new SelectTrustCandidatesCommand({`                                                                               |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 194  | cell-layer    | C     | sandwich | `const trustStateCell = Cell.layer({`                                                                              |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 197  | new-class     | C     | sandwich | `Result.succeed(new EvaluateTrustStateCommand({ candidates: [...flow.selected] })),`                               |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 203  | cell-layer    | C     | sandwich | `const stagedWorkCell = Cell.layer({`                                                                              |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 206  | new-class     | C     | sandwich | `Result.succeed(new PlanStagedWorkCommand({ owed: [...flow.owed] })),`                                             |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 217  | cell-layer    | C     | sandwich | `const launcherCell = Cell.layer({`                                                                                |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 221  | new-class     | C     | sandwich | `new AssessLauncherReadinessCommand({`                                                                             |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 232  | cell-layer    | C     | sandwich | `const stagingCell = Cell.layer({`                                                                                 |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 236  | new-class     | C     | sandwich | `new SplitDryRunCommand({`                                                                                         |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 257  | cell-layer    | C     | sandwich | `const stagedPublishCell = Cell.layer({`                                                                           |
| `packages/npm-publish-engine/src/stage-npm-trust.ts`                    | 260  | new-class     | C     | sandwich | `command: new AssessStagedPublishCommand({ outcomes: [...staged.flow.outcomes] }),`                                |
| `packages/npm-publish-engine/src/testing/FakeRegistry.ts`               | 31   | new-class     | C     | sandwich | `const published = new Set(seed.published ?? [])`                                                                  |
| `packages/npm-publish-engine/vitest.config.ts`                          | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 88   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 92   | new-class     | C     | sandwich | `.pipe(Effect.mapError(() => new EvidenceFileUnreadable({ path })))`                                               |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 103  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 116  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 125  | new-class     | C     | sandwich | `new EvidenceCommandFailed({`                                                                                      |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 142  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 209  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 217  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 225  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 237  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 251  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 259  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 272  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 281  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 295  | new-class     | C     | sandwich | `new EvidenceCommandFailed({`                                                                                      |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 305  | new-class     | C     | sandwich | `new TurboPinUnusable({`                                                                                           |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 318  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 372  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 383  | new-class     | C     | sandwich | `new WorktreeUnavailable({`                                                                                        |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 418  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 421  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 437  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ChangeEvidenceLive.ts`                    | 447  | new-class     | C     | sandwich | `new EvidenceCommandFailed({`                                                                                      |
| `packages/process-adapter/src/ProcessLive.ts`                           | 18   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ProcessRun.ts`                            | 47   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/process-adapter/src/ProcessRun.ts`                            | 49   | new-class     | C     | sandwich | `new ProcessUnstartable({`                                                                                         |
| `packages/process-adapter/src/ProcessRun.ts`                            | 54   | new-class     | C     | sandwich | `new ProcessUnobservable({`                                                                                        |
| `packages/process-adapter/src/TurboDryRun.ts`                           | 13   | new-class     | C     | sandwich | `(error) => new TurboDryRunUnreadable({ context, reason: error.message }),`                                        |
| `packages/process-adapter/src/TurboDryRun.ts`                           | 30   | new-class     | C     | sandwich | `new TurboDryRunDrifted({`                                                                                         |
| `packages/process-adapter/src/TurboDryRun.ts`                           | 38   | new-class     | C     | sandwich | `new TurboDryRunDrifted({`                                                                                         |
| `packages/process-adapter/src/TurboDryRun.ts`                           | 46   | new-class     | C     | sandwich | `new TurboDryRunDrifted({`                                                                                         |
| `packages/process-adapter/vitest.config.ts`                             | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/registry-adapter/src/RegistryLive.ts`                         | 43   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/registry-adapter/src/RegistryLive.ts`                         | 150  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/registry-adapter/vitest.config.ts`                            | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/release-language/vitest.config.ts`                            | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/version-engine/src/bump-derive.ts`                            | 109  | new-class     | C     | sandwich | `const known = new Set(args.members.map((member) => member.name))`                                                 |
| `packages/version-engine/src/bump-versions.workflow.ts`                 | 122  | workflow-make | B     | decide   | `export const bumpVersions = Workflow.make(`                                                                       |
| `packages/version-engine/src/bump.ts`                                   | 58   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/bump.ts`                                   | 69   | new-class     | C     | sandwich | `return new RawBump(request, workspace.root, intents, members, manifestVersion)`                                   |
| `packages/version-engine/src/bump.ts`                                   | 137  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/bump.ts`                                   | 156  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/bump.ts`                                   | 192  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/bump.ts`                                   | 235  | two-run-gen   | E     | railway  | `return Effect.gen(function*() {`                                                                                  |
| `packages/version-engine/src/bump.ts`                                   | 248  | cell-layer    | C     | sandwich | `export const bumpCell = Cell.layer({`                                                                             |
| `packages/version-engine/src/pin-root-manifest.ts`                      | 44   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/pin-root-manifest.ts`                      | 47   | new-class     | C     | sandwich | `return new RawPin(request, file.text, workspace.root)`                                                            |
| `packages/version-engine/src/pin-root-manifest.ts`                      | 152  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/pin-root-manifest.ts`                      | 162  | cell-layer    | C     | sandwich | `export const pinRootManifestCell = Cell.layer({`                                                                  |
| `packages/version-engine/src/pin-root-manifest.workflow.ts`             | 117  | workflow-make | B     | decide   | `export const pinRootManifest = Workflow.make(`                                                                    |
| `packages/version-engine/src/sync-surfaces.workflow.ts`                 | 120  | workflow-make | B     | decide   | `export const syncSurfaces = Workflow.make(`                                                                       |
| `packages/version-engine/src/sync.ts`                                   | 41   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/sync.ts`                                   | 49   | new-class     | C     | sandwich | `return new RawSync(request, expected, entries)`                                                                   |
| `packages/version-engine/src/sync.ts`                                   | 95   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/version-engine/src/sync.ts`                                   | 113  | cell-layer    | C     | sandwich | `export const syncCell = Cell.layer({`                                                                             |
| `packages/version-engine/src/testing/FakeChangelogStore.ts`             | 21   | new-class     | C     | sandwich | `roots: ReadonlyMap<RelativePath, string> = new Map(),`                                                            |
| `packages/version-engine/src/testing/FakeChangelogStore.ts`             | 23   | new-class     | C     | sandwich | `const rootChangelogs = new Map(roots)`                                                                            |
| `packages/version-engine/src/testing/FakeChangesetStore.ts`             | 27   | new-class     | C     | sandwich | `initial: ReadonlyMap<RelativePath, Intent> = new Map(),`                                                          |
| `packages/version-engine/src/testing/FakeChangesetStore.ts`             | 30   | new-class     | C     | sandwich | `const intents = new Map(initial)`                                                                                 |
| `packages/version-engine/src/testing/FakeCycleStore.ts`                 | 21   | new-class     | C     | sandwich | `captured: ReadonlyMap<FsPath, ReadonlyArray<CycleEntry>> = new Map(),`                                            |
| `packages/version-engine/src/testing/FakeCycleStore.ts`                 | 24   | new-class     | C     | sandwich | `const liveCaptured = new Map(captured)`                                                                           |
| `packages/version-engine/src/testing/FakeSurfaceStore.ts`               | 16   | new-class     | C     | sandwich | `initial: ReadonlyMap<RelativePath, PackageVersion> = new Map(),`                                                  |
| `packages/version-engine/src/testing/FakeSurfaceStore.ts`               | 18   | new-class     | C     | sandwich | `const versions = new Map(initial)`                                                                                |
| `packages/version-engine/src/testing/FakeWorkspaceStore.ts`             | 25   | new-class     | C     | sandwich | `files: ReadonlyMap<RelativePath, string> = new Map(),`                                                            |
| `packages/version-engine/src/testing/FakeWorkspaceStore.ts`             | 28   | new-class     | C     | sandwich | `const liveFiles = new Map(files)`                                                                                 |
| `packages/version-engine/vitest.config.ts`                              | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |
| `packages/workspace-adapter/src/ChangelogStoreLive.ts`                  | 20   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangelogStoreLive.ts`                  | 25   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangelogStoreLive.ts`                  | 33   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangelogStoreLive.ts`                  | 50   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 102  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 110  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 134  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 146  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 155  | new-class     | C     | sandwich | `Match.orElse(() => Effect.die(new Error(`cannot stage intent ${file}: ${fault.reason}`))),`                       |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 168  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 173  | new-class     | C     | sandwich | `Effect.mapError((fault) => new Error(`cannot delete ${full}: ${fault.reason}`)),`                                 |
| `packages/workspace-adapter/src/ChangesetStoreLive.ts`                  | 182  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/CycleStoreLive.ts`                      | 24   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/CycleStoreLive.ts`                      | 29   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/CycleStoreLive.ts`                      | 41   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ReleaseConfigStoreLive.ts`              | 28   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/ReleaseConfigStoreLive.ts`              | 33   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 103  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 113  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 131  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 144  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 158  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 179  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 191  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 224  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/SurfaceStoreLive.ts`                    | 234  | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/WorkspaceStoreLive.ts`                  | 28   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/WorkspaceStoreLive.ts`                  | 35   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/WorkspaceStoreLive.ts`                  | 46   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/src/WorkspaceStoreLive.ts`                  | 86   | two-run-gen   | E     | railway  | `Effect.gen(function*() {`                                                                                         |
| `packages/workspace-adapter/vitest.config.ts`                           | 3    | new-class     | C     | sandwich | `const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname`                  |

## recommended first slice (fill by hand)

- outside interaction I → A:
- intercept file:
- forbidden shape to paste back:
- command expected to go red:
