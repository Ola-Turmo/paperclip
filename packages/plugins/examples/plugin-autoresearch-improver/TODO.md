# Autoresearch Improver TODO

This file tracks the remaining work after the current git-backed, scorer-isolated, approval-aware version of the plugin.

## High priority

- Separate scoring into a real external evaluator service instead of a separate local workspace.
- ✅ Protect dirty repos before PR creation so unrelated local changes are never swept into proposal branches. *(implemented: dirty-repo guard in `createPullRequestFromRun`)*
- ✅ Add stale-candidate detection before approval or PR creation. *(implemented: workspace HEAD comparison in `promotePendingRun` and `createPullRequestFromRun`)*
- Store richer PR metadata on runs.
  - PR number
  - base branch
  - remote name
  - push result
  - merge status

## Safety and correctness

- ✅ Add explicit invalid-run semantics to JSON scoring. *(implemented: `invalid` and `invalidReason` fields in StructuredMetricResult, checked in runOptimizerCycle)*
- ✅ Add repeated guardrail execution, not only repeated scoring. *(implemented: guardrailRepeats and guardrailAggregator in measureGuardrail)*
- Add epsilon and confidence policies for noisy scorers beyond `minimumImprovement`.
- ✅ Handle merge conflicts on patch apply more gracefully. *(implemented: detectPatchConflicts, structured PatchConflictInfo on run, invalid outcome on conflict, UI conflict display)*
- ✅ Add a "workspace changed since run creation" check before approval. *(implemented: dirty-repo guard in promotePendingRun before patch apply)*
- Add better handling for binary files and large patches in diff artifacts.

## Git and PR flow

- Allow configuring the proposal base branch explicitly.
- Support optional `git push` as a first-class step before PR creation.
- Support a separate push command and PR command instead of one generic PR command.
- Add branch existence checks and reuse policy.
- Add cleanup policy for proposal branches created from rejected or obsolete runs.
- Add support for multi-repo or monorepo-subtree workflows where the Paperclip workspace is not the repo root.

## UI

- ✅ Show a first-class PR card on runs with branch, commit, URL, and command output. *(implemented: PullRequestCard with copyable fields, click-to-copy)*
- ✅ Add a cleaner side-by-side comparison view with score deltas, guardrail deltas, changed-file overlap, patch diff excerpts. *(implemented: enhanced ComparisonPanel with score deltas, guardrail summary, metric details, collapsible file list)*
- ✅ Add filters for: accepted, pending approval, rejected, invalid, dry run. *(implemented: RunFilterBar with outcome-based filter chips)*
- Add copyable scorer and mutator templates in the UI.
- Add a clearer sandbox retention indicator and cleanup action for retained candidates.
- ✅ Add warnings when an optimizer is configured for `automatic` apply without proposal settings. *(implemented: amber warning banner in optimizer editor)*

## Testing

- ✅ E2e coverage for patch-apply conflicts *(implemented: patch-apply conflict test with conflicting commit)*
- ✅ E2e coverage for dirty workspace rejection before proposal creation *(implemented: dirty-repo PR rejection test)*
- ✅ E2e coverage for dirty workspace rejection before approval *(implemented: dirty approval guard test)*
- Add e2e coverage for:
  - copy-mode sandboxes
  - subdirectory workspaces inside a larger git repo
  - untracked file creation inside the mutable surface
  - deletion flows
  - PR command failures
- Add assertions around run persistence after approval and rejection.
- Add UI-level tests for the comparison and approval flows.

## Documentation

- Document recommended PR command recipes.
  - `gh pr create`
  - branch push + API-based PR creation
  - internal enterprise git workflows
- Add a "design limitations" section comparing:
  - current scorer isolation
  - future remote evaluator isolation
- Add more scorer examples.
  - code quality
  - docs quality
  - Lighthouse
  - CRO / landing-page scoring

## Nice to have

- Add downloadable artifacts for patch, score JSON, and logs.
- Add optimizer version history and config diffing.
- Add a "clone optimizer" action.
- Add per-optimizer pause reasons and maintenance windows.
- Add richer metrics and dashboard summaries for:
  - average score delta
  - acceptance rate
  - invalidation rate
  - pending approval backlog

## Open design questions

- Should approval happen before apply-back, or should apply-back always happen into a proposal branch first?
- Should PR creation remain an explicit action, or become a new apply mode?
- Should scorer isolation move into Paperclip core rather than remain plugin-local?
- How much of the optimizer state machine belongs in the plugin versus a general Paperclip experiment framework?
