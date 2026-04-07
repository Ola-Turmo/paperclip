# `@paperclipai/plugin-autoresearch-improver-example`

Autoresearch Improver is a first-party Paperclip example plugin that turns the Karpathy `autoresearch` and Darwin Derby pattern into a project-scoped optimizer for Paperclip workspaces.

It implements the core loop:

1. define the mutable surface
2. keep the evaluator fixed
3. run each candidate under a fixed budget
4. keep only strict improvements

This version goes further than the initial example. It adds repeated scoring, structured JSON metrics, git-worktree sandboxes, separated scorer execution, diff artifacts, queueing, dry runs, manual approval, and PR generation from accepted runs.

## What the plugin adds

The plugin registers:

- a full plugin page
- a project detail tab
- a project sidebar link
- a dashboard widget
- an hourly sweep job
- agent tools for listing optimizers, creating issues from accepted runs, and creating PRs from accepted runs

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
- `guardrailRepeats`
- `guardrailAggregator`
- `minimumImprovement`
- per-step budgets
- `sandboxStrategy`
- `scorerIsolationMode`
- `applyMode`
- `requireHumanApproval`
- `hiddenScoring`
- `autoRun`
- `autoCreateIssueOnGuardrailFailure`
- `autoCreateIssueOnStagnation`
- `stagnationIssueThreshold`
- `guardrailRepeats`: number of times the guardrail command is executed per run (default: 1)
- `guardrailAggregator`: pass criterion for repeated guardrails (`all` means all repeats must pass; `any` means at least one repeat can pass)

The built-in UI also ships three templates:

- `Test Suite Ratchet`
- `Lighthouse Candidate`
- `Dry Run Prototype`

## Runtime behavior

For each run, the plugin:

1. resolves the project workspace
2. measures the incumbent score if no best score exists yet
3. creates either a copied sandbox or a detached git worktree
4. writes the optimizer brief to a temp file outside the mutable surface
5. runs the mutation command inside the sandbox
6. runs the scorer in a separate execution workspace when configured
7. runs the scorer `scoreRepeats` times
8. aggregates the result with `median`, `mean`, `max`, or `min`
9. runs the optional guardrail command `guardrailRepeats` times
10. aggregates the guardrail result with `guardrailAggregator` (`all` or `any`)
11. computes a diff artifact and detects unauthorized file changes
12. captures workspace HEAD at run creation for stale-candidate detection
13. compares candidate versus incumbent using `minimumImprovement`
14. either:
   - applies allowed paths immediately
   - records a pending approval candidate
   - records a dry-run candidate
   - rejects or invalidates the run
13. stores the run record, outputs, structured metrics, diff, queue state, and optional PR metadata

## Safety model

The plugin is designed around a constrained-mutation model:

- mutation happens in an isolated copy or git worktree
- scoring can run in a separate workspace from mutation
- only listed `mutablePaths` are eligible for apply-back
- changes outside the mutable surface are detected and recorded as unauthorized
- the real workspace is not modified for rejected or invalid runs
- manual approval and dry-run modes keep the candidate sandbox around for operator review
- patch-apply conflicts are detected when git apply fails; the run is marked invalid and the workspace is never left in a partially-applied state
- approval and PR creation are blocked when the workspace has uncommitted changes (dirty-repo guard)
- approval is blocked when the workspace HEAD has changed since the run was created (stale-candidate detection)

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

## Sandbox and scorer modes

### `sandboxStrategy`

- `git_worktree`: create a detached git worktree and apply accepted changes back as a git patch
- `copy`: copy the workspace directory and apply accepted changes by syncing allowed paths

### `scorerIsolationMode`

- `separate_workspace`: copy the candidate workspace into a scorer-only sandbox before scoring
- `same_workspace`: score directly in the mutation sandbox

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
- `PAPERCLIP_OPTIMIZER_SANDBOX_STRATEGY`
- `PAPERCLIP_OPTIMIZER_SCORER_ISOLATION`
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
- guardrail repeat details
- mutable paths
- sandbox path when retained
- scorer sandbox path when retained
- git repo root and workspace-relative path for worktree-backed runs
- diff stats
- changed files
- unauthorized changed files
- patch preview
- patch-apply conflict info when git apply fails (conflicting files, stderr excerpt)
- workspace HEAD commit SHA at run creation (used for stale-candidate detection)
- optional PR branch, commit, URL, and PR command result

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

## Pull request generation

For applied runs, the plugin can:

1. create a proposal branch
2. stage only the run's changed files
3. create a commit
4. optionally execute a PR command such as `gh pr create`

Useful optimizer fields:

- `proposalBranchPrefix`
- `proposalCommitMessage`
- `proposalPrCommand`

The PR command receives:

- `PAPERCLIP_OPTIMIZER_ID`
- `PAPERCLIP_OPTIMIZER_NAME`
- `PAPERCLIP_OPTIMIZER_RUN_ID`
- `PAPERCLIP_PROPOSAL_BRANCH`
- `PAPERCLIP_PROPOSAL_COMMIT`

## Approval UI

The project tab now supports:

- pending-run approval and rejection
- run-to-run side-by-side comparison
- diff and structured metric inspection
- issue creation from any run
- PR creation from applied runs

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

Research prompts for deeper design iteration live in [RESEARCH_PROMPTS.md](./RESEARCH_PROMPTS.md).

## Verification status

This plugin has been verified against a live Paperclip `0.3.1` deployment with:

- plugin install from a local path
- plugin health returning ready/healthy
- UI contribution discovery returning the page, dashboard widget, project tab, and project sidebar item
- in-container Vitest pass

The strengthened runtime in this branch preserves that deployment path while adding:

- repeated scoring
- structured JSON scoring
- git worktree sandboxing with patch apply
- separate scorer execution workspaces
- diff artifact capture
- unauthorized change detection
- queueing
- manual approval and dry runs
- auto-created issues on guardrail failure or stagnation
- PR creation from applied runs
- SDK harness e2e tests for accepted, pending, and rejected paths

## Current constraints

- This is a trusted local-workspace plugin. It executes shell commands inside project workspaces.
- Blind scoring is stronger than before, but still partial. Mutation and scoring are isolated at the workspace/executor level, not by a separate remote scoring service.
- Git-backed PR creation assumes the workspace repo is in a committable state for the run's changed files.
- Diff capture uses `git diff --no-index` for patch previews and falls back gracefully when diff generation is incomplete.
- If `keepTmpDirs` is enabled, retained sandboxes will accumulate until manually cleaned.
- Copy-mode sandboxes still exist for non-git workspaces or when operators prefer filesystem sync over git patch apply.

## Instance config

The plugin instance config supports:

- `defaultMutationBudgetSeconds`
- `defaultScoreBudgetSeconds`
- `defaultGuardrailBudgetSeconds`
- `keepTmpDirs`
- `maxOutputChars`
- `sweepLimit`
- `scoreRepeats`
- `guardrailRepeats`
- `guardrailAggregator`
- `minimumImprovement`
- `stagnationIssueThreshold`
