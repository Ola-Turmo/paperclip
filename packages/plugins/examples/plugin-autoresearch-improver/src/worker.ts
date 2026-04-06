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
  aggregateStructuredMetrics,
  buildOptimizerBrief,
  clampNonNegativeNumber,
  clampPositiveInteger,
  compareScores,
  emptyDiffArtifact,
  extractScore,
  extractStructuredMetricResult,
  formatCommandSummary,
  normalizeDotPath,
  normalizeMutablePaths,
  normalizeRelativePath,
  summarizeOutput
} from "./lib/optimizer.js";
import type {
  ApplyMode,
  CommandExecutionResult,
  OptimizerDefinition,
  OptimizerRunRecord,
  OptimizerTemplate,
  OverviewData,
  PluginConfigValues,
  RunDiffArtifact,
  RunOutcome,
  ScoreAggregator,
  ScoreDirection,
  ScoreFormat,
  StructuredMetricResult
} from "./types.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const runningOptimizers = new Set<string>();
let currentContext: PluginContext | null = null;

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
      applyMode: "manual_approval",
      requireHumanApproval: true,
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
      applyMode: "dry_run",
      requireHumanApproval: false
    }
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function isScoreAggregator(value: unknown): value is ScoreAggregator {
  return value === "median" || value === "mean" || value === "max" || value === "min";
}

function isApplyMode(value: unknown): value is ApplyMode {
  return value === "automatic" || value === "manual_approval" || value === "dry_run";
}

function isScoreFormat(value: unknown): value is ScoreFormat {
  return value === "number" || value === "json";
}

function parseDirection(value: unknown): ScoreDirection {
  return value === "minimize" ? "minimize" : "maximize";
}

function ensureNonEmptyString(value: unknown, field: string): string {
  const stringValue = typeof value === "string" ? value.trim() : "";
  if (!stringValue) {
    throw new Error(`${field} is required`);
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
    throw new Error(`Path escapes workspace: ${relativePath}`);
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
    return relativePath === mutablePath || relativePath.startsWith(`${mutablePath}/`);
  });
}

async function listFilesRecursively(rootDir: string, baseDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(absolutePath, baseDir));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(baseDir, absolutePath).replace(/\\/g, "/"));
    }
  }

  return files.sort();
}

async function filesDiffer(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftExists, rightExists] = await Promise.all([pathExists(leftPath), pathExists(rightPath)]);
  if (leftExists !== rightExists) return true;
  if (!leftExists && !rightExists) return false;

  const [leftStat, rightStat] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)]);
  if (leftStat.size !== rightStat.size) return true;

  const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
  return !leftContent.equals(rightContent);
}

async function createDiffArtifact(
  baselineRoot: string,
  candidateRoot: string,
  mutablePaths: string[],
  maxPatchChars: number
): Promise<RunDiffArtifact> {
  const baselineExists = await pathExists(baselineRoot);
  const candidateExists = await pathExists(candidateRoot);
  if (!baselineExists || !candidateExists) {
    return emptyDiffArtifact();
  }

  const [baselineFiles, candidateFiles] = await Promise.all([
    listFilesRecursively(baselineRoot),
    listFilesRecursively(candidateRoot)
  ]);
  const union = [...new Set([...baselineFiles, ...candidateFiles])].sort();
  const changedFiles: string[] = [];

  for (const relativePath of union) {
    const changed = await filesDiffer(
      path.join(baselineRoot, relativePath),
      path.join(candidateRoot, relativePath)
    );
    if (changed) changedFiles.push(relativePath);
  }

  const allowedChangedFiles = changedFiles.filter((entry) => pathIsAllowed(entry, mutablePaths));
  const unauthorizedChangedFiles = changedFiles.filter((entry) => !pathIsAllowed(entry, mutablePaths));

  let patch = "";
  let additions = 0;
  let deletions = 0;

  for (const relativePath of allowedChangedFiles) {
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
        patch += `\n# Failed to compute diff for ${relativePath}\n${err.stderr}\n`;
      }
    }
  }

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return {
    changedFiles: allowedChangedFiles,
    unauthorizedChangedFiles,
    patch: summarizeOutput(patch, maxPatchChars),
    stats: {
      files: allowedChangedFiles.length,
      additions,
      deletions
    }
  };
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
    minimumImprovement: clampNonNegativeNumber(raw.minimumImprovement, DEFAULTS.minimumImprovement),
    stagnationIssueThreshold: clampPositiveInteger(raw.stagnationIssueThreshold, DEFAULTS.stagnationIssueThreshold)
  };
}

function isRunRecord(record: PluginEntityRecord): boolean {
  return record.entityType === ENTITY_TYPES.run;
}

function asOptimizer(record: PluginEntityRecord): OptimizerDefinition {
  return {
    ...(record.data as OptimizerDefinition),
    optimizerId: record.externalId ?? record.id
  };
}

function asRunRecord(record: PluginEntityRecord): OptimizerRunRecord {
  return record.data as OptimizerRunRecord;
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
    title: `${run.outcome} run for ${run.optimizerId}`,
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

  const score = extractScore(`${execution.stdout}\n${execution.stderr}`, pattern);
  return {
    primary: score,
    metrics: score == null ? {} : { primary: score },
    guardrails: {},
    summary: score == null ? "No numeric score found." : `Score ${score}`,
    raw: `${execution.stdout}\n${execution.stderr}`.trim()
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
}> {
  if (!optimizer.guardrailCommand) {
    return { execution: undefined, result: null, passed: true };
  }

  const execution = await runShellCommand(
    optimizer.guardrailCommand,
    cwd,
    optimizer.guardrailBudgetSeconds ?? config.defaultGuardrailBudgetSeconds,
    process.env,
    config.maxOutputChars
  );
  const result = resultFromExecution(execution, optimizer.guardrailFormat, optimizer.guardrailKey);
  const failedGuardrails = Object.entries(result?.guardrails ?? {}).filter(([, value]) => value === false);
  const passed = execution.ok && failedGuardrails.length === 0;

  return {
    execution,
    result,
    passed,
    failureReason: !execution.ok
      ? "Guardrail command failed."
      : failedGuardrails.length > 0
        ? `Guardrails failed: ${failedGuardrails.map(([key]) => key).join(", ")}.`
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
  const title = `${titlePrefix ?? "Optimizer run"}: ${optimizer.name}`;
  const patchPreview = run.artifacts.patch || "(no diff patch captured)";
  const description = [
    `Objective: ${optimizer.objective}`,
    `Outcome: ${run.outcome}`,
    `Reason: ${run.reason}`,
    "",
    `Baseline score: ${run.baselineScore ?? "n/a"}`,
    `Candidate score: ${run.candidateScore ?? "n/a"}`,
    "",
    `Mutation: ${formatCommandSummary(run.mutation)}`,
    `Scoring: ${formatCommandSummary(run.scoring)}`,
    run.guardrail ? `Guardrail: ${formatCommandSummary(run.guardrail)}` : "Guardrail: not configured",
    "",
    `Changed files (${run.artifacts.changedFiles.length}): ${run.artifacts.changedFiles.join(", ") || "none"}`,
    `Unauthorized changes: ${run.artifacts.unauthorizedChangedFiles.join(", ") || "none"}`,
    "",
    "Patch preview",
    "```diff",
    patchPreview,
    "```"
  ].join("\n");

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
    message: `Autoresearch Improver created issue "${title}" from run ${run.runId}.`,
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId,
      outcome: run.outcome
    }
  });

  return { id: issue.id, title: issue.title };
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
    mutationBudgetSeconds: clampPositiveInteger(params.mutationBudgetSeconds, config.defaultMutationBudgetSeconds),
    scoreBudgetSeconds: clampPositiveInteger(params.scoreBudgetSeconds, config.defaultScoreBudgetSeconds),
    guardrailBudgetSeconds: params.guardrailBudgetSeconds == null || params.guardrailBudgetSeconds === ""
      ? undefined
      : clampPositiveInteger(params.guardrailBudgetSeconds, config.defaultGuardrailBudgetSeconds),
    hiddenScoring: params.hiddenScoring !== false,
    autoRun: params.autoRun === true,
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
    stagnationIssueThreshold: clampPositiveInteger(params.stagnationIssueThreshold, config.stagnationIssueThreshold),
    notes: typeof params.notes === "string" && params.notes.trim() ? params.notes.trim() : undefined,
    bestScore: typeof params.bestScore === "number" ? params.bestScore : undefined,
    bestRunId: typeof params.bestRunId === "string" ? params.bestRunId : undefined,
    lastRunId: typeof params.lastRunId === "string" ? params.lastRunId : undefined,
    runs: Math.max(0, Number(params.runs ?? 0) || 0),
    acceptedRuns: Math.max(0, Number(params.acceptedRuns ?? 0) || 0),
    rejectedRuns: Math.max(0, Number(params.rejectedRuns ?? 0) || 0),
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
    PAPERCLIP_OPTIMIZER_SCORE_REPEATS: String(optimizer.scoreRepeats),
    PAPERCLIP_OPTIMIZER_SCORE_AGGREGATOR: optimizer.scoreAggregator,
    PAPERCLIP_OPTIMIZER_MINIMUM_IMPROVEMENT: String(optimizer.minimumImprovement)
  };

  if (!optimizer.hiddenScoring) {
    mutationEnv.PAPERCLIP_OPTIMIZER_SCORE_COMMAND = optimizer.scoreCommand;
  }

  return mutationEnv;
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
  const nextRejectedRuns = optimizer.rejectedRuns + ((run.outcome === "rejected" || run.outcome === "invalid") ? 1 : 0);
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
    pendingApprovalRuns: nextPendingApprovalRuns,
    consecutiveFailures: failureOccurred ? optimizer.consecutiveFailures + 1 : 0,
    consecutiveNonImprovements: candidateImproved
      ? 0
      : optimizer.consecutiveNonImprovements + 1,
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
    message: `Autoresearch Improver recorded ${run.outcome} run ${run.runId} for ${optimizer.name}.`,
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
    throw new Error(`Optimizer ${optimizer.name} is already running.`);
  }

  runningOptimizers.add(optimizer.optimizerId);
  const config = await getConfig(ctx);
  const startedAt = nowIso();
  let sandboxDir = "";
  let sandboxWorkspace = "";
  let retainSandbox = config.keepTmpDirs;

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
    const baselineScore = await measureBaselineScore(optimizer, workspacePath, config);

    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autoresearch-"));
    sandboxWorkspace = path.join(sandboxDir, "workspace");
    await fs.cp(workspacePath, sandboxWorkspace, { recursive: true, force: true });

    const briefPath = path.join(sandboxDir, "paperclip-optimizer-brief.json");
    await fs.writeFile(briefPath, JSON.stringify(buildOptimizerBrief(optimizer), null, 2), "utf8");

    const mutation = await runShellCommand(
      optimizer.mutationCommand,
      sandboxWorkspace,
      optimizer.mutationBudgetSeconds,
      buildMutationEnv(optimizer, baselineScore, briefPath),
      config.maxOutputChars
    );

    const scoringResult = await measureScoreRepeats(optimizer, sandboxWorkspace, config);
    const guardrail = await measureGuardrail(optimizer, sandboxWorkspace, config);
    const artifacts = await createDiffArtifact(
      workspacePath,
      sandboxWorkspace,
      optimizer.mutablePaths,
      config.maxOutputChars * 4
    );

    const comparison = compareScores(
      optimizer.scoreDirection,
      baselineScore,
      scoringResult.candidateScore,
      optimizer.minimumImprovement
    );

    const failureReason = !mutation.ok
      ? "Mutation command failed."
      : artifacts.unauthorizedChangedFiles.length > 0
        ? `Mutation touched files outside the mutable surface: ${artifacts.unauthorizedChangedFiles.join(", ")}.`
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
      await applySandboxToWorkspace(workspacePath, sandboxWorkspace, optimizer.mutablePaths);
      outcome = "accepted";
      accepted = true;
      applied = true;
      reason = comparison.reason;
    }

    const run: OptimizerRunRecord = {
      runId: randomUUID(),
      optimizerId: optimizer.optimizerId,
      companyId: optimizer.companyId,
      projectId: optimizer.projectId,
      workspaceId,
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
      mutablePaths: optimizer.mutablePaths,
      sandboxStrategy: "copy",
      sandboxPath: retainSandbox ? sandboxWorkspace : undefined,
      artifacts
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

    if (
      !comparison.improved &&
      updatedOptimizer.autoCreateIssueOnStagnation &&
      updatedOptimizer.consecutiveNonImprovements === updatedOptimizer.stagnationIssueThreshold
    ) {
      await createIssueFromRun(ctx, optimizer.companyId, optimizer, run, "Optimizer stagnation");
    }

    return { optimizer: updatedOptimizer, run };
  } finally {
    runningOptimizers.delete(optimizer.optimizerId);
    if (sandboxDir && !retainSandbox) {
      await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
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
  await applySandboxToWorkspace(workspacePath, run.sandboxPath, run.mutablePaths);
  const promotedRun: OptimizerRunRecord = {
    ...run,
    workspaceId,
    finishedAt: nowIso(),
    outcome: "accepted",
    accepted: true,
    applied: true,
    approvalStatus: "approved",
    reason: `${run.reason} Approved by operator.`
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
    updatedAt: nowIso()
  };

  await upsertRun(ctx, promotedRun);
  await upsertOptimizer(ctx, updatedOptimizer);
  await ctx.activity.log({
    companyId: optimizer.companyId,
    entityType: "project",
    entityId: optimizer.projectId,
    message: `Autoresearch Improver approved run ${run.runId} for ${optimizer.name}.`,
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId
    }
  });

  const config = await getConfig(ctx);
  if (!config.keepTmpDirs && run.sandboxPath) {
    await fs.rm(path.dirname(run.sandboxPath), { recursive: true, force: true }).catch(() => undefined);
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
    updatedAt: nowIso()
  };

  await upsertRun(ctx, rejectedRun);
  await upsertOptimizer(ctx, updatedOptimizer);
  await ctx.activity.log({
    companyId: optimizer.companyId,
    entityType: "project",
    entityId: optimizer.projectId,
    message: `Autoresearch Improver rejected pending run ${run.runId} for ${optimizer.name}.`,
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId
    }
  });

  const config = await getConfig(ctx);
  if (!config.keepTmpDirs && run.sandboxPath) {
    await fs.rm(path.dirname(run.sandboxPath), { recursive: true, force: true }).catch(() => undefined);
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
      .filter((entry) => isRunRecord(entry) && (entry.data as OptimizerRunRecord).optimizerId === optimizerId)
      .map(asRunRecord)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  });

  ctx.data.register(DATA_KEYS.optimizerTemplates, async () => optimizerTemplates);

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
        acceptedRuns: runs.filter((entry) => entry.accepted).length,
        pendingApprovalRuns: runs.filter((entry) => entry.approvalStatus === "pending").length
      },
      latestAcceptedRun
    };

    return overview;
  });
}

async function registerActionHandlers(ctx: PluginContext): Promise<void> {
  ctx.actions.register(ACTION_KEYS.saveOptimizer, async (params) => {
    const existing = typeof params.optimizerId === "string" && typeof params.projectId === "string"
      ? await findOptimizer(ctx, params.projectId, params.optimizerId)
      : null;
    const optimizer = await createOptimizerFromParams(ctx, {
      ...(existing?.data ?? {}),
      ...params,
      createdAt: (existing?.data as OptimizerDefinition | undefined)?.createdAt
    });
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

  ctx.actions.register(ACTION_KEYS.runOptimizerCycle, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error(`Optimizer ${optimizerId} was not found.`);
    }
    return await runOptimizerCycle(ctx, asOptimizer(entity));
  });

  ctx.actions.register(ACTION_KEYS.enqueueOptimizerRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const entity = await findOptimizer(ctx, projectId, optimizerId);
    if (!entity) {
      throw new Error(`Optimizer ${optimizerId} was not found.`);
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
      throw new Error(`Optimizer ${optimizerId} was not found.`);
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
            `${entry.name}: status=${entry.status}, queue=${entry.queueState}, best=${entry.bestScore ?? "n/a"}, repeats=${entry.scoreRepeats}, apply=${entry.applyMode}`
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
        return { error: `Optimizer ${optimizerId} not found in project ${runCtx.projectId}.` };
      }
      const optimizer = asOptimizer(optimizerEntity);
      const runEntities = await listRunEntities(ctx, runCtx.projectId);
      const acceptedRun = runEntities
        .map(asRunRecord)
        .filter((entry) => entry.optimizerId === optimizerId && entry.accepted)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (!acceptedRun) {
        return { error: `Optimizer ${optimizer.name} has no accepted run yet.` };
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
        content: `Created issue ${issue.title}`,
        data: issue
      };
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
        errors.push(`${key} must be a positive number.`);
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
