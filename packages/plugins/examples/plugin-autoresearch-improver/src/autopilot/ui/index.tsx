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
  type CompanyBudget,
  type ConvoyTask,
  type Checkpoint,
  type OperatorIntervention,
  type InterventionType,
  type LearnerSummary,
  type KnowledgeEntry,
  type Digest,
  type ReleaseHealthCheck,
  type RollbackAction
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
  const resolvedCompanyId = autopilot?.companyId || companyId;
  const resolvedProjectId = autopilot?.projectId || "";

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
          border: "1px solid rgba(249, 115, 22, 0.5)",
          background: "rgba(249, 115, 22, 0.08)",
          fontSize: 13,
          color: "#9a3412"
        }}>
          <span style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 6,
            background: "rgba(249, 115, 22, 0.15)",
            color: "#c2410c",
            fontWeight: 700,
            fontSize: 12,
            marginRight: 8
          }}>
            PAUSED
          </span>
          {budgetQuery.data?.pauseReason ?? autopilot?.pauseReason ?? "No reason provided"}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {autopilot?.paused ? (
          <button
            type="button"
            style={buttonStyle}
            disabled={!resolvedCompanyId || !resolvedProjectId}
            onClick={async () => {
              console.log("[AutopilotSettings] handleResume", { companyId: resolvedCompanyId, projectId: resolvedProjectId, autopilot });
              if (!resolvedCompanyId || !resolvedProjectId) return;
              await resumeAutopilot({ companyId: resolvedCompanyId, projectId: resolvedProjectId });
            }}
          >
            Resume Autopilot
          </button>
        ) : (
          <button type="button" style={buttonStyle} onClick={async () => { await pauseAutopilot({ companyId: resolvedCompanyId, projectId: resolvedProjectId }); }} disabled={!resolvedCompanyId || !resolvedProjectId}>
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
      <ConvoyTasksSection companyId={companyId} projectId={projectId} />
      <CheckpointResumeControls companyId={companyId} projectId={projectId} />
      <OperatorInterventionControls companyId={companyId} projectId={projectId} />
      <ResearchSection companyId={companyId} projectId={projectId} />
      <IdeasSection companyId={companyId} projectId={projectId} />
      <SwipeSection companyId={companyId} projectId={projectId} />
      <KnowledgeSection companyId={companyId} projectId={projectId} />
      <DigestSection companyId={companyId} projectId={projectId} />
      <ReleaseHealthSection companyId={companyId} projectId={projectId} />
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
  const [newIdeaRationale, setNewIdeaRationale] = useState("Generated from research");
  const [newIdeaSources, setNewIdeaSources] = useState("research-cycle");
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
          rationale: newIdeaRationale,
          sourceReferences: newIdeaSources
            .split(",")
            .map((source) => source.trim())
            .filter(Boolean),
          score: parseInt(newIdeaScore, 10) || 75
        }]
      });
      await ideasQuery.refresh();
      setNewIdeaTitle("");
      setNewIdeaDescription("");
      setNewIdeaScore("75");
      setNewIdeaRationale("Generated from research");
      setNewIdeaSources("research-cycle");
      setMessage("Idea added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGenerating(false);
    }
  }, [companyId, projectId, newIdeaTitle, newIdeaDescription, newIdeaScore, newIdeaRationale, newIdeaSources, generateIdeas, ideasQuery]);

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
        <div style={{ display: "grid", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Rationale..."
            value={newIdeaRationale}
            onChange={(e) => setNewIdeaRationale(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Sources (comma-separated)..."
            value={newIdeaSources}
            onChange={(e) => setNewIdeaSources(e.target.value)}
          />
        </div>
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

// ─── Convoy Tasks Section ─────────────────────────────────────────────────────

function ConvoyTasksSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const runsQuery = usePluginData<DeliveryRun[]>(DATA_KEYS.deliveryRuns, { companyId, projectId });
  const runs = runsQuery.data ?? [];
  const selectedRunId = runs[0]?.runId ?? null;

  const tasksQuery = usePluginData<ConvoyTask[]>(
    DATA_KEYS.convoyTasks,
    selectedRunId ? { companyId, projectId, runId: selectedRunId } : { companyId, projectId }
  );
  const tasks = tasksQuery.data ?? [];

  const statusColor: Record<string, string> = {
    pending: "#64748b",
    blocked: "#f97316",
    running: "#3b82f6",
    passed: "#22c55e",
    failed: "#ef4444",
    skipped: "#a855f7"
  };

  const statusLabel: Record<string, string> = {
    pending: "Pending",
    blocked: "Blocked",
    running: "Running",
    passed: "Passed",
    failed: "Failed",
    skipped: "Skipped"
  };

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Convoy Tasks</h3>

      {runs.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No delivery runs to show convoy tasks.</p>
      ) : tasks.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No convoy tasks yet. Tasks are created when a delivery run is decomposed into convoy mode.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {tasks.map((task) => (
            <div
              key={task.taskId}
              style={{
                padding: "10px 12px",
                background: "white",
                borderRadius: 10,
                border: `2px solid ${statusColor[task.status] ?? "#e2e8f0"}`,
                borderLeftWidth: 4,
                fontSize: 12,
                display: "grid",
                gap: 4
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 13, color: "#1e293b" }}>{task.title}</strong>
                <span style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: `${statusColor[task.status]}20`,
                  color: statusColor[task.status] ?? "#64748b",
                  fontWeight: 600,
                  fontSize: 11
                }}>
                  {statusLabel[task.status] ?? task.status}
                </span>
              </div>
              {task.description && (
                <div style={{ color: "#64748b", fontSize: 12 }}>{task.description}</div>
              )}
              {task.dependsOnTaskIds.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Depends on:</span>
                  {task.dependsOnTaskIds.map((depId) => {
                    const depTask = tasks.find((t) => t.taskId === depId);
                    return (
                      <span
                        key={depId}
                        style={{
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: depTask ? `${statusColor[depTask.status] ?? "#e2e8f0"}20` : "rgba(100,116,139,0.1)",
                          color: depTask ? statusColor[depTask.status] ?? "#64748b" : "#94a3b8",
                          fontSize: 10,
                          fontWeight: 500
                        }}
                      >
                        {depTask?.title ?? depId.slice(0, 8)}
                        {depTask ? ` (${statusLabel[depTask.status] ?? depTask.status})` : " (?)"}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Checkpoint & Resume Controls ───────────────────────────────────────────────

function CheckpointResumeControls({ companyId, projectId }: { companyId: string; projectId: string }) {
  const runsQuery = usePluginData<DeliveryRun[]>(DATA_KEYS.deliveryRuns, { companyId, projectId });
  const runs = runsQuery.data ?? [];
  const activeRun = runs.find((r) => r.status === "running" || r.status === "paused") ?? runs[0] ?? null;

  const checkpointsQuery = usePluginData<Checkpoint[]>(
    DATA_KEYS.checkpoints,
    activeRun ? { companyId, projectId, runId: activeRun.runId } : { companyId, projectId }
  );
  const checkpoints = checkpointsQuery.data ?? [];

  const createCheckpoint = usePluginAction(ACTION_KEYS.createCheckpoint);
  const resumeFromCheckpoint = usePluginAction(ACTION_KEYS.resumeFromCheckpoint);
  const decomposeIntoConvoyTasks = usePluginAction(ACTION_KEYS.decomposeIntoConvoyTasks);

  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateCheckpoint = useCallback(async () => {
    if (!activeRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await createCheckpoint({ companyId, projectId, runId: activeRun.runId });
      await checkpointsQuery.refresh();
      setMessage("Checkpoint created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, companyId, projectId, createCheckpoint, checkpointsQuery]);

  const handleResumeFromCheckpoint = useCallback(async (checkpointId: string) => {
    if (!activeRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await resumeFromCheckpoint({ companyId, projectId, runId: activeRun.runId, checkpointId });
      await runsQuery.refresh();
      setMessage("Run resumed from checkpoint.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, companyId, projectId, resumeFromCheckpoint, runsQuery]);

  const handleDecomposeIntoConvoyTasks = useCallback(async () => {
    if (!activeRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      // Auto-decompose into 3 tasks: setup, build, test
      await decomposeIntoConvoyTasks({
        companyId,
        projectId,
        runId: activeRun.runId,
        artifactId: activeRun.artifactId,
        tasks: [
          { title: "Setup workspace", description: "Initialize workspace and dependencies", dependsOnTaskIds: [] },
          { title: "Build changes", description: "Compile and build the changes", dependsOnTaskIds: [] },
          { title: "Run tests", description: "Execute test suite", dependsOnTaskIds: [] }
        ]
      });
      setMessage("Convoy tasks created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, companyId, projectId, decomposeIntoConvoyTasks]);

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Checkpoint & Resume</h3>

      {runs.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No delivery runs available.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {activeRun && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={{ ...buttonStyle, fontSize: 12 }}
                onClick={handleCreateCheckpoint}
                disabled={isLoading}
              >
                📍 Create Checkpoint
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, fontSize: 12 }}
                onClick={handleDecomposeIntoConvoyTasks}
                disabled={isLoading}
              >
                🚚 Decompose into Convoy Tasks
              </button>
            </div>
          )}

          {checkpoints.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>Checkpoints ({checkpoints.length})</strong>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {checkpoints.slice(0, 5).map((cp) => (
                  <div
                    key={cp.checkpointId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 10px",
                      background: "white",
                      borderRadius: 8,
                      border: "1px solid rgba(100,116,139,0.2)",
                      fontSize: 12
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>
                        Checkpoint {cp.checkpointId.slice(0, 8)}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {formatDate(cp.createdAt)}
                        {cp.pauseReason ? ` — ${cp.pauseReason}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ ...buttonStyle, fontSize: 11, padding: "4px 10px" }}
                      onClick={() => handleResumeFromCheckpoint(cp.checkpointId)}
                      disabled={isLoading}
                    >
                      ▶ Resume
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && (
            <div style={{ fontSize: 12, color: "#166534" }}>{message}</div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Operator Intervention Controls ────────────────────────────────────────────

function OperatorInterventionControls({ companyId, projectId }: { companyId: string; projectId: string }) {
  const runsQuery = usePluginData<DeliveryRun[]>(DATA_KEYS.deliveryRuns, { companyId, projectId });
  const runs = runsQuery.data ?? [];
  const activeRun = runs.find((r) => r.status === "running" || r.status === "paused") ?? runs[0] ?? null;

  const interventionsQuery = usePluginData<OperatorIntervention[]>(
    DATA_KEYS.operatorInterventions,
    activeRun ? { companyId, projectId, runId: activeRun.runId } : { companyId, projectId }
  );
  const interventions = interventionsQuery.data ?? [];

  const addOperatorNote = usePluginAction(ACTION_KEYS.addOperatorNote);
  const requestCheckpoint = usePluginAction(ACTION_KEYS.requestCheckpoint);
  const nudgeRun = usePluginAction(ACTION_KEYS.nudgeRun);
  const inspectLinkedIssue = usePluginAction(ACTION_KEYS.inspectLinkedIssue);

  const [noteText, setNoteText] = useState("");
  const [linkedIssueId, setLinkedIssueId] = useState("");
  const [linkedIssueUrl, setLinkedIssueUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleAddNote = useCallback(async () => {
    if (!activeRun || !noteText.trim()) return;
    setIsLoading(true);
    setMessage("");
    try {
      await addOperatorNote({ companyId, projectId, runId: activeRun.runId, note: noteText });
      await interventionsQuery.refresh();
      setNoteText("");
      setMessage("Note added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, noteText, companyId, projectId, addOperatorNote, interventionsQuery]);

  const handleRequestCheckpoint = useCallback(async () => {
    if (!activeRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await requestCheckpoint({ companyId, projectId, runId: activeRun.runId });
      await interventionsQuery.refresh();
      setMessage("Checkpoint requested.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, companyId, projectId, requestCheckpoint, interventionsQuery]);

  const handleNudgeRun = useCallback(async () => {
    if (!activeRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await nudgeRun({ companyId, projectId, runId: activeRun.runId, note: noteText || "Operator nudged this run" });
      await interventionsQuery.refresh();
      setMessage("Run nudged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, noteText, companyId, projectId, nudgeRun, interventionsQuery]);

  const handleInspectLinkedIssue = useCallback(async () => {
    if (!activeRun || !linkedIssueId.trim()) return;
    setIsLoading(true);
    setMessage("");
    try {
      await inspectLinkedIssue({
        companyId,
        projectId,
        runId: activeRun.runId,
        linkedIssueId: linkedIssueId,
        linkedIssueUrl: linkedIssueUrl || undefined
      });
      await interventionsQuery.refresh();
      setMessage("Linked issue inspected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeRun, linkedIssueId, linkedIssueUrl, companyId, projectId, inspectLinkedIssue, interventionsQuery]);

  const interventionTypeLabel: Record<InterventionType, string> = {
    note: "📝 Note",
    checkpoint_request: "📍 Checkpoint Request",
    nudge: "👆 Nudge",
    linked_issue_inspection: "🔗 Linked Issue"
  };

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Operator Interventions</h3>

      {runs.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No delivery runs available.</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {/* Control buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              style={{ ...buttonStyle, fontSize: 12 }}
              onClick={handleAddNote}
              disabled={isLoading || !noteText.trim()}
            >
              📝 Add Note
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, fontSize: 12 }}
              onClick={handleRequestCheckpoint}
              disabled={isLoading}
            >
              📍 Request Checkpoint
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, fontSize: 12 }}
              onClick={handleNudgeRun}
              disabled={isLoading}
            >
              👆 Nudge Run
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, fontSize: 12 }}
              onClick={handleInspectLinkedIssue}
              disabled={isLoading || !linkedIssueId.trim()}
            >
              🔗 Inspect Linked Issue
            </button>
          </div>

          {/* Note input */}
          <div>
            <input
              style={{ ...inputStyle, fontSize: 12 }}
              placeholder="Add a note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
            />
          </div>

          {/* Linked issue inputs */}
          <div style={{ display: "grid", gap: 6 }}>
            <input
              style={{ ...inputStyle, fontSize: 12 }}
              placeholder="Linked Issue ID (e.g. ISSUE-123)..."
              value={linkedIssueId}
              onChange={(e) => setLinkedIssueId(e.target.value)}
            />
            <input
              style={{ ...inputStyle, fontSize: 12 }}
              placeholder="Linked Issue URL (optional)..."
              value={linkedIssueUrl}
              onChange={(e) => setLinkedIssueUrl(e.target.value)}
            />
          </div>

          {message && (
            <div style={{ fontSize: 12, color: "#166534" }}>{message}</div>
          )}

          {/* Recent interventions */}
          {interventions.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>
                Recent Interventions ({interventions.length})
              </strong>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {interventions.slice(0, 5).map((iv) => (
                  <div
                    key={iv.interventionId}
                    style={{
                      padding: "8px 10px",
                      background: "white",
                      borderRadius: 8,
                      border: "1px solid rgba(100,116,139,0.15)",
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <strong style={{ color: "#1e293b" }}>
                        {interventionTypeLabel[iv.interventionType] ?? iv.interventionType}
                      </strong>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(iv.createdAt)}</span>
                    </div>
                    {iv.note && (
                      <div style={{ color: "#475569", fontSize: 12 }}>{iv.note}</div>
                    )}
                    {iv.linkedIssueTitle && (
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                        Issue: {iv.linkedIssueTitle}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Knowledge Section ────────────────────────────────────────────────────────

function KnowledgeSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const knowledgeQuery = usePluginData<KnowledgeEntry[]>(DATA_KEYS.knowledgeEntries, { companyId, projectId });
  const summariesQuery = usePluginData<LearnerSummary[]>(DATA_KEYS.learnerSummaries, { companyId, projectId });
  const entries = knowledgeQuery.data ?? [];
  const summaries = summariesQuery.data ?? [];

  const [showType, setShowType] = useState<"all" | "procedure" | "pattern" | "lesson" | "skill">("all");

  const filteredEntries = showType === "all"
    ? entries
    : entries.filter((e) => e.knowledgeType === showType);

  const typeColor: Record<string, string> = {
    procedure: "#3b82f6",
    pattern: "#8b5cf6",
    lesson: "#22c55e",
    skill: "#f97316"
  };

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Knowledge</h3>

      {entries.length === 0 && summaries.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No knowledge entries yet. Complete a delivery run to generate learner summaries.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Filter tabs */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(["all", "procedure", "pattern", "lesson", "skill"] as const).map((type) => (
              <button
                key={type}
                type="button"
                style={{
                  ...buttonStyle,
                  fontSize: 11,
                  padding: "4px 10px",
                  background: showType === type ? "#0f172a" : "white",
                  color: showType === type ? "white" : "#64748b"
                }}
                onClick={() => setShowType(type)}
              >
                {type === "all" ? `All (${entries.length})` : `${type.charAt(0).toUpperCase() + type.slice(1)} (${entries.filter((e) => e.knowledgeType === type).length})`}
              </button>
            ))}
          </div>

          {/* Learner summaries */}
          {summaries.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>Learner Summaries</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {summaries.slice(0, 3).map((s) => (
                  <div
                    key={s.summaryId}
                    style={{
                      padding: "10px 12px",
                      background: "white",
                      borderRadius: 10,
                      border: "1px solid rgba(100,116,139,0.2)",
                      fontSize: 12
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#1e293b" }}>{s.title}</div>
                    {s.summaryText && (
                      <div style={{ marginTop: 4, color: "#475569", fontSize: 12 }}>
                        {s.summaryText.slice(0, 120)}{s.summaryText.length > 120 ? "..." : ""}
                      </div>
                    )}
                    {s.keyLearnings.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {s.keyLearnings.slice(0, 3).map((learning, i) => (
                          <span
                            key={i}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: "rgba(34,197,94,0.1)",
                              color: "#166534",
                              fontSize: 10,
                              fontWeight: 500
                            }}
                          >
                            {learning}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge entries */}
          {filteredEntries.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>Knowledge Entries</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {filteredEntries.slice(0, 10).map((entry) => (
                  <div
                    key={entry.entryId}
                    style={{
                      padding: "10px 12px",
                      background: "white",
                      borderRadius: 10,
                      border: `1px solid ${typeColor[entry.knowledgeType] ?? "#e2e8f0"}30`,
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b", flex: 1 }}>{entry.title}</div>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: `${typeColor[entry.knowledgeType] ?? "#64748b"}15`,
                        color: typeColor[entry.knowledgeType] ?? "#64748b",
                        fontSize: 10,
                        fontWeight: 600
                      }}>
                        {entry.knowledgeType}
                      </span>
                    </div>
                    {entry.content && (
                      <div style={{ marginTop: 4, color: "#475569", fontSize: 12 }}>
                        {entry.content.slice(0, 100)}{entry.content.length > 100 ? "..." : ""}
                      </div>
                    )}
                    {entry.reinjectionCommand && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                        {entry.reinjectionCommand}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Digest Section ────────────────────────────────────────────────────────────

function DigestSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const digestsQuery = usePluginData<Digest[]>(DATA_KEYS.digests, { companyId, projectId });
  const digests = digestsQuery.data ?? [];

  const generateStuckRunDigest = usePluginAction(ACTION_KEYS.generateStuckRunDigest);
  const generateBudgetAlertDigest = usePluginAction(ACTION_KEYS.generateBudgetAlertDigest);

  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerateStuckRunDigest = useCallback(async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const result = await generateStuckRunDigest({ companyId, projectId }) as { stuckRunsCount: number };
      await digestsQuery.refresh();
      setMessage(result.stuckRunsCount > 0
        ? `Stuck run digest created for ${result.stuckRunsCount} run(s).`
        : "No stuck runs detected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [companyId, projectId, generateStuckRunDigest, digestsQuery]);

  const handleGenerateBudgetAlertDigest = useCallback(async () => {
    setIsLoading(true);
    setMessage("");
    try {
      await generateBudgetAlertDigest({ companyId, projectId });
      await digestsQuery.refresh();
      setMessage("Budget alert digest generated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [companyId, projectId, generateBudgetAlertDigest, digestsQuery]);

  const priorityColor: Record<string, string> = {
    low: "#64748b",
    medium: "#3b82f6",
    high: "#f97316",
    critical: "#ef4444"
  };

  const digestTypeLabel: Record<string, string> = {
    budget_alert: "💰 Budget Alert",
    stuck_run: "🚨 Stuck Run",
    opportunity: "💡 Opportunity",
    weekly_summary: "📅 Weekly Summary",
    health_check_failed: "⚠️ Health Check Failed"
  };

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Digests & Alerts</h3>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          style={{ ...buttonStyle, fontSize: 12 }}
          onClick={handleGenerateStuckRunDigest}
          disabled={isLoading}
        >
          🔍 Check Stuck Runs
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, fontSize: 12 }}
          onClick={handleGenerateBudgetAlertDigest}
          disabled={isLoading}
        >
          💰 Generate Budget Alert
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: 10, fontSize: 12, color: "#166534" }}>{message}</div>
      )}

      {digests.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No digests yet. Generate a digest to see alerts and opportunities here.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {digests.slice(0, 10).map((digest) => (
            <div
              key={digest.digestId}
              style={{
                padding: "10px 12px",
                background: "white",
                borderRadius: 10,
                border: `1px solid ${priorityColor[digest.priority] ?? "#e2e8f0"}40`,
                borderLeftWidth: 4,
                fontSize: 12
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, color: "#1e293b", flex: 1 }}>
                  {digestTypeLabel[digest.digestType] ?? digest.digestType}
                </div>
                <span style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: `${priorityColor[digest.priority] ?? "#64748b"}20`,
                  color: priorityColor[digest.priority] ?? "#64748b",
                  fontSize: 10,
                  fontWeight: 700
                }}>
                  {digest.priority.toUpperCase()}
                </span>
              </div>
              <div style={{ fontWeight: 600, color: "#334155", marginTop: 4 }}>{digest.title}</div>
              {digest.summary && (
                <div style={{ color: "#475569", fontSize: 12, marginTop: 4 }}>
                  {digest.summary}
                </div>
              )}
              {digest.details.length > 0 && (
                <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                  {digest.details.slice(0, 3).map((detail, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#64748b", paddingLeft: 8 }}>
                      • {detail}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                {formatDate(digest.createdAt)}
                {digest.status !== "pending" && ` · ${digest.status}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Release Health Section ───────────────────────────────────────────────────

function ReleaseHealthSection({ companyId, projectId }: { companyId: string; projectId: string }) {
  const runsQuery = usePluginData<DeliveryRun[]>(DATA_KEYS.deliveryRuns, { companyId, projectId });
  const runs = runsQuery.data ?? [];
  const completedRun = runs.find((r) => r.status === "completed" || r.status === "failed") ?? runs[0] ?? null;

  const healthChecksQuery = usePluginData<ReleaseHealthCheck[]>(
    DATA_KEYS.releaseHealthChecks,
    completedRun ? { companyId, projectId, runId: completedRun.runId } : { companyId, projectId }
  );
  const healthChecks = healthChecksQuery.data ?? [];

  const rollbacksQuery = usePluginData<RollbackAction[]>(
    DATA_KEYS.rollbackActions,
    completedRun ? { companyId, projectId, runId: completedRun.runId } : { companyId, projectId }
  );
  const rollbacks = rollbacksQuery.data ?? [];

  const createReleaseHealthCheck = usePluginAction(ACTION_KEYS.createReleaseHealthCheck);
  const updateReleaseHealthStatus = usePluginAction(ACTION_KEYS.updateReleaseHealthStatus);
  const triggerRollback = usePluginAction(ACTION_KEYS.triggerRollback);

  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateHealthCheck = useCallback(async () => {
    if (!completedRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await createReleaseHealthCheck({
        companyId,
        projectId,
        runId: completedRun.runId,
        checkType: "smoke_test",
        name: "Smoke Test Check"
      });
      await healthChecksQuery.refresh();
      setMessage("Health check created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [completedRun, companyId, projectId, createReleaseHealthCheck, healthChecksQuery]);

  const handleUpdateHealthStatus = useCallback(async (checkId: string, status: "passed" | "failed") => {
    setIsLoading(true);
    setMessage("");
    try {
      await updateReleaseHealthStatus({
        companyId,
        projectId,
        checkId,
        status,
        errorMessage: status === "failed" ? "Test failed — see logs for details" : undefined
      });
      await healthChecksQuery.refresh();
      await rollbacksQuery.refresh();
      setMessage(`Health check marked as ${status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [companyId, projectId, updateReleaseHealthStatus, healthChecksQuery, rollbacksQuery]);

  const handleTriggerRollback = useCallback(async (checkId: string) => {
    if (!completedRun) return;
    setIsLoading(true);
    setMessage("");
    try {
      await triggerRollback({
        companyId,
        projectId,
        runId: completedRun.runId,
        checkId
      });
      await rollbacksQuery.refresh();
      setMessage("Rollback triggered.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [completedRun, companyId, projectId, triggerRollback, rollbacksQuery]);

  const statusColor: Record<string, string> = {
    pending: "#64748b",
    running: "#3b82f6",
    passed: "#22c55e",
    failed: "#ef4444",
    skipped: "#a855f7"
  };

  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 16 }}>Release Health</h3>

      {runs.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No delivery runs available.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {completedRun && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={{ ...buttonStyle, fontSize: 12 }}
                onClick={handleCreateHealthCheck}
                disabled={isLoading}
              >
                🏥 Create Health Check
              </button>
            </div>
          )}

          {/* Health checks */}
          {healthChecks.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>Health Checks ({healthChecks.length})</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {healthChecks.slice(0, 5).map((check) => (
                  <div
                    key={check.checkId}
                    style={{
                      padding: "10px 12px",
                      background: "white",
                      borderRadius: 10,
                      border: `1px solid ${statusColor[check.status] ?? "#e2e8f0"}40`,
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>{check.name}</div>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: `${statusColor[check.status] ?? "#64748b"}20`,
                        color: statusColor[check.status] ?? "#64748b",
                        fontSize: 11,
                        fontWeight: 600
                      }}>
                        {check.status}
                      </span>
                    </div>
                    {check.errorMessage && (
                      <div style={{ marginTop: 4, color: "#ef4444", fontSize: 12 }}>
                        Error: {check.errorMessage}
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {check.status === "pending" && (
                        <>
                          <button
                            type="button"
                            style={{ ...buttonStyle, fontSize: 11, padding: "4px 10px", color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}
                            onClick={() => handleUpdateHealthStatus(check.checkId, "passed")}
                            disabled={isLoading}
                          >
                            ✓ Mark Passed
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, fontSize: 11, padding: "4px 10px", color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
                            onClick={() => handleUpdateHealthStatus(check.checkId, "failed")}
                            disabled={isLoading}
                          >
                            ✗ Mark Failed
                          </button>
                        </>
                      )}
                      {check.status === "failed" && (
                        <button
                          type="button"
                          style={{ ...buttonStyle, fontSize: 11, padding: "4px 10px", color: "#f97316", borderColor: "rgba(249,115,22,0.3)" }}
                          onClick={() => handleTriggerRollback(check.checkId)}
                          disabled={isLoading}
                        >
                          ↩ Trigger Rollback
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rollback actions */}
          {rollbacks.length > 0 && (
            <div>
              <strong style={{ fontSize: 12, color: "#334155" }}>Rollback Actions</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {rollbacks.slice(0, 5).map((rb) => (
                  <div
                    key={rb.rollbackId}
                    style={{
                      padding: "10px 12px",
                      background: "rgba(249,115,22,0.05)",
                      borderRadius: 10,
                      border: "1px solid rgba(249,115,22,0.2)",
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>
                        {rb.rollbackType === "restore_checkpoint" ? "↩ Restore Checkpoint" :
                         rb.rollbackType === "revert_commit" ? "↩ Revert Commit" : "↩ Full Rollback"}
                      </div>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: rb.status === "completed" ? "rgba(34,197,94,0.15)" :
                                   rb.status === "in_progress" ? "rgba(59,130,246,0.15)" :
                                   "rgba(100,116,139,0.1)",
                        color: rb.status === "completed" ? "#166534" :
                               rb.status === "in_progress" ? "#1d4ed8" : "#64748b",
                        fontSize: 11,
                        fontWeight: 600
                      }}>
                        {rb.status}
                      </span>
                    </div>
                    {rb.checkpointId && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                        Checkpoint: {rb.checkpointId.slice(0, 8)}
                      </div>
                    )}
                    {rb.targetCommitSha && (
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        Target commit: {rb.targetCommitSha}
                      </div>
                    )}
                    {rb.errorMessage && (
                      <div style={{ marginTop: 4, fontSize: 12, color: "#ef4444" }}>
                        Error: {rb.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && (
            <div style={{ fontSize: 12, color: "#166534" }}>{message}</div>
          )}
        </div>
      )}
    </section>
  );
}

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
