# @paperclipai/plugin-autoresearch-improver-example

Autoresearch Improver is a first-party example Paperclip plugin that turns the Karpathy/Darwin-Derby pattern into a generic workspace optimizer for Paperclip projects:

- define the mutable surface
- keep the scorer fixed
- run trials under a fixed budget
- accept only strict improvements

## What it does

The plugin adds:

- a full plugin page with optimizer setup
- a project detail tab for project-scoped loops
- a dashboard widget with optimizer status
- an hourly sweep job for enabled auto-run optimizers

Each optimizer stores:

- objective
- mutable paths
- mutation command
- score command
- optional guardrail command
- score direction and parsing regex
- per-step budgets

At runtime the plugin:

1. measures the incumbent score if none exists yet
2. copies the selected workspace to a sandbox directory
3. writes `paperclip-optimizer-brief.json` into that sandbox
4. runs the mutation command in the sandbox
5. runs the score command and optional guardrail command
6. copies back only the allowed mutable paths if the score improved
7. records the run and can turn accepted runs into Paperclip issues

By default the score command is hidden from the mutation command, which follows the blind-scoring advice from Darwin Derby.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Inside the Paperclip monorepo this package uses `@paperclipai/plugin-sdk` via `workspace:*`.

## Example commands

Mutation command:

```bash
codex exec "Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only."
```

Score command:

```bash
pnpm test -- --runInBand && node -e "console.log('SCORE=1')"
```

Regex for score extraction:

```text
SCORE=([0-9.]+)
```

## Install into Paperclip

From the Paperclip repo:

```bash
pnpm --filter @paperclipai/plugin-autoresearch-improver-example build
pnpm paperclipai plugin install ./packages/plugins/examples/plugin-autoresearch-improver
```

## Verified surfaces

This example has been verified against a live Paperclip `0.3.1` deployment with:

- plugin install from a local path
- plugin health endpoint returning `status: ready`
- UI contribution discovery returning the page, dashboard widget, project tab, and project sidebar item
- container-side build and Vitest pass for the helper logic

## Notes

- This is a trusted local-workspace plugin. It executes shell commands in project workspaces.
- The sandbox is a copied workspace, but accepted changes are synced back only for the listed mutable paths.
- If you enable `keepTmpDirs`, sandbox workspaces are retained under the system temp directory for inspection.
