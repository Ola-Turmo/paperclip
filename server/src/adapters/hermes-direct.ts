import type { AdapterExecutionContext, AdapterExecutionResult } from "./types.js";
import {
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  renderTemplate,
  runChildProcess,
} from "./utils.js";

const HERMES_CLI = "hermes";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_PROVIDER = "paperclip-router";
const DEFAULT_TIMEOUT_SEC = 420;
const DEFAULT_GRACE_SEC = 10;
const DEFAULT_MAX_TURNS = 14;
const DEFAULT_TOOLSETS = "terminal,file,web";

const DEFAULT_PROMPT_TEMPLATE = `
You are {{agentName}}, an AI teammate operating inside Paperclip for {{companyName}}.

Do one bounded, value-producing cycle for the assigned issue, then stop.
Paperclip API base: {{paperclipApiUrl}}
Assigned issue id, if any: {{taskId}}
Assigned task title, if any: {{taskTitle}}

Hard stop rules:
- If there is no assigned issue id, do not inspect the repo, call tools, or invent work.
- Do not call the Paperclip API directly. Return a final report; Paperclip records the run.
- Do not launch child agents, background jobs, schedules, broad scans, or unrelated company work.
- If the task needs public social/email/legal/payment/credential approval, draft the gated item and return the exact review decision needed.
- Finish with: summary, files/artifacts changed, verification, business value, blockers, next action.

{{taskBody}}
`.trim();

const SESSION_ID_REGEX = /^session_id:\s*(\S+)/m;
const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:\s]+([a-zA-Z0-9_-]+)/i;
const TOKEN_USAGE_REGEX = /tokens?[:\s]+(\d+)\s*(?:input|in)\b.*?(\d+)\s*(?:output|out)\b/i;
const COST_REGEX = /(?:cost|spent)[:\s]*\$?([\d.]+)/i;

function cfgString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cfgNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function cfgBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function cfgStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function cfgObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cfgEnvValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const typedValue = record.value;
  if (typeof typedValue === "string") return typedValue;
  if (typeof typedValue === "number" || typeof typedValue === "boolean") return String(typedValue);
  return undefined;
}

function cfgEnvObject(value: unknown): Record<string, string> {
  const objectValue = cfgObject(value);
  if (!objectValue) return {};

  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(objectValue)) {
    const envValue = cfgEnvValue(rawValue);
    if (envValue !== undefined) env[key] = envValue;
  }
  return env;
}

function isSafeCliToken(value: string): boolean {
  return value.length > 0 && !/[\s\x00-\x1f\x7f]/.test(value);
}

function firstNonAuto(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.trim().length > 0 && value.trim().toLowerCase() !== "auto");
}

function hasArg(args: readonly string[], name: string): boolean {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function cleanResponse(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith("[tool]") || trimmed.startsWith("[hermes]") || trimmed.startsWith("[paperclip]")) return false;
      if (trimmed.startsWith("session_id:")) return false;
      if (/^\[\d{4}-\d{2}-\d{2}T/.test(trimmed)) return false;
      if (/^\[done\]\s*/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/^\[done\]\s*/, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function errorLinesFromStderr(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("session_id:"))
    .filter((line) => /error|exception|traceback|failed/i.test(line))
    .filter((line) => !/INFO|DEBUG|WARN|WARNING/i.test(line));
}

function parseHermesOutput(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`;
  const parsed: {
    sessionId?: string | null;
    response?: string;
    usage?: { inputTokens: number; outputTokens: number };
    costUsd?: number;
    errorMessage?: string;
  } = {};

  const sessionMatch = stdout.match(SESSION_ID_REGEX) ?? stderr.match(SESSION_ID_REGEX);
  if (sessionMatch?.[1]) {
    parsed.sessionId = sessionMatch[1];
    const sessionLineIdx = stdout.lastIndexOf("\nsession_id:");
    parsed.response = cleanResponse(sessionLineIdx > 0 ? stdout.slice(0, sessionLineIdx) : stdout);
  } else {
    const legacyMatch = combined.match(SESSION_ID_REGEX_LEGACY);
    if (legacyMatch?.[1]) parsed.sessionId = legacyMatch[1];
    parsed.response = cleanResponse(stdout);
  }

  const usageMatch = combined.match(TOKEN_USAGE_REGEX);
  if (usageMatch) {
    parsed.usage = {
      inputTokens: Number.parseInt(usageMatch[1] ?? "0", 10) || 0,
      outputTokens: Number.parseInt(usageMatch[2] ?? "0", 10) || 0,
    };
  }

  const costMatch = combined.match(COST_REGEX);
  if (costMatch?.[1]) parsed.costUsd = Number.parseFloat(costMatch[1]);

  const errors = errorLinesFromStderr(stderr);
  if (errors.length > 0) parsed.errorMessage = errors.slice(0, 5).join("\n");

  return parsed;
}

function reachedHermesIterationCap(response: string | undefined): boolean {
  if (!response) return false;
  return /Reached maximum iterations/i.test(response) || /tool-call iteration cap/i.test(response);
}

function buildPrompt(ctx: AdapterExecutionContext, config: Record<string, unknown>) {
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
  const taskId = cfgString(ctx.config?.taskId) || "";
  const commentId = cfgString(ctx.config?.commentId) || "";
  let paperclipApiUrl =
    cfgString(config.paperclipApiUrl) || process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api";
  if (!paperclipApiUrl.endsWith("/api")) {
    paperclipApiUrl = `${paperclipApiUrl.replace(/\/+$/, "")}/api`;
  }

  let rendered = template;
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, taskId ? "$1" : "");
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, taskId ? "" : "$1");
  rendered = rendered.replace(/\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g, commentId ? "$1" : "");

  return renderTemplate(rendered, {
    agentId: ctx.agent?.id || "",
    agentName: ctx.agent?.name || "Hermes Agent",
    companyId: ctx.agent?.companyId || "",
    companyName: cfgString(ctx.config?.companyName) || "",
    runId: ctx.runId || "",
    taskId,
    taskTitle: cfgString(ctx.config?.taskTitle) || "",
    taskBody: cfgString(ctx.config?.taskBody) || "",
    commentId,
    wakeReason: cfgString(ctx.config?.wakeReason) || "",
    projectName: cfgString(ctx.config?.projectName) || "",
    paperclipApiUrl,
  });
}

export async function executeHermesDirectTracked(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const config = (ctx.agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const taskId = cfgString(ctx.config?.taskId);
  const allowNoTaskRun = cfgBoolean(config.allowNoTaskRun) === true;
  if (!taskId && !allowNoTaskRun) {
    const summary = [
      "No assigned issue was available for this heartbeat.",
      "Hermes was not started because unscoped no-issue runs previously caused long-running orphan work.",
      "Create or assign a concrete issue to run this agent.",
    ].join(" ");
    await ctx.onLog("stdout", `[paperclip] ${summary}\n`);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: {
        result: summary,
        stopReason: "no_assigned_issue",
        hermesStarted: false,
      },
      summary,
    };
  }

  const llmRouterConfig = cfgObject(config.llmRouter);
  const hermesCommand = cfgString(config.hermesCommand) || HERMES_CLI;
  const model = firstNonAuto(
    cfgString(config.model),
    cfgString(llmRouterConfig?.model),
    process.env.PAPERCLIP_HERMES_DIRECT_MODEL,
    process.env.T3_RUNTIME_GATEWAY_HERMES_MODEL,
  ) || DEFAULT_MODEL;
  const provider = firstNonAuto(
    cfgString(config.provider),
    process.env.PAPERCLIP_HERMES_DIRECT_PROVIDER,
    process.env.HERMES_INFERENCE_PROVIDER,
  ) || DEFAULT_PROVIDER;
  const configuredTimeoutSec = cfgNumber(config.timeoutSec) || DEFAULT_TIMEOUT_SEC;
  const maxTimeoutSec = cfgNumber(config.maxTimeoutSec) || DEFAULT_TIMEOUT_SEC;
  const timeoutSec = Math.min(configuredTimeoutSec, maxTimeoutSec);
  const graceSec = cfgNumber(config.graceSec) || DEFAULT_GRACE_SEC;
  const maxTurns = cfgNumber(config.maxTurns) || cfgNumber(config.max_turns) || DEFAULT_MAX_TURNS;
  const toolsets = cfgString(config.toolsets) || cfgStringArray(config.enabledToolsets)?.join(",") || DEFAULT_TOOLSETS;
  const extraArgs = cfgStringArray(config.extraArgs) ?? [];
  const persistSession = cfgBoolean(config.persistSession) !== false;
  const worktreeMode = cfgBoolean(config.worktreeMode) === true;
  const checkpoints = cfgBoolean(config.checkpoints) === true;
  const useQuiet = cfgBoolean(config.quiet) !== false;
  const useYolo = cfgBoolean(config.yolo) !== false && cfgBoolean(config.dangerouslyDisableYolo) !== true;

  const args = ["chat", "-q", buildPrompt(ctx, config)];
  if (useQuiet) args.push("-Q");
  if (model && isSafeCliToken(model)) args.push("-m", model);
  if (provider && isSafeCliToken(provider)) args.push("--provider", provider);
  if (toolsets) args.push("-t", toolsets);
  if (worktreeMode) args.push("-w");
  if (checkpoints) args.push("--checkpoints");
  if (cfgBoolean(config.verbose) === true) args.push("-v");
  if (maxTurns > 0 && !hasArg(extraArgs, "--max-turns")) args.push("--max-turns", String(maxTurns));
  if (useYolo && !hasArg(extraArgs, "--yolo")) args.push("--yolo");
  args.push("--source", "tool");
  args.push("--profile", "paperclip");

  const previousSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
  if (persistSession && previousSessionId) args.push("--resume", previousSessionId);
  if (extraArgs?.length) args.push(...extraArgs);

  const env: Record<string, string> = {
    ...process.env,
    ...buildPaperclipEnv(ctx.agent),
  } as Record<string, string>;
  if (ctx.runId) env.PAPERCLIP_RUN_ID = ctx.runId;
  if (taskId) env.PAPERCLIP_TASK_ID = taskId;
  Object.assign(env, cfgEnvObject(config.env));

  const cwd = cfgString(config.cwd) || cfgString(ctx.config?.workspaceDir) || ".";
  try {
    await ensureAbsoluteDirectory(cwd);
  } catch {
    // Match upstream adapter behavior: the child process will report a clear cwd failure if needed.
  }

  await ctx.onLog(
    "stdout",
    `[hermes] Starting Hermes Agent (provider=${provider}, model=${model}, maxTurns=${maxTurns}, timeout=${timeoutSec}s, yolo=${useYolo})\n`,
  );
  if (previousSessionId) await ctx.onLog("stdout", `[hermes] Resuming session: ${previousSessionId}\n`);

  const wrappedOnLog = async (stream: "stdout" | "stderr", chunk: string) => {
    if (stream === "stderr") {
      const trimmed = chunk.trim();
      const benign =
        trimmed.startsWith("session_id:") ||
        /^\[?\d{4}[-/]\d{2}[-/]\d{2}T/.test(trimmed) ||
        /^[A-Z]+:\s+(INFO|DEBUG|WARN|WARNING)\b/.test(trimmed) ||
        /Successfully registered all tools/.test(trimmed) ||
        /MCP [Ss]erver/.test(trimmed) ||
        /tool registered successfully/.test(trimmed) ||
        /Application initialized/.test(trimmed);
      if (benign) return ctx.onLog("stdout", chunk);
    }
    return ctx.onLog(stream, chunk);
  };

  const result = await runChildProcess(ctx.runId, hermesCommand, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onLog: wrappedOnLog,
    onSpawn: ctx.onSpawn
      ? async (meta) => {
          await ctx.onSpawn?.({ ...meta, processGroupId: null });
        }
      : undefined,
  });

  const parsed = parseHermesOutput(result.stdout || "", result.stderr || "");
  const iterationCapped = reachedHermesIterationCap(parsed.response);
  await ctx.onLog("stdout", `[hermes] Exit code: ${result.exitCode ?? "null"}, timed out: ${result.timedOut}\n`);
  if (parsed.sessionId) await ctx.onLog("stdout", `[hermes] Session: ${parsed.sessionId}\n`);
  if (iterationCapped) {
    await ctx.onLog(
      "stderr",
      "[hermes] Hermes reached its tool-call iteration cap before completing the assigned Paperclip issue. Treating this as a failed bounded run, not successful value delivery.\n",
    );
  }

  const executionResult: AdapterExecutionResult = {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    provider: provider || null,
    model: model || null,
    resultJson: {
      result: parsed.response || "",
      session_id: parsed.sessionId || null,
      usage: parsed.usage || null,
      cost_usd: parsed.costUsd ?? null,
      tracked_pid: result.pid ?? null,
      started_at: result.startedAt ?? null,
      iteration_capped: iterationCapped,
    },
  };

  if (iterationCapped) {
    executionResult.errorMessage =
      "Hermes reached its tool-call iteration cap before completing a concrete value-producing action.";
    executionResult.errorCode = "hermes_iteration_cap";
    executionResult.clearSession = true;
  } else if (parsed.errorMessage) {
    executionResult.errorMessage = parsed.errorMessage;
  }
  if (parsed.usage) executionResult.usage = parsed.usage;
  if (parsed.costUsd !== undefined) executionResult.costUsd = parsed.costUsd;
  if (parsed.response) executionResult.summary = parsed.response.slice(0, 2000);
  if (persistSession && parsed.sessionId) {
    executionResult.sessionParams = { sessionId: parsed.sessionId };
    executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
  }

  return executionResult;
}
