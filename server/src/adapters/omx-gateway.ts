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

const DEFAULT_TIMEOUT_SEC = 900;
const DEFAULT_OMX_MODEL = "gpt-5.4";
const DEFAULT_GATEWAY_URL = "http://t3code-vps:3773";
const DEFAULT_PAPERCLIP_API_URL = "http://paperclip:3100/api";
const DEFAULT_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use the terminal tool with curl for Paperclip control-plane API calls.
Do not use localhost or 127.0.0.1 for Paperclip from the T3 runtime container.
Use the API Base printed below exactly. In production compose this is the Docker service URL.
Do not use, request, reveal, write, diff, or paste Paperclip bearer tokens.
Use only the provided run auth header in direct API commands.

Run-scoped API access rule:
Use company-scoped routes first. Your normal discovery path is \`/api/companies/{{companyId}}/operational-context\`, \`/api/companies/{{companyId}}/issues\`, \`/api/companies/{{companyId}}/agents\`, and specific \`/api/issues/{id}\` routes. If a global board-only route returns \`Board access required\`, do not stop the value loop; switch to the company-scoped route and continue. Never report \`No value loop possible\` solely because a board/admin route is unavailable.

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

## Strategic Start Gate

Before executing any task that starts or materially changes a social account, outbound sales motion, promotion channel, paid/organic campaign, customer-facing workflow, external connector, pricing/offer, partnership, launch, or revenue process, verify that the issue or its documents/comments contain a current strategy artifact headed exactly \`THECLAWBAY_STRATEGY_GATE_APPROVED\`.

If this issue title starts with \`Strategy gate:\` or the issue explicitly asks for TheClawBay strategy approval, you are the gate. Do not recursively create another gate and do not block yourself. Produce the approval artifact in an issue comment or document headed exactly \`THECLAWBAY_STRATEGY_GATE_APPROVED\`, including rules, standards, risk limits, target audience, research basis, operating cadence, success metric, and optimal MiniMax execution plan. Then mark the gate issue \`in_review\` with proof.

If the approval artifact is missing on a non-gate execution task:
1. Do not perform daily posting, outreach, connector mutation, or launch execution yet.
2. Create exactly one high-priority prerequisite issue titled \`Strategy gate: {{taskTitle}}\` assigned to the company CEO or strategy lead if one is visible in operational context. The required model for that issue is GPT-5.5 via TheClawBay at medium reasoning; the deliverable is rules, standards, risk limits, target audience, research basis, operating cadence, success metric, and an optimal execution plan.
3. Comment on this issue that execution is paused pending TheClawBay strategy approval, include the prerequisite issue ID if created, then set this issue to \`blocked\`.
4. Stop after that. Do not create any other issues.

MiniMax M2.7 is the workhorse for implementation only after the TheClawBay strategy gate exists. Keep company data, customer context, learned rules, and memory separate by company unless the issue explicitly authorizes cross-company synthesis.

## Workflow

1. Work on the task using your tools, subject to the Strategic Start Gate above.
2. When done, post a completion comment on the issue with concrete proof before closing it:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/{{taskId}}/comments" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"body":"DONE: <your summary here>"}'\`
3. Then mark the issue as completed:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/{{taskId}}" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"status":"done"}'\`
4. If this issue has a parent (check the issue body or comments for references like TRA-XX), post a brief notification on the parent issue so the parent owner knows:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/PARENT_ISSUE_ID/comments" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"body":"{{agentName}} completed {{taskId}}. Summary: <brief>"}'\`
5. After posting proof and closing the issue, stop. Do not keep working, browse for more work, or create additional issues unless this assigned task explicitly requires it.
{{/taskId}}

{{#commentId}}
## Comment on This Issue

Someone commented. Read it:
   \`curl -s "{{paperclipApiUrl}}/issues/{{taskId}}/comments/{{commentId}}" {{paperclipCurlHeaders}} | python3 -m json.tool\`

Address the comment, POST a reply if needed, then continue working.
{{/commentId}}

{{#noTask}}
## Autonomous Company Operating Cycle

This wake is not a queue poll. Run one value-generation cycle for this company.
Paperclip is the control plane; use normal tools and available plugins for the real work.

Primary objective: make the company more valuable. Useful work means generating revenue, serving a customer, shipping or improving a product, creating/promoting an asset, learning something that changes a decision, or improving automation that unblocks those outcomes. Internal activity is not value unless it produces one of those outputs.

Agency rule: blockers are inputs, not stopping points. If a connector, social account, payment provider, credential, domain, or API is missing, produce the nearest useful workaround in the same run: an owned-channel draft, prospect list, landing-page copy, customer reply, implementation patch, payment setup checklist, partner brief, or one precise unblocker issue. Never close with only "blocked" unless you also created an asset, decision, or next executable issue that moves toward revenue.

Value loop priority, in order:
1. Make money or unlock a sale.
2. Serve or retain a customer/user.
3. Build, code, ship, test, or document a product improvement.
4. Promote, publish, distribute, or create an audience/customer acquisition asset.
5. Research, learn, or generate ideas only when it produces a concrete decision, prospect list, content brief, product spec, experiment, or implementation task.
6. Improve operations/reliability only when it removes a blocker to the above.

1. Build context before deciding:
   - Company context: \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/operational-context" {{paperclipCurlHeaders}} | python3 -m json.tool\`
   - Assigned work: \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}" {{paperclipCurlHeaders}} | python3 -m json.tool\`
   - Finance/revenue state: check finance dashboard, budget policies, open revenue issues, recent customer/sales signals, and whether accounting has a current ledger. If finance/accounting is empty, create one concrete finance or revenue issue instead of a generic health review.

2. Pick exactly one high-leverage value lane for this run:
   - Revenue/sales/customer: reply, follow up, create an offer, unblock a lead, prepare a deliverable, or reduce churn risk.
   - Product/build/code: ship, test, document, fix, deploy, or create a concrete implementation issue.
   - Promotion/distribution/content: create or improve a page, post, outreach list, campaign, demo, case study, or SEO/GEO asset.
   - Research/learning/ideas: produce a decision-ready insight, validated idea, prospect list, competitor note, product spec, or experiment tied to a company goal.
   - Operations/reliability: fix a broken integration, reduce noisy work, improve routing, or create a precise remediation issue only when it unlocks revenue, product, customer, or promotion work.

3. If assigned actionable work exists, execute the highest-value item first. Read the issue, do the work, then comment with proof before closing it:
   - Read: \`curl -s "{{paperclipApiUrl}}/issues/ISSUE_ID" {{paperclipCurlHeaders}} | python3 -m json.tool\`
   - Comment: \`curl -s -X POST "{{paperclipApiUrl}}/issues/ISSUE_ID/comments" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"body":"DONE: <value created, outcome, evidence, links/files changed, remaining risk>"}'\`
   - Complete: \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/ISSUE_ID" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"status":"done"}'\`

4. If no assigned work is actionable, create or assign at most one concrete next issue only when it advances the value loop. Replace SPECIALIST_AGENT_ID with a real agent UUID from the company context:
   \`curl -s -X POST "{{paperclipApiUrl}}/companies/{{companyId}}/issues" {{paperclipCurlHeaders}} -H "Content-Type: application/json" -d '{"title":"<specific value outcome>", "description":"Value hypothesis: <money/customer/product/promotion impact>\\n\\nRequired output: <asset/code/research/decision/outreach/deliverable>\\n\\nAcceptance criteria:\\n- <verifiable result>\\n- <proof expected>", "status":"todo", "priority":"high", "assigneeAgentId":"SPECIALIST_AGENT_ID"}'\`

5. Do not create generic audit, review, research, heartbeat, check-in, strategy, or "look for work" issues. Research is valid only when the deliverable is a decision, prospect list, content brief, product spec, experiment, or implementation task. Create at most one follow-up issue total in this run. If the best issue is blocked, first attempt a workaround deliverable and add proof to that issue; only then create one narrow unblocker or switch to the next money/customer/product/promotion item. After you create one follow-up issue or post one completion proof, stop instead of continuing to operate. Do not fan out multiple jobs. Do not mix data or decisions across companies.

6. End with a concise operating report in your final answer: value lane chosen, value created or unlocked, Paperclip issue/comment IDs touched, external work done, learning captured, and the next concrete blocker if any. Only say "nothing useful to do" after proving no assigned work, no urgent customer/revenue/product/promotion item, and no safe next value issue worth creating.
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
  const agentName = ctx.agent?.name || "OMX Agent";
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

function extractOmxSessionId(session: SharedRuntimeSessionRecord | null): string | null {
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
      // creates duplicate OMX workers for the same Paperclip issue.
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
    resolvedEnv.T3_RUNTIME_GATEWAY_OMX_MODEL ||
    process.env.T3_RUNTIME_GATEWAY_OMX_MODEL ||
    DEFAULT_OMX_MODEL;
  const reasoningEffort = cfgString(config.modelReasoningEffort) || cfgString(config.reasoningEffort);
  const prompt = buildPrompt(ctx, config);
  const taskId = cfgString(ctx.config?.taskId);
  const taskTitle = cfgString(ctx.config?.taskTitle);
  const agentName = ctx.agent?.name || "OMX Agent";
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
      "[omx-gateway] Missing T3 runtime gateway credentials. Set T3_RUNTIME_GATEWAY_BEARER_TOKEN or T3_RUNTIME_GATEWAY_TOKEN.\n",
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
    `[omx-gateway] Executing via T3 runtime gateway (${gatewayUrl}) with model=${model}\n`,
  );

  const payload = {
    provider: "ohMyCodex",
    owner: {
      ownerKind,
      ownerId,
      companyId: ctx.agent?.companyId || undefined,
      roleScope: agentName,
    },
    title: taskOrAgentTitle,
    prompt,
    modelSelection: {
      provider: "ohMyCodex",
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
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
        ctx.onLog("stderr", `[omx-gateway] Runtime gateway attempt ${attempt} failed: ${detail}; retrying.\n`),
    });

    if (response.status < 200 || response.status >= 300 || !response.data) {
      const detail = response.data?.error || response.text || `HTTP ${response.status}`;
      await ctx.onLog("stderr", `[omx-gateway] Runtime gateway request failed: ${detail}\n`);
      return buildExecutionError(`T3 runtime gateway request failed: ${detail}`);
    }

    const assistantText = typeof response.data.assistantText === "string" ? response.data.assistantText : "";
    const sessionId = extractOmxSessionId(response.data.session);
    if (sessionId) {
      await ctx.onLog("stdout", `[omx-gateway] Shared OMX session: ${sessionId}\n`);
    }
    await ctx.onLog("stdout", `[omx-gateway] Shared T3 thread: ${response.data.threadId}\n`);

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
    await ctx.onLog("stderr", `[omx-gateway] Runtime gateway request failed: ${detail}\n`);
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
    resolvedEnv.T3_RUNTIME_GATEWAY_OMX_MODEL ||
    process.env.T3_RUNTIME_GATEWAY_OMX_MODEL ||
    DEFAULT_OMX_MODEL;
  const checks: AdapterEnvironmentCheck[] = [
    {
      level: "info",
      message: `T3 runtime gateway URL: ${gatewayUrl}`,
      code: "t3_runtime_gateway_url",
    },
    {
      level: "info",
      message: `OMX model via T3 gateway: ${model}`,
      code: "t3_runtime_gateway_omx_model",
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
      adapterType: "omx_local",
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const response = await fetchJson<{ sessions?: unknown; error?: string }>({
      url: `${gatewayUrl}/api/provider-runtime/sessions/list`,
      headers,
      body: { provider: "ohMyCodex" },
      timeoutMs: 15000,
    });
    if (response.status >= 200 && response.status < 300) {
      checks.push({
        level: "info",
        message: "T3 runtime gateway authenticated successfully",
        code: "t3_runtime_gateway_auth_ok",
      });
      return {
        adapterType: "omx_local",
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
      adapterType: "omx_local",
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
      adapterType: "omx_local",
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  }
}
