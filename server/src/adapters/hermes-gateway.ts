import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "./types.js";
import { buildPaperclipEnv, ensureAbsoluteDirectory, renderTemplate } from "./utils.js";

type SharedRuntimeSessionRecord = {
  threadId: string;
  provider: string;
  resumeCursor: unknown | null;
};

type SharedRuntimeExecuteTurnResult = {
  projectId: string;
  threadId: string;
  assistantText: string;
  session: SharedRuntimeSessionRecord | null;
};

const DEFAULT_TIMEOUT_SEC = 1800;
const DEFAULT_HERMES_MODEL = "minimax-m2.7";
const DEFAULT_GATEWAY_URL = "http://t3code-vps:3773";
const DEFAULT_PAPERCLIP_API_URL = "http://paperclip:3100/api";
const DEFAULT_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use the terminal tool with curl for ALL Paperclip API calls.
Do not use localhost or 127.0.0.1 for Paperclip from the T3 runtime container.
Use the API Base printed below exactly. In production compose this is the Docker service URL.
Do not use, request, reveal, write, diff, or paste Paperclip bearer tokens.
Use only the provided run auth header in direct API commands.

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}
  Run auth header: {{paperclipCurlHeaders}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Workflow

1. Work on the task using your tools
2. When done, mark the issue as completed:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/{{taskId}}" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"status":"done"}'\`
3. Post a completion comment on the issue summarizing what you did:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/{{taskId}}/comments" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"body":"DONE: <your summary here>"}'\`
4. If this issue has a parent (check the issue body or comments for references like TRA-XX), post a brief notification on the parent issue so the parent owner knows:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/PARENT_ISSUE_ID/comments" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"body":"{{agentName}} completed {{taskId}}. Summary: <brief>"}'\`
{{/taskId}}

{{#commentId}}
## Comment on This Issue

Someone commented. Read it:
   \`curl -s "{{paperclipApiUrl}}/issues/{{taskId}}/comments/{{commentId}}" {{paperclipCurlHeaders}} | python3 -m json.tool\`

Address the comment, POST a reply if needed, then continue working.
{{/commentId}}

{{#noTask}}
## Heartbeat Wake - Check for Work

1. List ALL open issues assigned to you (todo, backlog, in_progress):
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}" {{paperclipCurlHeaders}} | python3 -c "import sys,json;issues=json.loads(sys.stdin.read());[print(f'{i[\"identifier\"]} {i[\"status\"]:>12} {i[\"priority\"]:>6} {i[\"title\"]}') for i in issues if i['status'] not in ('done','cancelled')]" \`

2. If issues found, pick the highest priority one that is not done/cancelled and work on it:
   - Read the issue details: \`curl -s "{{paperclipApiUrl}}/issues/ISSUE_ID" {{paperclipCurlHeaders}}\`
   - Do the work in the project directory: {{projectName}}
   - When done, mark complete and post a comment (see Workflow steps 2-4 above)

3. If no issues are assigned to you, stop after reporting briefly what you checked.
   Do not browse the unassigned backlog, self-assign work, create new issues, or start speculative work from a heartbeat.
{{/noTask}}`;

function cfgString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function cfgNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cfgRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getResolvedEnv(config: Record<string, unknown>): Record<string, string> {
  const rawEnv = cfgRecord(config.env);
  const resolved: Record<string, string> = {};
  if (!rawEnv) return resolved;
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === "string" && value.length > 0) {
      resolved[key] = value;
    }
  }
  return resolved;
}

function normalizeGatewayBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePaperclipApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function resolveGatewayUrl(config: Record<string, unknown>, env: Record<string, string>): string {
  return normalizeGatewayBaseUrl(
    cfgString(config.t3RuntimeGatewayUrl) ||
      env.T3_RUNTIME_GATEWAY_URL ||
      process.env.T3_RUNTIME_GATEWAY_URL ||
      DEFAULT_GATEWAY_URL,
  );
}

function isLoopbackPaperclipApiUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function resolvePaperclipApiUrl(config: Record<string, unknown>, env: Record<string, string>): string {
  const configured =
    cfgString(config.paperclipApiUrl) ||
    env.PAPERCLIP_INTERNAL_API_URL ||
    env.PAPERCLIP_API_URL ||
    process.env.PAPERCLIP_INTERNAL_API_URL ||
    process.env.PAPERCLIP_API_URL;

  // The Paperclip server may auto-derive PAPERCLIP_API_URL as localhost for its own
  // listener. Remote T3/Hermes containers must use the compose service address.
  const safeConfigured = isLoopbackPaperclipApiUrl(configured) ? undefined : configured;
  return normalizePaperclipApiUrl(safeConfigured || DEFAULT_PAPERCLIP_API_URL);
}

function resolveGatewayTokenHeaders(config: Record<string, unknown>, env: Record<string, string>) {
  const runtimeToken =
    cfgString(config.t3RuntimeGatewayToken) ||
    env.T3_RUNTIME_GATEWAY_TOKEN ||
    process.env.T3_RUNTIME_GATEWAY_TOKEN;
  const bearerToken =
    cfgString(config.t3RuntimeGatewayBearerToken) ||
    env.T3_RUNTIME_GATEWAY_BEARER_TOKEN ||
    process.env.T3_RUNTIME_GATEWAY_BEARER_TOKEN;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (runtimeToken) {
    headers["x-t3-runtime-gateway-token"] = runtimeToken;
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return { headers, hasAuth: Boolean(runtimeToken || bearerToken) };
}

function buildPaperclipAuthPrompt(config: Record<string, unknown>): string {
  const env = getResolvedEnv(config);
  const runId = cfgString(env.PAPERCLIP_RUN_ID);
  if (!runId) return "";

  const lines = [
    "Paperclip API safety rule:",
    `Use X-Paperclip-Run-Id: ${runId} on every Paperclip API request.`,
    "Do not use Authorization bearer tokens for Paperclip API calls from this runtime.",
    "Never use a board, browser, or local-board session for Paperclip API writes.",
  ];

  return `${lines.join("\n")}\n\n`;
}

function buildPaperclipCurlHeaders(config: Record<string, unknown>, runId: string): string {
  const headers = [];
  if (runId) {
    headers.push(`-H "X-Paperclip-Run-Id: ${runId}"`);
  }
  return headers.join(" ");
}

function buildPrompt(ctx: AdapterExecutionContext, config: Record<string, unknown>): string {
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
  const taskId = cfgString(ctx.config?.taskId);
  const taskTitle = cfgString(ctx.config?.taskTitle) || "";
  const taskBody = cfgString(ctx.config?.taskBody) || "";
  const commentId = cfgString(ctx.config?.commentId) || "";
  const agentName = ctx.agent?.name || "Hermes Agent";
  const companyName = cfgString(ctx.config?.companyName) || "";
  const projectName = cfgString(ctx.config?.projectName) || "";

  const paperclipApiUrl = resolvePaperclipApiUrl(config, getResolvedEnv(config));

  const vars = {
    agentId: ctx.agent?.id || "",
    agentName,
    companyId: ctx.agent?.companyId || "",
    companyName,
    runId: ctx.runId || "",
    taskId: taskId || "",
    taskTitle,
    taskBody,
    commentId,
    projectName,
    paperclipApiUrl,
    paperclipCurlHeaders: buildPaperclipCurlHeaders(config, ctx.runId || ""),
  };

  let rendered = template;
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, taskId ? "$1" : "");
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, taskId ? "" : "$1");
  rendered = rendered.replace(/\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g, commentId ? "$1" : "");
  return buildPaperclipAuthPrompt(config) + renderTemplate(rendered, vars);
}

function extractHermesSessionId(session: SharedRuntimeSessionRecord | null): string | null {
  const resumeCursor = session?.resumeCursor;
  if (!resumeCursor || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) {
    return null;
  }
  const sessionId = (resumeCursor as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : null;
}

async function fetchJson<T>(input: {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}): Promise<{ status: number; data: T | null; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: input.method ?? "POST",
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: T | null = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { status: response.status, data, text };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.message.toLowerCase().includes("operation was aborted");
}

async function fetchJsonWithRetry<T>(
  input: Parameters<typeof fetchJson<T>>[0],
  options: { attempts?: number; onRetry?: (attempt: number, detail: string) => Promise<void> } = {},
): Promise<{ status: number; data: T | null; text: string }> {
  const attempts = Math.max(1, options.attempts ?? 5);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchJson<T>(input);
      if (![502, 503, 504].includes(response.status) || attempt === attempts) {
        return response;
      }
      const detail = response.text || `HTTP ${response.status}`;
      await options.onRetry?.(attempt, detail);
    } catch (error) {
      lastError = error;
      // A client-side abort may leave the remote T3 turn running. Retrying here
      // creates duplicate Hermes workers for the same Paperclip issue.
      if (isAbortError(error)) break;
      if (attempt === attempts) break;
      const detail = error instanceof Error ? error.message : String(error);
      await options.onRetry?.(attempt, detail);
    }

    await sleep(Math.min(2000 * attempt, 10000));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "fetch failed"));
}

function buildExecutionError(message: string): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage: message,
    resultJson: {
      error: message,
    },
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = cfgRecord(ctx.agent?.adapterConfig) ?? {};
  const resolvedEnv = getResolvedEnv(config);
  const gatewayUrl = resolveGatewayUrl(config, resolvedEnv);
  const { headers, hasAuth } = resolveGatewayTokenHeaders(config, resolvedEnv);
  const timeoutSec = cfgNumber(config.timeoutSec) || DEFAULT_TIMEOUT_SEC;
  const timeoutMs = timeoutSec * 1000;
  const model =
    cfgString(config.model) ||
    resolvedEnv.T3_RUNTIME_GATEWAY_HERMES_MODEL ||
    process.env.T3_RUNTIME_GATEWAY_HERMES_MODEL ||
    DEFAULT_HERMES_MODEL;
  const prompt = buildPrompt(ctx, config);
  const taskId = cfgString(ctx.config?.taskId);
  const taskTitle = cfgString(ctx.config?.taskTitle);
  const agentName = ctx.agent?.name || "Hermes Agent";
  const taskOrAgentTitle = taskTitle || agentName;
  const cwd = cfgString(config.cwd) || cfgString(ctx.config?.workspaceDir) || ".";

  try {
    await ensureAbsoluteDirectory(cwd);
  } catch {
    // Non-fatal; the T3 runtime owns the real execution cwd.
  }

  if (!hasAuth) {
    await ctx.onLog(
      "stderr",
      "[hermes-gateway] Missing T3 runtime gateway credentials. Set T3_RUNTIME_GATEWAY_BEARER_TOKEN or T3_RUNTIME_GATEWAY_TOKEN.\n",
    );
    return buildExecutionError(
      "Missing T3 runtime gateway credentials. Configure T3_RUNTIME_GATEWAY_BEARER_TOKEN or T3_RUNTIME_GATEWAY_TOKEN.",
    );
  }

  const companyId = ctx.agent?.companyId || "global";
  const agentId = ctx.agent?.id || "unknown-agent";
  const ownerKind = taskId ? "paperclip_issue" : "paperclip_agent_run";
  const ownerId = taskId || `${companyId}:${agentId}`;
  await ctx.onLog(
    "stdout",
    `[hermes-gateway] Executing via T3 runtime gateway (${gatewayUrl}) with model=${model}\n`,
  );

  const payload = {
    provider: "hermesAgent",
    owner: {
      ownerKind,
      ownerId,
      companyId: ctx.agent?.companyId || undefined,
      roleScope: agentName,
    },
    title: taskOrAgentTitle,
    prompt,
    modelSelection: {
      provider: "hermesAgent",
      model,
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    timeoutMs,
  };

  try {
    const response = await fetchJsonWithRetry<SharedRuntimeExecuteTurnResult & { error?: string }>({
      url: `${gatewayUrl}/api/provider-runtime/execute-turn`,
      headers,
      body: payload,
      timeoutMs,
    }, {
      onRetry: (attempt, detail) =>
        ctx.onLog("stderr", `[hermes-gateway] Runtime gateway attempt ${attempt} failed: ${detail}; retrying.\n`),
    });

    if (response.status < 200 || response.status >= 300 || !response.data) {
      const detail = response.data?.error || response.text || `HTTP ${response.status}`;
      await ctx.onLog("stderr", `[hermes-gateway] Runtime gateway request failed: ${detail}\n`);
      return buildExecutionError(`T3 runtime gateway request failed: ${detail}`);
    }

    const assistantText = typeof response.data.assistantText === "string" ? response.data.assistantText : "";
    const sessionId = extractHermesSessionId(response.data.session);
    if (sessionId) {
      await ctx.onLog("stdout", `[hermes-gateway] Shared Hermes session: ${sessionId}\n`);
    }
    await ctx.onLog("stdout", `[hermes-gateway] Shared T3 thread: ${response.data.threadId}\n`);

    const executionResult: AdapterExecutionResult = {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: assistantText.slice(0, 2000),
      resultJson: {
        result: assistantText,
        session_id: sessionId,
        t3_thread_id: response.data.threadId,
        t3_project_id: response.data.projectId,
      },
    };
    if (sessionId) {
      executionResult.sessionParams = { sessionId };
      executionResult.sessionDisplayId = sessionId.slice(0, 16);
    }
    return executionResult;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await ctx.onLog("stderr", `[hermes-gateway] Runtime gateway request failed: ${detail}\n`);
    return buildExecutionError(`T3 runtime gateway request failed: ${detail}`);
  }
}

export async function testEnvironment(ctx: {
  config?: Record<string, unknown>;
}): Promise<AdapterEnvironmentTestResult> {
  const config = cfgRecord(ctx.config) ?? {};
  const resolvedEnv = getResolvedEnv(config);
  const gatewayUrl = resolveGatewayUrl(config, resolvedEnv);
  const { headers, hasAuth } = resolveGatewayTokenHeaders(config, resolvedEnv);
  const model =
    cfgString(config.model) ||
    resolvedEnv.T3_RUNTIME_GATEWAY_HERMES_MODEL ||
    process.env.T3_RUNTIME_GATEWAY_HERMES_MODEL ||
    DEFAULT_HERMES_MODEL;
  const checks: AdapterEnvironmentCheck[] = [
    {
      level: "info",
      message: `T3 runtime gateway URL: ${gatewayUrl}`,
      code: "t3_runtime_gateway_url",
    },
    {
      level: "info",
      message: `Hermes model via T3 gateway: ${model}`,
      code: "t3_runtime_gateway_hermes_model",
    },
  ];

  if (!hasAuth) {
    checks.push({
      level: "error",
      message: "Missing T3 runtime gateway credentials",
      hint: "Set T3_RUNTIME_GATEWAY_BEARER_TOKEN or T3_RUNTIME_GATEWAY_TOKEN in the Paperclip environment.",
      code: "t3_runtime_gateway_auth_missing",
    });
    return {
      adapterType: "hermes_local",
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const response = await fetchJson<{ sessions?: unknown; error?: string }>({
      url: `${gatewayUrl}/api/provider-runtime/sessions/list`,
      headers,
      body: { provider: "hermesAgent" },
      timeoutMs: 15000,
    });
    if (response.status >= 200 && response.status < 300) {
      checks.push({
        level: "info",
        message: "T3 runtime gateway authenticated successfully",
        code: "t3_runtime_gateway_auth_ok",
      });
      return {
        adapterType: "hermes_local",
        status: "pass",
        checks,
        testedAt: new Date().toISOString(),
      };
    }

    checks.push({
      level: "error",
      message: `T3 runtime gateway returned HTTP ${response.status}`,
      hint: response.data?.error || response.text || "Check T3 gateway auth and connectivity.",
      code: "t3_runtime_gateway_http_error",
    });
    return {
      adapterType: "hermes_local",
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    checks.push({
      level: "error",
      message: "Failed to reach T3 runtime gateway",
      hint: error instanceof Error ? error.message : String(error),
      code: "t3_runtime_gateway_unreachable",
    });
    return {
      adapterType: "hermes_local",
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  }
}
