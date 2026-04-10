import { exec, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEntityRecord,
  type PluginHealthDiagnostics,
  type PluginJobContext,
  type ToolResult
} from "@paperclipai/plugin-sdk";
import {
  ACTION_KEYS,
  DATA_KEYS,
  DEFAULTS,
  ENTITY_TYPES,
  JOB_KEYS,
  PLUGIN_ID,
  TOOL_KEYS
} from "./constants.js";
import {
  aggregateGuardrailResults,
  aggregateStructuredMetrics,
  buildOptimizerBrief,
  clampNonNegativeNumber,
  clampPositiveInteger,
  compareScores,
  compareScoresWithPolicy,
  computePolicySuggestion,
  computeStdDev,
  emptyDiffArtifact,
  extractScore,
  extractStructuredMetricResult,
  formatCommandSummary,
  normalizeDotPath,
  normalizeMutablePaths,
  normalizeRelativePath,
  summarizeOutput
} from "./lib/optimizer.js";
import {
  ACTION_KEYS as AUTOPILOT_ACTION_KEYS,
  DATA_KEYS as AUTOPILOT_DATA_KEYS,
  ENTITY_TYPES as AUTOPILOT_ENTITY_TYPES,
  type AutopilotProject,
  type ProductProgramRevision,
  type AutomationTier,
  type ResearchCycle,
  type ResearchFinding,
  type Idea,
  type SwipeEvent,
  type PreferenceProfile,
  type IdeaStatus,
  type PlanningArtifact,
  type DeliveryRun,
  type WorkspaceLease,
  type CompanyBudget,
  type ProductLock,
} from "./autopilot/constants.js";
import {
  asIdea,
  asSwipeEvent,
  asPreferenceProfile,
  asResearchCycle,
  asResearchFinding,
  asPlanningArtifact,
  asDeliveryRun,
  asWorkspaceLease,
  asCompanyBudget,
  isValidSwipeDecision,
  upsertIdea,
  upsertSwipeEvent,
  upsertPreferenceProfile,
  findPreferenceProfile,
  upsertResearchCycle,
  findResearchCycle,
  listResearchCycleEntities,
  upsertResearchFinding,
  listResearchFindingEntities,
  listIdeaEntities,
  findIdeaById,
  findDuplicateIdea,
  listSwipeEventEntities,
  upsertPlanningArtifact,
  findPlanningArtifact,
  listPlanningArtifactEntities,
  findDeliveryRun,
  listDeliveryRunEntities,
  upsertDeliveryRun,
  findWorkspaceLease,
  listWorkspaceLeaseEntities,
  upsertWorkspaceLease,
  findCompanyBudget,
  listCompanyBudgetEntities,
  upsertCompanyBudget,
  asProductLock,
  upsertProductLock,
  findProductLock,
  listProductLockEntities,
  findActiveProductLock,
  findBlockingLock,
} from "./autopilot/helpers.js";
import type {
  ApplyMode,
  CommandExecutionResult,
  ConfigChangeRecord,
  OptimizerDefinition,
  OptimizerRunRecord,
  OptimizerTemplate,
  OverviewData,
  PatchConflictInfo,
  PluginConfigValues,
  PullRequestArtifact,
  RunDiffArtifact,
  RunOutcome,
  SandboxStrategy,
  ScoreAggregator,
  ScoreDirection,
  ScoreFormat,
  ScorerIsolationMode,
  StructuredMetricResult
} from "./types.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const runningOptimizers = new Set<string>();
let currentContext: PluginContext | null = null;

type GitWorkspaceContext = {
  repoRoot: string;
  workspaceRelativePath: string;
};

type SandboxContext = {
  strategy: SandboxStrategy;
  sandboxRoot: string;
  workspacePath: string;
  cleanup: () => Promise<void>;
  git?: GitWorkspaceContext;
};

type ScorerContext = {
  isolationMode: ScorerIsolationMode;
  sandboxRoot: string;
  workspacePath: string;
  cleanup: () => Promise<void>;
};

type GitDiffContext = {
  git: GitWorkspaceContext;
  sandboxRoot: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isValidCompanyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidAutopilotId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAutomationTier(value: unknown): value is AutomationTier {
  return value === "supervised" || value === "semiauto" || value === "fullauto";
}

function parseAutomationTier(value: unknown, fallback: AutomationTier = "supervised"): AutomationTier {
  return isAutomationTier(value) ? value : fallback;
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asAutopilotProject(record: PluginEntityRecord): AutopilotProject {
  return record.data as unknown as AutopilotProject;
}

function asProductProgramRevision(record: PluginEntityRecord): ProductProgramRevision {
  return record.data as unknown as ProductProgramRevision;
}

async function findAutopilotProject(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: AUTOPILOT_ENTITY_TYPES.autopilotProject,
    scopeKind: "project",
    scopeId: projectId,
    limit: 10,
    offset: 0,
  });
  return entities.find((e) => {
    const data = e.data as unknown as AutopilotProject;
    return data.companyId === companyId && data.projectId === projectId;
  }) ?? null;
}

async function upsertAutopilotProject(
  ctx: PluginContext,
  autopilot: AutopilotProject,
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: AUTOPILOT_ENTITY_TYPES.autopilotProject,
    scopeKind: "project",
    scopeId: autopilot.projectId,
    externalId: autopilot.autopilotId,
    title: `Autopilot for project ${autopilot.projectId}`,
    status: autopilot.enabled ? "active" : "inactive",
    data: autopilot as unknown as Record<string, unknown>,
  });
}

async function listAutopilotProjectEntities(
  ctx: PluginContext,
  projectId?: string,
): Promise<PluginEntityRecord[]> {
  return await ctx.entities.list({
    entityType: AUTOPILOT_ENTITY_TYPES.autopilotProject,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 200,
    offset: 0,
  });
}

async function findProductProgramRevision(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  revisionId: string,
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: AUTOPILOT_ENTITY_TYPES.productProgramRevision,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0,
  });
  return entities.find((e) => {
    const data = e.data as unknown as ProductProgramRevision;
    return data.companyId === companyId && data.revisionId === revisionId;
  }) ?? null;
}

async function listProductProgramRevisionEntities(
  ctx: PluginContext,
  companyId: string,
  projectId?: string,
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: AUTOPILOT_ENTITY_TYPES.productProgramRevision,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ProductProgramRevision;
    return data.companyId === companyId;
  });
}

async function upsertProductProgramRevision(
  ctx: PluginContext,
  revision: ProductProgramRevision,
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: AUTOPILOT_ENTITY_TYPES.productProgramRevision,
    scopeKind: "project",
    scopeId: revision.projectId,
    externalId: revision.revisionId,
    title: `Program revision v${revision.version}`,
    status: "active",
    data: revision as unknown as Record<string, unknown>,
  });
}

async function getLatestProductProgramRevision(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
): Promise<ProductProgramRevision | null> {
  const entities = await listProductProgramRevisionEntities(ctx, companyId, projectId);
  if (entities.length === 0) return null;
  return entities
    .map(asProductProgramRevision)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

const optimizerTemplates: OptimizerTemplate[] = [
  {
    key: "test-suite-ratchet",
    name: "Test Suite Ratchet",
    description: "Improve implementation or docs while repeating a JSON scorer that reports success rate and quality metrics.",
    values: {
      objective: "Improve the selected workspace while preserving build and test stability.",
      mutablePaths: ["src", "tests", "README.md"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only.\"",
      scoreCommand: "node ./scripts/score-json.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailFormat: "json",
      guardrailKey: "guardrails",
      scoreRepeats: 3,
      scoreAggregator: "median",
      minimumImprovement: 0.01,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval",
      requireHumanApproval: true,
      proposalBranchPrefix: "paprclip/autoresearch/tests",
      autoCreateIssueOnGuardrailFailure: true
    }
  },
  {
    key: "lighthouse-candidate",
    name: "Lighthouse Candidate",
    description: "Optimize a frontend workspace against a structured performance scorer while enforcing tests as a guardrail.",
    values: {
      objective: "Raise user-facing performance without regressing correctness or build stability.",
      mutablePaths: ["src", "public", "package.json"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and optimize performance on the allowed files only.\"",
      scoreCommand: "node ./scripts/lighthouse-score.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailCommand: "pnpm test -- --runInBand",
      guardrailFormat: "number",
      scoreRepeats: 3,
      scoreAggregator: "median",
      minimumImprovement: 0.5,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval",
      requireHumanApproval: true
    }
  },
  {
    key: "dry-run-prototype",
    name: "Dry Run Prototype",
    description: "Generate candidate changes and diff artifacts without mutating the real workspace.",
    values: {
      objective: "Explore high-upside candidates, but keep the real workspace untouched until an operator promotes a run.",
      mutablePaths: ["."],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and produce the strongest candidate within the allowed scope.\"",
      scoreCommand: "node -e \"console.log(JSON.stringify({ primary: 1, metrics: { confidence: 1 } }))\"",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      scoreRepeats: 1,
      scoreAggregator: "median",
      minimumImprovement: 0,
      sandboxStrategy: "copy",
      scorerIsolationMode: "separate_workspace",
      applyMode: "dry_run",
      requireHumanApproval: false
    }
  },
  {
    key: "noisy-scorer-ratchet",
    name: "Noisy Scorer Ratchet",
    description: "For scorers with high variance (e.g. Lighthouse, user satisfaction surveys, sampled metrics). Uses confidence policy: delta must exceed k×stdDev of repeated scores.",
    values: {
      objective: "Optimize with a noisy scorer, accepting only statistically significant improvements.",
      mutablePaths: ["src", "public"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only.\"",
      scoreCommand: "node ./scripts/lighthouse-score.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailFormat: "number",
      scoreRepeats: 5,
      scoreAggregator: "median",
      minimumImprovement: 0.05,
      scoreImprovementPolicy: "confidence",
      confidenceThreshold: 2.0,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "manual_approval",
      requireHumanApproval: true,
      autoCreateIssueOnGuardrailFailure: true
    }
  },
  {
    key: "epsilon-stability",
    name: "Epsilon Stability",
    description: "For scorers where minimum meaningful improvement is known (e.g. p95 latency must improve by at least 50ms). Uses epsilon policy: delta must exceed max(epsilon, noiseFloor).",
    values: {
      objective: "Optimize with a known minimum improvement threshold.",
      mutablePaths: ["src", "server"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only.\"",
      scoreCommand: "node ./scripts/perf-score.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailFormat: "json",
      scoreRepeats: 3,
      scoreAggregator: "median",
      minimumImprovement: 0.01,
      scoreImprovementPolicy: "epsilon",
      epsilonValue: 0.05,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic"
    }
  },
  {
    key: "auto-accept-fast",
    name: "Auto-Accept Fast",
    description: "Fast feedback loop for low-risk improvements. Automatic apply with strict minimum improvement. Good for non-critical workspace improvements where speed matters more than human review.",
    values: {
      objective: "Rapidly improve the workspace with automatic apply of strict improvements.",
      mutablePaths: ["src", "README.md"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only.\"",
      scoreCommand: "node ./scripts/score-json.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailFormat: "json",
      guardrailKey: "guardrails",
      scoreRepeats: 1,
      scoreAggregator: "median",
      minimumImprovement: 0.02,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic",
      requireHumanApproval: false,
      autoCreateIssueOnStagnation: true,
      stagnationIssueThreshold: 5
    }
  },
  {
    key: "stagnation-guard",
    name: "Stagnation Guard",
    description: "Ratchet with auto-pause on stagnation. Creates an issue after 3 non-improvements in a row, then pauses for operator review. Useful for production-workspace optimizers where runaway non-improvements indicate a broken scorer or mutator.",
    values: {
      objective: "Improve the workspace while monitoring for stagnation or scorer degradation.",
      mutablePaths: ["src", "tests"],
      mutationCommand: "codex exec \"Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only.\"",
      scoreCommand: "node ./scripts/score-json.mjs",
      scoreDirection: "maximize",
      scoreFormat: "json",
      scoreKey: "primary",
      guardrailFormat: "json",
      guardrailKey: "guardrails",
      scoreRepeats: 3,
      scoreAggregator: "median",
      minimumImprovement: 0.01,
      sandboxStrategy: "git_worktree",
      scorerIsolationMode: "separate_workspace",
      applyMode: "automatic",
      requireHumanApproval: false,
      autoCreateIssueOnStagnation: true,
      autoPauseOnConsecutiveFailures: true,
      stagnationIssueThreshold: 3
    }
  }
];

function isScoreAggregator(value: unknown): value is ScoreAggregator {
  return value === "median" || value === "mean" || value === "max" || value === "min";
}

function isApplyMode(value: unknown): value is ApplyMode {
  return value === "automatic" || value === "manual_approval" || value === "dry_run";
}

function isScoreFormat(value: unknown): value is ScoreFormat {
  return value === "number" || value === "json";
}

function isSandboxStrategy(value: unknown): value is SandboxStrategy {
  return value === "copy" || value === "git_worktree";
}

function isScorerIsolationMode(value: unknown): value is ScorerIsolationMode {
  return value === "same_workspace" || value === "separate_workspace";
}

function parseDirection(value: unknown): ScoreDirection {
  return value === "minimize" ? "minimize" : "maximize";
}

function ensureNonEmptyString(value: unknown, field: string): string {
  const stringValue = typeof value === "string" ? value.trim() : "";
  if (!stringValue) {
    throw new Error(field + " is required");
  }
  return stringValue;
}

function sanitizeWorkspacePath(workspacePath: string): string {
  const normalized = workspacePath.trim();
  if (!normalized) {
    throw new Error("Workspace path was empty.");
  }
  return normalized;
}

function resolveInside(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  const safeRelative = normalizeRelativePath(relativePath);
  const resolved = safeRelative === "." ? root : path.resolve(root, safeRelative);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace: " + relativePath);
  }
  return resolved;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function pathIsAllowed(relativePath: string, mutablePaths: string[]): boolean {
  return mutablePaths.some((mutablePath) => {
    if (mutablePath === ".") return true;
    return relativePath === mutablePath || relativePath.startsWith(mutablePath + "/");
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function readFileHead(filePath: string, maxBytes = 512): Promise<Buffer> {
  const file = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(maxBytes);
  try {
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Detect whether a file is binary by checking for null bytes in the first 512 bytes.
 * Files with null bytes are almost certainly binary (images, PDFs, compiled binaries, etc.).
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const head = await readFileHead(filePath);
    return head.some((byte) => byte === 0);
  } catch {
    return false;
  }
}

async function listFilesRecursively(rootDir: string, baseDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, "/");
    if (relativePath === ".git" || relativePath.startsWith(".git/")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(absolutePath, baseDir));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function filesDiffer(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftExists, rightExists] = await Promise.all([pathExists(leftPath), pathExists(rightPath)]);
  if (leftExists !== rightExists) return true;
  if (!leftExists && !rightExists) return false;

  const [leftStat, rightStat] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)]);
  // Size check as a fast pass; different sizes always means files differ.
  if (leftStat.size !== rightStat.size) return true;

  // For empty files or very small files, do a full byte comparison.
  if (leftStat.size <= 512) {
    const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
    return !leftContent.equals(rightContent);
  }

  // For larger files, do a quick binary detection before full comparison.
  // Read the first 512 bytes of each file and check for null bytes (a strong
  // indicator of binary content). If either file looks binary, fall back to
  // a size-only comparison since full byte comparison of large files is
  // expensive and not useful for text-oriented diff artifacts.
  const [leftHead, rightHead] = await Promise.all([
    readFileHead(leftPath),
    readFileHead(rightPath)
  ]);
  const leftBinary = leftHead.some((byte) => byte === 0);
  const rightBinary = rightHead.some((byte) => byte === 0);
  if (leftBinary || rightBinary) {
    // For binary files, trust the size check already done above.
    return leftStat.size !== rightStat.size;
  }

  // Both files appear to be text; do a full byte comparison.
  const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
  return !leftContent.equals(rightContent);
}

async function createDiffArtifact(
  baselineRoot: string,
  candidateRoot: string,
  mutablePaths: string[],
  maxPatchChars: number,
  gitDiffContext?: GitDiffContext
): Promise<RunDiffArtifact> {
  const baselineExists = await pathExists(baselineRoot);
  const candidateExists = await pathExists(candidateRoot);
  if (!baselineExists || !candidateExists) {
    return emptyDiffArtifact();
  }

  const changedFiles = gitDiffContext
    ? await listGitChangedWorkspaceFiles(gitDiffContext.git, gitDiffContext.sandboxRoot)
    : await listChangedFilesByFilesystem(baselineRoot, candidateRoot);

  const allowedChangedFiles: string[] = [];
  const unauthorizedChangedFiles: string[] = [];
  for (const entry of changedFiles) {
    if (pathIsAllowed(entry, mutablePaths)) {
      allowedChangedFiles.push(entry);
    } else {
      unauthorizedChangedFiles.push(entry);
    }
  }

  // Detect binary files in parallel so diff artifact generation does not
  // serialize per-file probes across larger candidate workspaces.
  const binaryClassification = await mapWithConcurrency(allowedChangedFiles, 8, async (relativePath) => ({
    relativePath,
    binary: await isBinaryFile(path.join(candidateRoot, relativePath))
  }));
  const binaryFiles = binaryClassification
    .filter((entry) => entry.binary)
    .map((entry) => entry.relativePath);
  const textFiles = binaryClassification
    .filter((entry) => !entry.binary)
    .map((entry) => entry.relativePath);

  let patch = "";
  let additions = 0;
  let deletions = 0;

  for (const relativePath of textFiles) {
    try {
      const { stdout } = await execFileAsync("git", [
        "diff",
        "--no-index",
        "--binary",
        "--",
        path.join(baselineRoot, relativePath),
        path.join(candidateRoot, relativePath)
      ], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      patch += stdout;
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      if (err.code === 1 && err.stdout) {
        patch += err.stdout;
      } else if (err.stderr) {
        patch += "\n# Failed to compute diff for " + relativePath + "\n" + err.stderr + "\n";
      }
    }
  }

  if (binaryFiles.length > 0) {
    patch += "\n# Binary files changed (excluded from text diff): " + binaryFiles.join(", ") + "\n";
  }

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return {
    changedFiles: allowedChangedFiles,
    unauthorizedChangedFiles,
    binaryFiles,
    patch: summarizeOutput(patch, maxPatchChars),
    stats: {
      files: allowedChangedFiles.length,
      additions,
      deletions
    }
  };
}

async function listChangedFilesByFilesystem(
  baselineRoot: string,
  candidateRoot: string
): Promise<string[]> {
  const [baselineFiles, candidateFiles] = await Promise.all([
    listFilesRecursively(baselineRoot),
    listFilesRecursively(candidateRoot)
  ]);
  const union = [...new Set([...baselineFiles, ...candidateFiles])].sort();

  return (await mapWithConcurrency(union, 8, async (relativePath) => {
    const changed = await filesDiffer(
      path.join(baselineRoot, relativePath),
      path.join(candidateRoot, relativePath)
    );
    return changed ? relativePath : null;
  })).filter((entry): entry is string => entry != null);
}

async function listGitChangedWorkspaceFiles(
  git: GitWorkspaceContext,
  sandboxRoot: string
): Promise<string[]> {
  const workspaceScope = git.workspaceRelativePath === "." ? "." : git.workspaceRelativePath;
  const trackedArgs = ["diff", "--name-only"];
  if (git.workspaceRelativePath !== ".") {
    trackedArgs.push("--relative=" + git.workspaceRelativePath);
  }
  trackedArgs.push("HEAD", "--", workspaceScope);

  const untrackedArgs = ["ls-files", "--others", "--exclude-standard", "--", workspaceScope];
  const [tracked, untracked] = await Promise.all([
    runGit(sandboxRoot, trackedArgs),
    runGit(sandboxRoot, untrackedArgs)
  ]);

  return [...new Set(
    [...tracked.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)]
      .map((entry) => entry.trim().replace(/\\/g, "/"))
      .filter(Boolean)
  )].sort();
}

async function copyAllowedPath(sourceRoot: string, destinationRoot: string, relativePath: string): Promise<void> {
  const sourcePath = resolveInside(sourceRoot, relativePath);
  const destinationPath = resolveInside(destinationRoot, relativePath);
  const sourceExists = await pathExists(sourcePath);

  if (!sourceExists) {
    await fs.rm(destinationPath, { recursive: true, force: true });
    return;
  }

  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function applySandboxToWorkspace(workspacePath: string, sandboxWorkspace: string, mutablePaths: string[]): Promise<void> {
  for (const mutablePath of mutablePaths) {
    await copyAllowedPath(sandboxWorkspace, workspacePath, mutablePath);
  }
}

async function runGit(
  cwd: string,
  args: string[],
  maxBuffer = 16 * 1024 * 1024
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer
  });
}

async function resolveGitWorkspace(workspacePath: string): Promise<GitWorkspaceContext | null> {
  try {
    const { stdout } = await runGit(workspacePath, ["rev-parse", "--show-toplevel"]);
    const repoRoot = stdout.trim();
    if (!repoRoot) return null;
    const workspaceRelativePath = path.relative(repoRoot, workspacePath).replace(/\\/g, "/");
    return {
      repoRoot,
      workspaceRelativePath: workspaceRelativePath === "" ? "." : workspaceRelativePath
    };
  } catch {
    return null;
  }
}

function toRepoRelativePath(git: GitWorkspaceContext, workspaceRelativePath: string): string {
  const normalized = normalizeRelativePath(workspaceRelativePath);
  return git.workspaceRelativePath === "."
    ? normalized
    : (git.workspaceRelativePath + "/" + normalized).replace(/\/+/g, "/");
}

async function createSandboxContext(
  requestedStrategy: SandboxStrategy,
  workspacePath: string
): Promise<SandboxContext> {
  const git = requestedStrategy === "git_worktree"
    ? await resolveGitWorkspace(workspacePath)
    : null;

  if (requestedStrategy === "git_worktree" && git) {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autoresearch-worktree-"));
    await runGit(git.repoRoot, ["worktree", "add", "--detach", sandboxRoot, "HEAD"]);
    const sandboxWorkspace = git.workspaceRelativePath === "."
      ? sandboxRoot
      : path.join(sandboxRoot, git.workspaceRelativePath);
    return {
      strategy: "git_worktree",
      sandboxRoot,
      workspacePath: sandboxWorkspace,
      git,
      cleanup: async () => {
        await runGit(git.repoRoot, ["worktree", "remove", "--force", sandboxRoot]).catch(() => undefined);
        await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    };
  }

  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autoresearch-copy-"));
  const sandboxWorkspace = path.join(sandboxRoot, "workspace");
  await fs.cp(workspacePath, sandboxWorkspace, { recursive: true, force: true });
  return {
    strategy: "copy",
    sandboxRoot,
    workspacePath: sandboxWorkspace,
    cleanup: async () => {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

async function createScorerContext(
  isolationMode: ScorerIsolationMode,
  candidateWorkspacePath: string
): Promise<ScorerContext> {
  if (isolationMode === "same_workspace") {
    return {
      isolationMode,
      sandboxRoot: path.dirname(candidateWorkspacePath),
      workspacePath: candidateWorkspacePath,
      cleanup: async () => undefined
    };
  }

  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autoresearch-score-"));
  const scorerWorkspace = path.join(sandboxRoot, "workspace");
  await fs.cp(candidateWorkspacePath, scorerWorkspace, { recursive: true, force: true });
  return {
    isolationMode,
    sandboxRoot,
    workspacePath: scorerWorkspace,
    cleanup: async () => {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

async function createWorkspacePatch(
  git: GitWorkspaceContext,
  sandboxRoot: string,
  mutablePaths: string[]
): Promise<string> {
  const repoRelativePaths = mutablePaths.map((entry) => toRepoRelativePath(git, entry));
  await runGit(sandboxRoot, ["add", "-N", "--", ...repoRelativePaths]).catch(() => undefined);
  const args = ["diff", "--binary"];
  if (git.workspaceRelativePath !== ".") {
    args.push("--relative=" + git.workspaceRelativePath);
  }
  args.push("HEAD", "--", ...repoRelativePaths);
  const { stdout } = await runGit(sandboxRoot, args, 32 * 1024 * 1024);
  return stdout;
}

/**
 * Detect conflict information from git apply stderr output.
 * Conflict markers appear as "<<<<<<<", "=======", or ">>>>>>>" in the output,
 * or git may report "error: patch failed:" for specific files.
 */
function detectPatchConflicts(stderr: string, exitCode: number): PatchConflictInfo {
  const lines = stderr.split(/\r?\n/);
  const conflictingFiles: string[] = [];
  let hasConflicts = false;

  for (const line of lines) {
    if (
      line.includes("<<<<<<<") ||
      line.includes(">>>>>>>") ||
      line.includes("=======") ||
      /error: patch failed/i.test(line)
    ) {
      hasConflicts = true;
    }
    const fileMatch = line.match(/^error: (?:patch failed|checking patch|unalign|already exists): (.+)$/i);
    if (fileMatch && fileMatch[1]) {
      const filePath = fileMatch[1].trim();
      if (!conflictingFiles.includes(filePath)) {
        conflictingFiles.push(filePath);
      }
    }
  }

  return {
    hasConflicts: hasConflicts || conflictingFiles.length > 0,
    conflictingFiles,
    stderr,
    exitCode
  };
}

/**
 * Apply a git patch to the workspace, capturing structured conflict details
 * when git apply fails due to overlapping changes.
 *
 * Throws an error if apply fails (including conflicts) so callers can decide
 * how to handle the result. The conflict info is returned alongside the error
 * via the `PatchConflictInfo` attached to the run record.
 */
async function applyPatchToWorkspace(
  workspacePath: string,
  git: GitWorkspaceContext | null,
  patch: string
): Promise<PatchConflictInfo | null> {
  if (!patch.trim()) return null;

  if (!git) {
    throw new Error("Git patch apply requested without a git workspace.");
  }

  const patchFile = path.join(os.tmpdir(), "paperclip-autoresearch-" + randomUUID() + ".patch");
  try {
    await fs.writeFile(patchFile, patch, "utf8");
    const args = ["apply", "--whitespace=nowarn", patchFile];
    if (git.workspaceRelativePath !== ".") {
      args.splice(1, 0, "--directory", git.workspaceRelativePath);
    }
    const result = await runGit(git.repoRoot, args, 32 * 1024 * 1024);
    return null; // no conflict
  } catch (err) {
    const error = err as { code?: number; stderr?: string; stdout?: string };
    const stderr = error.stderr ?? "";
    const exitCode = typeof error.code === "number" ? error.code : 1;
    const conflictInfo = detectPatchConflicts(stderr, exitCode);

    if (conflictInfo.hasConflicts || conflictInfo.conflictingFiles.length > 0) {
      // Return conflict info so the caller can record it and surface it in the UI.
      // Re-throw with a descriptive message so the run can be marked appropriately.
      const fileList = conflictInfo.conflictingFiles.join(", ") || "one or more files";
      throw new Error(
        "Patch apply conflict: " + fileList + ". The workspace has diverged since the candidate was generated. " +
        "Conflict details: " + stderr.slice(0, 500)
      );
    }

    // Non-conflict failure (e.g., corrupt patch, permission issue)
    throw new Error("Patch apply failed (exit " + exitCode + "): " + stderr.slice(0, 500));
  } finally {
    await fs.rm(patchFile, { force: true }).catch(() => undefined);
  }
}

function resolveRunSandboxWorkspacePath(run: OptimizerRunRecord): string {
  if (!run.sandboxPath) {
    throw new Error("Run did not retain a sandbox.");
  }
  if (run.sandboxStrategy === "git_worktree") {
    return run.gitWorkspaceRelativePath && run.gitWorkspaceRelativePath !== "."
      ? path.join(run.sandboxPath, run.gitWorkspaceRelativePath)
      : run.sandboxPath;
  }
  return path.join(run.sandboxPath, "workspace");
}

async function cleanupRetainedSandbox(run: OptimizerRunRecord): Promise<void> {
  if (!run.sandboxPath) return;
  if (run.sandboxStrategy === "git_worktree" && run.gitRepoRoot) {
    await runGit(run.gitRepoRoot, ["worktree", "remove", "--force", run.sandboxPath]).catch(() => undefined);
  }
  await fs.rm(run.sandboxPath, { recursive: true, force: true }).catch(() => undefined);
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
  env: NodeJS.ProcessEnv,
  maxOutputChars: number
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      env,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    return {
      command,
      cwd,
      exitCode: 0,
      stdout: summarizeOutput(stdout, maxOutputChars),
      stderr: summarizeOutput(stderr, maxOutputChars),
      durationMs: Date.now() - startedAt,
      timedOut: false,
      ok: true
    };
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      signal?: string;
      killed?: boolean;
      message?: string;
    };
    return {
      command,
      cwd,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: summarizeOutput(err.stdout ?? "", maxOutputChars),
      stderr: summarizeOutput(err.stderr ?? err.message ?? "", maxOutputChars),
      durationMs: Date.now() - startedAt,
      timedOut: err.signal === "SIGTERM" || err.killed === true,
      ok: false
    };
  }
}

async function getConfig(ctx: PluginContext): Promise<PluginConfigValues> {
  const raw = await ctx.config.get();
  return {
    defaultMutationBudgetSeconds: clampPositiveInteger(raw.defaultMutationBudgetSeconds, DEFAULTS.mutationBudgetSeconds),
    defaultScoreBudgetSeconds: clampPositiveInteger(raw.defaultScoreBudgetSeconds, DEFAULTS.scoreBudgetSeconds),
    defaultGuardrailBudgetSeconds: clampPositiveInteger(raw.defaultGuardrailBudgetSeconds, DEFAULTS.guardrailBudgetSeconds),
    keepTmpDirs: raw.keepTmpDirs === true,
    maxOutputChars: clampPositiveInteger(raw.maxOutputChars, DEFAULTS.maxOutputChars),
    sweepLimit: clampPositiveInteger(raw.sweepLimit, DEFAULTS.sweepLimit),
    scoreRepeats: clampPositiveInteger(raw.scoreRepeats, DEFAULTS.scoreRepeats),
    guardrailRepeats: clampPositiveInteger(raw.guardrailRepeats, DEFAULTS.guardrailRepeats),
    guardrailAggregator: raw.guardrailAggregator === "any" ? "any" : "all",
    minimumImprovement: clampNonNegativeNumber(raw.minimumImprovement, DEFAULTS.minimumImprovement),
    stagnationIssueThreshold: clampPositiveInteger(raw.stagnationIssueThreshold, DEFAULTS.stagnationIssueThreshold),
    scoreImprovementPolicy: (raw.scoreImprovementPolicy === "confidence" || raw.scoreImprovementPolicy === "epsilon") ? raw.scoreImprovementPolicy : undefined,
    confidenceThreshold: typeof raw.confidenceThreshold === "number" && Number.isFinite(raw.confidenceThreshold) ? raw.confidenceThreshold : undefined,
    epsilonValue: typeof raw.epsilonValue === "number" && raw.epsilonValue >= 0 ? raw.epsilonValue : undefined
  };
}

function isRunRecord(record: PluginEntityRecord): boolean {
  return record.entityType === ENTITY_TYPES.run;
}

function asOptimizer(record: PluginEntityRecord): OptimizerDefinition {
  return {
    ...(record.data as unknown as OptimizerDefinition),
    optimizerId: record.externalId ?? record.id
  };
}

function asRunRecord(record: PluginEntityRecord): OptimizerRunRecord {
  return record.data as unknown as OptimizerRunRecord;
}

async function listOptimizerEntities(ctx: PluginContext, projectId?: string): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.optimizer,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 200,
    offset: 0
  });
  return entities.filter((entry) => entry.status !== "deleted");
}

async function listRunEntities(ctx: PluginContext, projectId?: string): Promise<PluginEntityRecord[]> {
  return await ctx.entities.list({
    entityType: ENTITY_TYPES.run,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
}

async function findOptimizer(ctx: PluginContext, projectId: string, optimizerId: string): Promise<PluginEntityRecord | null> {
  const entities = await listOptimizerEntities(ctx, projectId);
  return entities.find((entry) => entry.externalId === optimizerId || entry.id === optimizerId) ?? null;
}

async function findRun(ctx: PluginContext, projectId: string, runId: string): Promise<PluginEntityRecord | null> {
  const entities = await listRunEntities(ctx, projectId);
  return entities.find((entry) => entry.externalId === runId || entry.id === runId) ?? null;
}

async function findLatestAcceptedRun(
  ctx: PluginContext,
  projectId: string,
  optimizerId: string
): Promise<OptimizerRunRecord | null> {
  const runEntities = await listRunEntities(ctx, projectId);
  return runEntities
    .map(asRunRecord)
    .filter((entry) => entry.optimizerId === optimizerId && entry.accepted)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

async function upsertOptimizer(ctx: PluginContext, optimizer: OptimizerDefinition, status?: string): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.optimizer,
    scopeKind: "project",
    scopeId: optimizer.projectId,
    externalId: optimizer.optimizerId,
    title: optimizer.name,
    status: status ?? optimizer.status,
    data: optimizer as unknown as Record<string, unknown>
  });
}

async function upsertRun(ctx: PluginContext, run: OptimizerRunRecord): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.run,
    scopeKind: "project",
    scopeId: run.projectId,
    externalId: run.runId,
    title: run.outcome + " run for " + run.optimizerId,
    status: run.outcome,
    data: run as unknown as Record<string, unknown>
  });
}

async function resolveWorkspacePath(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  workspaceId?: string
): Promise<{ workspaceId: string; workspacePath: string }> {
  const workspace = workspaceId
    ? (await ctx.projects.listWorkspaces(projectId, companyId)).find((entry) => entry.id === workspaceId) ?? null
    : await ctx.projects.getPrimaryWorkspace(projectId, companyId);
  if (!workspace) {
    throw new Error("No workspace was available for the selected project.");
  }
  return {
    workspaceId: workspace.id,
    workspacePath: sanitizeWorkspacePath(workspace.path)
  };
}

function resultFromExecution(
  execution: CommandExecutionResult,
  format: ScoreFormat,
  key?: string,
  pattern?: string
): StructuredMetricResult | null {
  if (format === "json") {
    return extractStructuredMetricResult(execution.stdout, key);
  }

  const score = extractScore(execution.stdout + "\n" + execution.stderr, pattern);
  return {
    primary: score,
    metrics: score == null ? {} : { primary: score },
    guardrails: {},
    summary: score == null ? "No numeric score found." : "Score " + score,
    raw: (execution.stdout + "\n" + execution.stderr).trim()
  };
}

async function measureScoreRepeats(
  optimizer: OptimizerDefinition,
  cwd: string,
  config: PluginConfigValues
): Promise<{
  scoring: CommandExecutionResult;
  scoringRepeats: OptimizerRunRecord["scoringRepeats"];
  scoringAggregate: StructuredMetricResult | null;
  candidateScore: number | null;
}> {
  const repeats = Math.max(1, optimizer.scoreRepeats);
  const scoringRepeats: OptimizerRunRecord["scoringRepeats"] = [];

  for (let index = 0; index < repeats; index += 1) {
    const execution = await runShellCommand(
      optimizer.scoreCommand,
      cwd,
      optimizer.scoreBudgetSeconds,
      process.env,
      config.maxOutputChars
    );
    const structured = resultFromExecution(execution, optimizer.scoreFormat, optimizer.scoreKey, optimizer.scorePattern);
    scoringRepeats.push({
      execution,
      score: structured?.primary ?? null,
      structured
    });
  }

  const scoring = scoringRepeats[scoringRepeats.length - 1]?.execution ?? {
    command: optimizer.scoreCommand,
    cwd,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    ok: false
  };
  const scoringAggregate = aggregateStructuredMetrics(
    scoringRepeats.map((entry) => entry.structured).filter((entry): entry is StructuredMetricResult => entry != null),
    optimizer.scoreAggregator
  );

  return {
    scoring,
    scoringRepeats,
    scoringAggregate,
    candidateScore: scoringAggregate?.primary ?? null
  };
}

async function measureBaselineScore(
  optimizer: OptimizerDefinition,
  workspacePath: string,
  config: PluginConfigValues
): Promise<number | null> {
  if (optimizer.bestScore != null) return optimizer.bestScore;
  const baseline = await measureScoreRepeats(optimizer, workspacePath, config);
  return baseline.candidateScore;
}

async function measureGuardrail(
  optimizer: OptimizerDefinition,
  cwd: string,
  config: PluginConfigValues
): Promise<{
  execution: CommandExecutionResult | undefined;
  result: StructuredMetricResult | null;
  passed: boolean;
  failureReason?: string;
  repeats?: Array<{
    execution: CommandExecutionResult;
    result: StructuredMetricResult | null;
    passed: boolean;
  }>;
  aggregate?: StructuredMetricResult | null;
}> {
  if (!optimizer.guardrailCommand) {
    return { execution: undefined, result: null, passed: true, repeats: [], aggregate: null };
  }

  const repeats = optimizer.guardrailRepeats ?? 1;
  const guardrailRepeats: Array<{
    execution: CommandExecutionResult;
    result: StructuredMetricResult | null;
    passed: boolean;
  }> = [];

  for (let index = 0; index < repeats; index += 1) {
    const execution = await runShellCommand(
      optimizer.guardrailCommand,
      cwd,
      optimizer.guardrailBudgetSeconds ?? config.defaultGuardrailBudgetSeconds,
      process.env,
      config.maxOutputChars
    );
    const result = resultFromExecution(execution, optimizer.guardrailFormat, optimizer.guardrailKey);
    const failedGuardrails = Object.entries(result?.guardrails ?? {}).filter(([, value]) => value === false);
    const passed = execution.ok && failedGuardrails.length === 0 && !result?.invalid;
    guardrailRepeats.push({ execution, result, passed });
  }

  const aggregate = repeats > 1
    ? aggregateGuardrailResults(
        guardrailRepeats.map((entry) => entry.result).filter((entry): entry is StructuredMetricResult => entry != null),
        optimizer.guardrailAggregator ?? "all"
      )
    : guardrailRepeats[0]?.result ?? null;

  const failedGuardrails = Object.entries(aggregate?.guardrails ?? {}).filter(([, value]) => value === false);
  const passed = guardrailRepeats.every((entry) => entry.passed);

  return {
    execution: guardrailRepeats[guardrailRepeats.length - 1]?.execution,
    result: aggregate,
    passed,
    repeats: guardrailRepeats,
    aggregate,
    failureReason: !passed
      ? (aggregate?.invalidReason
        ?? (failedGuardrails.length > 0
          ? "Guardrails failed: " + failedGuardrails.map(([key]) => key).join(", ") + "."
          : "One or more guardrail repeats failed."))
      : undefined
  };
}

async function createIssueFromRun(
  ctx: PluginContext,
  companyId: string,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  titlePrefix?: string
): Promise<{ id: string; title: string }> {
  const title = (titlePrefix ?? "Optimizer run") + ": " + optimizer.name;
  const patchPreview = run.artifacts.patch || "(no diff patch captured)";
  const delta = (run.candidateScore != null && run.baselineScore != null)
    ? (run.candidateScore - run.baselineScore).toFixed(4)
    : "n/a";
  const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  const scoringMetrics = run.scoringAggregate?.metrics;
  const guardrailVals = run.guardrailAggregate?.guardrails;
  const description = [
    "Objective: " + optimizer.objective,
    "Outcome: " + run.outcome,
    "Reason: " + run.reason,
    "",
    "Baseline score: " + (run.baselineScore ?? "n/a") + " | Candidate: " + (run.candidateScore ?? "n/a") + " | Delta: " + delta,
    scoringMetrics && Object.keys(scoringMetrics).length > 0
      ? "Scoring metrics: " + Object.entries(scoringMetrics).map(([k, v]) => k + "=" + v).join(", ")
      : null,
    guardrailVals && Object.keys(guardrailVals).length > 0
      ? "Guardrail results: " + Object.entries(guardrailVals).map(([k, v]) => k + "=" + v).join(", ")
      : "Guardrail: " + (run.guardrail ? formatCommandSummary(run.guardrail) : "not configured"),
    "Duration: " + (durationMs / 1000).toFixed(1) + "s | Scoring repeats: " + run.scoringRepeats.length + "x",
    "",
    "Mutation: " + formatCommandSummary(run.mutation),
    "Scoring: " + formatCommandSummary(run.scoring),
    "",
    "Changed files (" + run.artifacts.changedFiles.length + "): " + (run.artifacts.changedFiles.join(", ") || "none"),
    "Unauthorized changes: " + (run.artifacts.unauthorizedChangedFiles.join(", ") || "none"),
    run.patchConflict?.hasConflicts
      ? "Patch conflict: " + (run.patchConflict.conflictingFiles.join(", ") || "detected but files unknown")
      : null,
    "",
    optimizer.consecutiveNonImprovements > 0
      ? "Consecutive non-improvements: " + optimizer.consecutiveNonImprovements + " (threshold: " + optimizer.stagnationIssueThreshold + ")"
      : null,
    optimizer.consecutiveFailures > 0
      ? "Consecutive failures: " + optimizer.consecutiveFailures
      : null,
    "",
    "---",
    "Patch preview",
    "```diff",
    patchPreview,
    "```"
  ].filter(Boolean).join("\n");

  const issue = await ctx.issues.create({
    companyId,
    projectId: optimizer.projectId,
    title,
    description
  });

  await ctx.activity.log({
    companyId,
    entityType: "issue",
    entityId: issue.id,
    message: 'Autoresearch Improver created issue "' + title + '" from run ' + run.runId + '.',
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId,
      outcome: run.outcome
    }
  });

  return { id: issue.id, title: issue.title };
}

function buildProposalBranchName(optimizer: OptimizerDefinition, run: OptimizerRunRecord): string {
  const prefix = optimizer.proposalBranchPrefix?.trim() || "paprclip/autoresearch/" + optimizer.optimizerId.slice(0, 8);
  const suffix = run.runId.slice(0, 8);
  return (prefix + "-" + suffix).replace(/[^a-zA-Z0-9/_-]+/g, "-");
}

function buildProposalCommitMessage(optimizer: OptimizerDefinition, run: OptimizerRunRecord): string {
  if (optimizer.proposalCommitMessage?.trim()) return optimizer.proposalCommitMessage.trim();
  return "Autoresearch candidate: " + optimizer.name + " (" + run.runId.slice(0, 8) + ")";
}

function extractPullRequestUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/\S+/);
  return match?.[0];
}

/**
 * Extract a PR number from common GitHub CLI output patterns:
 * - "!123" (gh pr create default format)
 * - "#123"
 * - "/pull/123" in URLs already captured by extractPullRequestUrl
 */
function extractPullRequestNumber(output: string): number | null {
  // Match !123 or #123 at the end of a line or surrounded by whitespace
  const match = output.match(/(?:^|[\s])([!#])(\d+)(?:[\s]|$)/m);
  if (match) {
    const value = Number(match[2]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function createPullRequestFromRun(
  ctx: PluginContext,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  config: PluginConfigValues
): Promise<PullRequestArtifact> {
  const { workspacePath } = await resolveWorkspacePath(
    ctx,
    optimizer.companyId,
    optimizer.projectId,
    optimizer.workspaceId
  );
  const git = await resolveGitWorkspace(workspacePath);
  if (!git) {
    throw new Error("Workspace is not inside a git repository.");
  }
  if (run.artifacts.changedFiles.length === 0) {
    throw new Error("Run did not record any changed files.");
  }

  // For pending (non-applied) runs, the workspace does not yet contain the run's
  // changes (they are in the retained sandbox). Reject with dirty-repo guard to
  // prevent creating a PR when the workspace state may have diverged.
  if (!run.applied) {
    // Dirty-repo safety: reject if the workspace has uncommitted changes.
    // This guards against unrelated changes being swept into the proposal branch.
    const { stdout: statusOutput } = await runGit(git.repoRoot, ["status", "--porcelain"]);
    const dirtyFiles = statusOutput.trim().split("\n").filter((line) => line.trim() !== "");
    if (dirtyFiles.length > 0) {
      throw new Error(
        "Workspace has uncommitted changes (dirty repo). Proposal creation is blocked to prevent unrelated changes from being swept into the branch. Dirty files: " + dirtyFiles.join(", ")
      );
    }

    // Stale-candidate safety: reject if the workspace HEAD changed since the run was created.
    if (run.workspaceHeadAtRun) {
      const { stdout: currentHead } = await runGit(git.repoRoot, ["rev-parse", "HEAD"]);
      const currentHeadTrimmed = currentHead.trim();
      if (currentHeadTrimmed !== run.workspaceHeadAtRun.trim()) {
        throw new Error(
          "Workspace HEAD has changed since this run was created (stale candidate). Run was created at " + run.workspaceHeadAtRun + " but workspace is now at " + currentHeadTrimmed + ". A new run is required."
        );
      }
    }

    // Pending runs have not been applied; after the guards above, throw to
    // prevent attempting to stage non-existent workspace files.
    throw new Error("Run must be applied before creating a pull request.");
  }

  // Resolve base branch: use optimizer's explicit base if set, otherwise auto-detect from current branch.
  const baseBranch = optimizer.proposalBaseBranch?.trim()
    || (await runGit(git.repoRoot, ["branch", "--show-current"])).stdout.trim()
    || "HEAD";

  // Resolve the default remote (origin) for push tracking.
  const { stdout: remoteInfo } = await runGit(git.repoRoot, ["config", "--get", "branch." + baseBranch + ".remote"])
    .catch(() => ({ stdout: "" }));
  const remoteName = remoteInfo.trim() || undefined;

  const branchName = buildProposalBranchName(optimizer, run);

  // Branch existence check: refuse to create a PR if the proposal branch already exists
  // to prevent accidentally pushing duplicate commits or overwriting an existing review branch.
  const { stdout: existingBranches } = await runGit(git.repoRoot, ["branch", "--list", branchName]);
  if (existingBranches.trim()) {
    throw new Error(
      "Proposal branch \"" + branchName + "\" already exists. Delete it first or change the proposalBranchPrefix to create a fresh branch."
    );
  }

  await runGit(git.repoRoot, ["checkout", "-B", branchName]);

  const repoRelativeChangedFiles = run.artifacts.changedFiles.map((entry) => toRepoRelativePath(git, entry));
  await runGit(git.repoRoot, ["add", "-A", "--", ...repoRelativeChangedFiles]);
  await runGit(git.repoRoot, ["commit", "-m", buildProposalCommitMessage(optimizer, run)]);

  const { stdout: commitSha } = await runGit(git.repoRoot, ["rev-parse", "HEAD"]);

  // Optional push: run a dedicated push command if configured.
  let pushed: boolean | undefined;
  let pushRemote: string | undefined;
  let pushExitCode: number | null | undefined;
  if (optimizer.proposalPushCommand?.trim()) {
    const pushResult = await runShellCommand(
      optimizer.proposalPushCommand,
      workspacePath,
      optimizer.scoreBudgetSeconds,
      {
        ...process.env,
        PAPERCLIP_OPTIMIZER_ID: optimizer.optimizerId,
        PAPERCLIP_OPTIMIZER_NAME: optimizer.name,
        PAPERCLIP_OPTIMIZER_RUN_ID: run.runId,
        PAPERCLIP_PROPOSAL_BRANCH: branchName,
        PAPERCLIP_PROPOSAL_COMMIT: commitSha.trim(),
        PAPERCLIP_PROPOSAL_REMOTE: remoteName ?? "origin"
      },
      config.maxOutputChars
    );
    pushed = pushResult.ok;
    pushExitCode = pushResult.exitCode;
    pushRemote = remoteName;
  }

  let commandResult: CommandExecutionResult | undefined;
  let pullRequestUrl: string | undefined;
  let pullRequestNumber: number | null = null;

  if (optimizer.proposalPrCommand?.trim()) {
    commandResult = await runShellCommand(
      optimizer.proposalPrCommand,
      workspacePath,
      optimizer.scoreBudgetSeconds,
      {
        ...process.env,
        PAPERCLIP_OPTIMIZER_ID: optimizer.optimizerId,
        PAPERCLIP_OPTIMIZER_NAME: optimizer.name,
        PAPERCLIP_OPTIMIZER_RUN_ID: run.runId,
        PAPERCLIP_PROPOSAL_BRANCH: branchName,
        PAPERCLIP_PROPOSAL_COMMIT: commitSha.trim()
      },
      config.maxOutputChars
    );
    const output = commandResult.stdout + "\n" + commandResult.stderr;
    pullRequestUrl = extractPullRequestUrl(output);
    pullRequestNumber = extractPullRequestNumber(output);
  }

  return {
    branchName,
    baseBranch,
    remoteName,
    commitSha: commitSha.trim(),
    pullRequestUrl,
    pullRequestNumber,
    pushed,
    pushRemote,
    pushExitCode,
    command: optimizer.proposalPrCommand,
    commandResult,
    createdAt: nowIso()
  };
}

/**
 * Delete a proposal branch that was created from an accepted run.
 * Useful for cleaning up branches from rejected or superseded runs.
 * Fails if the run has no associated branch name.
 */
async function deleteProposalBranch(
  ctx: PluginContext,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  remote?: string
): Promise<{ deleted: boolean; branchName: string }> {
  const { workspacePath } = await resolveWorkspacePath(
    ctx,
    optimizer.companyId,
    optimizer.projectId,
    optimizer.workspaceId
  );
  const git = await resolveGitWorkspace(workspacePath);
  if (!git) {
    throw new Error("Workspace is not inside a git repository.");
  }

  const branchName = run.pullRequest?.branchName;
  if (!branchName) {
    throw new Error("Run has no associated proposal branch to delete.");
  }

  const deleteRemote = remote ?? run.pullRequest?.pushRemote ?? "origin";
  const pushResult = await runShellCommand(
    "git push " + deleteRemote + " --delete \"" + branchName + "\"",
    git.repoRoot,
    optimizer.scoreBudgetSeconds,
    process.env,
    (await getConfig(ctx)).maxOutputChars
  );

  if (!pushResult.ok) {
    throw new Error(
      "Failed to delete proposal branch \"" + branchName + "\" from " + deleteRemote + ": " + (pushResult.stderr || pushResult.stdout)
    );
  }

  return { deleted: true, branchName };
}

async function createOptimizerFromParams(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<OptimizerDefinition> {
  const config = await getConfig(ctx);
  const optimizerId = typeof params.optimizerId === "string" && params.optimizerId.trim()
    ? params.optimizerId.trim()
    : randomUUID();
  const requestedApplyMode = isApplyMode(params.applyMode) ? params.applyMode : undefined;
  const requireHumanApproval = params.requireHumanApproval === true || requestedApplyMode === "manual_approval";
  const applyMode: ApplyMode = requestedApplyMode
    ?? (requireHumanApproval ? "manual_approval" : "automatic");

  return {
    optimizerId,
    companyId: ensureNonEmptyString(params.companyId, "companyId"),
    projectId: ensureNonEmptyString(params.projectId, "projectId"),
    workspaceId: typeof params.workspaceId === "string" && params.workspaceId.trim() ? params.workspaceId.trim() : undefined,
    name: ensureNonEmptyString(params.name, "name"),
    objective: ensureNonEmptyString(params.objective, "objective"),
    mutablePaths: normalizeMutablePaths(params.mutablePaths),
    mutationCommand: ensureNonEmptyString(params.mutationCommand, "mutationCommand"),
    scoreCommand: ensureNonEmptyString(params.scoreCommand, "scoreCommand"),
    guardrailCommand: typeof params.guardrailCommand === "string" && params.guardrailCommand.trim()
      ? params.guardrailCommand.trim()
      : undefined,
    scoreDirection: parseDirection(params.scoreDirection),
    scorePattern: typeof params.scorePattern === "string" && params.scorePattern.trim() ? params.scorePattern.trim() : undefined,
    scoreFormat: isScoreFormat(params.scoreFormat) ? params.scoreFormat : "number",
    scoreKey: normalizeDotPath(params.scoreKey),
    guardrailFormat: isScoreFormat(params.guardrailFormat) ? params.guardrailFormat : "number",
    guardrailKey: normalizeDotPath(params.guardrailKey),
    scoreRepeats: clampPositiveInteger(params.scoreRepeats, config.scoreRepeats),
    scoreAggregator: isScoreAggregator(params.scoreAggregator) ? params.scoreAggregator : "median",
    minimumImprovement: clampNonNegativeNumber(params.minimumImprovement, config.minimumImprovement),
    scoreImprovementPolicy: (params.scoreImprovementPolicy === "confidence" || params.scoreImprovementPolicy === "epsilon")
      ? params.scoreImprovementPolicy
      : undefined,
    confidenceThreshold: typeof params.confidenceThreshold === "number" && Number.isFinite(params.confidenceThreshold) && params.confidenceThreshold > 0
      ? params.confidenceThreshold
      : undefined,
    epsilonValue: typeof params.epsilonValue === "number" && Number.isFinite(params.epsilonValue) && params.epsilonValue >= 0
      ? params.epsilonValue
      : undefined,
    mutationBudgetSeconds: clampPositiveInteger(params.mutationBudgetSeconds, config.defaultMutationBudgetSeconds),
    scoreBudgetSeconds: clampPositiveInteger(params.scoreBudgetSeconds, config.defaultScoreBudgetSeconds),
    guardrailBudgetSeconds: params.guardrailBudgetSeconds == null || params.guardrailBudgetSeconds === ""
      ? undefined
      : clampPositiveInteger(params.guardrailBudgetSeconds, config.defaultGuardrailBudgetSeconds),
    hiddenScoring: params.hiddenScoring !== false,
    autoRun: params.autoRun === true,
    sandboxStrategy: isSandboxStrategy(params.sandboxStrategy) ? params.sandboxStrategy : "git_worktree",
    scorerIsolationMode: isScorerIsolationMode(params.scorerIsolationMode) ? params.scorerIsolationMode : "separate_workspace",
    applyMode,
    status: params.status === "paused" ? "paused" : "active",
    queueState: params.queueState === "queued"
      ? "queued"
      : params.queueState === "running"
        ? "running"
        : params.queueState === "awaiting_approval"
          ? "awaiting_approval"
          : "idle",
    requireHumanApproval,
    autoCreateIssueOnGuardrailFailure: params.autoCreateIssueOnGuardrailFailure === true,
    autoCreateIssueOnStagnation: params.autoCreateIssueOnStagnation === true,
    autoPauseOnConsecutiveFailures: params.autoPauseOnConsecutiveFailures === true,
    stagnationWebhookUrl: typeof params.stagnationWebhookUrl === "string" && params.stagnationWebhookUrl.trim() ? params.stagnationWebhookUrl.trim() : undefined,
    stagnationIssueThreshold: clampPositiveInteger(params.stagnationIssueThreshold, config.stagnationIssueThreshold),
    guardrailRepeats: clampPositiveInteger(params.guardrailRepeats, 1),
    guardrailAggregator: params.guardrailAggregator === "any" ? "any" : "all",
    proposalBranchPrefix: typeof params.proposalBranchPrefix === "string" && params.proposalBranchPrefix.trim()
      ? params.proposalBranchPrefix.trim()
      : undefined,
    proposalCommitMessage: typeof params.proposalCommitMessage === "string" && params.proposalCommitMessage.trim()
      ? params.proposalCommitMessage.trim()
      : undefined,
    proposalBaseBranch: typeof params.proposalBaseBranch === "string" && params.proposalBaseBranch.trim()
      ? params.proposalBaseBranch.trim()
      : undefined,
    proposalPushCommand: typeof params.proposalPushCommand === "string" && params.proposalPushCommand.trim()
      ? params.proposalPushCommand.trim()
      : undefined,
    proposalPrCommand: typeof params.proposalPrCommand === "string" && params.proposalPrCommand.trim()
      ? params.proposalPrCommand.trim()
      : undefined,
    notes: typeof params.notes === "string" && params.notes.trim() ? params.notes.trim() : undefined,
    bestScore: typeof params.bestScore === "number" ? params.bestScore : undefined,
    bestRunId: typeof params.bestRunId === "string" ? params.bestRunId : undefined,
    lastRunId: typeof params.lastRunId === "string" ? params.lastRunId : undefined,
    runs: Math.max(0, Number(params.runs ?? 0) || 0),
    acceptedRuns: Math.max(0, Number(params.acceptedRuns ?? 0) || 0),
    rejectedRuns: Math.max(0, Number(params.rejectedRuns ?? 0) || 0),
    invalidRuns: Math.max(0, Number(params.invalidRuns ?? 0) || 0),
    pendingApprovalRuns: Math.max(0, Number(params.pendingApprovalRuns ?? 0) || 0),
    consecutiveFailures: Math.max(0, Number(params.consecutiveFailures ?? 0) || 0),
    consecutiveNonImprovements: Math.max(0, Number(params.consecutiveNonImprovements ?? 0) || 0),
    createdAt: typeof params.createdAt === "string" && params.createdAt ? params.createdAt : nowIso(),
    updatedAt: nowIso()
  };
}

function buildMutationEnv(optimizer: OptimizerDefinition, baselineScore: number | null, briefPath: string): NodeJS.ProcessEnv {
  const mutationEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PAPERCLIP_OPTIMIZER_ID: optimizer.optimizerId,
    PAPERCLIP_OPTIMIZER_NAME: optimizer.name,
    PAPERCLIP_OPTIMIZER_OBJECTIVE: optimizer.objective,
    PAPERCLIP_OPTIMIZER_MUTABLE_PATHS: JSON.stringify(optimizer.mutablePaths),
    PAPERCLIP_OPTIMIZER_BEST_SCORE: baselineScore == null ? "" : String(baselineScore),
    PAPERCLIP_OPTIMIZER_SCORE_DIRECTION: optimizer.scoreDirection,
    PAPERCLIP_OPTIMIZER_BRIEF: briefPath,
    PAPERCLIP_OPTIMIZER_APPLY_MODE: optimizer.applyMode,
    PAPERCLIP_OPTIMIZER_SANDBOX_STRATEGY: optimizer.sandboxStrategy,
    PAPERCLIP_OPTIMIZER_SCORER_ISOLATION: optimizer.scorerIsolationMode,
    PAPERCLIP_OPTIMIZER_SCORE_REPEATS: String(optimizer.scoreRepeats),
    PAPERCLIP_OPTIMIZER_SCORE_AGGREGATOR: optimizer.scoreAggregator,
    PAPERCLIP_OPTIMIZER_MINIMUM_IMPROVEMENT: String(optimizer.minimumImprovement),
    PAPERCLIP_OPTIMIZER_STATUS: optimizer.status,
    PAPERCLIP_OPTIMIZER_QUEUE_STATE: optimizer.queueState,
    PAPERCLIP_OPTIMIZER_CONSECUTIVE_NON_IMPROVEMENTS: String(optimizer.consecutiveNonImprovements),
    PAPERCLIP_OPTIMIZER_CONSECUTIVE_FAILURES: String(optimizer.consecutiveFailures),
    PAPERCLIP_OPTIMIZER_POLICY: optimizer.scoreImprovementPolicy ?? "threshold",
    PAPERCLIP_OPTIMIZER_NOISE_FLOOR: optimizer.noiseFloor != null ? String(optimizer.noiseFloor) : ""
  };

  if (!optimizer.hiddenScoring) {
    mutationEnv.PAPERCLIP_OPTIMIZER_SCORE_COMMAND = optimizer.scoreCommand;
  }

  return mutationEnv;
}

async function notifyWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error("Webhook returned " + res.status + " " + res.statusText);
    }
  } catch (err) {
    throw err; // re-throw so callers can catch it
  }
}

async function finalizeRun(
  ctx: PluginContext,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  candidateImproved: boolean,
  failureOccurred: boolean,
  createdIssueTitle?: string
): Promise<OptimizerDefinition> {
  const nextQueueState = run.approvalStatus === "pending"
    ? "awaiting_approval"
    : "idle";
  const nextAcceptedRuns = optimizer.acceptedRuns + (run.applied ? 1 : 0);
  const nextRejectedRuns = optimizer.rejectedRuns + (run.outcome === "rejected" ? 1 : 0);
  const nextInvalidRuns = optimizer.invalidRuns + (run.outcome === "invalid" ? 1 : 0);
  const nextPendingApprovalRuns = optimizer.pendingApprovalRuns + (run.approvalStatus === "pending" ? 1 : 0);

  const updatedOptimizer: OptimizerDefinition = {
    ...optimizer,
    workspaceId: run.workspaceId ?? optimizer.workspaceId,
    bestScore: run.applied && run.candidateScore != null ? run.candidateScore : optimizer.bestScore,
    bestRunId: run.applied ? run.runId : optimizer.bestRunId,
    lastRunId: run.runId,
    queueState: nextQueueState,
    runs: optimizer.runs + 1,
    acceptedRuns: nextAcceptedRuns,
    rejectedRuns: nextRejectedRuns,
    invalidRuns: nextInvalidRuns,
    pendingApprovalRuns: nextPendingApprovalRuns,
    consecutiveFailures: failureOccurred ? optimizer.consecutiveFailures + 1 : 0,
    consecutiveNonImprovements: candidateImproved
      ? 0
      : optimizer.consecutiveNonImprovements + 1,
    // Auto-suggest policy switch after many consecutive confidence rejections
    suggestion: computePolicySuggestion(optimizer, run.outcome, candidateImproved),
    updatedAt: nowIso()
  };

  await upsertRun(ctx, run);
  await upsertOptimizer(ctx, updatedOptimizer);
  await ctx.metrics.write("optimizer.run", 1, {
    accepted: run.applied ? "true" : "false",
    outcome: run.outcome,
    optimizer_id: optimizer.optimizerId
  });
  await ctx.activity.log({
    companyId: optimizer.companyId,
    entityType: "project",
    entityId: optimizer.projectId,
    message: "Autoresearch Improver recorded " + run.outcome + " run " + run.runId + " for " + optimizer.name + ".",
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId,
      baselineScore: run.baselineScore ?? "n/a",
      candidateScore: run.candidateScore ?? "n/a",
      issueTitle: createdIssueTitle ?? null
    }
  });

  return updatedOptimizer;
}

async function runOptimizerCycle(
  ctx: PluginContext,
  optimizer: OptimizerDefinition
): Promise<{ optimizer: OptimizerDefinition; run: OptimizerRunRecord }> {
  if (runningOptimizers.has(optimizer.optimizerId)) {
    throw new Error("Optimizer " + optimizer.name + " is already running.");
  }

  runningOptimizers.add(optimizer.optimizerId);
  const config = await getConfig(ctx);
  const startedAt = nowIso();
  let mutationSandbox: SandboxContext | null = null;
  let scorerSandbox: ScorerContext | null = null;
  let briefPath = "";
  let retainSandbox = config.keepTmpDirs;
  let retainScorerSandbox = config.keepTmpDirs;

  const runningOptimizer: OptimizerDefinition = {
    ...optimizer,
    queueState: "running",
    updatedAt: nowIso()
  };
  await upsertOptimizer(ctx, runningOptimizer);

  try {
    const { workspaceId, workspacePath } = await resolveWorkspacePath(
      ctx,
      optimizer.companyId,
      optimizer.projectId,
      optimizer.workspaceId
    );
    const baselineRunId = optimizer.bestRunId ?? null;
    const baselineScore = await measureBaselineScore(optimizer, workspacePath, config);

    // Capture workspace HEAD at run start for stale-candidate detection
    let workspaceHeadAtRun: string | null = null;
    try {
      const { stdout } = await runGit(workspacePath, ["rev-parse", "HEAD"]);
      workspaceHeadAtRun = stdout.trim() || null;
    } catch {
      workspaceHeadAtRun = null;
    }

    mutationSandbox = await createSandboxContext(optimizer.sandboxStrategy, workspacePath);
    briefPath = path.join(os.tmpdir(), "paperclip-optimizer-brief-" + randomUUID() + ".json");
    await fs.writeFile(briefPath, JSON.stringify(buildOptimizerBrief(optimizer), null, 2), "utf8");

    const mutation = await runShellCommand(
      optimizer.mutationCommand,
      mutationSandbox.workspacePath,
      optimizer.mutationBudgetSeconds,
      buildMutationEnv(optimizer, baselineScore, briefPath),
      config.maxOutputChars
    );

    scorerSandbox = await createScorerContext(optimizer.scorerIsolationMode, mutationSandbox.workspacePath);
    const scoringResult = await measureScoreRepeats(optimizer, scorerSandbox.workspacePath, config);
    const guardrail = await measureGuardrail(optimizer, scorerSandbox.workspacePath, config);
    const artifacts = await createDiffArtifact(
      workspacePath,
      mutationSandbox.workspacePath,
      optimizer.mutablePaths,
      config.maxOutputChars * 4,
      mutationSandbox.strategy === "git_worktree" && mutationSandbox.git
        ? { git: mutationSandbox.git, sandboxRoot: mutationSandbox.sandboxRoot }
        : undefined
    );

    const comparison = (optimizer.scoreImprovementPolicy && optimizer.scoreImprovementPolicy !== "threshold")
      ? compareScoresWithPolicy(
          scoringResult.scoringRepeats.map((r) => r.score).filter((s): s is number => s != null),
          optimizer.scoreDirection,
          baselineScore,
          scoringResult.candidateScore,
          optimizer.scoreImprovementPolicy,
          optimizer.minimumImprovement,
          optimizer.confidenceThreshold ?? 2.0,
          optimizer.epsilonValue ?? 0.01,
          optimizer.noiseFloor
        )
      : compareScores(
          optimizer.scoreDirection,
          baselineScore,
          scoringResult.candidateScore,
          optimizer.minimumImprovement
        );

    const scoringInvalid = scoringResult.scoringRepeats.some((entry) => entry.structured?.invalid === true);
    const failureReason = !mutation.ok
      ? "Mutation command failed."
      : artifacts.unauthorizedChangedFiles.length > 0
        ? "Mutation touched files outside the mutable surface: " + artifacts.unauthorizedChangedFiles.join(", ") + "."
        : scoringInvalid
          ? (scoringResult.scoringRepeats.find((entry) => entry.structured?.invalid === true)?.structured?.invalidReason
            ?? "Scorer marked this run as invalid.")
          : !scoringResult.scoringRepeats.every((entry) => entry.execution.ok)
            ? "One or more scoring runs failed."
            : scoringResult.candidateScore == null
              ? "Candidate score was missing or invalid."
              : !guardrail.passed
                ? guardrail.failureReason ?? "Guardrail failed."
                : undefined;

    let outcome: RunOutcome = "rejected";
    let accepted = false;
    let applied = false;
    let approvalStatus: OptimizerRunRecord["approvalStatus"] = "not_needed";
    let reason = failureReason ?? comparison.reason;
    let patchConflict: PatchConflictInfo | null = null;

    if (failureReason) {
      outcome = "invalid";
    } else if (!comparison.improved) {
      outcome = "rejected";
    } else if (optimizer.applyMode === "dry_run") {
      outcome = "dry_run_candidate";
      retainSandbox = true;
      reason = "Candidate improved the score, but apply mode is dry_run.";
    } else if (optimizer.requireHumanApproval || optimizer.applyMode === "manual_approval") {
      outcome = "pending_approval";
      approvalStatus = "pending";
      retainSandbox = true;
      reason = "Candidate improved the score and is waiting for human approval.";
    } else {
      try {
        if (mutationSandbox.strategy === "git_worktree" && mutationSandbox.git) {
          const patch = await createWorkspacePatch(
            mutationSandbox.git,
            mutationSandbox.sandboxRoot,
            optimizer.mutablePaths
          );
          patchConflict = await applyPatchToWorkspace(workspacePath, mutationSandbox.git, patch);
        } else {
          await applySandboxToWorkspace(workspacePath, mutationSandbox.workspacePath, optimizer.mutablePaths);
        }
        outcome = "accepted";
        accepted = true;
        applied = true;
        reason = comparison.reason;
      } catch (applyError) {
        patchConflict = {
          hasConflicts: true,
          conflictingFiles: [],
          stderr: applyError instanceof Error ? applyError.message : String(applyError),
          exitCode: 1
        };
        outcome = "invalid";
        reason = "Patch apply failed: " + (applyError instanceof Error ? applyError.message : String(applyError));
      }
    }

    const run: OptimizerRunRecord = {
      runId: randomUUID(),
      optimizerId: optimizer.optimizerId,
      companyId: optimizer.companyId,
      projectId: optimizer.projectId,
      workspaceId,
      baselineRunId,
      startedAt,
      finishedAt: nowIso(),
      outcome,
      baselineScore,
      candidateScore: scoringResult.candidateScore,
      accepted,
      applied,
      approvalStatus,
      reason,
      mutation,
      scoring: scoringResult.scoring,
      scoringRepeats: scoringResult.scoringRepeats,
      scoringAggregate: scoringResult.scoringAggregate,
      guardrail: guardrail.execution,
      guardrailResult: guardrail.result,
      guardrailRepeats: guardrail.repeats,
      guardrailAggregate: guardrail.aggregate,
      mutablePaths: optimizer.mutablePaths,
      sandboxStrategy: mutationSandbox.strategy,
      sandboxPath: retainSandbox ? mutationSandbox.sandboxRoot : undefined,
      scorerIsolationMode: optimizer.scorerIsolationMode,
      scorerSandboxPath: retainScorerSandbox ? scorerSandbox.sandboxRoot : undefined,
      gitRepoRoot: mutationSandbox.git?.repoRoot,
      gitWorkspaceRelativePath: mutationSandbox.git?.workspaceRelativePath,
      artifacts,
      patchConflict,
      workspaceHeadAtRun,
      invalidReason: outcome === "invalid" ? reason : undefined,
      pullRequest: null
    };

    let createdIssueTitle: string | undefined;
    if (guardrail.failureReason && optimizer.autoCreateIssueOnGuardrailFailure) {
      const issue = await createIssueFromRun(ctx, optimizer.companyId, optimizer, run, "Guardrail failure");
      createdIssueTitle = issue.title;
    }

    const updatedOptimizer = await finalizeRun(
      ctx,
      optimizer,
      run,
      comparison.improved,
      Boolean(failureReason),
      createdIssueTitle
    );

    // Compute noiseFloor from scoring repeats for epsilon policy use.
    // Uses the current run's scores to estimate scorer variance.
    const recentScores = scoringResult.scoringRepeats.map((r) => r.score).filter((s): s is number => s != null && Number.isFinite(s));
    if (recentScores.length >= 2) {
      updatedOptimizer.noiseFloor = computeStdDev(recentScores);
    }
    await upsertOptimizer(ctx, updatedOptimizer);

    if (
      !comparison.improved &&
      updatedOptimizer.autoCreateIssueOnStagnation &&
      updatedOptimizer.consecutiveNonImprovements === updatedOptimizer.stagnationIssueThreshold
    ) {
      await createIssueFromRun(ctx, optimizer.companyId, optimizer, run, "Optimizer stagnation");
      // Auto-pause after stagnation threshold to prevent runaway non-improvements
      updatedOptimizer.status = "paused";
      updatedOptimizer.pauseReason = "Auto-paused after " + updatedOptimizer.stagnationIssueThreshold + " consecutive non-improvements.";
      updatedOptimizer.updatedAt = nowIso();
      updatedOptimizer.history = [
        ...(updatedOptimizer.history ?? []),
        { timestamp: nowIso(), action: "paused", description: "Auto-paused after " + updatedOptimizer.stagnationIssueThreshold + " stagnation events.", triggeredBy: "system" }
      ];
      if (updatedOptimizer.stagnationWebhookUrl) {
        // Fire webhook asynchronously — don't block the run completion.
        notifyWebhook(updatedOptimizer.stagnationWebhookUrl, {
          optimizerId: updatedOptimizer.optimizerId,
          name: updatedOptimizer.name,
          trigger: "stagnation",
          nonImprovements: updatedOptimizer.consecutiveNonImprovements,
          failures: updatedOptimizer.consecutiveFailures,
          reason: updatedOptimizer.pauseReason ?? ""
        }).catch((err) => ctx.logger.error("Stagnation webhook failed", { error: err instanceof Error ? err.message : String(err) }));
      }
    }

    // Auto-pause on consecutive failures (reuses stagnationIssueThreshold as the trigger).
    // Only fires once: when consecutiveFailures first reaches the threshold.
    if (
      updatedOptimizer.autoPauseOnConsecutiveFailures &&
      updatedOptimizer.consecutiveFailures > 0 &&
      updatedOptimizer.consecutiveFailures >= updatedOptimizer.stagnationIssueThreshold
    ) {
      updatedOptimizer.status = "paused";
      updatedOptimizer.pauseReason = "Auto-paused after " + updatedOptimizer.stagnationIssueThreshold + " consecutive failures.";
      updatedOptimizer.updatedAt = nowIso();
      updatedOptimizer.history = [
        ...(updatedOptimizer.history ?? []),
        { timestamp: nowIso(), action: "paused", description: "Auto-paused after " + updatedOptimizer.stagnationIssueThreshold + " consecutive failures.", triggeredBy: "system" }
      ];
      if (updatedOptimizer.stagnationWebhookUrl) {
        notifyWebhook(updatedOptimizer.stagnationWebhookUrl, {
          optimizerId: updatedOptimizer.optimizerId,
          name: updatedOptimizer.name,
          trigger: "consecutive_failures",
          nonImprovements: updatedOptimizer.consecutiveNonImprovements,
          failures: updatedOptimizer.consecutiveFailures,
          reason: updatedOptimizer.pauseReason ?? ""
        }).catch((err) => ctx.logger.error("Failure webhook failed", { error: err instanceof Error ? err.message : String(err) }));
      }
    }

    return { optimizer: updatedOptimizer, run };
  } finally {
    runningOptimizers.delete(optimizer.optimizerId);
    if (mutationSandbox && !retainSandbox) {
      await mutationSandbox.cleanup();
    }
    if (scorerSandbox && !retainScorerSandbox) {
      await scorerSandbox.cleanup();
    }
    if (briefPath) {
      await fs.rm(briefPath, { force: true }).catch(() => undefined);
    }
  }
}

async function promotePendingRun(
  ctx: PluginContext,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord
): Promise<{ optimizer: OptimizerDefinition; run: OptimizerRunRecord }> {
  if (run.approvalStatus !== "pending") {
    throw new Error("Run is not pending approval.");
  }
  if (!run.sandboxPath) {
    throw new Error("Pending run has no sandbox path to promote.");
  }

  const { workspaceId, workspacePath } = await resolveWorkspacePath(
    ctx,
    optimizer.companyId,
    optimizer.projectId,
    optimizer.workspaceId
  );

  // Stale-candidate and workspace-change detection: check if the workspace HEAD
  // changed or has uncommitted changes since the run was created.
  if (run.gitRepoRoot) {
    // Check 1: dirty workspace (uncommitted changes since the run was created).
    // For git-worktree runs, the worktree is detached so any user changes should
    // be on a different branch. For non-worktree scenarios, detect uncommitted changes.
    const { stdout: statusOutput } = await runGit(run.gitRepoRoot, ["status", "--porcelain"]);
    const dirtyFiles = statusOutput.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
    if (dirtyFiles.length > 0) {
      throw new Error(
        "Workspace has uncommitted changes. Approval is blocked to prevent sweeping unrelated changes into the applied state. Dirty files: " + dirtyFiles.map((f) => f.replace(/^.. /, "")).join(", ")
      );
    }

    // Check 2: stale workspace HEAD (the commit the run was based on has moved).
    if (run.workspaceHeadAtRun) {
      const { stdout: currentHead } = await runGit(run.gitRepoRoot, ["rev-parse", "HEAD"]);
      const currentHeadTrimmed = currentHead.trim();
      if (currentHeadTrimmed !== run.workspaceHeadAtRun.trim()) {
        throw new Error(
          "Workspace HEAD has changed since this run was created (stale candidate). Run was created at commit " + run.workspaceHeadAtRun + " but workspace is now at " + currentHeadTrimmed + ". Please run the optimizer again to get a fresh candidate before approving."
        );
      }
    }
  }

  const sandboxWorkspacePath = resolveRunSandboxWorkspacePath(run);
  let patchConflict: PatchConflictInfo | null = null;

  try {
    if (run.sandboxStrategy === "git_worktree" && run.gitRepoRoot && run.gitWorkspaceRelativePath) {
      const gitContext: GitWorkspaceContext = {
        repoRoot: run.gitRepoRoot,
        workspaceRelativePath: run.gitWorkspaceRelativePath
      };
      const patch = await createWorkspacePatch(gitContext, run.sandboxPath, run.mutablePaths);
      patchConflict = await applyPatchToWorkspace(workspacePath, gitContext, patch);
    } else {
      await applySandboxToWorkspace(workspacePath, sandboxWorkspacePath, run.mutablePaths);
    }
  } catch (applyError) {
    // Record the conflict info on the run before surfacing the error.
    patchConflict = {
      hasConflicts: true,
      conflictingFiles: [],
      stderr: applyError instanceof Error ? applyError.message : String(applyError),
      exitCode: 1
    };
    throw new Error(
      "Patch apply conflict during approval: " + (applyError instanceof Error ? applyError.message : String(applyError))
    );
  }

  const promotedRun: OptimizerRunRecord = {
    ...run,
    workspaceId,
    finishedAt: nowIso(),
    outcome: "accepted",
    accepted: true,
    applied: true,
    approvalStatus: "approved",
    patchConflict,
    reason: run.reason + " Approved by operator."
  };

  const updatedOptimizer: OptimizerDefinition = {
    ...optimizer,
    workspaceId,
    bestScore: promotedRun.candidateScore ?? optimizer.bestScore,
    bestRunId: promotedRun.runId,
    lastRunId: promotedRun.runId,
    queueState: "idle",
    acceptedRuns: optimizer.acceptedRuns + 1,
    pendingApprovalRuns: Math.max(0, optimizer.pendingApprovalRuns - 1),
    consecutiveFailures: 0,
    consecutiveNonImprovements: 0,
    updatedAt: nowIso(),
    history: [
      ...(optimizer.history ?? []),
      { timestamp: nowIso(), action: "run_accepted", description: "Run " + run.runId.slice(0, 8) + "... accepted. Score: " + (promotedRun.candidateScore ?? "n/a"), runId: promotedRun.runId }
    ]
  };

  await upsertRun(ctx, promotedRun);
  await upsertOptimizer(ctx, updatedOptimizer);
  await ctx.activity.log({
    companyId: optimizer.companyId,
    entityType: "project",
    entityId: optimizer.projectId,
    message: "Autoresearch Improver approved run " + run.runId + " for " + optimizer.name + ".",
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId
    }
  });

  const config = await getConfig(ctx);
  if (!config.keepTmpDirs && run.sandboxPath) {
    await cleanupRetainedSandbox(run);
    promotedRun.sandboxPath = undefined;
    promotedRun.scorerSandboxPath = undefined;
  }

  return { optimizer: updatedOptimizer, run: promotedRun };
}

async function rejectPendingRun(
  ctx: PluginContext,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  note?: string
): Promise<{ optimizer: OptimizerDefinition; run: OptimizerRunRecord }> {
  if (run.approvalStatus !== "pending") {
    throw new Error("Run is not pending approval.");
  }

  const rejectedRun: OptimizerRunRecord = {
    ...run,
    finishedAt: nowIso(),
    outcome: "rejected",
    accepted: false,
    applied: false,
    approvalStatus: "rejected",
    reason: [run.reason, note?.trim()].filter(Boolean).join(" ")
  };

  const updatedOptimizer: OptimizerDefinition = {
    ...optimizer,
    queueState: "idle",
    pendingApprovalRuns: Math.max(0, optimizer.pendingApprovalRuns - 1),
    rejectedRuns: optimizer.rejectedRuns + 1,
    updatedAt: nowIso(),
    history: [
      ...(optimizer.history ?? []),
      { timestamp: nowIso(), action: "run_rejected", description: "Run " + run.runId.slice(0, 8) + "... rejected. Note: " + (typeof note === "string" && note.trim() ? note.trim() : "none"), runId: run.runId }
    ]
  };

  await upsertRun(ctx, rejectedRun);
  await upsertOptimizer(ctx, updatedOptimizer);
  await ctx.activity.log({
    companyId: optimizer.companyId,
    entityType: "project",
    entityId: optimizer.projectId,
    message: "Autoresearch Improver rejected pending run " + run.runId + " for " + optimizer.name + ".",
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId
    }
  });

  const config = await getConfig(ctx);
  if (!config.keepTmpDirs && run.sandboxPath) {
    await cleanupRetainedSandbox(run);
    rejectedRun.sandboxPath = undefined;
    rejectedRun.scorerSandboxPath = undefined;
  }

  return { optimizer: updatedOptimizer, run: rejectedRun };
}

async function registerDataHandlers(ctx: PluginContext): Promise<void> {
  ctx.data.register(DATA_KEYS.projects, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    if (!companyId) return [];
    return await ctx.projects.list({ companyId, limit: 200, offset: 0 });
  });

  ctx.data.register(DATA_KEYS.projectWorkspaces, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    return await ctx.projects.listWorkspaces(projectId, companyId);
  });

  ctx.data.register(DATA_KEYS.projectOptimizers, async (params) => {
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!projectId) return [];
    const entities = await listOptimizerEntities(ctx, projectId);
    return entities.map(asOptimizer).sort((a, b) => a.name.localeCompare(b.name));
  });

  ctx.data.register(DATA_KEYS.optimizerRuns, async (params) => {
    const optimizerId = typeof params.optimizerId === "string" ? params.optimizerId : "";
    if (!optimizerId) return [];
    const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
    const entities = await listRunEntities(ctx, projectId);
    return entities
      .filter((entry) => isRunRecord(entry) && asRunRecord(entry).optimizerId === optimizerId)
      .map(asRunRecord)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  });

  ctx.data.register(DATA_KEYS.optimizerTemplates, async () => optimizerTemplates);

  ctx.data.register(DATA_KEYS.optimizerHistory, async (params) => {
    const projectId = typeof params.projectId === "string" ? params.projectId : null;
    const optimizerId = typeof params.optimizerId === "string" ? params.optimizerId : null;
    const optimizers = (await listOptimizerEntities(ctx, projectId || undefined))
      .map(asOptimizer)
      .filter((entry) => !optimizerId || entry.optimizerId === optimizerId);

    const history: Array<{
      optimizerId: string;
      name: string;
      records: ConfigChangeRecord[];
    }> = optimizers.map((opt) => ({
      optimizerId: opt.optimizerId,
      name: opt.name,
      records: opt.history ?? []
    }));

    return optimizerId ? history[0] ?? null : history;
  });

  ctx.data.register(DATA_KEYS.overview, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : null;
    const config = await getConfig(ctx);
    const optimizers = (await listOptimizerEntities(ctx))
      .map(asOptimizer)
      .filter((entry) => !companyId || entry.companyId === companyId);
    const runs = (await listRunEntities(ctx))
      .map(asRunRecord)
      .filter((entry) => !companyId || entry.companyId === companyId);
    const latestAcceptedRun = runs
      .filter((entry) => entry.accepted)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

    const overview: OverviewData = {
      pluginId: PLUGIN_ID,
      version: ctx.manifest.version,
      companyId,
      config,
      counts: {
        optimizers: optimizers.length,
        activeOptimizers: optimizers.filter((entry) => entry.status === "active").length,
        pausedOptimizers: optimizers.filter((entry) => entry.status === "paused").length,
        acceptedRuns: runs.filter((entry) => entry.accepted).length,
        rejectedRuns: runs.filter((entry) => entry.outcome === "rejected").length,
        invalidRuns: runs.filter((entry) => entry.outcome === "invalid").length,
        pendingApprovalRuns: runs.filter((entry) => entry.approvalStatus === "pending").length,
        totalRuns: runs.length
      },
      metrics: (() => {
        const scores = runs
          .filter((r) => r.candidateScore != null && Number.isFinite(r.candidateScore))
          .map((r) => r.candidateScore as number);
        const deltas = runs
          .filter((r) => r.baselineScore != null && r.candidateScore != null && Number.isFinite(r.baselineScore) && Number.isFinite(r.candidateScore))
          .map((r) => (r.candidateScore as number) - (r.baselineScore as number));
        const decisionRuns = runs.filter((r) => ["accepted", "rejected", "invalid"].includes(r.outcome));

        const avgCandidateScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        const avgScoreDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
        const rejectedCount = runs.filter((r) => r.outcome === "rejected").length;
        const invalidCount = runs.filter((r) => r.outcome === "invalid").length;
        const acceptedCount = runs.filter((r) => r.outcome === "accepted").length;
        const totalDecisions = decisionRuns.length;
        const rejectionRate = totalDecisions > 0 ? rejectedCount / totalDecisions : null;
        const invalidRate = totalDecisions > 0 ? invalidCount / totalDecisions : null;
        const acceptanceRate = totalDecisions > 0 ? acceptedCount / totalDecisions : null;
        const stdDevOfScores = computeStdDev(scores);
        const stdDevOfDeltas = computeStdDev(deltas);

        return { avgScoreDelta, avgCandidateScore, rejectionRate, invalidRate, acceptanceRate, stdDevOfScores, stdDevOfDeltas };
      })(),
      latestAcceptedRun
    };

    return overview;
  });

  ctx.data.register(DATA_KEYS.optimizerComparison, async (params) => {
    const projectId = typeof params.projectId === "string" ? params.projectId : null;
    const optimizers = (await listOptimizerEntities(ctx))
      .map(asOptimizer)
      .filter((entry) => !projectId || entry.projectId === projectId);
    const runs = (await listRunEntities(ctx))
      .map(asRunRecord)
      .filter((entry) => !projectId || entry.projectId === projectId);

    return optimizers.map((opt) => {
      const optRuns = runs.filter((r) => r.optimizerId === opt.optimizerId);
      const acceptedRuns = optRuns.filter((r) => r.outcome === "accepted");
      const bestRun = acceptedRuns.sort((a, b) =>
        opt.scoreDirection === "minimize"
          ? (a.candidateScore ?? Infinity) - (b.candidateScore ?? Infinity)
          : (b.candidateScore ?? -Infinity) - (a.candidateScore ?? -Infinity)
      )[0] ?? null;
      return {
        optimizerId: opt.optimizerId,
        name: opt.name,
        status: opt.status,
        scoreDirection: opt.scoreDirection,
        totalRuns: optRuns.length,
        acceptedRuns: acceptedRuns.length,
        rejectedRuns: optRuns.filter((r) => r.outcome === "rejected").length,
        invalidRuns: optRuns.filter((r) => r.outcome === "invalid").length,
        pendingRuns: optRuns.filter((r) => r.approvalStatus === "pending").length,
        bestScore: bestRun?.candidateScore ?? null,
        bestScoreRunId: bestRun?.runId ?? null,
        bestScoreBaseline: bestRun?.baselineScore ?? null,
        scoreDelta: bestRun && bestRun.baselineScore != null && bestRun.candidateScore != null
          ? bestRun.candidateScore - bestRun.baselineScore
          : null,
        lastRunAt: optRuns
          .map((r) => r.startedAt)
          .sort((a, b) => b.localeCompare(a))[0] ?? null,
        suggestion: opt.suggestion ?? null
      };
    });
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.autopilotProject, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return null;
    const entity = await findAutopilotProject(ctx, companyId, projectId);
    return entity ? asAutopilotProject(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.autopilotProjects, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    if (!companyId) return [];
    const entities = await listAutopilotProjectEntities(ctx);
    return entities
      .map(asAutopilotProject)
      .filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.productProgramRevision, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const revisionId = typeof params.revisionId === "string" ? params.revisionId : "";
    if (!companyId || !projectId || !revisionId) return null;
    const entity = await findProductProgramRevision(ctx, companyId, projectId, revisionId);
    if (!entity) return null;
    const revision = asProductProgramRevision(entity);
    if (revision.companyId !== companyId) return null;
    return revision;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.productProgramRevisions, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const before = typeof params.cursor === "string" ? params.cursor : undefined;
    const entities = await listProductProgramRevisionEntities(ctx, companyId, projectId, before);
    return entities
      .map(asProductProgramRevision)
      .filter((entry) => entry.companyId === companyId)
      .sort((a, b) => b.version - a.version);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.researchCycle, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
    if (!companyId || !projectId || !cycleId) return null;
    const entity = await findResearchCycle(ctx, companyId, projectId, cycleId);
    return entity ? asResearchCycle(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.researchCycles, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const entities = await listResearchCycleEntities(ctx, companyId, projectId);
    return entities.map(asResearchCycle).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.researchFindings, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const cycleId = typeof params.cycleId === "string" ? params.cycleId : undefined;
    const entities = await listResearchFindingEntities(ctx, companyId, projectId, cycleId);
    return entities.map(asResearchFinding).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.ideas, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const before = typeof params.cursor === "string" ? params.cursor : undefined;
    const entities = await listIdeaEntities(ctx, companyId, projectId, before);
    return entities.map(asIdea).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.maybePoolIdeas, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const entities = await listIdeaEntities(ctx, companyId, projectId);
    return entities.map(asIdea).filter((entry) => entry.companyId === companyId && entry.status === "maybe");
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.swipeEvents, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const entities = await listSwipeEventEntities(ctx, companyId, projectId);
    return entities.map(asSwipeEvent).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.preferenceProfile, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return null;
    return await findPreferenceProfile(ctx, companyId, projectId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.planningArtifact, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
    if (!companyId || !projectId || !artifactId) return null;
    const entity = await findPlanningArtifact(ctx, companyId, projectId, artifactId);
    return entity ? asPlanningArtifact(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.planningArtifacts, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const entities = await listPlanningArtifactEntities(ctx, companyId, projectId);
    return entities.map(asPlanningArtifact).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.deliveryRun, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const runId = typeof params.runId === "string" ? params.runId : "";
    if (!companyId || !projectId || !runId) return null;
    const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
    return entity ? asDeliveryRun(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.deliveryRuns, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const before = typeof params.cursor === "string" ? params.cursor : undefined;
    const entities = await listDeliveryRunEntities(ctx, companyId, projectId, before);
    return entities.map(asDeliveryRun).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.workspaceLease, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const leaseId = typeof params.leaseId === "string" ? params.leaseId : "";
    if (!companyId || !projectId || !leaseId) return null;
    const entity = await findWorkspaceLease(ctx, companyId, projectId, leaseId);
    return entity ? asWorkspaceLease(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.workspaceLeases, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const entities = await listWorkspaceLeaseEntities(ctx, companyId, projectId);
    return entities.map(asWorkspaceLease).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.companyBudget, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    if (!companyId) return null;
    return await findCompanyBudget(ctx, companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.companyBudgets, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    if (!companyId) return [];
    const entities = await listCompanyBudgetEntities(ctx, companyId);
    return entities.map(asCompanyBudget).filter((entry) => entry.companyId === companyId);
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.productLock, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    const lockId = typeof params.lockId === "string" ? params.lockId : "";
    if (!companyId || !projectId || !lockId) return null;
    const entity = await findProductLock(ctx, companyId, projectId, lockId);
    return entity ? asProductLock(entity) : null;
  });

  ctx.data.register(AUTOPILOT_DATA_KEYS.productLocks, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : "";
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!companyId || !projectId) return [];
    const runId = typeof params.runId === "string" ? params.runId : undefined;
    const entities = await listProductLockEntities(ctx, companyId, projectId, runId);
    return entities.map(asProductLock).filter((entry) => entry.companyId === companyId);
  });
}

async function registerActionHandlers(ctx: PluginContext): Promise<void> {
  ctx.actions.register(AUTOPILOT_ACTION_KEYS.saveAutopilotProject, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const existing = await findAutopilotProject(ctx, companyId, projectId);
    const existingData = existing ? asAutopilotProject(existing) : null;

    const autopilotId =
      existingData?.autopilotId ??
      (typeof params.autopilotId === "string" && params.autopilotId ? params.autopilotId : randomUUID());
    const automationTier = parseAutomationTier(params.automationTier, existingData?.automationTier ?? "supervised");
    const budgetMinutes = parseNonNegativeInteger(params.budgetMinutes, existingData?.budgetMinutes ?? 60);

    const autopilot: AutopilotProject = {
      autopilotId,
      companyId,
      projectId,
      enabled: params.enabled === true || (existingData?.enabled ?? false),
      automationTier,
      budgetMinutes,
      repoUrl: typeof params.repoUrl === "string" ? params.repoUrl : existingData?.repoUrl,
      workspaceId: typeof params.workspaceId === "string" ? params.workspaceId : existingData?.workspaceId,
      agentId: typeof params.agentId === "string" ? params.agentId : existingData?.agentId,
      paused: params.paused === true || (existingData?.paused ?? false),
      pauseReason: typeof params.pauseReason === "string" ? params.pauseReason : existingData?.pauseReason,
      createdAt: existingData?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    await upsertAutopilotProject(ctx, autopilot);
    return autopilot;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.enableAutopilot, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const automationTier = parseAutomationTier(params.automationTier, "supervised");
    const budgetMinutes = parseNonNegativeInteger(params.budgetMinutes, 60);

    const autopilot: AutopilotProject = {
      autopilotId: randomUUID(),
      companyId,
      projectId,
      enabled: true,
      automationTier,
      budgetMinutes,
      repoUrl: typeof params.repoUrl === "string" ? params.repoUrl : undefined,
      workspaceId: typeof params.workspaceId === "string" ? params.workspaceId : undefined,
      agentId: typeof params.agentId === "string" ? params.agentId : undefined,
      paused: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await upsertAutopilotProject(ctx, autopilot);
    return autopilot;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.disableAutopilot, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const existing = await findAutopilotProject(ctx, companyId, projectId);
    if (!existing) {
      return { ok: true, message: "No autopilot project found" };
    }

    const autopilot = asAutopilotProject(existing);
    autopilot.enabled = false;
    autopilot.updatedAt = nowIso();

    await upsertAutopilotProject(ctx, autopilot);
    return { ok: true };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.saveProductProgramRevision, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const content = typeof params.content === "string" ? params.content : "";
    if (!content.trim()) {
      throw new Error("Program content cannot be empty");
    }

    const revisionId =
      typeof params.revisionId === "string" && params.revisionId ? params.revisionId : null;

    let revision: ProductProgramRevision;

    if (revisionId) {
      const existing = await findProductProgramRevision(ctx, companyId, projectId, revisionId);
      if (!existing) {
        throw new Error("Revision not found: " + revisionId);
      }
      const existingData = asProductProgramRevision(existing);
      if (existingData.companyId !== companyId) {
        throw new Error("Revision not found");
      }
      revision = {
        ...existingData,
        content,
        updatedAt: nowIso(),
      };
    } else {
      const latest = await getLatestProductProgramRevision(ctx, companyId, projectId);
      revision = {
        revisionId: randomUUID(),
        companyId,
        projectId,
        content,
        version: latest ? latest.version + 1 : 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    }

    await upsertProductProgramRevision(ctx, revision);
    return revision;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.createProductProgramRevision, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const content = typeof params.content === "string" ? params.content : "";
    if (!content.trim()) {
      throw new Error("Program content cannot be empty");
    }

    const latest = await getLatestProductProgramRevision(ctx, companyId, projectId);
    const revision: ProductProgramRevision = {
      revisionId: randomUUID(),
      companyId,
      projectId,
      content,
      version: latest ? latest.version + 1 : 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await upsertProductProgramRevision(ctx, revision);
    return revision;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.createPlanningArtifact, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
    if (!companyId || !projectId || !ideaId) {
      throw new Error("companyId, projectId, and ideaId are required");
    }

    const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
    const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
    const automationTier = autopilot?.automationTier ?? "supervised";

    const artifact: PlanningArtifact = {
      artifactId: randomUUID(),
      companyId,
      projectId,
      ideaId,
      title: typeof params.title === "string" ? params.title : "Planning Artifact",
      scope: typeof params.scope === "string" ? params.scope : "",
      dependencies: Array.isArray(params.dependencies) ? params.dependencies : [],
      tests: Array.isArray(params.tests) ? params.tests : [],
      executionMode: (params.executionMode === "convoy") ? "convoy" : "simple",
      approvalMode: automationTier === "fullauto" ? "auto_approve" : "manual",
      automationTier,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await upsertPlanningArtifact(ctx, artifact);
    return artifact;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.createDeliveryRun, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
    const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const companyBudget = await findCompanyBudget(ctx, companyId);
    if (companyBudget && companyBudget.paused) {
      throw new Error("Company autopilot budget is paused: " + (companyBudget.pauseReason ?? "Budget exceeded"));
    }

    const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
    const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
    if (autopilot?.paused) {
      throw new Error("Project autopilot is paused: " + (autopilot.pauseReason ?? "Budget or policy pause"));
    }

    const automationTier = autopilot?.automationTier ?? "supervised";
    const runId = randomUUID();
    const branchName = typeof params.branchName === "string" ? params.branchName : `autopilot-run-${runId.slice(0, 8)}`;
    const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
    const leasedPort = typeof params.leasedPort === "number" ? params.leasedPort : null;

    const lease: WorkspaceLease = {
      leaseId: randomUUID(),
      companyId,
      projectId,
      runId,
      workspacePath,
      branchName,
      leasedPort,
      gitRepoRoot: autopilot?.repoUrl ?? null,
      isActive: true,
      createdAt: nowIso(),
      releasedAt: null
    };
    await upsertWorkspaceLease(ctx, lease);

    const run: DeliveryRun = {
      runId,
      companyId,
      projectId,
      ideaId,
      artifactId,
      status: "pending",
      automationTier,
      branchName,
      workspacePath,
      leasedPort,
      commitSha: null,
      paused: false,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await upsertDeliveryRun(ctx, run);

    if (companyBudget) {
      companyBudget.autopilotUsedMinutes += autopilot?.budgetMinutes ?? 0;
      companyBudget.updatedAt = nowIso();
      if (companyBudget.autopilotUsedMinutes >= companyBudget.autopilotBudgetMinutes) {
        companyBudget.paused = true;
        companyBudget.pauseReason = "Autopilot budget minutes exceeded";
      }
      await upsertCompanyBudget(ctx, companyBudget);
    }

    return { run, lease };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.pauseAutopilot, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const existing = await findAutopilotProject(ctx, companyId, projectId);
    if (!existing) {
      throw new Error("Autopilot project not found");
    }

    const autopilot = asAutopilotProject(existing);
    autopilot.paused = true;
    autopilot.pauseReason = typeof params.reason === "string" ? params.reason : "Operator paused";
    autopilot.updatedAt = nowIso();

    await upsertAutopilotProject(ctx, autopilot);
    return { status: "paused", pauseReason: autopilot.pauseReason };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.resumeAutopilot, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const existing = await findAutopilotProject(ctx, companyId, projectId);
    if (!existing) {
      throw new Error("Autopilot project not found");
    }

    const autopilot = asAutopilotProject(existing);
    autopilot.paused = false;
    autopilot.pauseReason = undefined;
    autopilot.updatedAt = nowIso();

    await upsertAutopilotProject(ctx, autopilot);
    return { status: "running", pauseReason: undefined };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.pauseDeliveryRun, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const runId = typeof params.runId === "string" ? params.runId : "";
    if (!companyId || !projectId || !runId) {
      throw new Error("companyId, projectId, and runId are required");
    }

    const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
    if (!entity) {
      throw new Error("Delivery run not found");
    }

    const run = asDeliveryRun(entity);
    run.paused = true;
    run.pauseReason = typeof params.reason === "string" ? params.reason : "Operator paused";
    run.status = "paused";
    run.updatedAt = nowIso();

    await upsertDeliveryRun(ctx, run);
    return { status: "paused", pauseReason: run.pauseReason };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.resumeDeliveryRun, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const runId = typeof params.runId === "string" ? params.runId : "";
    if (!companyId || !projectId || !runId) {
      throw new Error("companyId, projectId, and runId are required");
    }

    const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
    if (!entity) {
      throw new Error("Delivery run not found");
    }

    const run = asDeliveryRun(entity);
    run.paused = false;
    run.pauseReason = undefined;
    run.status = "running";
    run.updatedAt = nowIso();

    await upsertDeliveryRun(ctx, run);
    return { status: "running", pauseReason: undefined };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.updateCompanyBudget, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    if (!companyId) {
      throw new Error("companyId is required");
    }

    const existing = await findCompanyBudget(ctx, companyId);
    const budgetId = existing?.budgetId ?? randomUUID();

    const budget: CompanyBudget = {
      budgetId,
      companyId,
      totalBudgetMinutes: typeof params.totalBudgetMinutes === "number" ? params.totalBudgetMinutes : (existing?.totalBudgetMinutes ?? 0),
      usedBudgetMinutes: typeof params.usedBudgetMinutes === "number" ? params.usedBudgetMinutes : (existing?.usedBudgetMinutes ?? 0),
      autopilotBudgetMinutes: typeof params.autopilotBudgetMinutes === "number" ? params.autopilotBudgetMinutes : (existing?.autopilotBudgetMinutes ?? 0),
      autopilotUsedMinutes: typeof params.autopilotUsedMinutes === "number" ? params.autopilotUsedMinutes : (existing?.autopilotUsedMinutes ?? 0),
      paused: params.paused === true || (existing?.paused ?? false),
      pauseReason: typeof params.pauseReason === "string" ? params.pauseReason : existing?.pauseReason,
      updatedAt: nowIso()
    };

    await upsertCompanyBudget(ctx, budget);
    return budget;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.checkBudgetAndPauseIfNeeded, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
    if (!autopilotEntity) return { paused: false, reason: null };

    const autopilot = asAutopilotProject(autopilotEntity);
    const companyBudget = await findCompanyBudget(ctx, companyId);

    if (companyBudget && companyBudget.autopilotUsedMinutes >= companyBudget.autopilotBudgetMinutes) {
      if (!companyBudget.paused) {
        companyBudget.paused = true;
        companyBudget.pauseReason = "Company-wide autopilot budget minutes exceeded";
        companyBudget.updatedAt = nowIso();
        await upsertCompanyBudget(ctx, companyBudget);
      }
      return { paused: true, reason: companyBudget.pauseReason ?? "Budget exceeded" };
    }

    return { paused: autopilot.paused, reason: autopilot.pauseReason ?? null };
  });

  ctx.actions.register(ACTION_KEYS.saveOptimizer, async (params) => {
    const existing = typeof params.optimizerId === "string" && typeof params.projectId === "string"
      ? await findOptimizer(ctx, params.projectId, params.optimizerId)
      : null;
    const optimizer = await createOptimizerFromParams(ctx, {
      ...(existing?.data ?? {}),
      ...params,
      createdAt: (existing?.data as OptimizerDefinition | undefined)?.createdAt
    });

    const now = nowIso();
    const existingOptimizer = existing ? asOptimizer(existing) : null;
    // If the scorer changed (scoreCommand, scoreFormat, scoreKey, or scoreRepeats), reset noiseFloor
    // since the new scorer may have different variance characteristics.
    const scorerChanged = existingOptimizer && (
      existingOptimizer.scoreCommand !== params.scoreCommand ||
      existingOptimizer.scoreFormat !== params.scoreFormat ||
      existingOptimizer.scoreKey !== params.scoreKey ||
      existingOptimizer.scoreRepeats !== params.scoreRepeats
    );
    if (scorerChanged && existingOptimizer?.noiseFloor != null) {
      optimizer.noiseFloor = null;
    }
    if (existing) {
      // Config update: append history entry
      optimizer.history = [
        ...(optimizer.history ?? []),
        { timestamp: now, action: "config_updated", description: scorerChanged ? "Configuration updated (scorer changed, noiseFloor reset)." : "Configuration updated.", triggeredBy: "user" }
      ];
    } else {
      // New optimizer: record creation
      optimizer.history = [
        ...(optimizer.history ?? []),
        { timestamp: now, action: "created", description: "Optimizer created.", triggeredBy: "user" }
      ];
    }

    await upsertOptimizer(ctx, optimizer);
    return optimizer;
  });

  ctx.actions.register(ACTION_KEYS.deleteOptimizer, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) return { ok: true };

    const optimizer = asOptimizer(entity);
    await upsertOptimizer(ctx, {
      ...optimizer,
      status: "paused",
      queueState: "idle",
      updatedAt: nowIso(),
      notes: [optimizer.notes, "[deleted]"].filter(Boolean).join("\n")
    }, "deleted");
    return { ok: true };
  });

  ctx.actions.register(ACTION_KEYS.cloneOptimizer, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const newName = typeof params.newName === "string" && params.newName.trim()
      ? params.newName.trim()
      : undefined;

    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }

    const original = asOptimizer(entity);
    const now = nowIso();

    // Create clone with new ID and name, preserve most settings
    const clone: OptimizerDefinition = {
      ...original,
      optimizerId: randomUUID(),
      name: newName ?? (original.name + " (clone)"),
      companyId: original.companyId,
      projectId: original.projectId,
      createdAt: now,
      updatedAt: now,
      runs: 0,
      acceptedRuns: 0,
      rejectedRuns: 0,
      invalidRuns: 0,
      pendingApprovalRuns: 0,
      bestScore: undefined,
      bestRunId: undefined,
      lastRunId: undefined,
      consecutiveFailures: 0,
      consecutiveNonImprovements: 0,
      cloneCount: undefined,
      history: [
        ...(original.history ?? []),
        {
          timestamp: now,
          action: "cloned",
          description: 'Cloned from optimizer "' + original.name + '" (' + optimizerId.slice(0, 8) + "...)",
          triggeredBy: typeof params.triggeredBy === "string" && params.triggeredBy.trim()
            ? params.triggeredBy.trim()
            : "system"
        }
      ]
    };

    await upsertOptimizer(ctx, clone);

    // Increment cloneCount on the original
    await upsertOptimizer(ctx, {
      ...original,
      cloneCount: (original.cloneCount ?? 0) + 1,
      updatedAt: now
    });

    return { optimizerId: clone.optimizerId, name: clone.name };
  });

  ctx.actions.register(ACTION_KEYS.pauseOptimizer, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const reason = typeof params.reason === "string" && params.reason.trim()
      ? params.reason.trim()
      : "Paused by operator.";

    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }

    const optimizer = asOptimizer(entity);
    const now = nowIso();
    await upsertOptimizer(ctx, {
      ...optimizer,
      status: "paused",
      queueState: "idle",
      pauseReason: reason,
      updatedAt: now,
      history: [
        ...(optimizer.history ?? []),
        {
          timestamp: now,
          action: "paused",
          description: reason,
          triggeredBy: typeof params.triggeredBy === "string" && params.triggeredBy.trim()
            ? params.triggeredBy.trim()
            : "operator"
        }
      ]
    });
    return { status: "paused", pauseReason: reason };
  });

  ctx.actions.register(ACTION_KEYS.resumeOptimizer, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");

    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }

    const optimizer = asOptimizer(entity);
    const now = nowIso();
    await upsertOptimizer(ctx, {
      ...optimizer,
      status: "active",
      pauseReason: undefined,
      updatedAt: now,
      history: [
        ...(optimizer.history ?? []),
        {
          timestamp: now,
          action: "resumed",
          description: "Optimizer resumed.",
          triggeredBy: typeof params.triggeredBy === "string" && params.triggeredBy.trim()
            ? params.triggeredBy.trim()
            : "operator"
        }
      ]
    });
    return { status: "active" };
  });

  ctx.actions.register(ACTION_KEYS.runOptimizerCycle, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }
    return await runOptimizerCycle(ctx, asOptimizer(entity));
  });

  ctx.actions.register(ACTION_KEYS.enqueueOptimizerRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }
    const optimizer = asOptimizer(entity);
    const queued = {
      ...optimizer,
      queueState: "queued" as const,
      updatedAt: nowIso()
    };
    await upsertOptimizer(ctx, queued);
    return queued;
  });

  ctx.actions.register(ACTION_KEYS.approveOptimizerRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const runId = ensureNonEmptyString(params.runId, "runId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    const runEntity = await findRun(ctx, projectId, runId);
    if (!optimizerEntity || !runEntity) {
      throw new Error("Optimizer or run not found.");
    }
    return await promotePendingRun(ctx, asOptimizer(optimizerEntity), asRunRecord(runEntity));
  });

  ctx.actions.register(ACTION_KEYS.rejectOptimizerRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const runId = ensureNonEmptyString(params.runId, "runId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    const runEntity = await findRun(ctx, projectId, runId);
    if (!optimizerEntity || !runEntity) {
      throw new Error("Optimizer or run not found.");
    }
    const note = typeof params.note === "string" ? params.note : undefined;
    return await rejectPendingRun(ctx, asOptimizer(optimizerEntity), asRunRecord(runEntity), note);
  });

  ctx.actions.register(ACTION_KEYS.createIssueFromRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    if (!optimizerEntity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }
    const optimizer = asOptimizer(optimizerEntity);
    const runEntities = await listRunEntities(ctx, projectId);
    const targetRunId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : undefined;
    const run = runEntities
      .map(asRunRecord)
      .filter((entry) => entry.optimizerId === optimizerId)
      .filter((entry) => !targetRunId || entry.runId === targetRunId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!run) {
      throw new Error("No matching run exists for this optimizer.");
    }
    return await createIssueFromRun(
      ctx,
      optimizer.companyId,
      optimizer,
      run,
      typeof params.titlePrefix === "string" && params.titlePrefix.trim() ? params.titlePrefix.trim() : undefined
    );
  });

  ctx.actions.register(ACTION_KEYS.createPullRequestFromRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    if (!optimizerEntity) {
      throw new Error("Optimizer " + optimizerId + " was not found.");
    }
    const optimizer = asOptimizer(optimizerEntity);
    const targetRunId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : undefined;
    const run = targetRunId
      ? (await findRun(ctx, projectId, targetRunId))?.data as OptimizerRunRecord | undefined
      : await findLatestAcceptedRun(ctx, projectId, optimizerId) ?? undefined;
    if (!run || run.optimizerId !== optimizerId) {
      throw new Error("No matching applied run exists for this optimizer.");
    }
    const pullRequest = await createPullRequestFromRun(ctx, optimizer, run, await getConfig(ctx));
    const updatedRun: OptimizerRunRecord = {
      ...run,
      pullRequest
    };
    await upsertRun(ctx, updatedRun);
    return pullRequest;
  });

  ctx.actions.register(ACTION_KEYS.deleteProposalBranch, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const runId = ensureNonEmptyString(params.runId, "runId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    const runEntity = await findRun(ctx, projectId, runId);
    if (!optimizerEntity || !runEntity) {
      throw new Error("Optimizer or run not found.");
    }
    const optimizer = asOptimizer(optimizerEntity);
    const run = asRunRecord(runEntity);
    const remote = typeof params.remote === "string" && params.remote.trim()
      ? params.remote.trim()
      : undefined;
    return await deleteProposalBranch(ctx, optimizer, run, remote);
  });

  // ─── Research Action Handlers ───────────────────────────────────────────────

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.startResearchCycle, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const query = typeof params.query === "string" ? params.query : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const cycle: ResearchCycle = {
      cycleId: randomUUID(),
      companyId,
      projectId,
      status: "running",
      query,
      findingsCount: 0,
      startedAt: nowIso(),
    };

    await upsertResearchCycle(ctx, cycle);
    return cycle;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.completeResearchCycle, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
    if (!companyId || !projectId || !cycleId) {
      throw new Error("companyId, projectId, and cycleId are required");
    }

    const entity = await findResearchCycle(ctx, companyId, projectId, cycleId);
    if (!entity) {
      throw new Error("Research cycle not found");
    }

    const cycle = asResearchCycle(entity);
    if (cycle.companyId !== companyId) {
      throw new Error("Research cycle not found");
    }

    cycle.status = params.status === "failed" ? "failed" : "completed";
    cycle.reportContent =
      typeof params.reportContent === "string" ? params.reportContent : cycle.reportContent;
    cycle.findingsCount =
      typeof params.findingsCount === "number" ? params.findingsCount : cycle.findingsCount;
    cycle.completedAt = nowIso();
    if (typeof params.error === "string") cycle.error = params.error;

    await upsertResearchCycle(ctx, cycle);
    return cycle;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.addResearchFinding, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
    if (!companyId || !projectId || !cycleId) {
      throw new Error("companyId, projectId, and cycleId are required");
    }

    const finding: ResearchFinding = {
      findingId: randomUUID(),
      companyId,
      projectId,
      cycleId,
      title: typeof params.title === "string" ? params.title : "Untitled Finding",
      description: typeof params.description === "string" ? params.description : "",
      sourceUrl: typeof params.sourceUrl === "string" ? params.sourceUrl : undefined,
      sourceLabel: typeof params.sourceLabel === "string" ? params.sourceLabel : undefined,
      evidenceText: typeof params.evidenceText === "string" ? params.evidenceText : undefined,
      confidence:
        typeof params.confidence === "number"
          ? Math.max(0, Math.min(1, params.confidence))
          : 0.5,
      createdAt: nowIso(),
    };

    await upsertResearchFinding(ctx, finding);
    return finding;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.generateIdeas, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const cycleId = typeof params.cycleId === "string" ? params.cycleId : undefined;
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const ideasRaw = Array.isArray(params.ideas) ? params.ideas : [];
    const created: Idea[] = [];

    for (const raw of ideasRaw) {
      const title = typeof raw.title === "string" ? raw.title : "Untitled Idea";
      const description = typeof raw.description === "string" ? raw.description : "";
      const rationale = typeof raw.rationale === "string" ? raw.rationale : "";
      const sourceReferences = Array.isArray(raw.sourceReferences) ? raw.sourceReferences : [];
      const score =
        typeof raw.score === "number" ? Math.max(0, Math.min(100, raw.score)) : 50;

      // Check for duplicates
      const duplicate = await findDuplicateIdea(
        ctx,
        companyId,
        projectId,
        title,
        description
      );
      if (duplicate && duplicate.similarity >= 0.9) {
        // Near-exact duplicate - suppress with annotation
        const idea: Idea = {
          ideaId: randomUUID(),
          companyId,
          projectId,
          cycleId,
          title: title + " [Possible Duplicate]",
          description,
          rationale,
          sourceReferences,
          score: Math.floor(score * 0.9),
          status: "active",
          duplicateOfIdeaId: duplicate.idea.ideaId,
          duplicateAnnotated: true,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await upsertIdea(ctx, idea);
        created.push(idea);
      } else if (duplicate && duplicate.similarity >= 0.75) {
        // Lower similarity - annotate
        const idea: Idea = {
          ideaId: randomUUID(),
          companyId,
          projectId,
          cycleId,
          title: title + " [Review Duplicate]",
          description,
          rationale,
          sourceReferences,
          score,
          status: "active",
          duplicateOfIdeaId: duplicate.idea.ideaId,
          duplicateAnnotated: true,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await upsertIdea(ctx, idea);
        created.push(idea);
      } else {
        // New idea, no duplicate
        const idea: Idea = {
          ideaId: randomUUID(),
          companyId,
          projectId,
          cycleId,
          title,
          description,
          rationale,
          sourceReferences,
          score,
          status: "active",
          duplicateAnnotated: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await upsertIdea(ctx, idea);
        created.push(idea);
      }
    }

    // Apply preference profile ordering if available
    const profile = await findPreferenceProfile(ctx, companyId, projectId);
    if (profile) {
      created.sort((a, b) => {
        const aWeight = a.score * (profile.yesCount + profile.nowCount + 1);
        const bWeight = b.score * (profile.yesCount + profile.nowCount + 1);
        return bWeight - aWeight;
      });
    }

    return created;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.recordSwipe, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
    const decision = isValidSwipeDecision(params.decision) ? params.decision : "pass";
    if (!companyId || !projectId || !ideaId) {
      throw new Error("companyId, projectId, and ideaId are required");
    }

    // Record the swipe event
    const swipe: SwipeEvent = {
      swipeId: randomUUID(),
      companyId,
      projectId,
      ideaId,
      decision,
      createdAt: nowIso(),
    };
    await upsertSwipeEvent(ctx, swipe);

    // Update the idea status based on decision
    const idea = await findIdeaById(ctx, companyId, projectId, ideaId);
    if (!idea) {
      throw new Error("Idea not found");
    }

    let newStatus: IdeaStatus = idea.status;
    if (decision === "pass") {
      newStatus = "rejected";
    } else if (decision === "maybe") {
      newStatus = "maybe";
    } else if (decision === "yes" || decision === "now") {
      newStatus = "approved";
    }

    idea.status = newStatus;
    idea.updatedAt = nowIso();
    await upsertIdea(ctx, idea);

    // Update the preference profile
    const existingProfile = await findPreferenceProfile(ctx, companyId, projectId);
    const profileId = existingProfile?.profileId ?? randomUUID();
    const profile: PreferenceProfile = {
      profileId,
      companyId,
      projectId,
      passCount: existingProfile?.passCount ?? 0,
      maybeCount: existingProfile?.maybeCount ?? 0,
      yesCount: existingProfile?.yesCount ?? 0,
      nowCount: existingProfile?.nowCount ?? 0,
      lastUpdated: nowIso(),
    };

    if (decision === "pass") profile.passCount++;
    else if (decision === "maybe") profile.maybeCount++;
    else if (decision === "yes") profile.yesCount++;
    else if (decision === "now") profile.nowCount++;

    await upsertPreferenceProfile(ctx, profile);

    // Auto-create planning artifact and delivery run for approved ideas
    let planningArtifact: PlanningArtifact | null = null;
    let deliveryRun: DeliveryRun | null = null;

    if (decision === "yes" || decision === "now") {
      // Create planning artifact
      const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
      const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
      const automationTier = autopilot?.automationTier ?? "supervised";

      planningArtifact = {
        artifactId: randomUUID(),
        companyId,
        projectId,
        ideaId,
        title: idea.title,
        scope: idea.description || "",
        dependencies: [],
        tests: [],
        executionMode: "simple",
        approvalMode: automationTier === "fullauto" ? "auto_approve" : "manual",
        automationTier,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await upsertPlanningArtifact(ctx, planningArtifact);

      // Create delivery run
      const companyBudget = await findCompanyBudget(ctx, companyId);
      if (companyBudget && companyBudget.paused) {
        // Budget paused but still created the artifact
      } else if (autopilot?.paused) {
        // Autopilot paused but still created the artifact
      } else {
        const runId = randomUUID();
        const branchName = `autopilot-run-${runId.slice(0, 8)}`;

        const lease: WorkspaceLease = {
          leaseId: randomUUID(),
          companyId,
          projectId,
          runId,
          workspacePath: autopilot?.workspaceId ?? "",
          branchName,
          leasedPort: null,
          gitRepoRoot: autopilot?.repoUrl ?? null,
          isActive: true,
          createdAt: nowIso(),
          releasedAt: null
        };
        await upsertWorkspaceLease(ctx, lease);

        deliveryRun = {
          runId,
          companyId,
          projectId,
          ideaId,
          artifactId: planningArtifact.artifactId,
          status: "pending",
          automationTier,
          branchName,
          workspacePath: autopilot?.workspaceId ?? "",
          leasedPort: null,
          commitSha: null,
          paused: false,
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        await upsertDeliveryRun(ctx, deliveryRun);
      }
    }

    return { swipe, idea, profile, planningArtifact, deliveryRun };
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.updatePreferenceProfile, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    if (!companyId || !projectId) {
      throw new Error("companyId and projectId are required");
    }

    const existing = await findPreferenceProfile(ctx, companyId, projectId);
    const profileId = existing?.profileId ?? randomUUID();

    const profile: PreferenceProfile = {
      profileId,
      companyId,
      projectId,
      passCount:
        typeof params.passCount === "number" ? params.passCount : (existing?.passCount ?? 0),
      maybeCount:
        typeof params.maybeCount === "number" ? params.maybeCount : (existing?.maybeCount ?? 0),
      yesCount:
        typeof params.yesCount === "number" ? params.yesCount : (existing?.yesCount ?? 0),
      nowCount:
        typeof params.nowCount === "number" ? params.nowCount : (existing?.nowCount ?? 0),
      lastUpdated: nowIso(),
    };

    await upsertPreferenceProfile(ctx, profile);
    return profile;
  });

  // ─── Product Lock Action Handlers ──────────────────────────────────────────

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.acquireProductLock, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const runId = typeof params.runId === "string" ? params.runId : "";
    const targetBranch = typeof params.targetBranch === "string" ? params.targetBranch : "";
    const lockType = (params.lockType === "product_lock" || params.lockType === "merge_lock")
      ? params.lockType
      : "product_lock";
    const blockReason = typeof params.blockReason === "string" ? params.blockReason : undefined;
    if (!companyId || !projectId || !runId || !targetBranch) {
      throw new Error("companyId, projectId, runId, and targetBranch are required");
    }

    // Check if there's already an active lock on this branch
    const existingLock = await findBlockingLock(ctx, companyId, projectId, targetBranch, runId);
    if (existingLock) {
      throw new Error(
        `Cannot acquire lock: ${existingLock.lockType} already held by run ${existingLock.runId} on branch ${targetBranch}. Block reason: ${existingLock.blockReason ?? "None"}`
      );
    }

    const runEntity = await findDeliveryRun(ctx, companyId, projectId, runId);
    const run = runEntity ? asDeliveryRun(runEntity) : null;

    const lock: ProductLock = {
      lockId: randomUUID(),
      companyId,
      projectId,
      runId,
      lockType,
      targetBranch,
      targetPath: run?.workspacePath ?? "",
      acquiredAt: nowIso(),
      releasedAt: null,
      isActive: true,
      blockReason
    };

    await upsertProductLock(ctx, lock);
    return lock;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.releaseProductLock, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const lockId = typeof params.lockId === "string" ? params.lockId : "";
    if (!companyId || !projectId || !lockId) {
      throw new Error("companyId, projectId, and lockId are required");
    }

    const lockEntity = await findProductLock(ctx, companyId, projectId, lockId);
    if (!lockEntity) {
      throw new Error("Product lock not found");
    }

    const lock = asProductLock(lockEntity);
    lock.isActive = false;
    lock.releasedAt = nowIso();
    await upsertProductLock(ctx, lock);
    return lock;
  });

  ctx.actions.register(AUTOPILOT_ACTION_KEYS.checkMergeConflict, async (params) => {
    const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
    const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
    const runId = typeof params.runId === "string" ? params.runId : "";
    const targetBranch = typeof params.targetBranch === "string" ? params.targetBranch : "";
    if (!companyId || !projectId || !runId || !targetBranch) {
      throw new Error("companyId, projectId, runId, and targetBranch are required");
    }

    const blockingLock = await findBlockingLock(ctx, companyId, projectId, targetBranch, runId);
    if (blockingLock) {
      return {
        hasConflict: true,
        conflictReason: `Branch "${targetBranch}" is locked by ${blockingLock.lockType} from run ${blockingLock.runId}. ${blockingLock.blockReason ?? ""}`.trim(),
        blockingLock
      };
    }
    return { hasConflict: false, conflictReason: null, blockingLock: null };
  });
}

async function registerToolHandlers(ctx: PluginContext): Promise<void> {
  ctx.tools.register(
    TOOL_KEYS.listOptimizers,
    {
      displayName: "List project optimizers",
      description: "Summarize optimizer loops registered for a project.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" }
        },
        required: ["projectId"]
      }
    },
    async (params, runCtx): Promise<ToolResult> => {
      const projectId = typeof (params as { projectId?: string }).projectId === "string"
        ? (params as { projectId: string }).projectId
        : runCtx.projectId;
      const entities = await listOptimizerEntities(ctx, projectId);
      const optimizers = entities.map(asOptimizer);
      return {
        content: optimizers.length === 0
          ? "No optimizers are configured for this project."
          : optimizers.map((entry) =>
            entry.name + ': status=' + entry.status + ', queue=' + entry.queueState + ', best=' + (entry.bestScore ?? 'n/a') + ', repeats=' + entry.scoreRepeats + ', apply=' + entry.applyMode + ', sandbox=' + entry.sandboxStrategy + ', scorer=' + entry.scorerIsolationMode + '\n'
          ).join("\n"),
        data: optimizers
      };
    }
  );

  ctx.tools.register(
    TOOL_KEYS.createIssueFromAcceptedRun,
    {
      displayName: "Create issue from accepted optimizer run",
      description: "Create a Paperclip issue from the latest accepted run for an optimizer.",
      parametersSchema: {
        type: "object",
        properties: {
          optimizerId: { type: "string" },
          titlePrefix: { type: "string" }
        },
        required: ["optimizerId"]
      }
    },
    async (params, runCtx): Promise<ToolResult> => {
      const optimizerId = ensureNonEmptyString((params as { optimizerId?: string }).optimizerId, "optimizerId");
      const optimizerEntity = await findOptimizer(ctx, runCtx.projectId, optimizerId);
      if (!optimizerEntity) {
        return { error: "Optimizer " + optimizerId + " not found in project " + runCtx.projectId + "." };
      }
      const optimizer = asOptimizer(optimizerEntity);
      const runEntities = await listRunEntities(ctx, runCtx.projectId);
      const acceptedRun = runEntities
        .map(asRunRecord)
        .filter((entry) => entry.optimizerId === optimizerId && entry.accepted)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (!acceptedRun) {
        return { error: "Optimizer " + optimizer.name + " has no accepted run yet." };
      }

      const issue = await createIssueFromRun(
        ctx,
        runCtx.companyId,
        optimizer,
        acceptedRun,
        typeof (params as { titlePrefix?: string }).titlePrefix === "string"
          ? (params as { titlePrefix: string }).titlePrefix
          : undefined
      );

      return {
        content: "Created issue " + issue.title,
        data: issue
      };
    }
  );

  ctx.tools.register(
    TOOL_KEYS.createPullRequestFromAcceptedRun,
    {
      displayName: "Create pull request from accepted optimizer run",
      description: "Create a branch, commit, and optional pull request from the latest accepted run for an optimizer.",
      parametersSchema: {
        type: "object",
        properties: {
          optimizerId: { type: "string" },
          runId: { type: "string" }
        },
        required: ["optimizerId"]
      }
    },
    async (params, runCtx): Promise<ToolResult> => {
      const optimizerId = ensureNonEmptyString((params as { optimizerId?: string }).optimizerId, "optimizerId");
      const optimizerEntity = await findOptimizer(ctx, runCtx.projectId, optimizerId);
      if (!optimizerEntity) {
        return { error: "Optimizer " + optimizerId + " not found in project " + runCtx.projectId + "." };
      }
      const optimizer = asOptimizer(optimizerEntity);
      const targetRunId = typeof (params as { runId?: string }).runId === "string"
        ? (params as { runId: string }).runId
        : undefined;
      const run = targetRunId
        ? (await findRun(ctx, runCtx.projectId, targetRunId))?.data as OptimizerRunRecord | undefined
        : await findLatestAcceptedRun(ctx, runCtx.projectId, optimizerId) ?? undefined;
      if (!run || run.optimizerId !== optimizerId) {
        return { error: "Optimizer " + optimizer.name + " has no matching applied run yet." };
      }

      const pullRequest = await createPullRequestFromRun(ctx, optimizer, run, await getConfig(ctx));
      await upsertRun(ctx, {
        ...run,
        pullRequest
      });

      const content = pullRequest.pullRequestUrl
        ? "Created branch " + pullRequest.branchName + " and pull request " + pullRequest.pullRequestUrl
        : "Created branch " + pullRequest.branchName + " and commit " + pullRequest.commitSha;
      return { content, data: pullRequest };
    }
  );

  ctx.tools.register(
    TOOL_KEYS.exportOptimizerRuns,
    {
      displayName: "Export optimizer runs as CSV",
      description: "Export optimizer runs for a project as CSV. Optionally filter by optimizer or date range.",
      parametersSchema: {
        type: "object",
        properties: {
          optimizerId: { type: "string", description: "Filter to a specific optimizer ID." },
          format: { type: "string", enum: ["csv", "json"], default: "csv", description: "Export format." }
        }
      }
    },
    async (params, runCtx): Promise<ToolResult> => {
      const format = (params as { format?: string }).format ?? "csv";
      const optimizerId = (params as { optimizerId?: string }).optimizerId;
      const allRuns = (await listRunEntities(ctx))
        .map(asRunRecord)
        .filter((r) => r.projectId === runCtx.projectId)
        .filter((r) => !optimizerId || r.optimizerId === optimizerId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      if (allRuns.length === 0) {
        return { content: "No runs found.", data: [] };
      }

      if (format === "json") {
        return { content: "Exported " + allRuns.length + " runs as JSON.", data: allRuns };
      }

      const headers = [
        "runId", "optimizerId", "outcome", "approvalStatus", "accepted",
        "startedAt", "finishedAt", "durationMs",
        "baselineScore", "candidateScore", "scoreDelta", "improved",
        "guardrailPass", "guardrailPrimary",
        "sandboxStrategy", "approvalStatus", "applyState", "errorMessage",
        "branchName", "commitSha", "patchConflict"
      ];
      const rows = allRuns.map((r) => [
        r.runId,
        r.optimizerId,
        r.outcome ?? "",
        r.approvalStatus ?? "",
        r.accepted ? "true" : "false",
        r.startedAt,
        r.finishedAt,
        String(Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime())),
        r.baselineScore != null ? String(r.baselineScore) : "",
        r.candidateScore != null ? String(r.candidateScore) : "",
        r.baselineScore != null && r.candidateScore != null ? String(r.candidateScore - r.baselineScore) : "",
        r.accepted ? "true" : "false",
        r.guardrailRepeats ? (r.guardrailRepeats.every((entry) => entry.passed) ? "true" : "false") : "",
        r.guardrailAggregate?.primary != null ? String(r.guardrailAggregate.primary) : "",
        r.sandboxStrategy ?? "",
        r.approvalStatus ?? "",
        r.applied ? "applied" : "not_applied",
        r.invalidReason ?? (r.outcome === "invalid" ? r.reason : ""),
        r.pullRequest?.branchName ?? "",
        r.pullRequest?.commitSha ?? "",
        r.patchConflict != null ? String(r.patchConflict.hasConflicts) : ""
      ].map((v) => "\"" + String(v).replace(/"/g, "\"\"") + "\""));

      const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
      return { content: "Exported " + allRuns.length + " runs as CSV.\n\n" + csv, data: csv };
    }
  );
}

async function registerJobs(ctx: PluginContext): Promise<void> {
  ctx.jobs.register(JOB_KEYS.optimizerSweep, async (_job: PluginJobContext) => {
    const config = await getConfig(ctx);
    const entities = await listOptimizerEntities(ctx);
    const candidates = entities
      .map(asOptimizer)
      .filter((entry) => entry.status === "active")
      .filter((entry) => entry.queueState === "queued" || (entry.autoRun && entry.queueState === "idle"))
      .slice(0, config.sweepLimit);

    for (const optimizer of candidates) {
      try {
        await runOptimizerCycle(ctx, optimizer);
      } catch (error) {
        ctx.logger.error("Optimizer sweep failed", {
          optimizerId: optimizer.optimizerId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    await registerDataHandlers(ctx);
    await registerActionHandlers(ctx);
    await registerToolHandlers(ctx);
    await registerJobs(ctx);
    ctx.logger.info("Autoresearch Improver plugin ready", { pluginId: PLUGIN_ID });
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const config = currentContext ? await getConfig(currentContext) : {
      defaultMutationBudgetSeconds: DEFAULTS.mutationBudgetSeconds,
      defaultScoreBudgetSeconds: DEFAULTS.scoreBudgetSeconds,
      defaultGuardrailBudgetSeconds: DEFAULTS.guardrailBudgetSeconds,
      keepTmpDirs: false,
      maxOutputChars: DEFAULTS.maxOutputChars,
      sweepLimit: DEFAULTS.sweepLimit,
      scoreRepeats: DEFAULTS.scoreRepeats,
      minimumImprovement: DEFAULTS.minimumImprovement,
      stagnationIssueThreshold: DEFAULTS.stagnationIssueThreshold
    };

    return {
      status: "ok",
      message: "Autoresearch improver is ready",
      details: {
        runningOptimizers: runningOptimizers.size,
        keepTmpDirs: config.keepTmpDirs,
        sweepLimit: config.sweepLimit,
        scoreRepeats: config.scoreRepeats
      }
    };
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.keepTmpDirs === true) {
      warnings.push("keepTmpDirs is enabled; sandbox workspaces will accumulate until manually cleaned.");
    }

    for (const key of [
      "defaultMutationBudgetSeconds",
      "defaultScoreBudgetSeconds",
      "defaultGuardrailBudgetSeconds",
      "maxOutputChars",
      "sweepLimit",
      "scoreRepeats",
      "stagnationIssueThreshold"
    ]) {
      const value = config[key];
      if (value != null && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
        errors.push(key + " must be a positive number.");
      }
    }

    if (config.minimumImprovement != null && (!Number.isFinite(Number(config.minimumImprovement)) || Number(config.minimumImprovement) < 0)) {
      errors.push("minimumImprovement must be a non-negative number.");
    }

    return {
      ok: errors.length === 0,
      warnings,
      errors
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
