import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginProjectSidebarItemProps,
  type PluginWidgetProps
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS, PLUGIN_ID } from "../constants.js";
import type {
  ApplyMode,
  OptimizerDefinition,
  OptimizerRunRecord,
  OptimizerTemplate,
  OverviewData
} from "../types.js";

type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
};

type ProjectInfo = {
  id: string;
  name?: string;
  title?: string;
};

type RunCycleResult = {
  optimizer: OptimizerDefinition;
  run: OptimizerRunRecord;
};

type FormState = {
  optimizerId?: string;
  name: string;
  objective: string;
  workspaceId: string;
  mutablePaths: string;
  mutationCommand: string;
  scoreCommand: string;
  guardrailCommand: string;
  scoreDirection: "maximize" | "minimize";
  scorePattern: string;
  scoreFormat: "number" | "json";
  scoreKey: string;
  guardrailFormat: "number" | "json";
  guardrailKey: string;
  scoreRepeats: string;
  scoreAggregator: "median" | "mean" | "max" | "min";
  guardrailRepeats: string;
  guardrailAggregator: "all" | "any";
  minimumImprovement: string;
  mutationBudgetSeconds: string;
  scoreBudgetSeconds: string;
  guardrailBudgetSeconds: string;
  hiddenScoring: boolean;
  autoRun: boolean;
  sandboxStrategy: "copy" | "git_worktree";
  scorerIsolationMode: "same_workspace" | "separate_workspace";
  status: "active" | "paused";
  applyMode: ApplyMode;
  requireHumanApproval: boolean;
  autoCreateIssueOnGuardrailFailure: boolean;
  autoCreateIssueOnStagnation: boolean;
  stagnationIssueThreshold: string;
  proposalBranchPrefix: string;
  proposalCommitMessage: string;
  proposalPrCommand: string;
  notes: string;
};

const shellExample = `codex exec "Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only."`;
const scoreExample = `node -e "console.log(JSON.stringify({ primary: 1, metrics: { testPassRate: 1 }, guardrails: { noRegression: true } }))"`;

const pageStyle: CSSProperties = {
  display: "grid",
  gap: 16
};

const cardStyle: CSSProperties = {
  border: "1px solid rgba(100, 116, 139, 0.22)",
  borderRadius: 16,
  padding: 18,
  background: "linear-gradient(180deg, rgba(248, 250, 252, 0.92), rgba(255, 255, 255, 0.98))",
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.06)"
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(100, 116, 139, 0.35)",
  background: "white"
};

const buttonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  background: "white",
  cursor: "pointer"
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#0f172a",
  color: "white",
  borderColor: "#0f172a"
};

function emptyForm(workspaceId = ""): FormState {
  return {
    name: "",
    objective: "",
    workspaceId,
    mutablePaths: ".",
    mutationCommand: shellExample,
    scoreCommand: scoreExample,
    guardrailCommand: "",
    scoreDirection: "maximize",
    scorePattern: "",
    scoreFormat: "json",
    scoreKey: "primary",
    guardrailFormat: "json",
    guardrailKey: "guardrails",
    scoreRepeats: "3",
    scoreAggregator: "median",
    guardrailRepeats: "1",
    guardrailAggregator: "all",
    minimumImprovement: "0",
    mutationBudgetSeconds: "300",
    scoreBudgetSeconds: "180",
    guardrailBudgetSeconds: "",
    hiddenScoring: true,
    autoRun: false,
    sandboxStrategy: "git_worktree",
    scorerIsolationMode: "separate_workspace",
    status: "active",
    applyMode: "manual_approval",
    requireHumanApproval: true,
    autoCreateIssueOnGuardrailFailure: true,
    autoCreateIssueOnStagnation: false,
    stagnationIssueThreshold: "5",
    proposalBranchPrefix: "",
    proposalCommitMessage: "",
    proposalPrCommand: "",
    notes: ""
  };
}

function formFromOptimizer(optimizer: OptimizerDefinition): FormState {
  return {
    optimizerId: optimizer.optimizerId,
    name: optimizer.name,
    objective: optimizer.objective,
    workspaceId: optimizer.workspaceId ?? "",
    mutablePaths: optimizer.mutablePaths.join("\n"),
    mutationCommand: optimizer.mutationCommand,
    scoreCommand: optimizer.scoreCommand,
    guardrailCommand: optimizer.guardrailCommand ?? "",
    scoreDirection: optimizer.scoreDirection,
    scorePattern: optimizer.scorePattern ?? "",
    scoreFormat: optimizer.scoreFormat,
    scoreKey: optimizer.scoreKey ?? "",
    guardrailFormat: optimizer.guardrailFormat,
    guardrailKey: optimizer.guardrailKey ?? "",
    scoreRepeats: String(optimizer.scoreRepeats),
    scoreAggregator: optimizer.scoreAggregator,
    guardrailRepeats: String(optimizer.guardrailRepeats),
    guardrailAggregator: optimizer.guardrailAggregator,
    minimumImprovement: String(optimizer.minimumImprovement),
    mutationBudgetSeconds: String(optimizer.mutationBudgetSeconds),
    scoreBudgetSeconds: String(optimizer.scoreBudgetSeconds),
    guardrailBudgetSeconds: optimizer.guardrailBudgetSeconds ? String(optimizer.guardrailBudgetSeconds) : "",
    hiddenScoring: optimizer.hiddenScoring,
    autoRun: optimizer.autoRun,
    sandboxStrategy: optimizer.sandboxStrategy,
    scorerIsolationMode: optimizer.scorerIsolationMode,
    status: optimizer.status,
    applyMode: optimizer.applyMode,
    requireHumanApproval: optimizer.requireHumanApproval,
    autoCreateIssueOnGuardrailFailure: optimizer.autoCreateIssueOnGuardrailFailure,
    autoCreateIssueOnStagnation: optimizer.autoCreateIssueOnStagnation,
    stagnationIssueThreshold: String(optimizer.stagnationIssueThreshold),
    proposalBranchPrefix: optimizer.proposalBranchPrefix ?? "",
    proposalCommitMessage: optimizer.proposalCommitMessage ?? "",
    proposalPrCommand: optimizer.proposalPrCommand ?? "",
    notes: optimizer.notes ?? ""
  };
}

function applyTemplate(template: OptimizerTemplate, current: FormState, workspaceId: string): FormState {
  const values = template.values;
  return {
    ...current,
    name: values.name ?? current.name,
    objective: values.objective ?? current.objective,
    workspaceId: values.workspaceId ?? workspaceId ?? current.workspaceId,
    mutablePaths: values.mutablePaths ? values.mutablePaths.join("\n") : current.mutablePaths,
    mutationCommand: values.mutationCommand ?? current.mutationCommand,
    scoreCommand: values.scoreCommand ?? current.scoreCommand,
    guardrailCommand: values.guardrailCommand ?? current.guardrailCommand,
    scoreDirection: values.scoreDirection ?? current.scoreDirection,
    scorePattern: values.scorePattern ?? current.scorePattern,
    scoreFormat: values.scoreFormat ?? current.scoreFormat,
    scoreKey: values.scoreKey ?? current.scoreKey,
    guardrailFormat: values.guardrailFormat ?? current.guardrailFormat,
    guardrailKey: values.guardrailKey ?? current.guardrailKey,
    scoreRepeats: values.scoreRepeats != null ? String(values.scoreRepeats) : current.scoreRepeats,
    scoreAggregator: values.scoreAggregator ?? current.scoreAggregator,
    guardrailRepeats: values.guardrailRepeats != null ? String(values.guardrailRepeats) : current.guardrailRepeats,
    guardrailAggregator: values.guardrailAggregator ?? current.guardrailAggregator,
    minimumImprovement: values.minimumImprovement != null ? String(values.minimumImprovement) : current.minimumImprovement,
    mutationBudgetSeconds: values.mutationBudgetSeconds != null ? String(values.mutationBudgetSeconds) : current.mutationBudgetSeconds,
    scoreBudgetSeconds: values.scoreBudgetSeconds != null ? String(values.scoreBudgetSeconds) : current.scoreBudgetSeconds,
    guardrailBudgetSeconds: values.guardrailBudgetSeconds != null ? String(values.guardrailBudgetSeconds) : current.guardrailBudgetSeconds,
    hiddenScoring: values.hiddenScoring ?? current.hiddenScoring,
    autoRun: values.autoRun ?? current.autoRun,
    sandboxStrategy: values.sandboxStrategy ?? current.sandboxStrategy,
    scorerIsolationMode: values.scorerIsolationMode ?? current.scorerIsolationMode,
    status: values.status ?? current.status,
    applyMode: values.applyMode ?? current.applyMode,
    requireHumanApproval: values.requireHumanApproval ?? current.requireHumanApproval,
    autoCreateIssueOnGuardrailFailure: values.autoCreateIssueOnGuardrailFailure ?? current.autoCreateIssueOnGuardrailFailure,
    autoCreateIssueOnStagnation: values.autoCreateIssueOnStagnation ?? current.autoCreateIssueOnStagnation,
    stagnationIssueThreshold: values.stagnationIssueThreshold != null ? String(values.stagnationIssueThreshold) : current.stagnationIssueThreshold,
    proposalBranchPrefix: values.proposalBranchPrefix ?? current.proposalBranchPrefix,
    proposalCommitMessage: values.proposalCommitMessage ?? current.proposalCommitMessage,
    proposalPrCommand: values.proposalPrCommand ?? current.proposalPrCommand,
    notes: values.notes ?? current.notes
  };
}

function toActionPayload(form: FormState) {
  return {
    optimizerId: form.optimizerId,
    name: form.name,
    objective: form.objective,
    workspaceId: form.workspaceId || undefined,
    mutablePaths: form.mutablePaths,
    mutationCommand: form.mutationCommand,
    scoreCommand: form.scoreCommand,
    guardrailCommand: form.guardrailCommand || undefined,
    scoreDirection: form.scoreDirection,
    scorePattern: form.scorePattern || undefined,
    scoreFormat: form.scoreFormat,
    scoreKey: form.scoreKey || undefined,
    guardrailFormat: form.guardrailFormat,
    guardrailKey: form.guardrailKey || undefined,
    scoreRepeats: Number(form.scoreRepeats || 0),
    scoreAggregator: form.scoreAggregator,
    guardrailRepeats: Number(form.guardrailRepeats || 1),
    guardrailAggregator: form.guardrailAggregator,
    minimumImprovement: Number(form.minimumImprovement || 0),
    mutationBudgetSeconds: Number(form.mutationBudgetSeconds || 0),
    scoreBudgetSeconds: Number(form.scoreBudgetSeconds || 0),
    guardrailBudgetSeconds: form.guardrailBudgetSeconds ? Number(form.guardrailBudgetSeconds) : undefined,
    hiddenScoring: form.hiddenScoring,
    autoRun: form.autoRun,
    sandboxStrategy: form.sandboxStrategy,
    scorerIsolationMode: form.scorerIsolationMode,
    status: form.status,
    applyMode: form.applyMode,
    requireHumanApproval: form.requireHumanApproval,
    autoCreateIssueOnGuardrailFailure: form.autoCreateIssueOnGuardrailFailure,
    autoCreateIssueOnStagnation: form.autoCreateIssueOnStagnation,
    stagnationIssueThreshold: Number(form.stagnationIssueThreshold || 0),
    proposalBranchPrefix: form.proposalBranchPrefix || undefined,
    proposalCommitMessage: form.proposalCommitMessage || undefined,
    proposalPrCommand: form.proposalPrCommand || undefined,
    notes: form.notes || undefined
  };
}

function formatScore(value: number | null | undefined): string {
  return value == null ? "n/a" : String(value);
}

function statusTone(outcome: string): string {
  if (outcome === "accepted") return "#166534";
  if (outcome === "pending_approval") return "#1d4ed8";
  if (outcome === "dry_run_candidate") return "#7c2d12";
  if (outcome === "invalid") return "#b91c1c";
  return "#334155";
}

function RunCard({
  run,
  onApprove,
  onReject,
  onCreateIssue,
  onCreatePullRequest
}: {
  run: OptimizerRunRecord;
  onApprove: (runId: string) => Promise<void>;
  onReject: (runId: string) => Promise<void>;
  onCreateIssue: (runId: string) => Promise<void>;
  onCreatePullRequest: (runId: string) => Promise<void>;
}) {
  const repeatSummary = run.scoringRepeats
    .map((entry, index) => `#${index + 1}: ${formatScore(entry.score)} (${entry.execution.exitCode ?? "null"})`)
    .join(" | ");

  return (
    <div style={{ border: "1px solid rgba(148, 163, 184, 0.35)", borderRadius: 12, padding: 14, background: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ color: statusTone(run.outcome) }}>{run.outcome}</strong>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
      </div>
      <div style={{ marginTop: 6 }}>{run.reason}</div>
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
        Baseline {formatScore(run.baselineScore)} | Candidate {formatScore(run.candidateScore)} | Approval {run.approvalStatus}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
        Diff {run.artifacts.stats.files} files, +{run.artifacts.stats.additions}, -{run.artifacts.stats.deletions}
      </div>
      {run.pullRequest?.branchName ? (
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
          Branch {run.pullRequest.branchName} {run.pullRequest.pullRequestUrl ? `| PR ${run.pullRequest.pullRequestUrl}` : ""}
        </div>
      ) : null}
      {run.artifacts.unauthorizedChangedFiles.length > 0 ? (
        <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 13 }}>
          Unauthorized changes: {run.artifacts.unauthorizedChangedFiles.join(", ")}
        </div>
      ) : null}
      {run.patchConflict?.hasConflicts ? (
        <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 13 }}>
          Patch conflict: {run.patchConflict.conflictingFiles.length > 0
            ? run.patchConflict.conflictingFiles.join(", ")
            : "detected"}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        {run.approvalStatus === "pending" ? (
          <>
            <button type="button" style={primaryButtonStyle} onClick={() => void onApprove(run.runId)}>
              Approve
            </button>
            <button type="button" style={buttonStyle} onClick={() => void onReject(run.runId)}>
              Reject
            </button>
          </>
        ) : null}
        <button type="button" style={buttonStyle} onClick={() => void onCreateIssue(run.runId)}>
          Create issue
        </button>
        {run.applied ? (
          <button type="button" style={buttonStyle} onClick={() => void onCreatePullRequest(run.runId)}>
            Create PR
          </button>
        ) : null}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary>Artifacts and command output</summary>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13 }}>Scoring repeats: {repeatSummary || "none"}</div>
          <div style={{ fontSize: 13 }}>
            Changed files: {run.artifacts.changedFiles.length > 0 ? run.artifacts.changedFiles.join(", ") : "none"}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
{`Patch:
${run.artifacts.patch || "(no patch)"}

Mutation (${run.mutation.exitCode ?? "null"}):
${run.mutation.stdout || run.mutation.stderr || "(no output)"}

Score (${run.scoring.exitCode ?? "null"}):
${run.scoring.stdout || run.scoring.stderr || "(no output)"}

Guardrail (${run.guardrail?.exitCode ?? "n/a"}):
${run.guardrail ? (run.guardrail.stdout || run.guardrail.stderr || "(no output)") : "(not configured)"}`}
          </pre>
        </div>
      </details>
    </div>
  );
}

function ComparisonPanel({ label, run }: { label: string; run: OptimizerRunRecord | null }) {
  return (
    <div style={{ border: "1px solid rgba(148, 163, 184, 0.28)", borderRadius: 12, padding: 14, background: "white" }}>
      <strong>{label}</strong>
      {!run ? (
        <div style={{ marginTop: 8, opacity: 0.72 }}>No run selected.</div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div>Outcome: {run.outcome}</div>
          <div>Score: {formatScore(run.candidateScore)}</div>
          <div>Approval: {run.approvalStatus}</div>
          <div>Files: {run.artifacts.changedFiles.join(", ") || "none"}</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
{JSON.stringify(run.scoringAggregate ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function OptimizerEditor({
  companyId,
  initialProjectId
}: {
  companyId: string | null;
  initialProjectId?: string | null;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? "");
  const [selectedOptimizerId, setSelectedOptimizerId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedCompareRunId, setSelectedCompareRunId] = useState("");
  const [form, setForm] = useState<FormState>(() => emptyForm(""));
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const saveOptimizer = usePluginAction(ACTION_KEYS.saveOptimizer);
  const deleteOptimizer = usePluginAction(ACTION_KEYS.deleteOptimizer);
  const runOptimizerCycle = usePluginAction(ACTION_KEYS.runOptimizerCycle);
  const enqueueOptimizerRun = usePluginAction(ACTION_KEYS.enqueueOptimizerRun);
  const approveOptimizerRun = usePluginAction(ACTION_KEYS.approveOptimizerRun);
  const rejectOptimizerRun = usePluginAction(ACTION_KEYS.rejectOptimizerRun);
  const createIssueFromRun = usePluginAction(ACTION_KEYS.createIssueFromRun);
  const createPullRequestFromRun = usePluginAction(ACTION_KEYS.createPullRequestFromRun);

  const projectsQuery = usePluginData<ProjectInfo[]>(DATA_KEYS.projects, companyId ? { companyId } : {});
  const workspacesQuery = usePluginData<WorkspaceInfo[]>(
    DATA_KEYS.projectWorkspaces,
    companyId && selectedProjectId ? { companyId, projectId: selectedProjectId } : {}
  );
  const optimizersQuery = usePluginData<OptimizerDefinition[]>(
    DATA_KEYS.projectOptimizers,
    selectedProjectId ? { projectId: selectedProjectId } : {}
  );
  const runsQuery = usePluginData<OptimizerRunRecord[]>(
    DATA_KEYS.optimizerRuns,
    selectedOptimizerId ? { optimizerId: selectedOptimizerId, projectId: selectedProjectId } : {}
  );
  const templatesQuery = usePluginData<OptimizerTemplate[]>(DATA_KEYS.optimizerTemplates, {});

  useEffect(() => {
    if (!selectedProjectId && initialProjectId) {
      setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId, selectedProjectId]);

  useEffect(() => {
    const firstWorkspace = workspacesQuery.data?.[0]?.id ?? "";
    if (!form.workspaceId && firstWorkspace) {
      setForm((prev) => ({ ...prev, workspaceId: firstWorkspace }));
    }
  }, [form.workspaceId, workspacesQuery.data]);

  const selectedOptimizer = useMemo(
    () => optimizersQuery.data?.find((entry) => entry.optimizerId === selectedOptimizerId) ?? null,
    [optimizersQuery.data, selectedOptimizerId]
  );
  const compareRun = useMemo(
    () => (runsQuery.data ?? []).find((entry) => entry.runId === selectedCompareRunId) ?? null,
    [runsQuery.data, selectedCompareRunId]
  );
  const bestRun = useMemo(
    () => (runsQuery.data ?? []).find((entry) => entry.runId === selectedOptimizer?.bestRunId) ?? null,
    [runsQuery.data, selectedOptimizer?.bestRunId]
  );

  useEffect(() => {
    if (selectedOptimizer) {
      setForm(formFromOptimizer(selectedOptimizer));
      setSelectedCompareRunId(selectedOptimizer.lastRunId ?? "");
    }
  }, [selectedOptimizer]);

  async function refreshAll() {
    await Promise.all([
      projectsQuery.refresh(),
      workspacesQuery.refresh(),
      optimizersQuery.refresh(),
      runsQuery.refresh(),
      templatesQuery.refresh()
    ]);
  }

  function resetForm() {
    setSelectedOptimizerId("");
    setSelectedTemplate("");
    setSelectedCompareRunId("");
    setForm(emptyForm(workspacesQuery.data?.[0]?.id ?? ""));
  }

  async function handleSave() {
    if (!companyId || !selectedProjectId) {
      setErrorMessage("Select a company and project first.");
      return;
    }
    setErrorMessage("");
    setMessage("");
    try {
      const result = await saveOptimizer({
        companyId,
        projectId: selectedProjectId,
        ...toActionPayload(form)
      }) as OptimizerDefinition;
      setSelectedOptimizerId(result.optimizerId);
      setMessage("Optimizer saved.");
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRun(mode: "run" | "queue") {
    if (!selectedOptimizerId || !selectedProjectId) {
      setErrorMessage("Save the optimizer before running it.");
      return;
    }
    setErrorMessage("");
    setMessage("");
    try {
      if (mode === "queue") {
        await enqueueOptimizerRun({ projectId: selectedProjectId, optimizerId: selectedOptimizerId });
        setMessage("Optimizer queued.");
      } else {
        const result = await runOptimizerCycle({
          projectId: selectedProjectId,
          optimizerId: selectedOptimizerId
        }) as RunCycleResult;
        setMessage(`${result.run.outcome}: ${result.run.reason}`);
      }
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete() {
    if (!selectedOptimizerId || !selectedProjectId) return;
    setErrorMessage("");
    setMessage("");
    try {
      await deleteOptimizer({ projectId: selectedProjectId, optimizerId: selectedOptimizerId });
      resetForm();
      setMessage("Optimizer deleted.");
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleApprove(runId: string) {
    if (!selectedProjectId || !selectedOptimizerId) return;
    setErrorMessage("");
    setMessage("");
    try {
      await approveOptimizerRun({ projectId: selectedProjectId, optimizerId: selectedOptimizerId, runId });
      setMessage("Run approved and promoted.");
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleReject(runId: string) {
    if (!selectedProjectId || !selectedOptimizerId) return;
    setErrorMessage("");
    setMessage("");
    try {
      await rejectOptimizerRun({ projectId: selectedProjectId, optimizerId: selectedOptimizerId, runId });
      setMessage("Pending run rejected.");
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateIssue(runId?: string) {
    if (!selectedProjectId || !selectedOptimizerId) return;
    setErrorMessage("");
    setMessage("");
    try {
      const issue = await createIssueFromRun({
        projectId: selectedProjectId,
        optimizerId: selectedOptimizerId,
        runId
      }) as { title: string };
      setMessage(`Created issue "${issue.title}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreatePullRequest(runId?: string) {
    if (!selectedProjectId || !selectedOptimizerId) return;
    setErrorMessage("");
    setMessage("");
    try {
      const result = await createPullRequestFromRun({
        projectId: selectedProjectId,
        optimizerId: selectedOptimizerId,
        runId
      }) as { branchName?: string; pullRequestUrl?: string; commitSha?: string };
      setMessage(
        result.pullRequestUrl
          ? `Created branch ${result.branchName} and PR ${result.pullRequestUrl}.`
          : `Created branch ${result.branchName} at ${result.commitSha}.`
      );
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const pendingRuns = (runsQuery.data ?? []).filter((run) => run.approvalStatus === "pending").length;

  return (
    <div style={pageStyle}>
      <section style={cardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12 }}>
          <div>
            <strong>Project</strong>
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                resetForm();
              }}
            >
              <option value="">Select a project</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name ?? project.title ?? project.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <strong>Existing optimizer</strong>
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={selectedOptimizerId}
              onChange={(event) => setSelectedOptimizerId(event.target.value)}
            >
              <option value="">New optimizer</option>
              {(optimizersQuery.data ?? []).map((optimizer) => (
                <option key={optimizer.optimizerId} value={optimizer.optimizerId}>
                  {optimizer.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <strong>Template</strong>
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={selectedTemplate}
              onChange={(event) => {
                const key = event.target.value;
                setSelectedTemplate(key);
                const template = (templatesQuery.data ?? []).find((entry) => entry.key === key);
                if (template) {
                  setForm((current) => applyTemplate(template, current, workspacesQuery.data?.[0]?.id ?? ""));
                }
              }}
            >
              <option value="">Start from template</option>
              {(templatesQuery.data ?? []).map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {selectedOptimizer ? (
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.82 }}>
            Queue {selectedOptimizer.queueState} | Best {formatScore(selectedOptimizer.bestScore)} | Accepted {selectedOptimizer.acceptedRuns} | Pending {selectedOptimizer.pendingApprovalRuns}
          </div>
        ) : null}
      </section>

      <section style={cardStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <strong>Name</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div>
              <strong>Workspace</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.workspaceId} onChange={(event) => setForm((prev) => ({ ...prev, workspaceId: event.target.value }))}>
                <option value="">Primary workspace</option>
                {(workspacesQuery.data ?? []).map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} {workspace.isPrimary ? "(Primary)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <strong>Objective</strong>
            <textarea style={{ ...inputStyle, minHeight: 90, marginTop: 6 }} value={form.objective} onChange={(event) => setForm((prev) => ({ ...prev, objective: event.target.value }))} />
          </div>

          <div>
            <strong>Mutable paths</strong>
            <textarea style={{ ...inputStyle, minHeight: 86, marginTop: 6 }} value={form.mutablePaths} onChange={(event) => setForm((prev) => ({ ...prev, mutablePaths: event.target.value }))} />
          </div>

          <div>
            <strong>Mutation command</strong>
            <textarea style={{ ...inputStyle, minHeight: 94, marginTop: 6 }} value={form.mutationCommand} onChange={(event) => setForm((prev) => ({ ...prev, mutationCommand: event.target.value }))} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <strong>Score command</strong>
              <textarea style={{ ...inputStyle, minHeight: 94, marginTop: 6 }} value={form.scoreCommand} onChange={(event) => setForm((prev) => ({ ...prev, scoreCommand: event.target.value }))} />
            </div>
            <div>
              <strong>Guardrail command</strong>
              <textarea style={{ ...inputStyle, minHeight: 94, marginTop: 6 }} value={form.guardrailCommand} onChange={(event) => setForm((prev) => ({ ...prev, guardrailCommand: event.target.value }))} placeholder="Optional. Exit 0 or return guardrails=true." />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <strong>Direction</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.scoreDirection} onChange={(event) => setForm((prev) => ({ ...prev, scoreDirection: event.target.value as "maximize" | "minimize" }))}>
                <option value="maximize">Maximize</option>
                <option value="minimize">Minimize</option>
              </select>
            </div>
            <div>
              <strong>Score format</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.scoreFormat} onChange={(event) => setForm((prev) => ({ ...prev, scoreFormat: event.target.value as "number" | "json" }))}>
                <option value="json">JSON</option>
                <option value="number">Number</option>
              </select>
            </div>
            <div>
              <strong>Score key</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.scoreKey} onChange={(event) => setForm((prev) => ({ ...prev, scoreKey: event.target.value }))} placeholder="primary" />
            </div>
            <div>
              <strong>Score pattern</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.scorePattern} onChange={(event) => setForm((prev) => ({ ...prev, scorePattern: event.target.value }))} placeholder="Optional regex for number mode" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <strong>Guardrail format</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.guardrailFormat} onChange={(event) => setForm((prev) => ({ ...prev, guardrailFormat: event.target.value as "number" | "json" }))}>
                <option value="json">JSON</option>
                <option value="number">Number</option>
              </select>
            </div>
            <div>
              <strong>Guardrail key</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.guardrailKey} onChange={(event) => setForm((prev) => ({ ...prev, guardrailKey: event.target.value }))} placeholder="guardrails" />
            </div>
            <div>
              <strong>Guardrail repeats</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.guardrailRepeats} onChange={(event) => setForm((prev) => ({ ...prev, guardrailRepeats: event.target.value }))} placeholder="1" />
            </div>
            <div>
              <strong>Guardrail aggregator</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.guardrailAggregator} onChange={(event) => setForm((prev) => ({ ...prev, guardrailAggregator: event.target.value as "all" | "any" }))}>
                <option value="all">All must pass</option>
                <option value="any">Any can pass</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <strong>Score repeats</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.scoreRepeats} onChange={(event) => setForm((prev) => ({ ...prev, scoreRepeats: event.target.value }))} />
            </div>
            <div>
              <strong>Aggregator</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.scoreAggregator} onChange={(event) => setForm((prev) => ({ ...prev, scoreAggregator: event.target.value as FormState["scoreAggregator"] }))}>
                <option value="median">Median</option>
                <option value="mean">Mean</option>
                <option value="max">Max</option>
                <option value="min">Min</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <strong>Minimum improvement</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.minimumImprovement} onChange={(event) => setForm((prev) => ({ ...prev, minimumImprovement: event.target.value }))} />
            </div>
            <div>
              <strong>Mutation budget</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.mutationBudgetSeconds} onChange={(event) => setForm((prev) => ({ ...prev, mutationBudgetSeconds: event.target.value }))} />
            </div>
            <div>
              <strong>Score budget</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.scoreBudgetSeconds} onChange={(event) => setForm((prev) => ({ ...prev, scoreBudgetSeconds: event.target.value }))} />
            </div>
            <div>
              <strong>Guardrail budget</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.guardrailBudgetSeconds} onChange={(event) => setForm((prev) => ({ ...prev, guardrailBudgetSeconds: event.target.value }))} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <strong>Apply mode</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.applyMode} onChange={(event) => setForm((prev) => ({ ...prev, applyMode: event.target.value as ApplyMode, requireHumanApproval: event.target.value === "manual_approval" ? true : prev.requireHumanApproval }))}>
                <option value="manual_approval">Manual approval</option>
                <option value="automatic">Automatic apply</option>
                <option value="dry_run">Dry run</option>
              </select>
            </div>
            <div>
              <strong>Stagnation threshold</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.stagnationIssueThreshold} onChange={(event) => setForm((prev) => ({ ...prev, stagnationIssueThreshold: event.target.value }))} />
            </div>
            <div>
              <strong>Status</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as "active" | "paused" }))}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div>
              <strong>Sandbox strategy</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.sandboxStrategy} onChange={(event) => setForm((prev) => ({ ...prev, sandboxStrategy: event.target.value as "copy" | "git_worktree" }))}>
                <option value="git_worktree">Git worktree</option>
                <option value="copy">Workspace copy</option>
              </select>
            </div>
            <div>
              <strong>Scorer isolation</strong>
              <select style={{ ...inputStyle, marginTop: 6 }} value={form.scorerIsolationMode} onChange={(event) => setForm((prev) => ({ ...prev, scorerIsolationMode: event.target.value as "same_workspace" | "separate_workspace" }))}>
                <option value="separate_workspace">Separate scorer workspace</option>
                <option value="same_workspace">Same mutation workspace</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <strong>Proposal branch prefix</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.proposalBranchPrefix} onChange={(event) => setForm((prev) => ({ ...prev, proposalBranchPrefix: event.target.value }))} placeholder="paprclip/autoresearch/my-optimizer" />
            </div>
            <div>
              <strong>Proposal commit message</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.proposalCommitMessage} onChange={(event) => setForm((prev) => ({ ...prev, proposalCommitMessage: event.target.value }))} placeholder="Autoresearch candidate: ..." />
            </div>
            <div>
              <strong>PR command</strong>
              <input style={{ ...inputStyle, marginTop: 6 }} value={form.proposalPrCommand} onChange={(event) => setForm((prev) => ({ ...prev, proposalPrCommand: event.target.value }))} placeholder="gh pr create --fill --head $PAPERCLIP_PROPOSAL_BRANCH" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label><input type="checkbox" checked={form.hiddenScoring} onChange={(event) => setForm((prev) => ({ ...prev, hiddenScoring: event.target.checked }))} /> Hide score command from mutator</label>
            <label><input type="checkbox" checked={form.autoRun} onChange={(event) => setForm((prev) => ({ ...prev, autoRun: event.target.checked }))} /> Auto-run in sweep</label>
            <label><input type="checkbox" checked={form.requireHumanApproval} onChange={(event) => setForm((prev) => ({ ...prev, requireHumanApproval: event.target.checked, applyMode: event.target.checked ? "manual_approval" : prev.applyMode === "manual_approval" ? "automatic" : prev.applyMode }))} /> Require human approval</label>
            <label><input type="checkbox" checked={form.autoCreateIssueOnGuardrailFailure} onChange={(event) => setForm((prev) => ({ ...prev, autoCreateIssueOnGuardrailFailure: event.target.checked }))} /> Issue on guardrail failure</label>
            <label><input type="checkbox" checked={form.autoCreateIssueOnStagnation} onChange={(event) => setForm((prev) => ({ ...prev, autoCreateIssueOnStagnation: event.target.checked }))} /> Issue on stagnation</label>
          </div>

          <div>
            <strong>Notes</strong>
            <textarea style={{ ...inputStyle, minHeight: 80, marginTop: 6 }} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={primaryButtonStyle} onClick={() => void handleSave()}>Save optimizer</button>
            <button type="button" style={buttonStyle} onClick={() => void handleRun("run")}>Run now</button>
            <button type="button" style={buttonStyle} onClick={() => void handleRun("queue")}>Queue run</button>
            <button type="button" style={buttonStyle} onClick={() => void handleCreateIssue()}>Create issue from latest run</button>
            <button type="button" style={buttonStyle} onClick={() => void handleCreatePullRequest()}>Create PR from latest accepted run</button>
            <button type="button" style={buttonStyle} onClick={resetForm}>Reset</button>
            <button type="button" style={buttonStyle} onClick={() => void handleDelete()}>Delete</button>
          </div>

          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Pending approvals: {pendingRuns}. JSON scoring should print a stable object such as <code>{`{"primary":0.91,"metrics":{"quality":0.95},"guardrails":{"safe":true}}`}</code>.
          </div>
          {message ? <div style={{ color: "#166534" }}>{message}</div> : null}
          {errorMessage ? <div style={{ color: "#b91c1c" }}>{errorMessage}</div> : null}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Run comparison</strong>
          <select style={{ ...inputStyle, maxWidth: 340 }} value={selectedCompareRunId} onChange={(event) => setSelectedCompareRunId(event.target.value)}>
            <option value="">Select run to compare</option>
            {(runsQuery.data ?? []).map((run) => (
              <option key={run.runId} value={run.runId}>
                {new Date(run.startedAt).toLocaleString()} · {run.outcome} · {formatScore(run.candidateScore)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ComparisonPanel label="Incumbent / best run" run={bestRun} />
          <ComparisonPanel label="Selected candidate" run={compareRun} />
        </div>
      </section>

      <section style={cardStyle}>
        <strong>Recent runs</strong>
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {(runsQuery.data ?? []).length === 0 ? (
            <div style={{ opacity: 0.75 }}>No runs yet.</div>
          ) : (
            (runsQuery.data ?? []).map((run) => (
              <RunCard
                key={run.runId}
                run={run}
                onApprove={handleApprove}
                onReject={handleReject}
                onCreateIssue={handleCreateIssue}
                onCreatePullRequest={handleCreatePullRequest}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export function OptimizerDashboardWidget({ context }: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<OverviewData>(DATA_KEYS.overview, {
    companyId: context.companyId
  });

  if (loading) return <div>Loading optimizer overview...</div>;
  if (error) return <div>Optimizer overview failed: {error.message}</div>;

  return (
    <section style={cardStyle}>
      <strong>Autoresearch Improver</strong>
      <div style={{ marginTop: 8 }}>Optimizers: {data?.counts.optimizers ?? 0}</div>
      <div>Active: {data?.counts.activeOptimizers ?? 0}</div>
      <div>Accepted runs: {data?.counts.acceptedRuns ?? 0}</div>
      <div>Pending approval: {data?.counts.pendingApprovalRuns ?? 0}</div>
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.82 }}>
        {data?.latestAcceptedRun
          ? `Latest accepted score: ${formatScore(data.latestAcceptedRun.candidateScore)}`
          : "No accepted runs yet."}
      </div>
    </section>
  );
}

export function OptimizerPage({ context }: PluginPageProps) {
  return (
    <div style={pageStyle}>
      <section style={cardStyle}>
        <strong>Darwin-Derby loop for Paperclip workspaces</strong>
        <p style={{ marginTop: 8, lineHeight: 1.55 }}>
          Define a mutable surface, keep the evaluator fixed, score each candidate under a bounded budget, and ratchet only accepted improvements.
          This version supports repeated scoring, structured JSON metrics, diff artifacts, queued runs, and manual approval before workspace write-back.
        </p>
      </section>
      <OptimizerEditor companyId={context.companyId ?? null} />
    </div>
  );
}

export function ProjectOptimizerTab({ context }: PluginDetailTabProps) {
  return <OptimizerEditor companyId={context.companyId ?? null} initialProjectId={context.entityId} />;
}

export function ProjectOptimizerSidebarLink({ context }: PluginProjectSidebarItemProps) {
  const prefix = context.companyPrefix ? `/${context.companyPrefix}` : "";
  return (
    <a href={`${prefix}/projects/${context.entityId}?tab=plugin:${PLUGIN_ID}:optimizer-project-tab`}>
      Optimizer
    </a>
  );
}
