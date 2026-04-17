# Paperclip Ecosystem Consolidation PRD

Status: Program PRD
Date: 2026-04-17
Primary target: `paperclip`
Workspace root: `/root/work/paperclip-live-2026-04-17`

## Objective

Unify the live Paperclip/UOS ecosystem into one coherent, installable, testable, documented program centered on the main `paperclip` control plane.

This program includes:

1. Absorbing all still-open work implied by live PRDs, plans, specs, and codebase review docs across the live repos.
2. Making Paperclip the canonical install and integration surface.
3. Making every plugin, department, tool, and support package installable and testable one by one and together.
4. Bringing docs, verification, debugging, release discipline, and operator UX to a consistent standard.
5. Adding the loops needed to make the ecosystem self-observing, self-learning, and self-improving.

## Program Rule

Every open PRD, plan, spec, and codebase-review artifact in the live repo set is in scope unless it is explicitly deprecated by a newer source doc. If two docs overlap, the newer or more canonical repo wins, but the useful acceptance criteria from both still need to be carried forward into `paperclip`.

## Live Repo Set

- `paperclip`
- `paperclip-product-autopilot`
- `uos-core`
- `uos-department-customer-service`
- `uos-department-finance-risk`
- `uos-department-growth-revenue`
- `uos-department-operations`
- `uos-department-people`
- `uos-department-product-tech`
- `uos-department-social-media`
- `uos-org-learning-plugin`
- `uos-paperclip-compat`
- `uos-plugin-connectors`
- `uos-plugin-connectors-universal-connector-bus`
- `uos-plugin-operations-cockpit`
- `uos-plugin-setup-studio`
- `uos-quality-gate`
- `uos-skills-catalog`
- `uos-tool-canonry-aeo-monitoring`
- `uos-tool-droid-cli-companion`
- `uos-tool-droid-cli-companion-safe-ai-command-e`
- `uos-tool-ffmpeg-media-operations`
- `uos-tool-opencli-automation-hub`
- `uos-tool-tandem-browser-companion`
- `uos-tool-trawl-web-extraction`

## Source Artifacts That Must Be Absorbed

| Repo | Source docs that are in scope | Consolidation requirement |
|---|---|---|
| `paperclip` | `doc/SPEC.md`, `doc/SPEC-implementation.md`, `doc/plans/*`, `docs/plans/*`, `docs/specs/cliphub-plan.md`, `packages/adapters/openclaw-gateway/doc/ONBOARDING_AND_TEST_PLAN.md` | Finish all existing control-plane plans and use them as the integration backbone. |
| `paperclip-product-autopilot` | `docs/world-class-prd.md`, `docs/final-mile-prd.md`, `docs/salvage/evaluator-driven-code-optimization-prd.md` | Bring product-improvement, evaluator, and delivery-loop capabilities into a clean Paperclip integration story. |
| `uos-core` | `PRD.md` | Make this the shared engine contract for pack resolution, plan generation, apply transactions, and shared contracts. |
| `uos-department-customer-service` | `PRD.md`, `docs/salvage/customer-service-knowledge-graph-and-multi-intent-prd.md`, `docs/salvage/customer-service-omnichannel-autonomy-and-learning-prd.md` | Add customer service overlays, triage, knowledge graph, learning loop, and omnichannel surfaces. |
| `uos-department-finance-risk` | `PRD.md`, `evals/variance-explanation-evals.md` | Add finance, budgeting, risk, accounting, and variance explanation flows tied to Paperclip budgets and approvals. |
| `uos-department-growth-revenue` | `PRD.md` | Add growth analytics, attribution, experiments, and revenue operations as first-class operational loops. |
| `uos-department-operations` | `PRD.md` | Add operations overlays, runbooks, freshness scoring, and operational health. |
| `uos-department-people` | `PRD.md` | Add people, role design, hiring/onboarding, and org health loops. |
| `uos-department-product-tech` | `PRD.md`, `docs/salvage/product-tech-autonomous-product-salvage-prd.md` | Add launch readiness, rollback readiness, and incident intelligence around product delivery. |
| `uos-department-social-media` | `PRD.md` | Add social publishing, content operations, and channel governance. |
| `uos-org-learning-plugin` | `codebase_review_prd.md` | Make learning capture, retrieval, and reuse a standard Paperclip capability. |
| `uos-paperclip-compat` | `PRD.md` | Ensure a stable compatibility layer between Paperclip and the UOS ecosystem. |
| `uos-plugin-connectors` | `PRD.md` | Add connector auth, policy, webhook, and callback infrastructure. |
| `uos-plugin-connectors-universal-connector-bus` | `PLAN.md` | Standardize the connector bus into the connectors platform and retire drift between repo variants. |
| `uos-plugin-operations-cockpit` | `PRD.md` | Surface health, drift, and evidence for operators inside Paperclip. |
| `uos-plugin-setup-studio` | `PRD.md` | Make guided setup, install, environment planning, and apply flows excellent. |
| `uos-quality-gate` | `SPEC.md`, `codebase_review_prd.md` | Make evaluation, gating, and human approval enforceable and visible. |
| `uos-skills-catalog` | `PLAN.md` | Add a living skill ecosystem with publishing, discovery, scoring, and safe deployment. |
| `uos-tool-canonry-aeo-monitoring` | `PRD.md` | Add AEO/SEO monitoring and evidence loops. |
| `uos-tool-droid-cli-companion` | code + tests | Make safe CLI execution and sandboxed command orchestration production-ready. |
| `uos-tool-droid-cli-companion-safe-ai-command-e` | repo state | Decide whether to implement, merge, or archive; it is currently empty and cannot remain ambiguous. |
| `uos-tool-ffmpeg-media-operations` | `PLAN.md` | Add media transformation capability with reliable test fixtures and artifact validation. |
| `uos-tool-opencli-automation-hub` | `PRD.md` | Add automation routing across CLI, browser, and app tools. |
| `uos-tool-tandem-browser-companion` | `PRD.md` | Add authenticated browser-session reuse, handoff, recovery, and user-style automation. |
| `uos-tool-trawl-web-extraction` | `PRD.md` | Add structured extraction with schema, provenance, and drift awareness. |

## What Must Be Done

## 1. Make `paperclip` The Canonical Ecosystem Host

`paperclip` must become the place where a user can:

1. Install the control plane.
2. Discover the available UOS ecosystem packages.
3. Install, enable, disable, configure, and update each package.
4. Test each package in isolation.
5. Test combined package sets as real operating systems for AI companies.
6. Observe failures, logs, drift, costs, and learning signals.

Required work:

- Finish the existing Paperclip plans already checked into `doc/plans/` and `docs/plans/`.
- Build or finalize a canonical plugin/package installation manager with version visibility, dependency visibility, compatibility checks, health checks, and rollback.
- Standardize plugin metadata so every live repo declares package purpose, capabilities, host version compatibility, required secrets, required connectors, test commands, smoke commands, and user-facing setup steps.
- Add ecosystem discovery inside Paperclip so the operator can understand what each repo does without reading GitHub manually.
- Make the operator experience board-first, output-first, and user-understandable rather than transcript-first.

## 2. Standardize The Live Repos

Every live repo should converge on the same baseline:

- clear README
- canonical PRD or PLAN
- install instructions
- example configuration
- test instructions
- smoke instructions
- integration instructions for Paperclip
- release/versioning instructions
- issue triage conventions
- known limitations

Immediate repo hygiene work:

- Remove committed `node_modules` and generated `dist` outputs from repos that still contain them, especially `uos-tool-droid-cli-companion` and `uos-tool-ffmpeg-media-operations`.
- Normalize repos that only have `PLAN.md` into the same documentation standard as repos that already have `PRD.md`.
- Decide the fate of `uos-tool-droid-cli-companion-safe-ai-command-e`, because an empty live repo creates portfolio and integration ambiguity.
- Add missing `.github` workflow coverage where repo quality signals are weaker than the rest of the ecosystem.

## 3. Finish The Existing Product Backlog

The following backlog is explicitly in scope because it is already present in the live source artifacts:

- Paperclip control-plane follow-up plans around agent management, issue orchestration, token optimization, skills UI, browser cleanup, agent OS follow-ups, VS Code task interoperability, issue documents, ClipHub, and gateway onboarding.
- Product Autopilot capabilities around research, ideation, evaluator-driven optimization, and final-mile delivery.
- Customer service capabilities around multi-intent triage, knowledge graphs, omnichannel handling, KPI control, learning loops, and cross-department handoff.
- Finance and risk capabilities around budget intelligence, accounting/variance explanations, and explainable financial controls.
- Product-tech capabilities around launch readiness, rollback readiness, and incident prediction/intelligence.
- Learning, quality, skills, connectors, setup, and cockpit capabilities from their respective PRD/PLAN/spec files.

None of these should remain as “docs debt with no owning execution path.” Every source artifact must map to a tracked Paperclip integration milestone, acceptance criteria, and test plan.

## 4. Build The Missing Cross-Cutting Platform Work

The live repo set implies several cross-cutting workstreams that are broader than any single repo:

### 4.1 Documentation Program

- Update every README so it matches the current code and Paperclip integration story.
- Add a single “ecosystem install” doc in `paperclip` that shows the recommended order of adoption.
- Add “operator quickstart” docs that are written for real users, not only for developers.
- Add “debugging” docs for plugin loading, failed runs, failed connectors, missing secrets, browser automation failures, extractor drift, and eval failures.
- Add “acceptance test” docs for each repo.
- Add “when not to use this package” sections to reduce operator confusion.

### 4.2 Stability Program

- Add plugin contract tests so packages cannot silently drift from the host API.
- Add compatibility/version matrix tests between `paperclip`, `uos-paperclip-compat`, and every installable package.
- Add failure-injection tests for bad configs, missing secrets, network failures, browser crashes, malformed extraction, failed approvals, and budget hard-stop scenarios.
- Add startup, restart, shutdown, and upgrade safety tests.
- Add persistence and replay tests so agent runs, comments, approvals, and costs survive restarts cleanly.
- Add synthetic company fixtures that can exercise the full ecosystem repeatedly.

### 4.3 Self-Learning And Self-Improvement Program

- Capture failures, operator interventions, and successful resolutions as reusable learning artifacts.
- Turn eval failures into tracked issues with reproducible traces and suggested remediation.
- Build doc-drift detection so repo docs and host behavior cannot diverge for long.
- Add plugin health scoring, regression scoring, and capability confidence scoring.
- Feed run outcomes, review outcomes, and operator corrections back into product-autopilot and org-learning loops.
- Add automatic identification of recurring friction in onboarding, setup, and day-2 operations.
- Add controlled self-improvement loops that generate suggestions, experiments, migrations, and PRs, but still pass through quality gates and approvals.

## 5. Repo-By-Repo Integration Expectations

## 5.1 Core Host

### `paperclip`

Must become the authoritative runtime and UX for:

- company creation
- agent orchestration
- approvals
- costs and budgets
- tasks/issues/comments
- plugin discovery and plugin lifecycle
- integration testing and observability

Must be tested for:

- fresh install
- first-run onboarding
- first company creation
- agent creation and execution
- plugin install/enable/disable/update
- restart recovery
- multi-company isolation
- auth mode differences
- budget enforcement

### `uos-paperclip-compat`

Must define the compatibility contract and remove ambiguity around host coupling, API shape, shared models, version checks, and migration policy.

### `uos-core`

Must either power the ecosystem install/apply flows directly or be cleanly wrapped by Paperclip so the user experience is still simple.

## 5.2 Departments

Each department repo must be installable as an overlay that enriches company behavior, not as an isolated artifact with no host story.

- `uos-department-customer-service`: support queues, knowledge, escalation, omnichannel handling, and learning.
- `uos-department-finance-risk`: financial oversight, budget intelligence, accounting explanations, and risk controls.
- `uos-department-growth-revenue`: growth operating system, attribution, experiments, and revenue loops.
- `uos-department-operations`: operational excellence, freshness, runbooks, drift, and operations evidence.
- `uos-department-people`: hiring, staffing, org health, performance, onboarding, and role design.
- `uos-department-product-tech`: roadmap-to-launch delivery, readiness review, rollback readiness, and incident intelligence.
- `uos-department-social-media`: publishing, review, channel strategy, and governance.

## 5.3 Plugins

- `uos-plugin-setup-studio`: must provide a first-class setup experience that new users can complete without tribal knowledge.
- `uos-plugin-connectors`: must unify connector auth, policy, callbacks, and provider lifecycle.
- `uos-plugin-connectors-universal-connector-bus`: must be reconciled into the connector system and not remain a parallel conceptual fork.
- `uos-plugin-operations-cockpit`: must give the board operator real operational insight and not just raw internals.
- `uos-org-learning-plugin`: must make organizational learning persistent, searchable, actionable, and measurable.
- `uos-quality-gate`: must enforce high-quality completion and expose why work passed or failed.
- `uos-skills-catalog`: must support skill discovery, packaging, scoring, rollout, rollback, and compatibility.

## 5.4 Tools

- `paperclip-product-autopilot`: must close the loop from product signals to prioritized improvement work to verified delivery.
- `uos-tool-canonry-aeo-monitoring`: must generate actionable monitoring outputs and connect them to tasks.
- `uos-tool-droid-cli-companion`: must be safe, auditable, sandboxed, and predictable.
- `uos-tool-droid-cli-companion-safe-ai-command-e`: must be either implemented or removed from the live set.
- `uos-tool-ffmpeg-media-operations`: must have fixture-based media validation and deterministic output expectations.
- `uos-tool-opencli-automation-hub`: must route automation jobs correctly and expose why a route was selected.
- `uos-tool-tandem-browser-companion`: must support real authenticated browser reuse, handoff, and recovery under realistic sessions.
- `uos-tool-trawl-web-extraction`: must produce schema-valid, provenance-aware outputs and detect extraction drift.

## How It Should Be Tested

## 1. Install And Test `paperclip` First

The main Paperclip repo must be installed and validated before any ecosystem repo is integrated.

Baseline operator flow:

1. Clone and install `paperclip`.
2. Run `pnpm install`.
3. Run `pnpm dev`.
4. Verify `/api/health`.
5. Complete a new-user flow as an operator would:
   - create a company
   - create a CEO
   - create at least one subordinate agent
   - create goals, projects, and issues
   - run an agent heartbeat
   - observe outputs, activity, approvals, and costs
6. Run the baseline Paperclip verification suite:
   - `pnpm typecheck`
   - `pnpm test:run`
   - `pnpm build`
   - targeted `pnpm test:e2e`
   - targeted `pnpm test:release-smoke`

No plugin should be blamed for failures that already exist in the Paperclip baseline.

## 2. Test Every Repo One By One

Each ecosystem repo must then be tested in isolation against the Paperclip host:

1. Install or link the package into Paperclip.
2. Verify package discovery and metadata.
3. Verify configuration UI or configuration file flow.
4. Verify validation of bad config and missing secrets.
5. Run package-specific unit tests and typechecks in the package repo.
6. Run a Paperclip-host smoke flow that exercises the package as a real user would use it.
7. Verify created tasks, outputs, artifacts, approvals, logs, and learning signals.
8. Remove and reinstall the package to verify a clean lifecycle.

Every package should have a user-style acceptance script covering:

- happy path
- bad config path
- partial-failure path
- recovery path
- uninstall/disable path

## 3. Test The Combined Ecosystem

After one-by-one validation, test combined packages together.

Recommended combined suites:

1. Core platform suite:
   - `paperclip`
   - `uos-paperclip-compat`
   - `uos-core`
   - `uos-plugin-setup-studio`
   - `uos-plugin-connectors`
   - `uos-plugin-operations-cockpit`
   - `uos-quality-gate`
   - `uos-skills-catalog`

2. Operating company suite:
   - all department overlays
   - org learning
   - quality gate
   - product autopilot

3. Automation and tooling suite:
   - tandem browser
   - trawl extraction
   - opencli automation hub
   - droid CLI companion
   - ffmpeg media operations
   - canonry monitoring

4. Full ecosystem suite:
   - all non-empty live repos together

Combined tests must simulate a real operator journey:

- install a stack
- configure secrets/connectors
- create a company
- assign work
- trigger automated work
- review outputs
- handle failures
- restart services
- rerun work
- compare costs and quality
- confirm learning artifacts were captured

## 4. Test Like A User, Not Like A Maintainer

Every major feature must be tested from the perspective of:

- a first-time solo operator
- a returning operator resuming yesterday’s work
- an operator fixing a broken configuration
- an operator reviewing agent output under time pressure
- an operator deciding whether to trust autopilot/self-improvement suggestions

This means testing:

- UI flows, not only internal APIs
- copy and affordances, not only types
- empty states, loading states, and error states
- install and upgrade flows
- partial outages and confusing input
- result quality, not just process completion

## How It Should Be Debugged

Every repo and every integrated flow should be debuggable through a standard playbook:

1. Reproduce with a named scenario and fixture company.
2. Capture exact package versions and Paperclip host version.
3. Capture package config, secret state, and connector state.
4. Capture server logs, browser console logs, and package logs.
5. Capture issue comments, approvals, activity log, heartbeat runs, and cost events.
6. Capture generated artifacts and screenshots.
7. Reduce the failure to:
   - host-only
   - package-only
   - connector-only
   - configuration-only
   - data-specific
8. Add a regression test or replay fixture before closing the issue.

Required debugging infrastructure:

- scenario-based smoke runners
- fixture companies
- reproducible seed data
- standardized plugin health endpoints
- install diagnostics
- config validation diagnostics
- connector diagnostics
- browser trace capture
- extraction drift comparison reports
- evaluator result history
- run replay support

## Definition Of Done

This program is complete only when all of the following are true:

1. Every live repo has an explicit Paperclip integration story.
2. Every open PRD/PLAN/spec/codebase-review artifact has an owning execution path.
3. Paperclip can install and operate the ecosystem with clear UI and docs.
4. Each repo passes repo-local verification and Paperclip-host smoke verification.
5. The full ecosystem can be tested together in realistic user journeys.
6. Docs are current, navigable, and written for both operators and developers.
7. Failure handling, debugging, and rollback are documented and exercised.
8. Learning signals from failures and successes are captured and reused.
9. Empty, redundant, or structurally ambiguous repos are either implemented, merged, or archived.

## Immediate Execution Order

1. Stabilize `paperclip` baseline and finish open Paperclip plans.
2. Standardize ecosystem package metadata and compatibility via `uos-paperclip-compat`.
3. Make setup, connectors, cockpit, quality gate, and skills the core installable platform stack.
4. Integrate departments one by one.
5. Integrate tools one by one.
6. Add user-style acceptance suites and combined-system suites.
7. Close the learning/improvement loop so the ecosystem gets better from every run.

