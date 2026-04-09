# Validation Contract

## Area: Onboarding and Product Program

### VAL-AUTOPILOT-001: Enable autopilot for a project
An operator can enable Product Autopilot on a Paperclip project, save the project's automation tier and budget settings, and reopen the same project with those settings preserved.
Tool: agent-browser
Evidence: screenshot, network(POST/PUT project autopilot -> 200), screenshot(reloaded settings), console-errors

### VAL-AUTOPILOT-002: Create and edit Product Program revisions
An operator can create an initial Product Program, edit it, and see a new revision added to the same company/project history.
Tool: agent-browser
Evidence: screenshot(editor), network(POST program revision -> 200), screenshot(history updated)

### VAL-AUTOPILOT-003: Program content is versioned and recoverable
Reloading the project page preserves the latest Product Program revision and exposes prior revisions for the same project.
Tool: agent-browser
Evidence: screenshot(before reload), screenshot(after reload), console-errors

## Area: Research and Idea Generation

### VAL-AUTOPILOT-010: Run research on demand
An operator can trigger a research cycle from the project surface and receive a completed research report with attributable evidence links.
Tool: agent-browser
Evidence: screenshot(started cycle), network(POST research cycle -> 200), screenshot(report detail)

### VAL-AUTOPILOT-011: Generate scored ideas from research
A completed research cycle produces ideas that display ranking information, rationale, and source references in the ideas list.
Tool: agent-browser
Evidence: screenshot(ideas list), network(GET ideas -> 200), console-errors

### VAL-AUTOPILOT-012: Deduplicate near-identical ideas
Submitting or generating a new idea candidate that closely matches an existing pending or maybe-pooled idea is suppressed or clearly annotated as a duplicate instead of silently creating a second indistinguishable idea.
Tool: agent-browser
Evidence: screenshot(duplicate handling), network(POST idea candidate -> 200/409), console-errors

## Area: Swipe Review and Learning

### VAL-AUTOPILOT-020: Swipe Pass records rejection
Swiping Pass on an idea records the rejection and removes that idea from the active swipe queue.
Tool: agent-browser
Evidence: screenshot(before pass), network(POST swipe pass -> 200), screenshot(queue updated)

### VAL-AUTOPILOT-021: Swipe Maybe sends idea to resurfacing queue
Swiping Maybe moves the idea into the maybe pool and preserves it for later resurfacing without creating duplicates.
Tool: agent-browser
Evidence: screenshot(maybe action), network(POST swipe maybe -> 200), screenshot(maybe pool)

### VAL-AUTOPILOT-022: Swipe Yes or Now creates downstream delivery work
Swiping Yes or Now creates planning or delivery work inside Paperclip and the created work is visible from the project context.
Tool: agent-browser
Evidence: screenshot(created work item), network(POST swipe yes/now -> 200), console-errors

### VAL-AUTOPILOT-023: Preference model updates from swipe history
After a mix of Pass, Maybe, Yes, and Now decisions, the preference profile changes and later idea ordering reflects those decisions.
Tool: agent-browser
Evidence: screenshot(before ordering), screenshot(after ordering), network(GET preference profile -> 200)

## Area: Delivery, Automation, and Run Control

### VAL-AUTOPILOT-030: Planning flow is created for approved ideas
A Yes or Now idea produces a planning artifact that summarizes scope, dependencies, tests, and recommended execution mode.
Tool: agent-browser
Evidence: screenshot(planning artifact), network(GET planning artifact -> 200)

### VAL-AUTOPILOT-031: Automation tiers enforce the configured approval path
Supervised, Semi-Auto, and Full Auto projects each follow their configured approval and merge behavior for approved ideas.
Tool: agent-browser
Evidence: screenshot(tier setting), screenshot(run outcome), network(GET delivery run -> 200)

### VAL-AUTOPILOT-032: Delivery run uses an isolated workspace and leased port
Starting a delivery run allocates an isolated workspace or worktree and shows the run's branch, workspace path, and leased port metadata in the UI.
Tool: agent-browser
Evidence: screenshot(run metadata), network(POST delivery run -> 200), console-errors

### VAL-AUTOPILOT-033: Budget caps pause future runs
When a project budget cap or company-wide autopilot cap is exceeded, future autopilot work is paused and the UI clearly shows the pause reason.
Tool: agent-browser
Evidence: screenshot(budget paused), network(GET cost status -> 200)

### VAL-AUTOPILOT-034: Operator can pause and resume autopilot or a specific run
An operator can pause and later resume autopilot for a project or a specific delivery run without losing existing program, idea, or run state.
Tool: agent-browser
Evidence: screenshot(paused state), network(POST pause/resume -> 200), screenshot(resumed state)

### VAL-AUTOPILOT-035: Convoy execution blocks downstream tasks until dependencies pass
A complex approved idea can run in convoy mode, with downstream tasks remaining blocked until prerequisite tasks complete successfully.
Tool: agent-browser
Evidence: screenshot(convoy graph blocked), screenshot(convoy graph unblocked), network(GET convoy tasks -> 200)

### VAL-AUTOPILOT-036: Checkpoint and resume restore run state
After a run is checkpointed or interrupted, resuming it restores the saved task, workspace, and progress state instead of restarting from scratch.
Tool: agent-browser
Evidence: screenshot(before resume), screenshot(after resume), network(GET resumed run -> 200)

### VAL-AUTOPILOT-037: Merge coordination prevents conflicting run completion
When multiple delivery runs target overlapping branches or merge paths, merge coordination prevents conflicting completion and surfaces the blocking reason.
Tool: agent-browser
Evidence: screenshot(merge blocked), network(POST merge/complete -> 200/409), console-errors

### VAL-AUTOPILOT-038: Operator interventions are available during active runs
During an active run, an operator can add notes, request checkpoints, nudge execution, or inspect linked issue/comment context from the UI.
Tool: agent-browser
Evidence: screenshot(intervention controls), network(POST intervention -> 200), screenshot(updated run state)

### VAL-AUTOPILOT-039: Learner summaries and reusable knowledge are generated after runs
After a delivery run completes, the system records a learner summary and exposes reusable project-scoped knowledge for later runs.
Tool: agent-browser
Evidence: screenshot(learner summary), network(GET knowledge entries -> 200)

### VAL-AUTOPILOT-040: Digests and alerts are generated for recurring autopilot conditions
The system can produce scheduled or triggered digests for opportunities, budget alerts, or stuck-run escalation, and these outputs are visible from the relevant company or project surfaces.
Tool: agent-browser
Evidence: screenshot(digest view), network(GET digests -> 200)

### VAL-AUTOPILOT-041: Release-health failures trigger rollback or revert handling
After a merged delivery run fails its configured release-health checks, the system surfaces the failure and creates or performs the configured rollback or revert path.
Tool: agent-browser
Evidence: screenshot(release-health failure), screenshot(rollback or revert result), network(GET release health -> 200)

## Cross-Area Flows

### VAL-CROSS-001: End-to-end product loop is reachable from project navigation
A user can reach the autopilot surfaces through Paperclip project navigation, run research, swipe an idea, and see the resulting delivery work without leaving the project context.
Tool: agent-browser
Evidence: screenshot(navigation), screenshot(research), screenshot(swipe), screenshot(created work)

### VAL-CROSS-002: Company isolation is preserved across autopilot data
A user in one company cannot see another company's Product Program, research, ideas, delivery runs, knowledge, or digests through either the UI or direct API access.
Tool: agent-browser
Evidence: screenshot(company A), screenshot(company B), network(403/404 on cross-company access), console-errors
