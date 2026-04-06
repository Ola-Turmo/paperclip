import { exec } from "node:child_process";
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
  buildOptimizerBrief,
  clampPositiveInteger,
  compareScores,
  extractScore,
  formatCommandSummary,
  normalizeMutablePaths,
  normalizeRelativePath,
  summarizeOutput
} from "./lib/optimizer.js";
import type {
  CommandExecutionResult,
  OptimizerDefinition,
  OptimizerRunRecord,
  OverviewData,
  PluginConfigValues,
  ScoreDirection
} from "./types.js";

const execAsync = promisify(exec);
const runningOptimizers = new Set<string>();
let currentContext: PluginContext | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

async function getConfig(ctx: PluginContext): Promise<PluginConfigValues> {
  const raw = await ctx.config.get();
  return {
    defaultMutationBudgetSeconds: clampPositiveInteger(raw.defaultMutationBudgetSeconds, DEFAULTS.mutationBudgetSeconds),
    defaultScoreBudgetSeconds: clampPositiveInteger(raw.defaultScoreBudgetSeconds, DEFAULTS.scoreBudgetSeconds),
    defaultGuardrailBudgetSeconds: clampPositiveInteger(raw.defaultGuardrailBudgetSeconds, DEFAULTS.guardrailBudgetSeconds),
    keepTmpDirs: raw.keepTmpDirs === true,
    maxOutputChars: clampPositiveInteger(raw.maxOutputChars, DEFAULTS.maxOutputChars),
    sweepLimit: clampPositiveInteger(raw.sweepLimit, DEFAULTS.sweepLimit)
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

async function listRunEntities(ctx: PluginContext): Promise<PluginEntityRecord[]> {
  return await ctx.entities.list({
    entityType: ENTITY_TYPES.run,
    limit: 500,
    offset: 0
  });
}

async function findOptimizer(ctx: PluginContext, projectId: string, optimizerId: string): Promise<PluginEntityRecord | null> {
  const entities = await listOptimizerEntities(ctx, projectId);
  return entities.find((entry) => entry.externalId === optimizerId || entry.id === optimizerId) ?? null;
}

function ensureNonEmptyString(value: unknown, field: string): string {
  const stringValue = typeof value === "string" ? value.trim() : "";
  if (!stringValue) {
    throw new Error(`${field} is required`);
  }
  return stringValue;
}

function parseDirection(value: unknown): ScoreDirection {
  return value === "minimize" ? "minimize" : "maximize";
}

function sanitizeWorkspacePath(workspacePath: string): string {
  const normalized = workspacePath.trim();
  if (!normalized) {
    throw new Error("Workspace path was empty");
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

async function upsertOptimizer(ctx: PluginContext, optimizer: OptimizerDefinition): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.optimizer,
    scopeKind: "project",
    scopeId: optimizer.projectId,
    externalId: optimizer.optimizerId,
    title: optimizer.name,
    status: optimizer.status,
    data: optimizer as unknown as Record<string, unknown>
  });
}

async function upsertRun(ctx: PluginContext, run: OptimizerRunRecord): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.run,
    scopeKind: "project",
    scopeId: run.projectId,
    externalId: run.runId,
    title: `${run.accepted ? "Accepted" : "Rejected"} run for ${run.optimizerId}`,
    status: run.accepted ? "accepted" : "rejected",
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

async function copyAllowedPath(sourceRoot: string, destinationRoot: string, relativePath: string): Promise<void> {
  const sourcePath = resolveInside(sourceRoot, relativePath);
  const destinationPath = resolveInside(destinationRoot, relativePath);
  const sourceExists = await fs.stat(sourcePath).then(() => true).catch(() => false);

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
    const exitCode = typeof err.code === "number" ? err.code : null;
    return {
      command,
      cwd,
      exitCode,
      stdout: summarizeOutput(err.stdout ?? "", maxOutputChars),
      stderr: summarizeOutput(err.stderr ?? err.message ?? "", maxOutputChars),
      durationMs: Date.now() - startedAt,
      timedOut: err.signal === "SIGTERM" || err.killed === true,
      ok: false
    };
  }
}

async function measureScore(
  optimizer: OptimizerDefinition,
  cwd: string,
  config: PluginConfigValues
): Promise<{ execution: CommandExecutionResult; score: number | null }> {
  const execution = await runShellCommand(
    optimizer.scoreCommand,
    cwd,
    optimizer.scoreBudgetSeconds,
    process.env,
    config.maxOutputChars
  );
  const score = extractScore(`${execution.stdout}\n${execution.stderr}`, optimizer.scorePattern);
  return { execution, score };
}

async function createOptimizerFromParams(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<OptimizerDefinition> {
  const config = await getConfig(ctx);
  const existingId = typeof params.optimizerId === "string" && params.optimizerId.trim()
    ? params.optimizerId.trim()
    : randomUUID();

  return {
    optimizerId: existingId,
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
    mutationBudgetSeconds: clampPositiveInteger(params.mutationBudgetSeconds, config.defaultMutationBudgetSeconds),
    scoreBudgetSeconds: clampPositiveInteger(params.scoreBudgetSeconds, config.defaultScoreBudgetSeconds),
    guardrailBudgetSeconds: typeof params.guardrailBudgetSeconds === "number" || typeof params.guardrailBudgetSeconds === "string"
      ? clampPositiveInteger(params.guardrailBudgetSeconds, config.defaultGuardrailBudgetSeconds)
      : undefined,
    hiddenScoring: params.hiddenScoring !== false,
    autoRun: params.autoRun === true,
    status: params.status === "paused" ? "paused" : "active",
    notes: typeof params.notes === "string" && params.notes.trim() ? params.notes.trim() : undefined,
    bestScore: typeof params.bestScore === "number" ? params.bestScore : undefined,
    bestRunId: typeof params.bestRunId === "string" ? params.bestRunId : undefined,
    lastRunId: typeof params.lastRunId === "string" ? params.lastRunId : undefined,
    runs: Math.max(0, Number(params.runs ?? 0) || 0),
    acceptedRuns: Math.max(0, Number(params.acceptedRuns ?? 0) || 0),
    createdAt: typeof params.createdAt === "string" && params.createdAt ? params.createdAt : nowIso(),
    updatedAt: nowIso()
  };
}

async function createIssueFromRun(
  ctx: PluginContext,
  companyId: string,
  optimizer: OptimizerDefinition,
  run: OptimizerRunRecord,
  titlePrefix = "Accepted optimizer run"
): Promise<{ id: string; title: string }> {
  const title = `${titlePrefix}: ${optimizer.name}`;
  const description = [
    `Objective: ${optimizer.objective}`,
    "",
    `Reason: ${run.reason}`,
    `Baseline score: ${run.baselineScore ?? "n/a"}`,
    `Candidate score: ${run.candidateScore ?? "n/a"}`,
    "",
    "Mutation command",
    "```bash",
    optimizer.mutationCommand,
    "```",
    "",
    "Score command",
    "```bash",
    optimizer.scoreCommand,
    "```",
    "",
    `Mutation result: ${formatCommandSummary(run.mutation)}`,
    `Scoring result: ${formatCommandSummary(run.scoring)}`
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
    message: `Autoresearch Improver created issue "${title}" from accepted run ${run.runId}.`,
    metadata: {
      optimizerId: optimizer.optimizerId,
      runId: run.runId
    }
  });

  return { id: issue.id, title: issue.title };
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

  try {
    const { workspaceId, workspacePath } = await resolveWorkspacePath(
      ctx,
      optimizer.companyId,
      optimizer.projectId,
      optimizer.workspaceId
    );

    const baselineMeasurement = optimizer.bestScore == null
      ? await measureScore(optimizer, workspacePath, config)
      : null;
    const baselineScore = optimizer.bestScore ?? baselineMeasurement?.score ?? null;

    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autoresearch-"));
    const sandboxWorkspace = path.join(sandboxDir, "workspace");
    await fs.cp(workspacePath, sandboxWorkspace, { recursive: true, force: true });

    const briefPath = path.join(sandboxWorkspace, "paperclip-optimizer-brief.json");
    await fs.writeFile(briefPath, JSON.stringify(buildOptimizerBrief(optimizer), null, 2), "utf8");

    const mutationEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PAPERCLIP_OPTIMIZER_ID: optimizer.optimizerId,
      PAPERCLIP_OPTIMIZER_NAME: optimizer.name,
      PAPERCLIP_OPTIMIZER_OBJECTIVE: optimizer.objective,
      PAPERCLIP_OPTIMIZER_MUTABLE_PATHS: JSON.stringify(optimizer.mutablePaths),
      PAPERCLIP_OPTIMIZER_BEST_SCORE: baselineScore == null ? "" : String(baselineScore),
      PAPERCLIP_OPTIMIZER_SCORE_DIRECTION: optimizer.scoreDirection,
      PAPERCLIP_OPTIMIZER_BRIEF: briefPath
    };

    if (!optimizer.hiddenScoring) {
      mutationEnv.PAPERCLIP_OPTIMIZER_SCORE_COMMAND = optimizer.scoreCommand;
    }

    const mutation = await runShellCommand(
      optimizer.mutationCommand,
      sandboxWorkspace,
      optimizer.mutationBudgetSeconds,
      mutationEnv,
      config.maxOutputChars
    );

    const scoring = await measureScore(optimizer, sandboxWorkspace, config);

    let guardrail: CommandExecutionResult | undefined;
    if (optimizer.guardrailCommand) {
      guardrail = await runShellCommand(
        optimizer.guardrailCommand,
        sandboxWorkspace,
        optimizer.guardrailBudgetSeconds ?? config.defaultGuardrailBudgetSeconds,
        process.env,
        config.maxOutputChars
      );
    }

    const comparison = compareScores(optimizer.scoreDirection, baselineScore, scoring.score);
    const accepted = mutation.ok && scoring.execution.ok && (guardrail ? guardrail.ok : true) && comparison.improved;
    const reason = !mutation.ok
      ? "Mutation command failed."
      : guardrail && !guardrail.ok
        ? "Guardrail command failed."
        : !scoring.execution.ok
          ? "Score command failed."
          : comparison.reason;

    if (accepted) {
      for (const mutablePath of optimizer.mutablePaths) {
        await copyAllowedPath(sandboxWorkspace, workspacePath, mutablePath);
      }
    }

    const runId = randomUUID();
    const run: OptimizerRunRecord = {
      runId,
      optimizerId: optimizer.optimizerId,
      companyId: optimizer.companyId,
      projectId: optimizer.projectId,
      workspaceId,
      startedAt,
      finishedAt: nowIso(),
      baselineScore,
      candidateScore: scoring.score,
      accepted,
      reason,
      mutation,
      scoring: scoring.execution,
      guardrail,
      mutablePaths: optimizer.mutablePaths
    };

    const updatedOptimizer: OptimizerDefinition = {
      ...optimizer,
      workspaceId,
      bestScore: accepted ? scoring.score ?? optimizer.bestScore : optimizer.bestScore ?? baselineScore ?? undefined,
      bestRunId: accepted ? runId : optimizer.bestRunId,
      lastRunId: runId,
      runs: optimizer.runs + 1,
      acceptedRuns: optimizer.acceptedRuns + (accepted ? 1 : 0),
      updatedAt: nowIso()
    };

    await upsertRun(ctx, run);
    await upsertOptimizer(ctx, updatedOptimizer);
    await ctx.metrics.write("optimizer.run", 1, {
      accepted: accepted ? "true" : "false",
      optimizer_id: optimizer.optimizerId
    });
    await ctx.activity.log({
      companyId: optimizer.companyId,
      entityType: "project",
      entityId: optimizer.projectId,
      message: `Autoresearch Improver ${accepted ? "accepted" : "rejected"} run ${runId} for ${optimizer.name}.`,
      metadata: {
        optimizerId: optimizer.optimizerId,
        runId,
        candidateScore: run.candidateScore ?? "n/a",
        baselineScore: run.baselineScore ?? "n/a"
      }
    });

    return { optimizer: updatedOptimizer, run };
  } finally {
    runningOptimizers.delete(optimizer.optimizerId);
    const config = currentContext ? await getConfig(currentContext) : null;
    if (sandboxDir && config?.keepTmpDirs !== true) {
      await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
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
    const entities = await listRunEntities(ctx);
    return entities
      .filter((entry) => isRunRecord(entry) && (entry.data as OptimizerRunRecord).optimizerId === optimizerId)
      .map(asRunRecord)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 20);
  });

  ctx.data.register(DATA_KEYS.overview, async (params) => {
    const companyId = typeof params.companyId === "string" ? params.companyId : null;
    const config = await getConfig(ctx);
    const optimizers = (await listOptimizerEntities(ctx)).map(asOptimizer).filter((entry) => !companyId || entry.companyId === companyId);
    const runs = (await listRunEntities(ctx)).map(asRunRecord).filter((entry) => !companyId || entry.companyId === companyId);
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
        acceptedRuns: runs.filter((entry) => entry.accepted).length
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
    if (entity) {
      const optimizer = asOptimizer(entity);
      await ctx.entities.upsert({
        entityType: ENTITY_TYPES.optimizer,
        scopeKind: "project",
        scopeId: optimizer.projectId,
        externalId: optimizer.optimizerId,
        title: optimizer.name,
        status: "deleted",
        data: {
          ...optimizer,
          status: "paused",
          updatedAt: nowIso(),
          notes: [optimizer.notes, "[deleted]"].filter(Boolean).join("\n")
        } as unknown as Record<string, unknown>
      });
    }
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

  ctx.actions.register(ACTION_KEYS.createIssueFromRun, async (params) => {
    const projectId = ensureNonEmptyString(params.projectId, "projectId");
    const optimizerId = ensureNonEmptyString(params.optimizerId, "optimizerId");
    const optimizerEntity = await findOptimizer(ctx, projectId, optimizerId);
    if (!optimizerEntity) {
      throw new Error(`Optimizer ${optimizerId} was not found.`);
    }
    const optimizer = asOptimizer(optimizerEntity);
    const runEntities = await listRunEntities(ctx);
    const acceptedRun = runEntities
      .map(asRunRecord)
      .filter((entry) => entry.optimizerId === optimizerId && entry.accepted)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!acceptedRun) {
      throw new Error("No accepted run exists for this optimizer yet.");
    }
    return await createIssueFromRun(
      ctx,
      optimizer.companyId,
      optimizer,
      acceptedRun,
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
          : optimizers
            .map((entry) => `${entry.name}: ${entry.status}, best=${entry.bestScore ?? "n/a"}, autoRun=${entry.autoRun}`)
            .join("\n"),
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
      const runEntities = await listRunEntities(ctx);
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
    const activeOptimizers = entities
      .map(asOptimizer)
      .filter((entry) => entry.autoRun && entry.status === "active")
      .slice(0, config.sweepLimit);

    for (const optimizer of activeOptimizers) {
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
      sweepLimit: DEFAULTS.sweepLimit
    };
    return {
      status: "ok",
      message: "Autoresearch improver is ready",
      details: {
        runningOptimizers: runningOptimizers.size,
        keepTmpDirs: config.keepTmpDirs,
        sweepLimit: config.sweepLimit
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
      "sweepLimit"
    ]) {
      const value = config[key];
      if (value != null && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
        errors.push(`${key} must be a positive number.`);
      }
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
