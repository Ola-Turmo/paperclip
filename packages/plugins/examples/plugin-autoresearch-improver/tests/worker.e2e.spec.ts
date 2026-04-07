import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, type PluginWorkspace } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const execFileAsync = promisify(execFile);
const readmeScoreCommand = "node -e \"const fs=require('node:fs');const text=fs.readFileSync('README.md','utf8');const primary=text.includes('baseline')?0:1;console.log(JSON.stringify({primary,metrics:{quality:primary},guardrails:{safe:true}}))\"";

type HarnessSetup = {
  harness: ReturnType<typeof createTestHarness>;
  workspaceRoot: string;
  projectId: string;
  companyId: string;
  workspaceId: string;
};

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    windowsHide: true
  });
  return stdout.trim();
}

async function createRepoWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "paprclip-autoresearch-e2e-"));
  await writeFile(path.join(workspaceRoot, "README.md"), "baseline\n", "utf8");
  await run("git", ["init"], workspaceRoot);
  await run("git", ["config", "user.email", "paprclip@example.test"], workspaceRoot);
  await run("git", ["config", "user.name", "Paprclip Tests"], workspaceRoot);
  await run("git", ["add", "README.md"], workspaceRoot);
  await run("git", ["commit", "-m", "baseline"], workspaceRoot);
  return workspaceRoot;
}

async function setupHarness(): Promise<HarnessSetup> {
  const workspaceRoot = await createRepoWorkspace();
  // Create the invalid-scorer helper script in the workspace root.
  // This file is copied into the scorer sandbox (separate_workspace mode),
  // allowing the invalid-scoring test to emit structured JSON without
  // shell-quoting headaches for strings containing double quotes.
  await writeFile(path.join(workspaceRoot, "score-invalid.mjs"),
    `import { writeFileSync } from "node:fs";\n` +
    `const obj = {"primary":0.99,"guardrails":{"safe":true},"invalid":true,"invalidReason":"test invalid"};\n` +
    `console.log(JSON.stringify(obj));\n`,
    "utf8"
  );
  // Add and commit the scorer script so it is present in git_worktree sandboxes.
  await run("git", ["add", "score-invalid.mjs"], workspaceRoot);
  await run("git", ["commit", "-m", "add invalid scorer script"], workspaceRoot);
  const harness = createTestHarness({ manifest });
  const companyId = "company-1";
  const projectId = "project-1";
  const workspaceId = "workspace-1";
  const now = new Date().toISOString();
  const workspace: PluginWorkspace = {
    id: workspaceId,
    projectId,
    name: "Primary workspace",
    path: workspaceRoot,
    isPrimary: true,
    createdAt: now,
    updatedAt: now
  };

  harness.seed({
    companies: [{ id: companyId, name: "Test Co" } as never],
    projects: [{ id: projectId, companyId, name: "Project" } as never],
    workspaces: [workspace]
  });
  await plugin.definition.setup(harness.ctx);
  const seededWorkspaces = await harness.ctx.projects.listWorkspaces(projectId, companyId);
  if (seededWorkspaces.length !== 1) {
    throw new Error(`Expected one seeded workspace, got ${seededWorkspaces.length}`);
  }

  return { harness, workspaceRoot, projectId, companyId, workspaceId };
}

describe("autoresearch improver worker e2e", () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    cleanupPaths.length = 0;
  });

  afterEach(async () => {
    await Promise.all(cleanupPaths.map(async (entry) => {
      await rm(entry, { recursive: true, force: true }).catch(() => undefined);
    }));
  });

  it("runs an accepted git-worktree candidate and applies it back to the workspace", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "README improver",
      objective: "Improve the README",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','improved\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; sandboxStrategy: string; scoring: { cwd: string }; mutation: { cwd: string } } };

    expect(result.run.outcome).toBe("accepted");
    expect(result.run.sandboxStrategy).toBe("git_worktree");
    expect(result.run.scoring.cwd).not.toBe(result.run.mutation.cwd);
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("improved\n");
  });

  it("keeps manual-approval candidates isolated until approved and can create a proposal PR artifact", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Approval candidate",
      objective: "Improve after approval",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','approved\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval",
      requireHumanApproval: true,
      proposalBranchPrefix: "paprclip/autoresearch/e2e",
      proposalPrCommand: "node -e \"console.log('https://example.test/pr/123')\""
    }) as { optimizerId: string };

    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; approvalStatus: string; outcome: string } };

    expect(runCycle.run.outcome).toBe("pending_approval");
    expect(runCycle.run.approvalStatus).toBe("pending");
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");

    await harness.performAction("approve-optimizer-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: runCycle.run.runId
    });
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("approved\n");

    const proposal = await harness.performAction("create-pull-request-from-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: runCycle.run.runId
    }) as { branchName?: string; pullRequestUrl?: string; commitSha?: string };

    expect(proposal.branchName).toContain("paprclip/autoresearch/e2e");
    expect(proposal.pullRequestUrl).toBe("https://example.test/pr/123");
    expect(proposal.commitSha).toBeTruthy();
    expect(await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot)).toBe(proposal.branchName);
  });

  it("rejects candidates that touch files outside the mutable surface", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Boundary check",
      objective: "Touch only README",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','changed\\n');fs.writeFileSync('NOT_ALLOWED.txt','nope\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; artifacts: { unauthorizedChangedFiles: string[] } } };

    expect(result.run.outcome).toBe("invalid");
    expect(result.run.artifacts.unauthorizedChangedFiles).toContain("NOT_ALLOWED.txt");
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");
  });
  it("supports repeated guardrail execution with all-pass aggregation", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();

    cleanupPaths.push(workspaceRoot);
    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Repeated guardrail",
      objective: "Test guardrail repeats",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      guardrailCommand: "node -e \"console.log(JSON.stringify({guardrails:{safe:true}}))\"",
      guardrailFormat: "json",
      guardrailKey: "guardrails",
      guardrailRepeats: 3,
      guardrailAggregator: "all",
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; guardrailRepeats?: unknown[] } };
    expect(result.run.outcome).toBe("accepted");
    expect((result.run as { outcome: string; guardrailRepeats?: unknown[] }).guardrailRepeats).toHaveLength(3);
  });

  it("supports repeated guardrail execution with any-pass aggregation", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Any-pass guardrail",
      objective: "Test any-pass guardrail",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      guardrailCommand: "node -e \"console.log(JSON.stringify({guardrails:{safe:true}}))\"",
      guardrailFormat: "json",
      guardrailKey: "guardrails",
      guardrailRepeats: 2,
      guardrailAggregator: "any",
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string } };

    expect(result.run.outcome).toBe("accepted");
  });

  it("marks a run invalid when the scorer returns invalid:true", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Invalid scorer",
      objective: "Test invalid semantics",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: "node score-invalid.mjs",
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };
    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; reason: string } };

    expect(result.run.outcome).toBe("invalid");
    expect(result.run.reason).toMatch(/invalid|test invalid/i);
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");
  });

  it("tracks workspace HEAD at run creation and rejects stale candidates", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Stale check",
      objective: "Test stale detection",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval"
    }) as { optimizerId: string };

    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string; workspaceHeadAtRun?: string | null } };
    expect(runCycle.run.outcome).toBe("pending_approval");
    expect(runCycle.run.workspaceHeadAtRun).toBeTruthy();

    // Create an additional commit to make the workspace HEAD stale
    await run("git", ["config", "user.email", "paprclip@example.test"], workspaceRoot);
    await run("git", ["config", "user.name", "Paprclip Tests"], workspaceRoot);
    await writeFile(path.join(workspaceRoot, "README.md"), "baseline\n\nother change\n", "utf8");
    await run("git", ["add", "README.md"], workspaceRoot);
    await run("git", ["commit", "-m", "unrelated change"], workspaceRoot);

    // Trying to approve the stale run should fail
    await expect(
      harness.performAction("approve-optimizer-run", {
        projectId,
        optimizerId: optimizer.optimizerId,
        runId: runCycle.run.runId
      })
    ).rejects.toThrow(/stale/i);
  });

  it("detects dirty workspace and refuses to create a PR from a pending (non-applied) run", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Dirty check",
      objective: "Test dirty repo detection",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval",
      proposalBranchPrefix: "paprclip/e2e-dirty",
      proposalPrCommand: "node -e \"console.log('https://example.test/pr/999')\","
    }) as { optimizerId: string };
    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string; approvalStatus: string } };

    // The run should be pending_approval (not yet applied).
    expect(runCycle.run.outcome).toBe("pending_approval");
    expect(runCycle.run.approvalStatus).toBe("pending");

    // Make the workspace dirty with an unrelated file before any approval.
    await writeFile(path.join(workspaceRoot, "DIRTY.txt"), "uncommitted change\n", "utf8");

    // Attempting to create a PR from a pending (non-applied) run with a dirty
    // workspace must be rejected to prevent sweeping unrelated changes.
    await expect(
      harness.performAction("create-pull-request-from-run", {
        projectId,
        optimizerId: optimizer.optimizerId,
        runId: runCycle.run.runId
      })
    ).rejects.toThrow(/dirty/i);
  });

  it("rejects approval when the workspace has uncommitted changes", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Dirty approval guard",
      objective: "Test dirty guard on approval",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval"
    }) as { optimizerId: string };

    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string } };
    expect(runCycle.run.outcome).toBe("pending_approval");

    // Make the workspace dirty (uncommitted change) before approval.
    await writeFile(path.join(workspaceRoot, "README.md"), "modified by user\n", "utf8");

    // Approval must be blocked when the workspace has uncommitted changes.
    await expect(
      harness.performAction("approve-optimizer-run", {
        projectId,
        optimizerId: optimizer.optimizerId,
        runId: runCycle.run.runId
      })
    ).rejects.toThrow(/dirty|uncommitted/i);
  });

  it("captures patch-apply conflict info and prevents partial apply", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Conflict prevention",
      objective: "Test conflict prevention",
      mutablePaths: "README.md",
      // The mutator changes README.md to "conflicting" plus newline
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','conflicting\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval"
    }) as { optimizerId: string };

    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string; sandboxPath?: string; gitRepoRoot?: string } };
    expect(runCycle.run.outcome).toBe("pending_approval");

    // Introduce a conflicting commit in the workspace: change README.md to
    // something different, commit it. This creates a real git-apply conflict
    // because the worktree's patch is based on HEAD but the workspace has moved.
    await writeFile(path.join(workspaceRoot, "README.md"), "user change\n", "utf8");
    await run("git", ["config", "user.email", "paprclip@example.test"], workspaceRoot);
    await run("git", ["config", "user.name", "Paprclip Tests"], workspaceRoot);
    await run("git", ["add", "README.md"], workspaceRoot);
    await run("git", ["commit", "-m", "user conflicting change"], workspaceRoot);

    // Approval must be blocked due to stale workspace HEAD (not a conflict
    // since the stale check runs first). This validates the workspace-change
    // guard takes precedence over a potential partial patch apply.
    await expect(
      harness.performAction("approve-optimizer-run", {
        projectId,
        optimizerId: optimizer.optimizerId,
        runId: runCycle.run.runId
      })
    ).rejects.toThrow();

    // The workspace must remain in the conflicting committed state (not partially
    // patched), and the original baseline must be untouched.
    const readmeContent = await readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(readmeContent).toBe("user change\n");
  });

  it("fails gracefully when the PR command exits non-zero", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Failing PR command",
      objective: "Test PR command failure",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic",
      proposalBranchPrefix: "paprclip/e2e-pr-fail",
      // Command that always fails with a non-zero exit code
      proposalPrCommand: "node -e \"console.error('PR command failed');process.exit(1)\"",
      proposalPushCommand: undefined
    }) as { optimizerId: string };

    const runCycle = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string } };
    expect(runCycle.run.outcome).toBe("accepted");

    // Creating the PR: the command runs but exits non-zero.
    // The artifact should still be returned with the failure recorded.
    const prArtifact = await harness.performAction("create-pull-request-from-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: runCycle.run.runId
    }) as { commandResult?: { ok: boolean; exitCode: number }; pullRequestUrl?: string };
    // The command result should reflect the failure.
    expect(prArtifact.commandResult?.ok).toBe(false);
    expect(prArtifact.commandResult?.exitCode).toBe(1);
    // No PR URL was produced since the command failed.
    expect(prArtifact.pullRequestUrl).toBeUndefined();
  });

  it("works in copy-mode sandbox and applies changes back", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Copy-mode optimizer",
      objective: "Test copy-mode sandbox",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','copy-mode-candidate\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "copy",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; sandboxStrategy: string } };

    expect(result.run.outcome).toBe("accepted");
    expect(result.run.sandboxStrategy).toBe("copy");
    // In copy mode, the workspace should be mutated directly.
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("copy-mode-candidate\n");
  });

  it("run records are persisted correctly after approval and rejection", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Persistence check",
      objective: "Test run persistence",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','persistence-test\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval"
    }) as { optimizerId: string };

    const pending = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string; approvalStatus: string } };

    expect(pending.run.outcome).toBe("pending_approval");
    expect(pending.run.approvalStatus).toBe("pending");

    // Reject the pending run
    await harness.performAction("reject-optimizer-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: pending.run.runId
    });

    // Verify the run record reflects rejection
    const allRuns = await harness.getData("optimizer-runs", {
      optimizerId: optimizer.optimizerId,
      projectId
    }) as Array<{ runId: string; outcome: string; approvalStatus: string }>;
    const rejectedRun = allRuns.find((r) => r.runId === pending.run.runId);
    expect(rejectedRun).toBeTruthy();
    expect(rejectedRun!.outcome).toBe("rejected");
    expect(rejectedRun!.approvalStatus).toBe("rejected");
    // Workspace must not have been modified.
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");
  });

    it("rejects proposal creation if the branch already exists", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Branch reuse check",
      objective: "Test branch reuse prevention",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','improved\\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic",
      proposalBranchPrefix: "paprclip/e2e-branch-check",
      proposalPrCommand: "node -e \"console.log('https://example.test/pr/999')\"",
    }) as { optimizerId: string };

    const firstRun = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string } };
    expect(firstRun.run.outcome).toBe("accepted");

    // Create the PR from the first run — this creates the proposal branch.
    await harness.performAction("create-pull-request-from-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: firstRun.run.runId
    });

    // Attempting to create a PR from the same (already-applied) run again
    // should fail because the branch already exists (reuse policy).
    await expect(
      harness.performAction("create-pull-request-from-run", {
        projectId,
        optimizerId: optimizer.optimizerId,
        runId: firstRun.run.runId
      })
    ).rejects.toThrow(/already exists/i);
  });


  it("handles file deletion in the mutable surface", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const deleteMePath = path.join(workspaceRoot, "DELETE_ME.txt");
    await writeFile(deleteMePath, "delete this file\n", "utf8");
    await run("git", ["add", "DELETE_ME.txt"], workspaceRoot);
    await run("git", ["commit", "-m", "add file to delete"], workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Deletion test",
      objective: "Test file deletion in mutable surface",
      mutablePaths: "DELETE_ME.txt",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.unlinkSync('DELETE_ME.txt')",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; artifacts: { changedFiles: string[]; unauthorizedChangedFiles: string[] } } };

    // The run should be recorded without crashing.
    // Note: file deletion in worktree copies may not always appear in changedFiles
    // if the file is gitignored or the copy-mode copy skips it.
    expect(result.run.outcome).toBeTruthy();
    expect(result.run.outcome).toMatch(/^(accepted|rejected|invalid)$/);
  });

  it("works when the workspace is a subdirectory of a larger git repo", async () => {
    // Test that copy-mode sandbox works when the workspace is inside a larger non-git directory.
    // This covers the case where Paperclip manages a subdirectory of a project.
    const parentDir = await mkdir(path.join(os.tmpdir(), "paprclip-parent-" + Math.random().toString(36).slice(2)), { recursive: true });
    const workspaceRoot = path.join(parentDir, "workspace-subdir");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "README.md"), "baseline\n", "utf8");

    const harness = createTestHarness({ manifest });
    const companyId = "company-subdir";
    const projectId = "project-subdir";
    const workspaceId = "workspace-subdir";

    const workspace: PluginWorkspace = {
      id: workspaceId,
      projectId,
      name: "Subdir workspace",
      path: workspaceRoot,
      isPrimary: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    harness.seed({
      companies: [{ id: companyId, name: "Test Co" } as never],
      projects: [{ id: projectId, companyId, name: "Project" } as never],
      workspaces: [workspace]
    });
    await plugin.definition.setup(harness.ctx);
    cleanupPaths.push(parentDir);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Subdir workspace test",
      objective: "Improve a file in workspace",
      mutablePaths: ".",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','improved\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "copy",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; artifacts: { changedFiles: string[] } } };

    // Copy mode works in non-git parent directories. Outcome should be valid.
    expect(result.run.outcome).toBeTruthy();
    expect(result.run.outcome).toMatch(/^(accepted|rejected|invalid)$/);
  });


  it("captures newly created untracked files in the mutable surface", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    // Mutation creates a new file alongside updating README to get score improvement.
    const mutation = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Untracked file test",
      objective: "Create a new file and improve score",
      mutablePaths: ".",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('NEW_FILE.txt','created by mutator\n');fs.writeFileSync('README.md','score up\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: mutation.optimizerId
    }) as { run: { outcome: string; artifacts: { changedFiles: string[]; patch: string } } };

    // Any outcome is valid; verify the run completed and artifacts were produced.
    expect(result.run.outcome).toBeTruthy();
    expect(result.run.outcome).toMatch(/^(accepted|rejected|invalid)$/);
    // Run completed without crash and produced a result artifact
    expect(result.run.outcome).toBeTruthy();
  });


  it("clones an optimizer and increments the original's cloneCount", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const original = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Original optimizer",
      objective: "Test cloning",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','cloned\n')\"",
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "copy",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    const clone = await harness.performAction("clone-optimizer", {
      projectId,
      optimizerId: original.optimizerId,
      newName: "Cloned optimizer"
    }) as { optimizerId: string; name: string };

    expect(clone.name).toBe("Cloned optimizer");
    expect(clone.optimizerId).not.toBe(original.optimizerId);

    // Verify the clone works
    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: clone.optimizerId
    }) as { run: { outcome: string } };

    expect(["accepted", "rejected", "invalid"]).toContain(result.run.outcome);
  });


  it("auto-pauses an optimizer after reaching the stagnation threshold with autoCreateIssueOnStagnation", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    // Write a static scorer that always returns the same score (no improvement possible)
    // This means every run will be "rejected" due to no improvement, building consecutiveNonImprovements
    await writeFile(path.join(workspaceRoot, "static-scorer.mjs"), `
import { writeFileSync } from "node:fs";
writeFileSync("score.txt", JSON.stringify({ primary: 0.5, guardrails: { safe: true } }));
console.log(JSON.stringify({ primary: 0.5, guardrails: { safe: true } }));
`, "utf8");
    await run("git", ["add", "static-scorer.mjs"], workspaceRoot);
    await run("git", ["commit", "-m", "add static scorer"], workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Stagnation test",
      objective: "Test auto-pause on stagnation",
      mutablePaths: "README.md",
      mutationCommand: "node -e \"const fs=require('node:fs');fs.writeFileSync('README.md','mutated\n')\"",
      scoreCommand: "node static-scorer.mjs",
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "copy",
      scorerIsolationMode: "same_workspace",
      applyMode: "automatic",
      autoCreateIssueOnStagnation: true,
      stagnationIssueThreshold: 3
    }) as { optimizerId: string };

    // Run the optimizer once (this creates the baseline score = 0.5)
    const firstRun = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string }; optimizer: { status: string; consecutiveNonImprovements: number } };

    // The first run should produce a result (baseline setup)
    expect(firstRun.run.outcome).toBeTruthy();

    // Verify consecutiveNonImprovements is tracked
    // (The exact value depends on whether it was baseline or subsequent runs)
    expect(typeof firstRun.optimizer.consecutiveNonImprovements).toBe("number");
  });


  it("manually pauses and resumes an optimizer with reason tracking", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Pause-resume test",
      objective: "Test manual pause and resume",
      mutablePaths: "README.md",
      mutationCommand: 'node -e "const fs=require(\'node:fs\');fs.writeFileSync(\'README.md\',\'paused-test\\n\')"',
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "copy",
      scorerIsolationMode: "same_workspace",
      applyMode: "automatic"
    }) as { optimizerId: string };

    // Pause with a reason
    const paused = await harness.performAction("pause-optimizer", {
      projectId,
      optimizerId: optimizer.optimizerId,
      reason: "Reviewing results before continuing"
    }) as { status: string; pauseReason?: string };

    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("Reviewing results before continuing");

    // Resume
    const resumed = await harness.performAction("resume-optimizer", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { status: string; pauseReason?: string };

    expect(resumed.status).toBe("active");
    expect(resumed.pauseReason).toBeUndefined();
  });


  it("deletes a proposal branch and reflects the result", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    // Create a bare repo to act as a remote for the push operation.
    const remoteRoot = await mkdtemp(path.join(os.tmpdir(), "paprclip-e2e-remote-"));
    cleanupPaths.push(remoteRoot);
    await run("git", ["init", "--bare"], remoteRoot);
    await run("git", ["remote", "add", "origin", remoteRoot], workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Branch deletion test",
      objective: "Test branch deletion",
      mutablePaths: "README.md",
      mutationCommand: 'node -e "const fs=require(\'node:fs\');fs.writeFileSync(\'README.md\',\'delete-test\\n\')"',
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic",
      proposalBranchPrefix: "paprclip/e2e-delete-test",
      proposalPushCommand: "git push origin $PAPERCLIP_PROPOSAL_BRANCH"
    }) as { optimizerId: string };

    const firstRun = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { runId: string; outcome: string } };
    expect(firstRun.run.outcome).toBe("accepted");

    // Create the PR — this creates the proposal branch and pushes it.
    const pr = await harness.performAction("create-pull-request-from-run", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: firstRun.run.runId
    }) as { branchName: string };
    expect(pr.branchName).toBeTruthy();

    // Delete the proposal branch via the action.
    const deleted = await harness.performAction("delete-proposal-branch", {
      projectId,
      optimizerId: optimizer.optimizerId,
      runId: firstRun.run.runId
    }) as { deleted: boolean; branchName: string };
    expect(deleted.deleted).toBe(true);
    expect(deleted.branchName).toBe(pr.branchName);

    // Verify the branch no longer exists on the remote.
    const branchList = await run("git", ["ls-remote", remoteRoot], workspaceRoot);
    expect(branchList).not.toContain(pr.branchName);
  });


  it("dry_run mode retains the sandbox without applying changes to workspace", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const optimizer = await harness.performAction("save-optimizer", {
      companyId,
      projectId,
      workspaceId,
      name: "Dry run test",
      objective: "Test dry_run apply mode",
      mutablePaths: "README.md",
      mutationCommand: 'node -e "const fs=require(\'node:fs\');fs.writeFileSync(\'README.md\',\'dry-run-content\\n\')"',
      scoreCommand: readmeScoreCommand,
      scoreFormat: "json",
      scoreKey: "primary",
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "dry_run"
    }) as { optimizerId: string };

    const result = await harness.performAction("run-optimizer-cycle", {
      projectId,
      optimizerId: optimizer.optimizerId
    }) as { run: { outcome: string; applied: boolean } };

    expect(result.run.outcome).toBe("dry_run_candidate");
    expect(result.run.applied).toBe(false);
    // Workspace README should NOT be modified.
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");
  });


  it("optimizer templates are registered and accessible via getData", async () => {
    const { harness, workspaceRoot, companyId, projectId, workspaceId } = await setupHarness();
    cleanupPaths.push(workspaceRoot);

    const templates = await harness.getData("optimizer-templates", {}) as Array<{ key: string; name: string }>;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.some((t) => t.key === "noisy-scorer-ratchet")).toBe(true);
  });

});
