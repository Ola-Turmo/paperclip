import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
