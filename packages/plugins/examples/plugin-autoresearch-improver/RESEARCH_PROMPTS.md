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


## 10. Template and policy design

```text
Given a Paperclip autoresearch plugin that now supports three score improvement policies:

1. **threshold** (default): delta > minimumImprovement
2. **confidence**: delta > k × stdDev(scores), with k configurable (default 2.0), needs scoreRepeats ≥ 2
3. **epsilon**: delta > max(epsilonValue, noiseFloor), for known minimum improvements

And also supports:
- auto-pause after stagnation threshold (configurable consecutiveNonImprovements limit)
- 7 built-in templates (Test Suite Ratchet, Lighthouse, Dry Run, Noisy Scorer, Epsilon Stability, Auto-Accept Fast, Stagnation Guard)
- optimizer history tracking (created, cloned, config_updated, run_accepted, run_rejected, paused, resumed)
- optimizer cloning with incremented cloneCount
- richer overview metrics (avg score, avg delta, rejection rate)
- separate invalidRuns counter (distinct from rejectedRuns)
- `noiseFloor` computed from scorer variance and used as epsilon policy's rolling noise floor

Research questions:
1. What are the best practices for setting scoreRepeats, confidenceThreshold, and epsilonValue given different scorer types (deterministic, low-noise, high-noise)?
2. How should the stagnation threshold be tuned relative to the scoreRepeats and improvement policy?
3. When should a user choose epsilon vs confidence policy? What are the failure modes of each?
4. How should clone optimizer be used in practice — for branching experiments, A/B comparison, or config variation?
5. What patterns emerge from optimizer history that could inform automated policy suggestion or self-tuning?

Return a practical guide for template selection, policy tuning, and stagnation management.
```


## 11. Run history analysis and scorer drift detection

```text
The optimizer tracks a history of config changes (created, config_updated, run_accepted,
run_rejected, paused, resumed, cloned) and a counter of runs, acceptedRuns, rejectedRuns,
invalidRuns, consecutiveFailures, consecutiveNonImprovements.

Each run record captures: scoringRepeats with individual scores, scoringAggregate with
metrics, guardrailAggregate with guardrails, artifacts with patch/stats, baselineScore,
candidateScore, outcome, reason, duration.

Research questions:
1. How can scoring history be used to detect scorer drift (the scorer itself changing
   behavior over time — e.g., external API version changes, time-of-day effects)?
   What signals would indicate the scorer has changed?
2. What patterns in the run history could trigger a policy switch? For example,
   if confidence policy consistently produces rejections, should it fall back to
   threshold? If epsilon policy causes rejections on every small improvement,
   should noiseFloor be cleared or recalculated?
3. When consecutiveNonImprovements grows, at what point should the optimizer
   auto-pause vs suggest a scorer change vs clone the optimizer to try different config?
4. How could optimizer history (ConfigChangeRecord entries) be used to give users
   a "timeline view" of their optimization — what changed, when, and why?
5. What minimum dataset size is needed to make confidence policy reliable?
   (needs scoreRepeats >= 2 per run, and many runs to compute stdDev of means)

Return actionable heuristics for history-driven optimization management.
```


## 12. Optimizer lifecycle and production readiness

```text
The autoresearch plugin manages a full optimizer lifecycle:
- creation (from templates or blank)
- configuration (50+ fields across objective, mutation, scoring, guardrails, apply, PR)
- execution (sandbox creation, repeated scoring, guardrail evaluation, patch apply)
- review (manual approval, issue creation, PR creation)
- pause/resume (manual or auto-pause on stagnation/failures)
- cloning (for A/B variation or branching)
- deletion (branch cleanup, workspace reset)

Research questions:
1. How should a user decide when to clone an optimizer vs. adjust the existing one's config? What signals suggest "this optimizer is stuck in a local optimum"?
2. When should an optimizer be deleted vs. paused? What is the cost of keeping stale optimizers around?
3. What is the recommended naming/convention for optimizer names when running multiple variants (e.g., A/B testing two different scorers)?
4. How should the mutation budget and score budget be tuned relative to expected mutation complexity and scoring speed?
5. What are the minimum viable settings for each apply mode:
   - manual_approval: minimum viable config
   - automatic: minimum viable config (requires PR flow or dirty workspace guard?)
   - dry_run: minimum viable config
6. When is it appropriate to use scorerIsolationMode=same_workspace vs. separate_workspace? What are the trade-offs for scorer blinding?
7. How should users handle the case where their scorer is external (e.g., an API endpoint)? The current plugin runs commands locally — what's the path for a remote scorer?

Return a production-ready checklist for running optimizers in a real codebase.
```
