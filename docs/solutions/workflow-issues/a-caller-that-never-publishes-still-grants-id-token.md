---
title: Every release run failed at startup once the reusable workflow gained a publish job
date: 2026-11-15
category: workflow-issues
module: release-workflow
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "Every Release (dogfood) run since the npm publish job landed ended in startup_failure, with no job run"
  - "The run page read: The nested job 'publish' is requesting 'id-token: write', but is only allowed 'id-token: none'"
root_cause: config_error
resolution_type: workflow_fix
severity: high
tags: [release-workflow, permissions, id-token, reusable-workflow, dogfood]
---

# Every release run failed at startup once the reusable workflow gained a publish job

## Problem

`release.yml` gained a `publish` job that asks for `id-token: write`, for npm trusted publishing. The job's `if:` is
false unless the caller passes `npm-publish: true`. This repository's own caller, `release-dogfood.yml`, does not
publish, so it did not grant `id-token`. From that merge on, every dogfood run ended in `startup_failure`
without running a job. `gh run view` said only "This run likely failed because of a workflow file issue". The run's
page on github.com gave the cause: "The nested job 'publish' is requesting 'id-token: write', but is only allowed
'id-token: none'".

## Cause

GitHub checks the permissions every job of a called workflow asks for against the caller's grant when it validates
the workflow, before any `if:` is evaluated. A job that would be skipped still has to be allowed, so a permission
one job needs is a permission every caller grants. The README said only callers that publish need `id-token: write`.

## Fix

The dogfood caller grants `id-token: write`. The README's caller example grants it too, and the README says why.

## Prevention

- When a job of a reusable workflow asks for a new permission, every caller grants it before that job merges.
- `gh run view` hides why a run failed at startup. Read the run's page on github.com for the real error.
