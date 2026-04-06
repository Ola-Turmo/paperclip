# Research Prompts for `plugin-autoresearch-improver`

These prompts are meant for deep research runs, LLM planning sessions, or design reviews. They assume the current plugin already supports:

- mutable-surface constraints
- repeated scoring with JSON or numeric scorers
- separate scorer workspaces
- git-worktree or copy sandboxes
- diff artifacts
- queued runs
- manual approval and dry runs
- issue creation from runs
- PR creation from applied runs
- e2e harness coverage for accepted, pending, and rejected flows

## 1. Architecture critique

```text
Analyze the current Paprclip/Paperclip autoresearch improver plugin as an optimization system.

Current behavior:
- optimizer definitions are project-scoped plugin entities
- mutation runs in either a copied workspace or a detached git worktree
- scoring can run in a separate scorer-only workspace
- scores can be numeric or structured JSON
- repeated scoring is aggregated with median/mean/max/min
- candidates are accepted only if they beat the incumbent by minimumImprovement
- unauthorized file changes invalidate the run
- accepted changes are applied back by git patch or allowed-path sync
- pending approval and dry-run candidates retain their sandbox for review
- applied runs can generate proposal branches, commits, and optional PRs

Research questions:
1. What are the strongest and weakest parts of this design?
2. Which failure modes still remain around metric gaming, reproducibility, and operator trust?
3. Where should the system move from example-plugin quality to production-grade control plane quality?
4. What responsibilities should remain inside the plugin and what should move to external services?

Give a concrete roadmap ordered by impact and implementation risk.
```

## 2. Blind scoring boundary

```text
Study how to strengthen blind scoring for a Paperclip autoresearch plugin that currently isolates mutation and scoring by running the scorer in a separate workspace, but still from the same worker runtime.

Current plugin facts:
- mutator gets an optimizer brief and can optionally be denied the score command
- scorer runs in a separate workspace copy after mutation
- approval and PR generation happen after scoring
- run artifacts include diff previews and structured metric payloads

Research tasks:
- compare same-process isolation, separate local process isolation, container isolation, and remote service isolation
- analyze how each option changes trust, cost, reproducibility, and operator complexity
- propose a staged migration path from the current plugin to a stronger scoring boundary
- include how secrets, private datasets, and hidden evaluation logic should be handled

Focus on practical system design, not abstract ideals.
```

## 3. Git worktree methods

```text
Evaluate git-worktree based optimization workflows for an autoresearch plugin.

Current plugin behavior:
- uses detached git worktrees when possible
- computes diff artifacts and applies accepted changes back as patches
- falls back to copy-mode for non-git workspaces
- can branch and commit applied runs for PR creation

Research questions:
1. What are the edge cases with detached worktrees, subdirectory workspaces, untracked files, deletions, and dirty working trees?
2. What is the safest apply-back strategy for accepted runs?
3. When should patch-apply be preferred over cherry-pick, worktree promotion, or direct branch switching?
4. How should the plugin protect user changes that already exist in the workspace?
5. What metadata should be stored so that approvals and PRs remain reproducible?

Include recommended git command patterns and rollback strategies.
```

## 4. Evaluation methodology

```text
Design a research-backed evaluation framework for a Paperclip autoresearch plugin that currently supports:
- structured JSON scoring
- repeated scoring
- score aggregation
- minimum improvement thresholds
- guardrail commands
- issue creation on stagnation or guardrail failure

I want guidance on:
- how to define good primary metrics
- how to define guardrails and invalid-run conditions
- how to handle noisy scorers
- how to choose between median/mean/max/min aggregation
- how to set minimumImprovement thresholds
- how to distinguish offline proxy metrics from slower truth metrics

Use online experimentation, ML evaluation, Darwin Derby, and Goodhart-aware optimization principles. End with a concrete metric design template the plugin could adopt.
```

## 5. Approval workflow research

```text
Research the best approval workflow for an optimization plugin that already supports pending-approval candidates, side-by-side comparison UI, diff previews, and run-to-issue / run-to-PR promotion.

Current plugin facts:
- candidates can be queued, approved, rejected, or kept as dry runs
- retained sandboxes allow operator review before apply-back
- comparison UI can inspect structured metrics and changed files
- PR generation happens only after a run has been applied

Questions:
1. Should approval happen before apply-back, before branch creation, or before PR creation?
2. What artifacts are mandatory for good human review?
3. How should approvals interact with noisy scorers and stale incumbents?
4. What should happen when the workspace changed after the candidate was generated?
5. How should multi-step approvals work for high-risk optimizers?

Answer with a recommended approval state machine and UI requirements.
```

## 6. Productionizing prompts

```text
Improve the mutation and scorer prompt strategy for a Paperclip autoresearch plugin.

Current plugin facts:
- the mutator reads PAPERCLIP_OPTIMIZER_BRIEF
- mutable paths are explicit
- score direction, repeats, apply mode, and thresholds are provided
- scoring may be hidden from the mutator
- the plugin can run in git-worktree or copy mode

I want:
- a better default mutator prompt template
- a better scorer prompt template for LLM-as-judge JSON outputs
- guidance on comparative scoring versus absolute scoring
- guidance on prompt wording that reduces reward hacking
- examples for code quality, docs quality, CRO, and performance optimization

Return improved prompt templates plus rationale for each template section.
```

## 7. Boundary exploration

```text
Map the boundaries of what a Paperclip autoresearch plugin should and should not optimize.

Current plugin can optimize:
- project workspaces
- selected mutable files
- code, docs, configs, and content inside a project workspace
- scored outcomes that can be measured by local commands

It currently does not natively optimize:
- remote production traffic experiments
- secret-backed hidden scorers on a separate server
- multi-repo or cross-service rollouts
- long-horizon truth metrics without an external evaluator

Research questions:
1. Which optimization domains fit the plugin architecture well right now?
2. Which domains need a separate evaluator service, online experimentation layer, or data warehouse?
3. What are the red lines where the plugin should stop and hand off to a bigger orchestration system?
4. How should Paprclip position this plugin: example, internal ops tool, or production optimizer?

Give a capability matrix with near-term, mid-term, and out-of-scope categories.
```

## 8. Test strategy research

```text
Review the test strategy for a Paperclip autoresearch plugin that now has:
- helper tests
- SDK harness e2e tests
- git-worktree execution
- manual approval and PR creation flows

I want a research-backed testing roadmap covering:
- unit tests
- harness-level integration tests
- container-level tests
- live-instance smoke tests
- failure injection tests
- mutation-score-approval race conditions
- dirty-git and conflict scenarios

Propose a layered test plan that balances confidence, runtime cost, and maintainability.
```

## 9. Next-method exploration

```text
Given the current Paperclip autoresearch improver plugin, propose the next 10 methods or design upgrades that would most increase real-world usefulness.

Current capabilities:
- mutable-surface ratchet loop
- JSON scoring and repeated evaluation
- git-worktree or copy sandboxes
- separated scorer workspace
- approval UI and diff review
- issue creation and PR generation
- harness e2e coverage

For each proposed method:
- describe the method
- explain why it matters
- state whether it belongs inside the plugin, Paperclip core, or an external service
- estimate implementation difficulty
- identify the main risk or tradeoff

Optimize for practical leverage, not novelty.
```
