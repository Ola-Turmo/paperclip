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
  type AutomationTier
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
  onSave
}: {
  autopilot: AutopilotProject | null;
  onSave: (updates: Partial<AutopilotProject>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(autopilot?.enabled ?? false);
  const [automationTier, setAutomationTier] = useState<AutomationTier>(autopilot?.automationTier ?? "supervised");
  const [budgetMinutes, setBudgetMinutes] = useState(String(autopilot?.budgetMinutes ?? 60));
  const [repoUrl, setRepoUrl] = useState(autopilot?.repoUrl ?? "");
  const [workspaceId, setWorkspaceId] = useState(autopilot?.workspaceId ?? "");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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
              onChange={(e) => setAutomationTier(e.target.value as AutomationTier)}
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

      {autopilot && autopilot.paused && (
        <div style={{
          marginTop: 8,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(234, 179, 8, 0.5)",
          background: "rgba(234, 179, 8, 0.08)",
          fontSize: 13,
          color: "#854d0e"
        }}>
          <strong>Paused:</strong> {autopilot.pauseReason ?? "No reason provided"}
        </div>
      )}
    </div>
  );
}

function ProductProgramEditor({
  revision,
  revisionHistory,
  onSave,
  onCreateRevision
}: {
  revision: ProductProgramRevision | null;
  revisionHistory: RevisionHistory[];
  onSave: (content: string) => Promise<void>;
  onCreateRevision: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(revision?.content ?? "");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
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

      {showHistory && revisionHistory.length > 0 && (
        <div style={{
          border: "1px solid rgba(100, 116, 139, 0.25)",
          borderRadius: 10,
          padding: 12,
          maxHeight: 200,
          overflowY: "auto",
          background: "rgba(248, 250, 252, 0.5)"
        }}>
          <strong style={{ fontSize: 12, color: "#334155" }}>Revision History</strong>
          {revisionHistory.map((rev) => (
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
          ))}
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
          onSave={handleSaveAutopilot}
        />
      </section>

      <section style={cardStyle}>
        <ProductProgramEditor
          revision={latestRevision}
          revisionHistory={revisionHistory}
          onSave={handleSaveProgram}
          onCreateRevision={handleCreateRevision}
        />
      </section>
    </div>
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
