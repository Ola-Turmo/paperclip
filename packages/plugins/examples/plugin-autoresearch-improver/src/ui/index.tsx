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
import type { OptimizerDefinition, OptimizerRunRecord, OverviewData } from "../types.js";

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
  mutationBudgetSeconds: string;
  scoreBudgetSeconds: string;
  guardrailBudgetSeconds: string;
  hiddenScoring: boolean;
  autoRun: boolean;
  status: "active" | "paused";
  notes: string;
};

const shellExample = `codex exec "Read $PAPERCLIP_OPTIMIZER_BRIEF and improve the selected files only."`;
const scoreExample = `pnpm test -- --runInBand && node -e "console.log('SCORE=1')"`;

const cardStyle: CSSProperties = {
  border: "1px solid rgba(100, 116, 139, 0.3)",
  borderRadius: 12,
  padding: 16,
  background: "rgba(15, 23, 42, 0.02)"
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
    mutationBudgetSeconds: "300",
    scoreBudgetSeconds: "180",
    guardrailBudgetSeconds: "",
    hiddenScoring: true,
    autoRun: false,
    status: "active",
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
    mutationBudgetSeconds: String(optimizer.mutationBudgetSeconds),
    scoreBudgetSeconds: String(optimizer.scoreBudgetSeconds),
    guardrailBudgetSeconds: optimizer.guardrailBudgetSeconds ? String(optimizer.guardrailBudgetSeconds) : "",
    hiddenScoring: optimizer.hiddenScoring,
    autoRun: optimizer.autoRun,
    status: optimizer.status,
    notes: optimizer.notes ?? ""
  };
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
  const [form, setForm] = useState<FormState>(() => emptyForm(""));
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const saveOptimizer = usePluginAction(ACTION_KEYS.saveOptimizer);
  const deleteOptimizer = usePluginAction(ACTION_KEYS.deleteOptimizer);
  const runOptimizerCycle = usePluginAction(ACTION_KEYS.runOptimizerCycle);
  const createIssueFromRun = usePluginAction(ACTION_KEYS.createIssueFromRun);

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
    selectedOptimizerId ? { optimizerId: selectedOptimizerId } : {}
  );

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

  useEffect(() => {
    if (selectedOptimizer) {
      setForm(formFromOptimizer(selectedOptimizer));
    }
  }, [selectedOptimizer]);

  async function refreshAll() {
    await Promise.all([optimizersQuery.refresh(), runsQuery.refresh(), workspacesQuery.refresh()]);
  }

  function resetForm() {
    setSelectedOptimizerId("");
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
        optimizerId: form.optimizerId,
        companyId,
        projectId: selectedProjectId,
        workspaceId: form.workspaceId || undefined,
        name: form.name,
        objective: form.objective,
        mutablePaths: form.mutablePaths,
        mutationCommand: form.mutationCommand,
        scoreCommand: form.scoreCommand,
        guardrailCommand: form.guardrailCommand || undefined,
        scoreDirection: form.scoreDirection,
        scorePattern: form.scorePattern || undefined,
        mutationBudgetSeconds: Number(form.mutationBudgetSeconds || 0),
        scoreBudgetSeconds: Number(form.scoreBudgetSeconds || 0),
        guardrailBudgetSeconds: form.guardrailBudgetSeconds ? Number(form.guardrailBudgetSeconds) : undefined,
        hiddenScoring: form.hiddenScoring,
        autoRun: form.autoRun,
        status: form.status,
        notes: form.notes || undefined
      });
      setSelectedOptimizerId((result as OptimizerDefinition).optimizerId);
      setMessage("Optimizer saved.");
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

  async function handleRun() {
    if (!selectedOptimizerId || !selectedProjectId) {
      setErrorMessage("Save the optimizer before running it.");
      return;
    }
    setErrorMessage("");
    setMessage("");
    try {
      const result = await runOptimizerCycle({
        projectId: selectedProjectId,
        optimizerId: selectedOptimizerId
      }) as RunCycleResult;
      setMessage(
        result.run.accepted
          ? `Accepted improvement with score ${result.run.candidateScore ?? "n/a"}.`
          : `Rejected candidate. ${result.run.reason}`
      );
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateIssue() {
    if (!selectedOptimizerId || !selectedProjectId) return;
    setErrorMessage("");
    setMessage("");
    try {
      const issue = await createIssueFromRun({
        projectId: selectedProjectId,
        optimizerId: selectedOptimizerId
      }) as { title: string };
      setMessage(`Created issue "${issue.title}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={cardStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <strong>Project</strong>
            <div style={{ marginTop: 6 }}>
              <select
                style={inputStyle}
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setSelectedOptimizerId("");
                  setForm(emptyForm(""));
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
          </div>

          <div>
            <strong>Existing optimizer</strong>
            <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
              <select
                style={{ ...inputStyle, flex: 1 }}
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
              <button type="button" style={buttonStyle} onClick={resetForm}>
                Reset
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <strong>Name</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Paperclip onboarding conversion"
            />
          </div>

          <div>
            <strong>Objective</strong>
            <textarea
              style={{ ...inputStyle, minHeight: 86, marginTop: 6 }}
              value={form.objective}
              onChange={(event) => setForm((prev) => ({ ...prev, objective: event.target.value }))}
              placeholder="Improve the onboarding funnel without breaking auth or page speed."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <strong>Workspace</strong>
              <select
                style={{ ...inputStyle, marginTop: 6 }}
                value={form.workspaceId}
                onChange={(event) => setForm((prev) => ({ ...prev, workspaceId: event.target.value }))}
              >
                <option value="">Primary workspace</option>
                {(workspacesQuery.data ?? []).map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} {workspace.isPrimary ? "(Primary)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <strong>Mutable paths</strong>
              <textarea
                style={{ ...inputStyle, minHeight: 86, marginTop: 6 }}
                value={form.mutablePaths}
                onChange={(event) => setForm((prev) => ({ ...prev, mutablePaths: event.target.value }))}
                placeholder=".\nsrc/\nREADME.md"
              />
            </div>
          </div>

          <div>
            <strong>Mutation command</strong>
            <textarea
              style={{ ...inputStyle, minHeight: 88, marginTop: 6 }}
              value={form.mutationCommand}
              onChange={(event) => setForm((prev) => ({ ...prev, mutationCommand: event.target.value }))}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              This runs in a copied workspace sandbox. It receives the objective and mutable paths through environment variables and a brief file.
            </div>
          </div>

          <div>
            <strong>Score command</strong>
            <textarea
              style={{ ...inputStyle, minHeight: 74, marginTop: 6 }}
              value={form.scoreCommand}
              onChange={(event) => setForm((prev) => ({ ...prev, scoreCommand: event.target.value }))}
            />
          </div>

          <div>
            <strong>Guardrail command</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={form.guardrailCommand}
              onChange={(event) => setForm((prev) => ({ ...prev, guardrailCommand: event.target.value }))}
              placeholder="Optional. Exit 0 to allow acceptance."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <strong>Direction</strong>
              <select
                style={{ ...inputStyle, marginTop: 6 }}
                value={form.scoreDirection}
                onChange={(event) => setForm((prev) => ({ ...prev, scoreDirection: event.target.value as "maximize" | "minimize" }))}
              >
                <option value="maximize">Maximize</option>
                <option value="minimize">Minimize</option>
              </select>
            </div>

            <div>
              <strong>Mutation budget</strong>
              <input
                style={{ ...inputStyle, marginTop: 6 }}
                value={form.mutationBudgetSeconds}
                onChange={(event) => setForm((prev) => ({ ...prev, mutationBudgetSeconds: event.target.value }))}
              />
            </div>

            <div>
              <strong>Score budget</strong>
              <input
                style={{ ...inputStyle, marginTop: 6 }}
                value={form.scoreBudgetSeconds}
                onChange={(event) => setForm((prev) => ({ ...prev, scoreBudgetSeconds: event.target.value }))}
              />
            </div>

            <div>
              <strong>Guardrail budget</strong>
              <input
                style={{ ...inputStyle, marginTop: 6 }}
                value={form.guardrailBudgetSeconds}
                onChange={(event) => setForm((prev) => ({ ...prev, guardrailBudgetSeconds: event.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <strong>Score pattern</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={form.scorePattern}
              onChange={(event) => setForm((prev) => ({ ...prev, scorePattern: event.target.value }))}
              placeholder="Optional regex. First capture group becomes the score."
            />
          </div>

          <div>
            <strong>Notes</strong>
            <textarea
              style={{ ...inputStyle, minHeight: 70, marginTop: 6 }}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Guardrails, operator notes, or how the score should be interpreted."
            />
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.hiddenScoring}
                onChange={(event) => setForm((prev) => ({ ...prev, hiddenScoring: event.target.checked }))}
              />
              Hide score command from mutator
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.autoRun}
                onChange={(event) => setForm((prev) => ({ ...prev, autoRun: event.target.checked }))}
              />
              Auto-run in hourly sweep
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.status === "paused"}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.checked ? "paused" : "active" }))}
              />
              Paused
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={primaryButtonStyle} onClick={() => void handleSave()}>
              Save optimizer
            </button>
            <button type="button" style={buttonStyle} onClick={() => void handleRun()}>
              Run cycle
            </button>
            <button type="button" style={buttonStyle} onClick={() => void handleCreateIssue()}>
              Create issue from latest accepted run
            </button>
            <button type="button" style={buttonStyle} onClick={() => void handleDelete()}>
              Delete
            </button>
          </div>

          {message ? <div style={{ color: "#166534" }}>{message}</div> : null}
          {errorMessage ? <div style={{ color: "#b91c1c" }}>{errorMessage}</div> : null}
        </div>
      </section>

      <section style={cardStyle}>
        <strong>Recent runs</strong>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {(runsQuery.data ?? []).length === 0 ? (
            <div style={{ opacity: 0.75 }}>No runs yet.</div>
          ) : (
            (runsQuery.data ?? []).map((run) => (
              <div key={run.runId} style={{ border: "1px solid rgba(148, 163, 184, 0.35)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>{run.accepted ? "Accepted" : "Rejected"}</strong>
                  <span>{new Date(run.startedAt).toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 6 }}>{run.reason}</div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  Baseline: {String(run.baselineScore ?? "n/a")} | Candidate: {String(run.candidateScore ?? "n/a")}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary>Mutation and score output</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 8 }}>
{`Mutation (${run.mutation.exitCode ?? "null"}):
${run.mutation.stdout || run.mutation.stderr || "(no output)"}

Score (${run.scoring.exitCode ?? "null"}):
${run.scoring.stdout || run.scoring.stderr || "(no output)"}`}
                  </pre>
                </details>
              </div>
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
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
        {data?.latestAcceptedRun
          ? `Latest accepted score: ${data.latestAcceptedRun.candidateScore ?? "n/a"}`
          : "No accepted runs yet."}
      </div>
    </section>
  );
}

export function OptimizerPage({ context }: PluginPageProps) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={cardStyle}>
        <strong>Darwin-Derby loop for Paperclip workspaces</strong>
        <p style={{ marginTop: 8, lineHeight: 1.5 }}>
          Define a mutable surface, keep the evaluator fixed, run each candidate under a fixed budget, and ratchet only strict improvements.
          The mutation command runs in a copied workspace. The real workspace only changes when the score improves and the guardrail command passes.
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
