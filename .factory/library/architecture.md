# Architecture

High-level system model for the Product Autopilot mission.

**What belongs here:** major components, boundaries, core entities, orchestration flows, and invariants workers must preserve.
**What does not belong here:** low-level code-path notes, exact schema definitions, or step-by-step implementation instructions.

---

## System Shape

Product Autopilot is a Paperclip plugin that extends the existing Paperclip control plane with a complete product-native autonomous improvement loop.
Paperclip still owns companies, projects, issues, approvals, costs, routines, adapters, and the main UI shell. The plugin adds project-scoped product configuration, research, ideation, swipe decisions, planning, convoy execution, delivery orchestration, release monitoring, rollback, reusable learning, and digests.

## Primary Components

- **Paperclip core**
  - Company/project boundaries
  - Issue and approval workflows
  - Cost tracking and governance controls
  - Routines/jobs host
  - Adapter-driven agent execution
  - Shared UI shell and project/company navigation

- **Product Autopilot plugin worker**
  - Product onboarding and settings management
  - Product Program revisions and preference state
  - Research-cycle orchestration and report persistence
  - Idea generation, ranking, deduplication, and maybe-pool resurfacing
  - Swipe decision handling and downstream work creation
  - Planning, delivery-run orchestration, convoy dependency scheduling, and checkpoint/resume state
  - Workspace leasing, product locks, port allocation, merge coordination, and run recovery
  - Budget checks, digests, pause/resume logic, learner summaries, skill extraction, and rollback/release monitoring

- **Product Autopilot plugin UI**
  - Project-level tabs for overview, program, ideas, swipe, research, runs, costs, knowledge, and workspaces
  - Company-level health and listing surfaces
  - Deep links from existing Paperclip project/company navigation
  - Operator controls for interrupts, nudges, pause/resume, checkpoint requests, and latest-run inspection

- **Workspace/execution layer**
  - Isolated workspaces or worktrees for approved delivery runs
  - Per-run branch/path/port metadata
  - Dependency-aware convoy task execution and join behavior
  - Merge queue / merge coordination and post-merge release-health monitoring

## Core Entity Model

Workers should preserve this conceptual model even if implementation details differ:

- `autopilot_project`: enablement, automation tier, budget policy, schedules, agent assignments, pause state
- `product_program_revision`: versioned product program content per company/project
- `research_cycle` and `research_finding`: attributable research runs and evidence-backed findings
- `idea`: scored, deduplicated product opportunities tied to research context
- `swipe_event` and `preference_profile`: review decisions and learned ranking preferences
- `delivery_run`: approved execution flow with planning, convoy mode, workspace, PR, merge, release health, and cost state
- `convoy_task`: dependency-aware subtask execution model for complex work
- `workspace_lease`: isolated execution metadata, branch, path, port, and lock state
- `knowledge_entry`: reusable project-scoped lessons, procedures, and extracted skills
- `digest_event`: recurring summaries, alerts, and escalations

## Main Data Flow

1. An operator enables Product Autopilot for a Paperclip project.
2. The plugin stores project-scoped settings and a versioned Product Program.
3. A scheduled or manual research cycle gathers product and market evidence.
4. Idea generation reads the Product Program, research findings, and the preference profile.
5. The operator reviews ideas with Pass/Maybe/Yes/Now decisions.
6. Approved ideas create planning artifacts and delivery runs.
7. Delivery runs choose simple or convoy execution, allocate isolated workspaces, lease ports, and dispatch build/test/review/PR work via Paperclip-supported agents.
8. Convoy tasks respect dependency ordering, checkpoint/resume state, merge coordination, and operator interventions.
9. After PR merge, release-health checks run and optionally trigger rollback flows.
10. The plugin records run costs, digest events, outcomes, and reusable knowledge/skills for future cycles.

## Invariants

- Every plugin-owned record is scoped by both `companyId` and `projectId` unless it is strictly company-wide metadata.
- No Product Autopilot data may leak across company boundaries through UI, API, job execution, digests, or learned knowledge.
- Human approval and Paperclip governance rules remain authoritative for governed actions.
- Budget caps can pause future autopilot work automatically and that paused state must be visible in the UI.
- Browser-visible autopilot surfaces must clearly show current company/project context and current automation tier.
- Delivery runs must never share workspace, branch, or leased port state in a way that breaks run isolation.
- Convoy execution must block downstream tasks until prerequisites have passed or been explicitly cancelled.
- Resume and recovery behavior must preserve accurate run state instead of replaying stale or cross-run context.
- Release-health failures must produce visible alerts and configured rollback or revert behavior.

## Boundary Notes

- Product Autopilot must not introduce a second external control plane or a parallel Autensa deployment.
- The plugin should prefer existing Paperclip primitives before inventing new workflow systems, but must still deliver the complete PRD scope in this mission.
- No functionality should be intentionally left as a “later phase” for this mission; architecture and feature planning should assume all described capabilities are delivered now.
