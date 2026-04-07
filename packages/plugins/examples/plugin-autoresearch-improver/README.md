# `@paperclipai/plugin-autoresearch-improver-example`

Autoresearch Improver is a first-party Paperclip example plugin that turns the Karpathy `autoresearch` and Darwin Derby pattern into a project-scoped optimizer for Paperclip workspaces.

It implements the core loop:

1. define the mutable surface
2. keep the evaluator fixed
3. run each candidate under a fixed budget
4. keep only strict improvements

This version goes further than the initial example. It adds repeated scoring, structured JSON metrics, git-worktree sandboxes, separated scorer execution, diff artifacts, queueing, dry runs, manual approval, and PR generation from accepted runs.

## What the plugin adds

## Score improvement policies

For noisy scorers, three policies control when a score improvement is accepted:

- **threshold** (default): candidate delta > `minimumImprovement`
- **confidence**: candidate delta > k × stdDev(scores) — requires `scoreRepeats` ≥ 2; falls back to threshold with insufficient data
- **epsilon**: candidate delta > max(`epsilonValue`, noiseFloor) — useful when scorer variance is consistent

Configure via `scoreImprovementPolicy`, `confidenceThreshold` (default: 2.0), and `epsilonValue` (default: 0.01) on the optimizer.

## Optimizer history and cloning

Each optimizer maintains a change history (`history: ConfigChangeRecord[]`) recording:

- creation, cloning, config updates
- run acceptance and rejection
- pause and resume events

The UI exposes a Show/Hide history panel on the optimizer editor. Use the "Clone" button to duplicate an optimizer with a new ID and name. The original's `cloneCount` is incremented.

## Pause and resume

Optimizers can be paused with an optional reason (`pauseReason` field). Paused optimizers show ⏸ prefix in the dropdown and display the pause reason in a banner below the action buttons. Resume clears the pause reason and reactivates the optimizer.

Optimizers can also auto-pause based on two conditions:
- **Stagnation**: When `autoCreateIssueOnStagnation=true` and `consecutiveNonImprovements === stagnationIssueThreshold`, the optimizer pauses and creates a stagnation issue.
- **Consecutive failures**: When `autoPauseOnConsecutiveFailures=true` and `consecutiveFailures >= stagnationIssueThreshold`, the optimizer pauses with a failure reason.

Both conditions share the `stagnationIssueThreshold` as their trigger threshold.

## Richer metrics

The overview dashboard shows:

- counts: total runs, accepted, rejected, invalid, pending
- metrics: average candidate score, average score delta, rejection rate

---

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
- optional PR branch, commit, URL, PR number, push result (pushed flag, push remote, push exit code), and full command result

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

1. check that no branch with the proposed name already exists (branch existence guard)
2. create a proposal branch (optionally from an explicit `proposalBaseBranch`)
3. stage only the run's changed files
4. create a commit
5. optionally push the branch via `proposalPushCommand`
6. optionally execute a PR command such as `gh pr create`
7. extract the PR number from the PR command output (`!123` or `#123` patterns)

Useful optimizer fields:

- `proposalBranchPrefix` — prefix for the generated branch name
- `proposalBaseBranch` — explicit base branch (defaults to current checked-out branch)
- `proposalPushCommand` — optional push step run before the PR command (receives `PAPERCLIP_PROPOSAL_REMOTE`)
- `proposalCommitMessage` — commit message override
- `proposalPrCommand` — PR creation command (receives `PAPERCLIP_PROPOSAL_BRANCH`, `PAPERCLIP_PROPOSAL_COMMIT`, `PAPERCLIP_OPTIMIZER_ID`, `PAPERCLIP_OPTIMIZER_NAME`, `PAPERCLIP_OPTIMIZER_RUN_ID`)

Stored PR artifacts include: branch name, base branch, remote, commit SHA, PR URL, PR number, push result, push remote, push exit code, command output, and creation timestamp.

## Approval UI

The project tab supports:

- pending-run approval and rejection (with dirty-repo and stale-candidate guards)
- run-to-run side-by-side comparison with score deltas, guardrail summary, and metric details
- diff and structured metric inspection
- run-state filters (All, Pending, Accepted, Rejected, Invalid, Dry Run)
- first-class PR card with copyable branch, commit, and command fields
- issue creation from any run
- PR creation from applied runs
- automatic apply warning when no proposal settings are configured

## Recommended PR command recipes

### 1. `gh pr create` (GitHub CLI)

```bash
gh pr create --title "Autoresearch: ${PAPERCLIP_OPTIMIZER_NAME}" --body "Run: ${PAPERCLIP_OPTIMIZER_RUN_ID}" --base main
```

Environment variables available to the command:
- `PAPERCLIP_PROPOSAL_BRANCH`
- `PAPERCLIP_PROPOSAL_BASE`
- `PAPERCLIP_PROPOSAL_REMOTE`
- `PAPERCLIP_PROPOSAL_COMMIT`
- `PAPERCLIP_OPTIMIZER_ID`
- `PAPERCLIP_OPTIMIZER_NAME`
- `PAPERCLIP_OPTIMIZER_RUN_ID`

### 2. Branch push + API-based PR creation

```bash
git push origin ${PAPERCLIP_PROPOSAL_BRANCH}
```

Then use `gh api` or a custom tool to open the PR.

### 3. Enterprise internal workflows

For internal setups without GitHub CLI, use `git push` followed by a custom API call:

```bash
git push https://github.com/your-org/repo.git ${PAPERCLIP_PROPOSAL_BRANCH}
gh api repos/your-org/repo/pulls --method POST -f title="Autoresearch: ${PAPERCLIP_OPTIMIZER_NAME}" -f head="${PAPERCLIP_PROPOSAL_BRANCH}" -f base=main
```

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

## Scorer examples

### Code quality scorer

```bash
node -e "const {execSync} = require('child_process'); const result = execSync('node ./scripts/code-quality.mjs', {encoding: 'utf8'}); console.log(result);"
```

Example JSON output:
```json
{"primary": 0.85, "metrics": {"complexity": 12, "duplicates": 3}, "guardrails": {"noSyntaxErrors": true}}
```

### Docs quality scorer

```bash
node -e "const {execSync} = require('child_process'); const result = execSync('node ./scripts/docs-score.mjs', {encoding: 'utf8'}); console.log(result);"
```

Example JSON output:
```json
{"primary": 0.92, "metrics": {"readability": 88, "wordCount": 1200}, "guardrails": {"hasExamples": true}}
```

### Lighthouse performance scorer

```bash
node ./scripts/lighthouse-score.mjs
```

Example JSON output:
```json
{"primary": 0.87, "metrics": {"fcp": 1200, "lcp": 2400, "cls": 0.05}, "guardrails": {"noCrash": true}}
```

### CRO / landing-page scorer

```bash
node -e "console.log(JSON.stringify({ primary: 0.78, metrics: { conversionRate: 0.041, bounceRate: 0.32 }, guardrails: { mobileFriendly: true } }))"
```

### Plain number scorer with pattern

```bash
node ./scripts/simple-score.mjs && echo "SCORE=0.91"
```

Configure `scoreFormat: "number"` and `scorePattern: "SCORE=([0-9.]+)"`.

## Install into Paperclip

From the Paperclip repo:

```bash
pnpm --filter @paperclipai/plugin-autoresearch-improver-example build
pnpm paperclipai plugin install ./packages/plugins/examples/plugin-autoresearch-improver
```

## Template guide

The plugin ships with these built-in templates. Select one from the UI template dropdown or clone and customize:

| Template | Apply mode | Sandbox | Policy | Best for |
|---|---|---|---|---|
| Test Suite Ratchet | Manual approval | git_worktree | threshold | Code quality, test stability |
| Lighthouse Candidate | Manual approval | git_worktree | threshold | Frontend performance |
| Dry Run Prototype | Dry run | copy | threshold | Proposal generation, review-only |
| Noisy Scorer Ratchet | Manual approval | git_worktree | confidence (k=2) | Lighthouse, sampled metrics |
| Epsilon Stability | Automatic | git_worktree | epsilon | Latency, known minimum thresholds |
| Auto-Accept Fast | Automatic | git_worktree | threshold | Low-risk, rapid improvement |
| Stagnation Guard | Automatic | git_worktree | threshold | Production, auto-pause on stagnation |

### Choosing a template

**Start here**: Test Suite Ratchet with `manual_approval` — lets you review candidates before they affect the workspace.

**For noisy scorers**: Use Noisy Scorer Ratchet. Set `scoreRepeats` to at least 5 to get enough data for the stdDev computation. Lower `confidenceThreshold` (e.g., 1.5) to accept smaller deltas.

**For known minimums**: Use Epsilon Stability. Set `epsilonValue` to your minimum meaningful improvement (e.g., 0.05 for 5% quality gain).

**For production**: Use Stagnation Guard with a low `stagnationIssueThreshold` (3-5). It auto-pauses and creates an issue when the scorer stops producing improvements.

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
- Scoring is isolated at the workspace/executor level. Separating into a remote scoring service requires further architectural work.
- Git-backed PR creation assumes the workspace repo is in a committable state for the run's changed files.
- Diff capture uses `git diff --no-index` for patch previews and falls back gracefully when diff generation is incomplete.
- Binary files are detected by null-byte scanning and excluded from the text patch; the `binaryFiles` array on the diff artifact lists them.
- Copy-mode sandboxes still exist for non-git workspaces or when operators prefer filesystem sync over git patch apply.
- Git worktree strategy requires the workspace to be the git repo root (worktrees are full-repo copies).
- `noiseFloor` is computed internally from scorer variance (stdDev of repeated scores) after each run. The epsilon policy uses it as `max(epsilonValue, noiseFloor)` so noisy scorers require larger deltas to qualify.

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
- `autoPauseOnConsecutiveFailures` (auto-pause on consecutive failures)
- `scoreImprovementPolicy` ("threshold" | "confidence" | "epsilon")
- `confidenceThreshold` (k multiplier for stdDev in confidence policy)
- `epsilonValue` (minimum meaningful improvement for epsilon policy)
- `autoPauseOnConsecutiveFailures` is an **optimizer-level** flag, not instance-level (set per-optimizer in the optimizer editor form)
