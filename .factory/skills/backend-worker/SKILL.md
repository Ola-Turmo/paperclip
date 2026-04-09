---
name: backend-worker
description: Implements complete Product Autopilot features with TDD, aggressive dependency recovery, orchestration checks, and browser verification.
---

# backend-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for Product Autopilot features that touch plugin entities, project/company-scoped API behavior, research/idea flows, budgets, convoy scheduling, workspace isolation, merge/release handling, digests, learner flows, or browser-visible plugin surfaces.

## Required Skills

- `agent-browser`: mandatory for any feature with browser-visible behavior, including project tabs, swipe flows, budgets, convoy views, workspaces, run views, release-health views, or navigation.
- `browser-debugger`: use when the browser flow does not behave as expected and deeper UI/network inspection is needed.

## Work Procedure

1. Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/user-testing.md`, and the assigned feature before changing anything.
2. Identify the exact company/project-scoped behavior the feature must complete, including every validation assertion listed in `fulfills`.
3. Add or update failing automated tests first for the required behavior. Prefer targeted server/plugin tests and include boundary coverage for cross-company access, locking/isolation, and recovery behavior when relevant.
4. If dependencies, generated artifacts, local services, or caches block progress, debug aggressively before giving up: inspect the failure output, run the repo-local install/build/generate flow, repair fixtures or generated files, clear only the minimum necessary caches, restart the failing local service, and verify the failure is actually resolved.
5. Implement the smallest safe change that makes the new tests pass while preserving Paperclip invariants.
6. Run the smallest relevant automated checks during iteration, then run the required commands from `.factory/services.yaml` before handoff.
7. For every browser-visible behavior, verify it end-to-end with `agent-browser`, capturing concrete actions, observed outcomes, and any console/network problems.
8. If the feature mutates navigation, settings, delivery state, convoy scheduling, workspace leasing, release health, or rollback behavior, verify the main happy path and at least one adjacent failure/isolation/recovery case.
9. Do not mark work complete if tests, typecheck, or required browser validation are missing.
10. If you had to repair dependency/setup issues to complete the feature, include the root cause, exact remediation steps, and any follow-up shared-state updates in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented convoy-task orchestration with dependency blocking, checkpoint persistence, and resume handling for delivery runs. Fixed a stale generated-schema issue by rebuilding the package before rerunning the new convoy tests, then verified the convoy graph and resumed run state in the browser.",
  "whatWasImplemented": "Added company/project-scoped convoy task scheduling and checkpoint-aware delivery-run state so approved ideas can decompose into dependent subtasks, block downstream work until prerequisites pass, and resume accurately after interruption without losing run metadata or leaking state across projects.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm install",
        "exitCode": 0,
        "observation": "Workspace dependencies matched the lockfile; no package drift remained."
      },
      {
        "command": "pnpm test -- --grep 'convoy'",
        "exitCode": 0,
        "observation": "Targeted convoy orchestration tests passed, including dependency blocking and resume behavior."
      },
      {
        "command": "pnpm -r typecheck",
        "exitCode": 0,
        "observation": "No TypeScript regressions in touched packages."
      },
      {
        "command": "curl -sf http://localhost:3100/api/companies/demo/projects/autopilot-demo/delivery-runs/run-123",
        "exitCode": 0,
        "observation": "Returned convoy task graph, checkpoint metadata, and current run status for the seeded run."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened the run detail page in agent-browser and inspected the convoy dependency graph before and after a prerequisite task completed.",
        "observed": "Blocked downstream tasks remained disabled until the prerequisite passed, then became runnable in the graph view."
      },
      {
        "action": "Triggered resume on a checkpointed run from the browser UI.",
        "observed": "The run resumed from the saved checkpoint instead of restarting, and prior workspace metadata remained attached to the run."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "server/autopilot/convoy-runs.test.ts",
        "cases": [
          {
            "name": "blocks downstream convoy tasks until prerequisites pass",
            "verifies": "dependency-aware execution ordering"
          },
          {
            "name": "resumes a checkpointed delivery run without losing workspace metadata",
            "verifies": "checkpoint/resume correctness"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A required plugin capability or Paperclip primitive is missing and the feature cannot proceed safely after reasonable debugging and recovery attempts
- The local validation path is broken in a way that cannot be fixed within the feature scope and the exact unresolved cause is identified
- The feature reveals a mission-level inconsistency between required assertions and the current shared architecture/guidance
