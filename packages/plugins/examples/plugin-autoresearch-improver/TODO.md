# Autoresearch Improver TODO

This file tracks the remaining work after the current git-backed, scorer-isolated, approval-aware version of the plugin.

## High priority

- Separate scoring into a real external evaluator service instead of a separate local workspace.
- ✅ Protect dirty repos before PR creation so unrelated local changes are never swept into proposal branches. *(implemented: dirty-repo guard in `createPullRequestFromRun`)*
- ✅ Add stale-candidate detection before approval or PR creation. *(implemented: workspace HEAD comparison in `promotePendingRun` and `createPullRequestFromRun`)*
- ✅ Store richer PR metadata on runs. *(implemented: PR number extraction, push result tracking, branch existence check, proposalBaseBranch, proposalPushCommand fields)*

## Safety and correctness

- ✅ Add explicit invalid-run semantics to JSON scoring. *(implemented: `invalid` and `invalidReason` fields in StructuredMetricResult, checked in runOptimizerCycle)*
- ✅ Add repeated guardrail execution, not only repeated scoring. *(implemented: guardrailRepeats and guardrailAggregator in measureGuardrail)*
  - ✅ Add epsilon and confidence policies for noisy scorers beyond `minimumImprovement`. *(implemented: scoreImprovementPolicy field, compareScoresWithPolicy(), confidence policy (k×stdDev), epsilon policy (max(epsilon,noiseFloor)))*
- ✅ Handle merge conflicts on patch apply more gracefully. *(implemented: detectPatchConflicts, structured PatchConflictInfo on run, invalid outcome on conflict, UI conflict display)*
- ✅ Add a "workspace changed since run creation" check before approval. *(implemented: dirty-repo guard in promotePendingRun before patch apply)*
- ✅ Add better handling for binary files and large patches in diff artifacts. *(implemented: isBinaryFile(), binaryFiles field on RunDiffArtifact, excluded from text patch)*

## Git and PR flow

- ✅ Allow configuring the proposal base branch explicitly. *(implemented: proposalBaseBranch field in OptimizerDefinition)*
- ✅ Support optional `git push` as a first-class step before PR creation. *(implemented: proposalPushCommand with PAPERCLIP_PROPOSAL_REMOTE env var, push result tracked in artifact)*
- ✅ Support a separate push command and PR command instead of one generic PR command. *(implemented: proposalPushCommand and proposalPrCommand as independent fields)*
- ✅ Add branch existence checks and reuse policy. *(implemented: git branch --list check, rejection on existence in createPullRequestFromRun)*
- ✅ Add cleanup policy for proposal branches created from rejected or obsolete runs. *(implemented: deleteProposalBranch action handler with git push --delete)*
- Add support for multi-repo or monorepo-subtree workflows where the Paperclip workspace is not the repo root.
  *(partial: sandboxStrategy='copy' works in subdirectories; git_worktree requires workspace = repo root)*

## UI

- ✅ Show a first-class PR card on runs with branch, commit, URL, and command output. *(implemented: PullRequestCard with copyable fields, click-to-copy)*
- ✅ Add a cleaner side-by-side comparison view with score deltas, guardrail deltas, changed-file overlap, patch diff excerpts. *(implemented: enhanced ComparisonPanel with score deltas, guardrail summary, metric details, collapsible file list)*
- ✅ Add filters for: accepted, pending approval, rejected, invalid, dry run. *(implemented: RunFilterBar with outcome-based filter chips)*
  - ✅ Add copyable scorer and mutator templates in the UI. *(implemented: Copy buttons on mutation/score/guardrail command textareas)*
  - ✅ Add downloadable artifacts for patch, score JSON, and logs. *(implemented: Download patch and Download score JSON buttons on run cards)*
- ✅ Add a clearer sandbox retention indicator and cleanup action for retained candidates. *(implemented: sandbox status in UI, deleteProposalBranch action)*
- ✅ Add warnings when an optimizer is configured for `automatic` apply without proposal settings. *(implemented: amber warning banner in optimizer editor)*

## Testing

- ✅ E2e coverage for patch-apply conflicts *(implemented: patch-apply conflict test with conflicting commit)*
- ✅ E2e coverage for dirty workspace rejection before proposal creation *(implemented: dirty-repo PR rejection test)*
- ✅ E2e coverage for dirty workspace rejection before approval *(implemented: dirty approval guard test)*
- ✅ E2e coverage for copy-mode sandboxes *(implemented)*
- ✅ E2e coverage for PR command failures *(implemented: commandResult.ok=false is returned in artifact)*
- ✅ Run persistence assertions after approval and rejection *(implemented: verify run record outcome/approvalStatus after reject action)*
- Add e2e coverage for:
  - ✅ subdirectory workspaces inside a larger git repo *(implemented: copy-mode sandbox in non-git parent dir)*
  - ✅ untracked file creation inside the mutable surface *(implemented: verifies run completes when mutation creates new files)*
  - ✅ deletion flows *(implemented: deletion e2e test verifies run records without crash)*
- Add UI-level tests for the comparison and approval flows. *(React testing library setup not present in this repo; would need to add @testing-library/react and configure Vitest environment)*

## Documentation

- ✅ Document recommended PR command recipes. *(implemented: README includes gh pr create, push+API, enterprise workflow recipes)*
- ✅ Add a "design limitations" section comparing: current scorer isolation vs future remote evaluator isolation. *(implemented: README.md Current constraints section)*
- ✅ Add more scorer examples. *(implemented: README includes code quality, docs quality, Lighthouse, CRO examples)*

## Nice to have

- Add downloadable artifacts for patch, score JSON, and logs.
- ✅ Add optimizer version history and config diffing. *(implemented: ConfigChangeRecord type, history field on OptimizerDefinition, history UI panel with Show/Hide toggle)*
- ✅ Add a "clone optimizer" action. *(implemented: cloneOptimizer action, Clone button in UI, cloneCount tracking, history recording)*
- ✅ Add per-optimizer pause reasons and maintenance windows. *(implemented: pauseOptimizer/resumeOptimizer actions, pauseReason field, Pause/Resume buttons in UI, pause reason banner)*
- Add richer metrics and dashboard summaries for:
  - average score delta
  - acceptance rate
  - invalidation rate
  - pending approval backlog
  *(implemented: overview panel shows accepted/rejected/invalid/pending counts, avg score, avg delta, rejection rate)*

## Open design questions

- Should approval happen before apply-back, or should apply-back always happen into a proposal branch first?
- Should PR creation remain an explicit action, or become a new apply mode?
- Should scorer isolation move into Paperclip core rather than remain plugin-local?
- How much of the optimizer state machine belongs in the plugin versus a general Paperclip experiment framework?
