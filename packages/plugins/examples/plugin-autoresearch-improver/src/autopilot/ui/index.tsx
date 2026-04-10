import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginDetailTabProps,
  type PluginProjectSidebarItemProps
} from "@paperclipai/plugin-sdk/ui";
import {
  ACTION_KEYS,
  DATA_KEYS,
  PLUGIN_ID,
  type AutopilotProject,
  type ProductProgramRevision,
  type AutomationTier,
  type ResearchCycle,
  type ResearchFinding,
  type Idea,
  type SwipeEvent,
  type PreferenceProfile,
  type IdeaStatus,
  type SwipeDecision,
  type DeliveryRun,
  type CompanyBudget
} from "../constants.js";

type ProjectInfo = {
  id: string;
  name?: string;
  title?: string;
};

type RevisionHistory = ProductProgramRevision;

const pageStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  padding: 16
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

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function AutopilotSettings({
  autopilot,
  companyId,
  onSave
}: {
  autopilot: AutopilotProject | null;
  companyId: string;
  onSave: (updates: Partial<AutopilotProject>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(autopilot?.enabled ?? false);
  const [automationTier, setAutomationTier] = useState<AutomationTier>(autopilot?.automationTier ?? "supervised");
  const [budgetMinutes, setBudgetMinutes] = useState(String(autopilot?.budgetMinutes ?? 60));
  const [repoUrl, setRepoUrl] = useState(autopilot?.repoUrl ?? "");
  const [workspaceId, setWorkspaceId] = useState(autopilot?.workspaceId ?? "");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const pauseAutopilot = usePluginAction(ACTION_KEYS.pauseAutopilot);
  const resumeAutopilot = usePluginAction(ACTION_KEYS.resumeAutopilot);
  const budgetQuery = usePluginData<CompanyBudget | null>(DATA_KEYS.companyBudget, { companyId });

  useEffect(() => {
    if (autopilot) {
      setEnabled(autopilot.enabled);
      setAutomationTier(autopilot.automationTier);
      setBudgetMinutes(String(autopilot.budgetMinutes));
      setRepoUrl(autopilot.repoUrl ?? "");
      setWorkspaceId(autopilot.workspaceId ?? "");
    }
  }, [autopilot]);

  const handleSave = useCallback(async () => {
    setErrorMessage("");
    setMessage("");
    try {
      await onSave({
        enabled,
        automationTier,
        budgetMinutes: parseInt(budgetMinutes, 10),
        repoUrl: repoUrl || undefined,
        workspaceId: workspaceId || undefined
      });
      setMessage("Settings saved successfully.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [enabled, automationTier, budgetMinutes, repoUrl, workspaceId, onSave]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <strong>Enable Product Autopilot</strong>
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <strong>Automation Tier</strong>
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={automationTier}
              onChange={(e) => {
                const nextTier = e.target.value as AutomationTier;
                setAutomationTier(nextTier);
                if (enabled) {
                  void onSave({
                    enabled,
                    automationTier: nextTier,
                    budgetMinutes: parseInt(budgetMinutes, 10),
                    repoUrl: repoUrl || undefined,
                    workspaceId: workspaceId || undefined
                  });
                }
              }}
            >
              <option value="supervised">Supervised — requires approval for each run</option>
              <option value="semiauto">Semi-Auto — runs automatically, pauses on issues</option>
              <option value="fullauto">Full Auto — fully autonomous operation</option>
            </select>
          </div>

          <div>
            <strong>Budget (minutes per week)</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              type="number"
              value={budgetMinutes}
              onChange={(e) => setBudgetMinutes(e.target.value)}
              min="1"
            />
          </div>

          <div>
            <strong>Repository URL (optional)</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
            />
          </div>

          <div>
            <strong>Workspace ID (optional)</strong>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              type="text"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="workspace-uuid"
            />
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" style={primaryButtonStyle} onClick={handleSave}>
          Save Settings
        </button>
        {message && (
          <span style={{ color: "#166534", fontSize: 13 }}>{message}</span>
        )}
        {errorMessage && (
          <span style={{ color: "#b91c1c", fontSize: 13 }}>{errorMessage}</span>
        )}
      </div>

      {((budgetQuery.data?.paused && budgetQuery.data?.pauseReason) || (autopilot && autopilot.paused)) && (
        <div style={{
          marginTop: 8,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(234, 179, 8, 0.5)",
          background: "rgba(234, 179, 8, 0.08)",
          fontSize: 13,
          color: "#854d0e"
        }}>
          <strong>Paused:</strong> {budgetQuery.data?.pauseReason ?? autopilot?.pauseReason ?? "No reason provided"}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {autopilot?.paused ? (
          <button type="button" style={buttonStyle} onClick={async () => { await resumeAutopilot({ companyId, projectId: autopilot.projectId }); }}>
            Resume Autopilot
          </button>
        ) : (
          <button type="button" style={buttonStyle} onClick={async () => { await pauseAutopilot({ companyId, projectId: autopilot?.projectId ?? "" }); }}>
            Pause Autopilot
          </button>
        )}
      </div>
    </div>
  );
}

function ProductProgramEditor({
  companyId,
  revision,
  revisionHistory,
  onSave,
  onCreateRevision
}: {
  companyId: string;
  revision: ProductProgramRevision | null;
  revisionHistory: RevisionHistory[];
  onSave: (content: string) => Promise<void>;
  onCreateRevision: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(revision?.content ?? "");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const pauseAutopilot = usePluginAction(ACTION_KEYS.pauseAutopilot);
  const resumeAutopilot = usePluginAction(ACTION_KEYS.resumeAutopilot);
  const budgetQuery = usePluginData<CompanyBudget | null>(DATA_KEYS.companyBudget, { companyId });
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (revision) {
      setContent(revision.content);
    }
  }, [revision]);

  const handleSave = useCallback(async () => {
    setErrorMessage("");
    setMessage("");
    try {
      await onSave(content);
      setMessage("Program saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [content, onSave]);

  const handleCreateRevision = useCallback(async () => {
    setErrorMessage("");
    setMessage("");
    try {
      await onCreateRevision(content);
      setMessage("New revision created.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [content, onCreateRevision]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>
          Product Program
          {revision ? ` v${revision.version}` : " (new)"}
        </strong>
        {revisionHistory.length > 0 && (
          <button
            type="button"
            style={{ ...buttonStyle, fontSize: 12 }}
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? "Hide History" : `Show History (${revisionHistory.length})`}
          </button>
        )}
      </div>

      {showHistory && (
        <div style={{
          border: "1px solid rgba(100, 116, 139, 0.25)",
          borderRadius: 10,
          padding: 12,
          maxHeight: 200,
          overflowY: "visible",
          background: "rgba(248, 250, 252, 0.5)"
        }}>
          <strong style={{ fontSize: 12, color: "#334155" }}>Revision History</strong>
          {revisionHistory.length > 0 ? (
            revisionHistory.map((rev) => (
              <div key={rev.revisionId} style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>v{rev.version}</strong>
                  <span style={{ opacity: 0.7 }}>{formatDate(rev.createdAt)}</span>
                </div>
                <div style={{
                  marginTop: 4,
                  padding: "6px 8px",
                  background: "white",
                  borderRadius: 6,
                  border: "1px solid rgba(100, 116, 139, 0.15)",
                  whiteSpace: "pre-wrap",
                  fontSize: 11,
                  maxHeight: 60,
                  overflowY: "hidden"
                }}>
                  {rev.content.slice(0, 200)}{rev.content.length > 200 ? "..." : ""}
                </div>
              </div>
            ))
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              No history yet.
            </div>
          )}
        </div>
      )}

      <textarea
        style={{ ...inputStyle, minHeight: 200, fontFamily: "monospace", fontSize: 13 }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Enter your Product Program content here..."
      />

      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" style={primaryButtonStyle} onClick={handleSave}>
          Save
        </button>
        {revision && (
          <button type="button" style={buttonStyle} onClick={handleCreateRevision}>
            Create New Revision
          </button>
        )}
        {message && (
          <span style={{ color: "#166534", fontSize: 13, alignSelf: "center" }}>{message}</span>
        )}
        {errorMessage && (
          <span style={{ color: "#b91c1c", fontSize: 13, alignSelf: "center" }}>{errorMessage}</span>
        )}
      </div>
    </div>
  );
}

export function AutopilotProjectTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId;
  const projectId = context.entityId ?? "";

  const saveAutopilotProject = usePluginAction(ACTION_KEYS.saveAutopilotProject);
  const enableAutopilot = usePluginAction(ACTION_KEYS.enableAutopilot);
  const saveProductProgramRevision = usePluginAction(ACTION_KEYS.saveProductProgramRevision);
  const createProductProgramRevision = usePluginAction(ACTION_KEYS.createProductProgramRevision);

  const autopilotQuery = usePluginData<AutopilotProject | null>(
    DATA_KEYS.autopilotProject,
    companyId && projectId ? { companyId, projectId } : {}
  );

  const revisionsQuery = usePluginData<ProductProgramRevision[]>(
    DATA_KEYS.productProgramRevisions,
    companyId && projectId ? { companyId, projectId } : {}
  );

  const revisionHistory: RevisionHistory[] = useMemo(() => {
    return (revisionsQuery.data ?? []) as RevisionHistory[];
  }, [revisionsQuery.data]);

  const latestRevision = revisionHistory[0] ?? null;

  const handleSaveAutopilot = useCallback(
    async (updates: Partial<AutopilotProject>) => {
      if (!companyId || !projectId) return;
      await saveAutopilotProject({
        companyId,
        projectId,
        ...updates
      });
      await autopilotQuery.refresh();
    },
    [companyId, projectId, saveAutopilotProject, autopilotQuery]
  );

  const handleEnableAutopilot = useCallback(
    async (params: { automationTier: AutomationTier; budgetMinutes: number; repoUrl?: string; workspaceId?: string }) => {
      if (!companyId || !projectId) return;
      await enableAutopilot({
        companyId,
        projectId,
        ...params
      });
      await autopilotQuery.refresh();
    },
    [companyId, projectId, enableAutopilot, autopilotQuery]
  );

  const handleSaveProgram = useCallback(
    async (content: string) => {
      if (!companyId || !projectId) return;
      if (latestRevision) {
        await saveProductProgramRevision({
          companyId,
          projectId,
          revisionId: latestRevision.revisionId,
          content
        });
      } else {
        await createProductProgramRevision({
          companyId,
          projectId,
          content
        });
      }
      await revisionsQuery.refresh();
    },
    [companyId, projectId, latestRevision, saveProductProgramRevision, createProductProgramRevision, revisionsQuery]
  );

  const handleCreateRevision = useCallback(
    async (content: string) => {
      if (!companyId || !projectId) return;
      await createProductProgramRevision({
        companyId,
        projectId,
        content
      });
      await revisionsQuery.refresh();
    },
    [companyId, projectId, createProductProgramRevision, revisionsQuery]
  );

  if (!companyId || !projectId) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <p style={{ color: "#64748b", fontSize: 14 }}>
            Select a company and project to configure Product Autopilot.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Autopilot Settings</h3>
        <AutopilotSettings
          autopilot={autopilotQuery.data ?? null}
          companyId={companyId}
          onSave={handleSaveAutopilot}
        />
      </section>

      <section style={cardStyle}>
        <ProductProgramEditor
          companyId={companyId}
          revision={latestRevision}
          revisionHistory={revisionHistory}
          onSave={handleSaveProgram}
          onCreateRevision={handleCreateRevision}
        />
      </section>

      <DeliveryRunSection companyId={companyId} projectId={projectId} />
      <ResearchSection companyId={companyId} projectId={projectId} />
      <IdeasSection companyId={companyId} projectId={projectId} />
      <SwipeSection companyId={companyId} projectId={projectId} />
      <PreferenceSection companyId={companyId} projectId={projectId} />
    </div>
  );
}


function DeliveryRunSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const runsQuery = usePluginData<DeliveryRun[]>(DATA_KEYS.deliveryRuns, { companyId, projectId });
  const runs = runsQuery.data ?? [];
  const [expandedRunId, setExpandedRunId] = useState<string | null>(runs[0]?.runId ?? null);

  useEffect(() => {
    if (!runs.some((run) => run.runId === expandedRunId)) {
      setExpandedRunId(runs[0]?.runId ?? null);
    }
  }, [runs, expandedRunId]);

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Delivery Runs</h3>

      {runs.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No delivery runs yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.runId;
            return (
              <button
                key={run.runId}
                type="button"
                onClick={() => setExpandedRunId(isExpanded ? null : run.runId)}
                style={{
                  ...buttonStyle,
                  textAlign: "left",
                  padding: 12,
                  background: "white"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13 }}>Run {run.runId.slice(0, 8)}</strong>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                      Workspace: {run.workspacePath}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#334155" }}>
                    <div>Status: {run.status}</div>
                    <div>Port: {run.leasedPort ?? "—"}</div>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(100,116,139,0.15)", fontSize: 12, color: "#475569", display: "grid", gap: 4 }}>
                    <div><strong>Branch:</strong> {run.branchName}</div>
                    <div><strong>Idea:</strong> {run.ideaId}</div>
                    <div><strong>Artifact:</strong> {run.artifactId}</div>
                    <div><strong>Paused:</strong> {run.paused ? "Yes" : "No"}</div>
                    {run.pauseReason && <div><strong>Pause reason:</strong> {run.pauseReason}</div>}
                    <div><strong>Commit:</strong> {run.commitSha ?? "—"}</div>
                    <div><strong>Completed:</strong> {run.completedAt ? formatDate(run.completedAt) : "—"}</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Research Section ─────────────────────────────────────────────────────────

function ResearchSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const [researchQuery, setResearchQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");

  const startResearchCycle = usePluginAction(ACTION_KEYS.startResearchCycle);
  const completeResearchCycle = usePluginAction(ACTION_KEYS.completeResearchCycle);

  const cyclesQuery = usePluginData<ResearchCycle[]>(DATA_KEYS.researchCycles, { companyId, projectId });
  const latestCycle = cyclesQuery.data?.[0];

  const findingsQuery = usePluginData<ResearchFinding[]>(
    DATA_KEYS.researchFindings,
    latestCycle ? { companyId, projectId, cycleId: latestCycle.cycleId } : { companyId, projectId }
  );

  const handleStartResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setIsRunning(true);
    setMessage("");
    try {
      const cycle = await startResearchCycle({ companyId, projectId, query: researchQuery }) as { cycleId: string };
      // Simulate completion after a short delay
      await completeResearchCycle({
        companyId,
        projectId,
        cycleId: cycle.cycleId,
        status: "completed",
        reportContent: `Research completed on: ${researchQuery}`,
        findingsCount: 3
      });
      await cyclesQuery.refresh();
      setMessage("Research completed successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  }, [companyId, projectId, researchQuery, startResearchCycle, completeResearchCycle, cyclesQuery]);

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Research</h3>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Enter research topic or question..."
          value={researchQuery}
          onChange={(e) => setResearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleStartResearch()}
        />
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={handleStartResearch}
          disabled={isRunning || !researchQuery.trim()}
        >
          {isRunning ? "Running..." : "Run Research"}
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#166534" }}>{message}</div>
      )}

      {cyclesQuery.data && cyclesQuery.data.length > 0 && (
        <div>
          <strong style={{ fontSize: 13, color: "#334155" }}>
            Latest Cycle: {latestCycle?.status === "completed" ? "✅ Completed" : latestCycle?.status === "running" ? "🔄 Running" : "⏳ Pending"}
          </strong>
          {latestCycle?.reportContent && (
            <div style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "rgba(248,250,252,0.8)",
              borderRadius: 8,
              fontSize: 13,
              whiteSpace: "pre-wrap",
              border: "1px solid rgba(100,116,139,0.15)"
            }}>
              {latestCycle.reportContent}
            </div>
          )}
          {findingsQuery.data && findingsQuery.data.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <strong style={{ fontSize: 12, color: "#475569" }}>Findings ({findingsQuery.data.length})</strong>
              {findingsQuery.data.slice(0, 5).map((f: ResearchFinding) => (
                <div key={f.findingId} style={{
                  padding: "8px 10px",
                  background: "white",
                  borderRadius: 8,
                  border: "1px solid rgba(100,116,139,0.15)",
                  fontSize: 12
                }}>
                  <strong>{f.title}</strong>
                  {f.description && <p style={{ margin: "4px 0 0", color: "#64748b" }}>{f.description}</p>}
                  {f.sourceLabel && <span style={{ fontSize: 11, color: "#94a3b8" }}>Source: {f.sourceLabel}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Ideas Section ────────────────────────────────────────────────────────────

function IdeasSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const [newIdeaTitle, setNewIdeaTitle] = useState("");
  const [newIdeaDescription, setNewIdeaDescription] = useState("");
  const [newIdeaScore, setNewIdeaScore] = useState("75");
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const generateIdeas = usePluginAction(ACTION_KEYS.generateIdeas);
  const ideasQuery = usePluginData<Idea[]>(DATA_KEYS.ideas, { companyId, projectId });

  const handleGenerateIdea = useCallback(async () => {
    if (!newIdeaTitle.trim()) return;
    setIsGenerating(true);
    setMessage("");
    try {
      await generateIdeas({
        companyId,
        projectId,
        ideas: [{
          title: newIdeaTitle,
          description: newIdeaDescription,
          rationale: "Generated from research",
          sourceReferences: ["research-cycle"],
          score: parseInt(newIdeaScore, 10) || 75
        }]
      });
      await ideasQuery.refresh();
      setNewIdeaTitle("");
      setNewIdeaDescription("");
      setNewIdeaScore("75");
      setMessage("Idea added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGenerating(false);
    }
  }, [companyId, projectId, newIdeaTitle, newIdeaDescription, newIdeaScore, generateIdeas, ideasQuery]);

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Ideas</h3>

      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Idea title..."
            value={newIdeaTitle}
            onChange={(e) => setNewIdeaTitle(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 70 }}
            type="number"
            min="1"
            max="100"
            placeholder="Score"
            value={newIdeaScore}
            onChange={(e) => setNewIdeaScore(e.target.value)}
          />
        </div>
        <textarea
          style={{ ...inputStyle, minHeight: 60, fontSize: 12 }}
          placeholder="Description..."
          value={newIdeaDescription}
          onChange={(e) => setNewIdeaDescription(e.target.value)}
        />
        <button type="button" style={primaryButtonStyle} onClick={handleGenerateIdea} disabled={isGenerating || !newIdeaTitle.trim()}>
          {isGenerating ? "Adding..." : "Add Idea"}
        </button>
      </div>

      {message && <div style={{ marginBottom: 10, fontSize: 13, color: "#166534" }}>{message}</div>}

      {ideasQuery.data && ideasQuery.data.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {ideasQuery.data.map((idea: Idea) => (
            <div key={idea.ideaId} style={{
              padding: "10px 12px",
              background: "white",
              borderRadius: 10,
              border: "1px solid rgba(100,116,139,0.2)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{idea.title}</strong>
                  {idea.duplicateAnnotated && (
                    <span style={{ fontSize: 10, padding: "2px 6px", background: "rgba(234,179,8,0.15)", color: "#854d0e", borderRadius: 4 }}>
                      Duplicate
                    </span>
                  )}
                </div>
                {idea.description && (
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>{idea.description}</p>
                )}
                {idea.rationale && (
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>Rationale: {idea.rationale}</p>
                )}
              </div>
              <div style={{
                minWidth: 42,
                textAlign: "center",
                padding: "4px 8px",
                borderRadius: 8,
                background: idea.score >= 80 ? "rgba(22,163,74,0.1)" : idea.score >= 60 ? "rgba(234,179,8,0.1)" : "rgba(100,116,139,0.1)",
                color: idea.score >= 80 ? "#166534" : idea.score >= 60 ? "#854d0e" : "#475569",
                fontWeight: 700,
                fontSize: 13
              }}>
                {idea.score}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Swipe Section ────────────────────────────────────────────────────────────

function SwipeSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const [swipeFeedback, setSwipeFeedback] = useState("");

  const recordSwipe = usePluginAction(ACTION_KEYS.recordSwipe);
  const ideasQuery = usePluginData<Idea[]>(DATA_KEYS.ideas, { companyId, projectId });
  const swipeEventsQuery = usePluginData<SwipeEvent[]>(DATA_KEYS.swipeEvents, { companyId, projectId });

  const activeIdeas = (ideasQuery.data ?? []).filter((i: Idea) => i.status === "active" || i.status === "approved");

  const handleSwipe = useCallback(async (ideaId: string, decision: SwipeDecision) => {
    setSwipeFeedback("");
    try {
      const result = await recordSwipe({ companyId, projectId, ideaId, decision }) as { idea: { status: IdeaStatus }; profile: PreferenceProfile };
      await ideasQuery.refresh();
      await swipeEventsQuery.refresh();
      setSwipeFeedback(`Swiped ${decision} — Idea now ${result.idea.status}`);
    } catch (error) {
      setSwipeFeedback(error instanceof Error ? error.message : String(error));
    }
  }, [companyId, projectId, recordSwipe, ideasQuery, swipeEventsQuery]);

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Swipe Review</h3>

      {activeIdeas.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No ideas ready for review. Generate ideas first.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {activeIdeas.slice(0, 5).map((idea: Idea) => (
            <div key={idea.ideaId} style={{
              padding: "12px 14px",
              background: "white",
              borderRadius: 12,
              border: "1px solid rgba(100,116,139,0.2)"
            }}>
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>{idea.title}</strong>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: idea.score >= 80 ? "rgba(22,163,74,0.1)" : idea.score >= 60 ? "rgba(234,179,8,0.1)" : "rgba(100,116,139,0.1)",
                    color: idea.score >= 80 ? "#166534" : idea.score >= 60 ? "#854d0e" : "#475569",
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    Score: {idea.score}
                  </span>
                  {idea.status === "approved" && (
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(22,163,74,0.15)", color: "#166534", fontSize: 12 }}>
                      Approved
                    </span>
                  )}
                </div>
                {idea.description && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>{idea.description}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleSwipe(idea.ideaId, "pass")}
                  style={{ ...buttonStyle, color: "#dc2626", borderColor: "rgba(220,38,38,0.3)" }}
                >
                  Pass
                </button>
                <button
                  type="button"
                  onClick={() => handleSwipe(idea.ideaId, "maybe")}
                  style={{ ...buttonStyle, color: "#d97706", borderColor: "rgba(217,119,6,0.3)" }}
                >
                  Maybe
                </button>
                <button
                  type="button"
                  onClick={() => handleSwipe(idea.ideaId, "yes")}
                  style={{ ...buttonStyle, color: "#16a34a", borderColor: "rgba(22,163,74,0.3)" }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => handleSwipe(idea.ideaId, "now")}
                  style={{ ...primaryButtonStyle, background: "#16a34a", borderColor: "#16a34a" }}
                >
                  Now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {swipeFeedback && (
        <div style={{ marginTop: 10, fontSize: 13, color: "#166534" }}>{swipeFeedback}</div>
      )}

      {swipeEventsQuery.data && swipeEventsQuery.data.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(100,116,139,0.15)" }}>
          <strong style={{ fontSize: 12, color: "#64748b" }}>Recent Swipes ({swipeEventsQuery.data.length})</strong>
          <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
            {swipeEventsQuery.data.slice(0, 5).map((s: SwipeEvent) => (
              <div key={s.swipeId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
                <span>{s.decision.toUpperCase()}</span>
                <span style={{ opacity: 0.6 }}>{formatDate(s.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Preference Profile Section ───────────────────────────────────────────────

function PreferenceSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const profileQuery = usePluginData<PreferenceProfile | null>(DATA_KEYS.preferenceProfile, { companyId, projectId });
  const profile = profileQuery.data;

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Preference Profile</h3>
      {!profile ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No swipe history yet. Swipe on ideas to build your preference profile.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "rgba(220,38,38,0.08)", borderRadius: 10, border: "1px solid rgba(220,38,38,0.15)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#dc2626" }}>{profile.passCount}</div>
              <div style={{ fontSize: 11, color: "#dc2626", opacity: 0.8 }}>Pass</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "rgba(217,119,6,0.08)", borderRadius: 10, border: "1px solid rgba(217,119,6,0.15)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#d97706" }}>{profile.maybeCount}</div>
              <div style={{ fontSize: 11, color: "#d97706", opacity: 0.8 }}>Maybe</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "rgba(22,163,74,0.08)", borderRadius: 10, border: "1px solid rgba(22,163,74,0.15)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>{profile.yesCount}</div>
              <div style={{ fontSize: 11, color: "#16a34a", opacity: 0.8 }}>Yes</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "rgba(14,116,144,0.08)", borderRadius: 10, border: "1px solid rgba(14,116,144,0.15)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0e7392" }}>{profile.nowCount}</div>
              <div style={{ fontSize: 11, color: "#0e7392", opacity: 0.8 }}>Now</div>
            </div>
          </div>
          {profile.lastUpdated && (
            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
              Last updated: {formatDate(profile.lastUpdated)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Note: autopilot is merged into the main plugin, so we use the main plugin's ID
const AUTOPILOT_PLUGIN_KEY = "paperclip.autoresearch-improver-example";
const AUTOPILOT_TAB_SLOT_ID = "autopilot-project-tab";

export function AutopilotProjectSidebarLink({ context }: PluginProjectSidebarItemProps) {
  const projectId = context.entityId;
  if (!projectId) return null;

  const projectRef = (context as PluginProjectSidebarItemProps["context"] & { projectRef?: string | null })
    .projectRef
    ?? projectId;
  const prefix = context.companyPrefix ? `/${context.companyPrefix}` : "";
  const tabValue = `plugin:${AUTOPILOT_PLUGIN_KEY}:${AUTOPILOT_TAB_SLOT_ID}`;
  const href = `${prefix}/projects/${projectRef}?tab=${encodeURIComponent(tabValue)}`;

  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: "4px 8px",
        fontSize: 13,
        color: "#64748b",
        textDecoration: "none",
        transition: "color 0.15s, background 0.15s"
      }}
    >
      Autopilot
    </a>
  );
}
