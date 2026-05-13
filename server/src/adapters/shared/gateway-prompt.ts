import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "../types.js";
import { ensureAbsoluteDirectory, renderTemplate } from "../utils.js";
import {
  renderPaperclipWakePrompt,
} from "@paperclipai/adapter-utils/server-utils";

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

const DEFAULT_GATEWAY_URL = "";
const DEFAULT_PAPERCLIP_API_URL = "http://paperclip:3100/api";

const DEFAULT_PROMPT_TEMPLATE = `You are {{agentName}}, an AI agent employee in a Paperclip-managed company.

Identity: Agent ID {{agentId}}, Company ID {{companyId}}, API Base {{paperclipApiUrl}}
Auth: include X-Paperclip-Run-Id: {{runId}} and the run auth header on every mutating API request. Do not use board/browser sessions for API writes.

Routing: prefer company-scoped routes (/api/companies/{{companyId}}/...). If a global route returns "Board access required", switch to the company-scoped equivalent.

Before acting, read company operational context and any standing strategy documents in company memory. Keep company data separate unless explicitly authorized.

{{#wakePrompt}}
{{wakePrompt}}
{{/wakePrompt}}

{{#taskId}}
## Task
Issue {{taskId}}: {{taskTitle}}

{{taskBody}}

Work on the task, post proof in a comment, mark the issue done, then stop. If the issue has a parent, notify the parent.
{{/taskId}}

{{#commentId}}
## New Comment
Address the comment, reply if needed, continue working.
{{/commentId}}

{{#noTask}}
## Autonomous Cycle
Run one value-generation cycle for this company.

Value priority: revenue > customer > product > promotion > decision-ready research > ops/reliability (only when it unblocks the above).

Blockers are inputs, not stopping points. If something is missing, produce the nearest workaround in the same run. Never close with only "blocked" without also creating an asset or next executable issue.

If no actionable work exists, create at most one concrete next issue that advances the value loop. Update company memory (learning-log, revenue-memory, operating-playbook, agent-handoff) after meaningful work.
{{/noTask}}`;

export function cfgString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function cfgNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function cfgRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getResolvedEnv(config: Record<string, unknown>): Record<string, string> {
  const rawEnv = cfgRecord(config.env);
  const resolved: Record<string, string> = {};
  if (!rawEnv) return resolved;
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === "string" && value.length > 0) {
      resolved[key] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (obj.type === "plain" && typeof obj.value === "string") {
        resolved[key] = obj.value;
      }
    }
  }
  return resolved;
}

export function normalizeGatewayBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizePaperclipApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function resolveGatewayUrl(
  config: Record<string, unknown>,
  env: Record<string, string>,
  defaultUrl: string = DEFAULT_GATEWAY_URL,
): string {
  return normalizeGatewayBaseUrl(
    cfgString(config.runtimeGatewayUrl) ||
      env.RUNTIME_GATEWAY_URL ||
      process.env.RUNTIME_GATEWAY_URL ||
      defaultUrl,
  );
}

export function isLoopbackPaperclipApiUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function resolvePaperclipApiUrl(
  config: Record<string, unknown>,
  env: Record<string, string>,
  defaultUrl: string = DEFAULT_PAPERCLIP_API_URL,
): string {
  const configured =
    cfgString(config.paperclipApiUrl) ||
    env.PAPERCLIP_INTERNAL_API_URL ||
    env.PAPERCLIP_API_URL ||
    process.env.PAPERCLIP_INTERNAL_API_URL ||
    process.env.PAPERCLIP_API_URL;

  const safeConfigured = isLoopbackPaperclipApiUrl(configured) ? undefined : configured;
  return normalizePaperclipApiUrl(safeConfigured || defaultUrl);
}

export function resolveGatewayTokenHeaders(config: Record<string, unknown>, env: Record<string, string>) {
  const runtimeToken =
    cfgString(config.runtimeGatewayToken) ||
    env.RUNTIME_GATEWAY_TOKEN ||
    process.env.RUNTIME_GATEWAY_TOKEN;
  const bearerToken =
    cfgString(config.runtimeGatewayBearerToken) ||
    env.RUNTIME_GATEWAY_BEARER_TOKEN ||
    process.env.RUNTIME_GATEWAY_BEARER_TOKEN;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (runtimeToken) {
    headers["x-runtime-gateway-token"] = runtimeToken;
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return { headers, hasAuth: Boolean(runtimeToken || bearerToken) };
}

export function buildPaperclipCurlHeaders(_config: Record<string, unknown>, runId: string): string {
  const headers: string[] = [];
  if (runId) {
    headers.push(`-H "X-Paperclip-Run-Id: ${runId}"`);
  }
  return headers.join(" ");
}

export function buildPrompt(ctx: AdapterExecutionContext, config: Record<string, unknown>): string {
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
  const taskId = cfgString(ctx.config?.taskId);
  const taskTitle = cfgString(ctx.config?.taskTitle) || "";
  const taskBody = cfgString(ctx.config?.taskBody) || "";
  const commentId = cfgString(ctx.config?.commentId) || "";
  const agentName = ctx.agent?.name || "Agent";
  const companyName = cfgString(ctx.config?.companyName) || "";

  const paperclipApiUrl = resolvePaperclipApiUrl(config, getResolvedEnv(config));

  const wakePrompt = ctx.context?.paperclipWake
    ? renderPaperclipWakePrompt(ctx.context.paperclipWake as Record<string, unknown>, { resumedSession: false })
    : "";
  const sessionHandoff = cfgString(ctx.context?.paperclipSessionHandoffMarkdown) || "";

  const vars: Record<string, string> = {
    agentId: ctx.agent?.id || "",
    agentName,
    companyId: ctx.agent?.companyId || "",
    companyName,
    runId: ctx.runId || "",
    taskId: taskId || "",
    taskTitle,
    taskBody,
    commentId,
    paperclipApiUrl,
    paperclipCurlHeaders: buildPaperclipCurlHeaders(config, ctx.runId || ""),
    wakePrompt: wakePrompt + (sessionHandoff ? "\n\n" + sessionHandoff : ""),
  };

  let rendered = template;
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, taskId ? "$1" : "");
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, taskId ? "" : "$1");
  rendered = rendered.replace(/\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g, commentId ? "$1" : "");
  rendered = rendered.replace(/\{\{#wakePrompt\}\}([\s\S]*?)\{\{\/wakePrompt\}\}/g, vars.wakePrompt ? "$1" : "");
  return renderTemplate(rendered, vars);
}

export async function fetchJson<T>(input: {
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

export async function fetchJsonWithRetry<T>(
  input: Parameters<typeof fetchJson<T>>[0],
  options: {
    attempts?: number;
    allowAbortRetry?: boolean;
    onRetry?: (attempt: number, detail: string) => Promise<void>;
  } = {},
): Promise<{ status: number; data: T | null; text: string }> {
  const attempts = Math.max(1, options.attempts ?? 5);
  let lastError: unknown;
  let abortRetryUsed = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchJson<T>(input);
      const isRetryableHttp = [502, 503, 504].includes(response.status) ||
        (response.status === 400 && (response.text ?? "").toLowerCase().includes("not found"));
      if (!isRetryableHttp || attempt === attempts) {
        return response;
      }
      const detail = response.text || `HTTP ${response.status}`;
      await options.onRetry?.(attempt, detail);
    } catch (error) {
      lastError = error;
      if (isAbortError(error)) {
        if (options.allowAbortRetry && !abortRetryUsed) {
          abortRetryUsed = true;
          const detail = error instanceof Error ? error.message : String(error);
          await options.onRetry?.(attempt, `abort (one retry granted): ${detail}`);
        } else {
          break;
        }
      }
      if (attempt === attempts) break;
      const detail = error instanceof Error ? error.message : String(error);
      await options.onRetry?.(attempt, detail);
    }

    await sleep(Math.min(2000 * attempt, 10000) + Math.floor(Math.random() * 1000));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "fetch failed"));
}

export function buildExecutionError(
  message: string,
  options?: { timedOut?: boolean; errorCode?: string },
): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: options?.timedOut ?? false,
    errorCode: options?.errorCode,
    errorMessage: message,
    resultJson: {
      error: message,
      ...(options?.errorCode ? { errorCode: options.errorCode } : {}),
    },
  };
}

export interface GatewayAdapterOptions {
  adapterLabel: string;
  adapterType: string;
  defaultModel: string;
  defaultProvider: string;
  providerInPayload: string;
  defaultTimeoutSec: number;
  maxTimeoutSec?: number;
  defaultGatewayUrl?: string;
  defaultPaperclipApiUrl?: string;
  healthCheck?: boolean;
  retryAttempts?: number;
  allowAbortRetry?: boolean;
}

export function createGatewayAdapter(options: GatewayAdapterOptions) {
  const {
    adapterLabel,
    adapterType,
    defaultModel,
    defaultProvider,
    providerInPayload,
    defaultTimeoutSec,
    maxTimeoutSec,
    defaultGatewayUrl,
    defaultPaperclipApiUrl,
    healthCheck = false,
    retryAttempts = 5,
    allowAbortRetry = false,
  } = options;

  async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const config = cfgRecord(ctx.agent?.adapterConfig) ?? {};
    const resolvedEnv = getResolvedEnv(config);
    const gatewayUrl = resolveGatewayUrl(config, resolvedEnv, defaultGatewayUrl);
    const { headers, hasAuth } = resolveGatewayTokenHeaders(config, resolvedEnv);
    const configuredTimeoutSec = cfgNumber(config.timeoutSec) || defaultTimeoutSec;
    const timeoutSec = maxTimeoutSec ? Math.max(60, Math.min(configuredTimeoutSec, maxTimeoutSec)) : configuredTimeoutSec;
    const timeoutMs = timeoutSec * 1000;
    const model =
      cfgString(config.model) ||
      resolvedEnv.RUNTIME_GATEWAY_MODEL ||
      process.env.RUNTIME_GATEWAY_MODEL ||
      defaultModel;
    const runtimeProvider =
      cfgString(config.runtimeProvider) ||
      cfgString(config.modelProvider) ||
      resolvedEnv.RUNTIME_GATEWAY_PROVIDER ||
      process.env.RUNTIME_GATEWAY_PROVIDER ||
      defaultProvider;
    const reasoningEffort = cfgString(config.modelReasoningEffort) || cfgString(config.reasoningEffort);
    const prompt = buildPrompt(ctx, config);
    const taskId = cfgString(ctx.config?.taskId);
    const taskTitle = cfgString(ctx.config?.taskTitle);
    const agentName = ctx.agent?.name || adapterLabel;
    const taskOrAgentTitle = taskTitle || agentName;
    const cwd = cfgString(config.cwd) || cfgString(ctx.config?.workspaceDir) || ".";

    try {
      await ensureAbsoluteDirectory(cwd);
    } catch {
      // Non-fatal; the external runtime owns the real execution cwd.
    }

    if (!hasAuth) {
      await ctx.onLog(
        "stderr",
        `[${adapterLabel}] Missing runtime gateway credentials. Set RUNTIME_GATEWAY_BEARER_TOKEN or RUNTIME_GATEWAY_TOKEN.\n`,
      );
      return buildExecutionError(
        "Missing runtime gateway credentials. Configure RUNTIME_GATEWAY_BEARER_TOKEN or RUNTIME_GATEWAY_TOKEN.",
      );
    }

    const companyId = ctx.agent?.companyId || "global";
    const agentId = ctx.agent?.id || "unknown-agent";
    const ownerKind = taskId ? "paperclip_issue" : "paperclip_agent_run";
    const ownerId = taskId || `${companyId}:${agentId}`;
    await ctx.onLog(
      "stdout",
      `[${adapterLabel}] Executing via runtime gateway (${gatewayUrl}) with provider=${runtimeProvider} model=${model}\n`,
    );

    if (healthCheck) {
      try {
        const health = await fetchJson({ url: `${gatewayUrl}/health`, method: "GET", headers, timeoutMs: 5000 });
        if (health.status < 200 || health.status >= 300) {
          await ctx.onLog(
            "stderr",
            `[${adapterLabel}] Runtime gateway health check failed (HTTP ${health.status}). Gateway may be restarting.\n`,
          );
          return buildExecutionError(
            `Runtime gateway health check failed (HTTP ${health.status}). Gateway may be restarting.`,
            { errorCode: "runtime_gateway_unhealthy" },
          );
        }
      } catch (healthErr) {
        const healthDetail = healthErr instanceof Error ? healthErr.message : String(healthErr);
        await ctx.onLog(
          "stderr",
          `[${adapterLabel}] Runtime gateway health check unreachable: ${healthDetail}. Gateway may be restarting.\n`,
        );
        return buildExecutionError(
          `Runtime gateway unreachable: ${healthDetail}. Gateway may be restarting.`,
          { errorCode: "runtime_gateway_unreachable" },
        );
      }
    }

    const payload = {
      provider: providerInPayload,
      owner: {
        ownerKind,
        ownerId,
        companyId: ctx.agent?.companyId || undefined,
        roleScope: agentName,
      },
      title: taskOrAgentTitle,
      prompt,
      modelSelection: {
        provider: providerInPayload,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      timeoutMs,
    };

    try {
      const response = await fetchJsonWithRetry<SharedRuntimeExecuteTurnResult & { error?: string }>(
        {
          url: `${gatewayUrl}/api/provider-runtime/execute-turn`,
          headers,
          body: payload,
          timeoutMs,
        },
        {
          attempts: retryAttempts,
          allowAbortRetry,
          onRetry: (attempt, detail) =>
            ctx.onLog("stderr", `[${adapterLabel}] Runtime gateway attempt ${attempt} failed: ${detail}; retrying.\n`),
        },
      );

      if (response.status < 200 || response.status >= 300 || !response.data) {
        const detail = response.data?.error || response.text || `HTTP ${response.status}`;
        await ctx.onLog("stderr", `[${adapterLabel}] Runtime gateway request failed: ${detail}\n`);
        return buildExecutionError(`Runtime gateway request failed: ${detail}`);
      }

      const assistantText = typeof response.data.assistantText === "string" ? response.data.assistantText : "";
      const session = response.data.session;
      const resumeCursor = session?.resumeCursor;
      const sessionId =
        resumeCursor && typeof resumeCursor === "object" && !Array.isArray(resumeCursor)
          ? (resumeCursor as Record<string, unknown>).sessionId
          : null;
      const sessionIdStr = typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : null;

      if (sessionIdStr) {
        await ctx.onLog("stdout", `[${adapterLabel}] Shared session: ${sessionIdStr}\n`);
      }
      await ctx.onLog("stdout", `[${adapterLabel}] Shared runtime thread: ${response.data.threadId}\n`);

      const executionResult: AdapterExecutionResult = {
        exitCode: 0,
        signal: null,
        timedOut: false,
        summary: assistantText.slice(0, 2000),
        resultJson: {
          result: assistantText,
          session_id: sessionIdStr,
          runtime_thread_id: response.data.threadId,
          runtime_project_id: response.data.projectId,
        },
      };
      if (sessionIdStr) {
        executionResult.sessionParams = { sessionId: sessionIdStr };
        executionResult.sessionDisplayId = sessionIdStr.slice(0, 16);
      }
      return executionResult;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isAbortError(error)) {
        await ctx.onLog("stderr", `[${adapterLabel}] Runtime gateway timed out after ${timeoutSec}s.\n`);
        return buildExecutionError(
          `Runtime gateway request timed out after ${timeoutSec}s`,
          { timedOut: true, errorCode: "runtime_gateway_timeout" },
        );
      }
      await ctx.onLog("stderr", `[${adapterLabel}] Runtime gateway request failed: ${detail}\n`);
      return buildExecutionError(`Runtime gateway request failed: ${detail}`);
    }
  }

  async function testEnvironment(ctx: {
    config?: Record<string, unknown>;
  }): Promise<AdapterEnvironmentTestResult> {
    const config = cfgRecord(ctx.config) ?? {};
    const resolvedEnv = getResolvedEnv(config);
    const gatewayUrl = resolveGatewayUrl(config, resolvedEnv, defaultGatewayUrl);
    const { headers, hasAuth } = resolveGatewayTokenHeaders(config, resolvedEnv);
    const model =
      cfgString(config.model) ||
      resolvedEnv.RUNTIME_GATEWAY_MODEL ||
      process.env.RUNTIME_GATEWAY_MODEL ||
      defaultModel;
    const checks: AdapterEnvironmentCheck[] = [
      {
        level: "info",
        message: `Runtime gateway URL: ${gatewayUrl}`,
        code: "runtime_gateway_url",
      },
      {
        level: "info",
        message: `${adapterLabel} model via runtime gateway: ${model}`,
        code: "runtime_gateway_model",
      },
    ];

    if (!hasAuth) {
      checks.push({
        level: "error",
        message: "Missing runtime gateway credentials",
        hint: "Set RUNTIME_GATEWAY_BEARER_TOKEN or RUNTIME_GATEWAY_TOKEN in the Paperclip environment.",
        code: "runtime_gateway_auth_missing",
      });
      return {
        adapterType,
        status: "fail",
        checks,
        testedAt: new Date().toISOString(),
      };
    }

    try {
      const response = await fetchJson<{ sessions?: unknown; error?: string }>({
        url: `${gatewayUrl}/api/provider-runtime/sessions/list`,
        headers,
        body: { provider: providerInPayload },
        timeoutMs: 15000,
      });
      if (response.status >= 200 && response.status < 300) {
        checks.push({
          level: "info",
          message: "Runtime gateway authenticated successfully",
          code: "runtime_gateway_auth_ok",
        });
        return {
          adapterType,
          status: "pass",
          checks,
          testedAt: new Date().toISOString(),
        };
      }

      checks.push({
        level: "error",
        message: `Runtime gateway returned HTTP ${response.status}`,
        hint: response.data?.error || response.text || "Check runtime gateway auth and connectivity.",
        code: "runtime_gateway_http_error",
      });
      return {
        adapterType,
        status: "fail",
        checks,
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      checks.push({
        level: "error",
        message: "Failed to reach runtime gateway",
        hint: error instanceof Error ? error.message : String(error),
        code: "runtime_gateway_unreachable",
      });
      return {
        adapterType,
        status: "fail",
        checks,
        testedAt: new Date().toISOString(),
      };
    }
  }

  return { execute, testEnvironment };
}

