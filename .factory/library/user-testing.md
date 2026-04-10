# User Testing

## Validation Surface

Primary surfaces for this mission:

- **Browser UI**: Paperclip company and project pages, plugin tabs, swipe deck, dashboards, run details, convoy graphs, workspaces, costs, knowledge, release-health views, and operator actions.
- **API**: company/project-scoped endpoints backing onboarding, Product Program storage, research cycles, ideas, swipe decisions, planning artifacts, convoy tasks, delivery runs, workspaces, budgets, digests, pause/resume actions, release health, and rollback.

Required validation tools:

- `agent-browser` for browser-visible flows
- `curl` for direct API assertions

## Validation Readiness Assumptions

- The repo's documented local Paperclip dev flow can serve the UI and API from the existing dev server setup.
- The mission should validate against real local company/project records, not mocked browser pages.
- If local startup reveals a different active port or a combined API/UI topology, workers and validators must update this file and `.factory/services.yaml` before continuing.

## Validation Concurrency

### Browser UI

- Max concurrent validators: **2**
- Rationale: browser validation shares one local Paperclip dev stack, touches stateful project/company context, and now also exercises convoy, workspaces, and release-health surfaces. Keep concurrency conservative so evidence stays attributable and the single-node environment remains stable.

### API

- Max concurrent validators: **3**
- Rationale: API checks now include locking, workspace leasing, checkpoint/resume, digest generation, and rollback-sensitive mutations. Limit to three to reduce race-condition noise while still allowing parallel boundary checks.

## Required Coverage Focus

Validators should explicitly cover:

- project onboarding and Product Program revision history
- research-cycle creation and visible report output
- idea scoring, source references, duplicate handling, and maybe-pool resurfacing
- Pass/Maybe/Yes/Now review behaviors and preference-model changes
- planning artifacts, automation tiers, PR orchestration, and delivery-run visibility
- convoy task decomposition, dependency blocking, checkpoint/resume, and stuck-run recovery controls
- workspace leasing, branch/path/port visibility, merge coordination, and product locking behavior
- budget-pause, company-wide cap behavior, digests, pause/resume controls, and operator interventions
- release-health failure handling and rollback/revert behavior
- cross-company isolation through both UI navigation and direct API attempts

## Evidence Expectations

- Browser checks: screenshots plus notes about console errors and failed network requests
- API checks: raw HTTP response status/body summaries for boundary-sensitive assertions
- Concurrency/isolation checks: explicit evidence of blocked downstream tasks, denied conflicting leases, or preserved resumed state
- Cross-company checks: clear evidence of success in the allowed company and denial (`403`/`404`) in the disallowed company
- Release-health/rollback checks: evidence of alert state, created rollback work, or revert result visibility

## Plugin Installation for User Testing

The `autoresearch-improver` plugin (`@paperclipai/plugin-autoresearch-improver-example`) is a **local plugin** not published to npm. To install it for browser testing:

```bash
# Install via Paperclip API using local path
curl -X POST http://localhost:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "/root/work/paperclip/packages/plugins/examples/plugin-autoresearch-improver", "isLocalPath": true}'
```

The plugin manifest declares these UI slots for projects:
- `autopilot-project-tab` → Autopilot tab in project detail view
- `autopilot-project-link` → "Autopilot" link in project sidebar

After installation, navigate to any project → "Autopilot" tab to access the plugin UI.

**Note**: The Plugin Manager UI ("Install Plugin" button) only supports npm package names, not local file paths. Use the API directly as shown above.
