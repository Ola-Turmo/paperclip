# `@paperclipai/plugin-autoresearch-improver-example`

Autoresearch Improver is a first-party Paperclip example plugin that turns the Karpathy `autoresearch` and Darwin Derby pattern into a project-scoped optimizer for Paperclip workspaces.

It implements the core loop:

1. define the mutable surface
2. keep the evaluator fixed
3. run each candidate under a fixed budget
4. keep only strict improvements

This version goes further than the initial example. It adds repeated scoring, structured JSON metrics, diff artifacts, queueing, dry runs, and manual approval before workspace write-back.

## What the plugin adds

The plugin registers:

- a full plugin page
- a project detail tab
- a project sidebar link
- a dashboard widget
- an hourly sweep job
- agent tools for listing optimizers and creating issues from accepted runs

The worker stores optimizer definitions and run history as plugin-owned entities, so everything remains scoped to the relevant Paperclip project.

## Optimizer model

Each optimizer stores:

- `objective`
- `mutablePaths`
- `mutationCommand`
- `scoreCommand`
- optional `guardrailCommand`
- `scoreDirection`
- `scoreFormat`
- optional `scoreKey`
- optional `scorePattern`
- `guardrailFormat`
- optional `guardrailKey`
- `scoreRepeats`
- `scoreAggregator`
- `minimumImprovement`
- per-step budgets
- `applyMode`
- `requireHumanApproval`
- `hiddenScoring`
- `autoRun`
- `autoCreateIssueOnGuardrailFailure`
- `autoCreateIssueOnStagnation`
- `stagnationIssueThreshold`

The built-in UI also ships three templates:

- `Test Suite Ratchet`
- `Lighthouse Candidate`
- `Dry Run Prototype`

## Runtime behavior

For each run, the plugin:

1. resolves the project workspace
2. measures the incumbent score if no best score exists yet
3. copies the workspace into a sandbox
4. writes `paperclip-optimizer-brief.json` into that sandbox
5. runs the mutation command inside the sandbox
6. runs the scorer `scoreRepeats` times
7. aggregates the result with `median`, `mean`, `max`, or `min`
8. runs the optional guardrail command
9. computes a diff artifact and detects unauthorized file changes
10. compares candidate versus incumbent using `minimumImprovement`
11. either:
   - applies allowed paths immediately
   - records a pending approval candidate
   - records a dry-run candidate
   - rejects or invalidates the run
12. stores the run record, outputs, structured metrics, diff, and queue state

## Safety model

The plugin is designed around a constrained-mutation model:

- mutation happens in a copied sandbox
- only listed `mutablePaths` are eligible for copy-back
- changes outside the mutable surface are detected and recorded as unauthorized
- the real workspace is not modified for rejected or invalid runs
- manual approval and dry-run modes keep the candidate sandbox around for operator review

This is the Darwin Derby idea translated to Paperclip project workspaces.

## Score formats

The plugin supports two score formats.

### `number`

Use this when the command prints a plain numeric score, or when you want to scrape one with a regex.

Example:

```bash
pnpm test -- --runInBand && node -e "console.log('SCORE=0.91')"
```

Optional pattern:

```text
SCORE=([0-9.]+)
```

### `json`

Use this when the scorer can print a stable machine-readable object.

Recommended shape:

```json
{
  "primary": 0.91,
  "metrics": {
    "quality": 0.95,
    "latency": 123
  },
  "guardrails": {
    "safe": true,
    "testsPassing": true
  },
  "summary": "Improved quality without regressions"
}
```

The plugin reads:

- `primary` as the optimization target
- `metrics` as diagnostics
- `guardrails` as pass/fail signals when values are boolean
- `summary` as optional operator context

`scoreKey` and `guardrailKey` can point at nested fields when the payload is wrapped.

## Apply modes

### `automatic`

Strict improvements are copied back to the real workspace immediately.

### `manual_approval`

Strict improvements are stored as pending candidates. Operators can inspect the run and approve or reject it from the UI.

### `dry_run`

Strict improvements are recorded as candidates, but nothing is copied back automatically. This is useful for proposal generation and review-only workflows.

## Environment passed to the mutator

The mutation command runs in the sandbox with these environment variables:

- `PAPERCLIP_OPTIMIZER_ID`
- `PAPERCLIP_OPTIMIZER_NAME`
- `PAPERCLIP_OPTIMIZER_OBJECTIVE`
- `PAPERCLIP_OPTIMIZER_MUTABLE_PATHS`
- `PAPERCLIP_OPTIMIZER_BEST_SCORE`
- `PAPERCLIP_OPTIMIZER_SCORE_DIRECTION`
- `PAPERCLIP_OPTIMIZER_BRIEF`
- `PAPERCLIP_OPTIMIZER_APPLY_MODE`
- `PAPERCLIP_OPTIMIZER_SCORE_REPEATS`
- `PAPERCLIP_OPTIMIZER_SCORE_AGGREGATOR`
- `PAPERCLIP_OPTIMIZER_MINIMUM_IMPROVEMENT`

If `hiddenScoring` is disabled, the mutator also receives:

- `PAPERCLIP_OPTIMIZER_SCORE_COMMAND`

## Stored run artifacts

Each run stores:

- baseline score
- candidate score
- outcome
- approval status
- mutation command output
- scoring command output
- repeated scoring results
- aggregated structured metrics
- optional guardrail result
- mutable paths
- sandbox path when retained
- diff stats
- changed files
- unauthorized changed files
- patch preview

## Queueing and automation

The plugin supports two ways to execute optimizers:

- run immediately from the UI
- enqueue a run for the hourly sweep

The hourly sweep job:

- looks for `queueState=queued`
- also picks `autoRun` optimizers that are `idle`
- skips paused optimizers
- limits throughput with `sweepLimit`

## Issue generation

The plugin can create Paperclip issues from:

- any selected run in the UI
- the latest accepted run via the agent tool
- guardrail failures, if configured
- stagnation thresholds, if configured

Generated issues include the objective, score delta, command summaries, changed files, unauthorized files, and a diff preview.

## Example setup

Mutation command:

```bash
codex exec "Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only."
```

Structured score command:

```bash
node -e "console.log(JSON.stringify({ primary: 0.91, metrics: { tests: 1 }, guardrails: { safe: true } }))"
```

Guardrail command:

```bash
pnpm test -- --runInBand
```

## Install into Paperclip

From the Paperclip repo:

```bash
pnpm --filter @paperclipai/plugin-autoresearch-improver-example build
pnpm paperclipai plugin install ./packages/plugins/examples/plugin-autoresearch-improver
```

## Development

Inside this package:

```bash
pnpm build
pnpm test
```

Inside the Paperclip monorepo the package resolves `@paperclipai/plugin-sdk` through `workspace:*`.

## Verification status

This plugin has been verified against a live Paperclip `0.3.1` deployment with:

- plugin install from a local path
- plugin health returning ready/healthy
- UI contribution discovery returning the page, dashboard widget, project tab, and project sidebar item
- in-container Vitest pass

The strengthened runtime in this branch is designed to preserve that deployment path while adding:

- repeated scoring
- structured JSON scoring
- diff artifact capture
- unauthorized change detection
- queueing
- manual approval and dry runs
- auto-created issues on guardrail failure or stagnation

## Current constraints

- This is a trusted local-workspace plugin. It executes shell commands inside project workspaces.
- Blind scoring is partial, not absolute. The scorer can be hidden from the mutator, but mutation and scoring still run under the same worker runtime.
- Sandboxes are copied workspaces, not git worktrees.
- Diff capture uses `git diff --no-index` for patch previews and falls back gracefully when diff generation is incomplete.
- If `keepTmpDirs` is enabled, retained sandboxes will accumulate until manually cleaned.

## Instance config

The plugin instance config supports:

- `defaultMutationBudgetSeconds`
- `defaultScoreBudgetSeconds`
- `defaultGuardrailBudgetSeconds`
- `keepTmpDirs`
- `maxOutputChars`
- `sweepLimit`
- `scoreRepeats`
- `minimumImprovement`
- `stagnationIssueThreshold`
