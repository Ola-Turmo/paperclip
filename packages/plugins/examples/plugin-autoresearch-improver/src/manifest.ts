import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.autoresearch-improver-example";
const PLUGIN_VERSION = "0.1.0";
const JOB_KEYS = {
  optimizerSweep: "optimizer-sweep"
} as const;
const TOOL_KEYS = {
  listOptimizers: "list-optimizers",
  createIssueFromAcceptedRun: "create-issue-from-accepted-run"
} as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Autoresearch Improver",
  description: "Run Darwin-Derby style improve-score-ratchet loops against Paperclip project workspaces.",
  author: "Codex",
  categories: ["automation", "workspace", "ui"],
  capabilities: [
    "companies.read",
    "projects.read",
    "project.workspaces.read",
    "issues.create",
    "issues.read",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "metrics.write",
    "jobs.schedule",
    "agent.tools.register",
    "ui.page.register",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
    "ui.sidebar.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaultMutationBudgetSeconds: {
        type: "number",
        minimum: 5,
        maximum: 3600,
        default: 300
      },
      defaultScoreBudgetSeconds: {
        type: "number",
        minimum: 5,
        maximum: 3600,
        default: 180
      },
      defaultGuardrailBudgetSeconds: {
        type: "number",
        minimum: 5,
        maximum: 3600,
        default: 120
      },
      keepTmpDirs: {
        type: "boolean",
        default: false
      },
      maxOutputChars: {
        type: "number",
        minimum: 500,
        maximum: 50000,
        default: 8000
      },
      sweepLimit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 10
      }
    }
  },
  jobs: [
    {
      jobKey: JOB_KEYS.optimizerSweep,
      displayName: "Optimizer Sweep",
      description: "Runs active optimizers that have auto-run enabled.",
      schedule: "0 * * * *"
    }
  ],
  tools: [
    {
      name: TOOL_KEYS.listOptimizers,
      displayName: "List project optimizers",
      description: "Summarize the registered autoresearch loops for a project.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" }
        },
        required: ["projectId"]
      }
    },
    {
      name: TOOL_KEYS.createIssueFromAcceptedRun,
      displayName: "Create issue from accepted optimizer run",
      description: "Turns the latest accepted run for an optimizer into a Paperclip issue.",
      parametersSchema: {
        type: "object",
        properties: {
          optimizerId: { type: "string" },
          titlePrefix: { type: "string" }
        },
        required: ["optimizerId"]
      }
    }
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "optimizer-console-page",
        displayName: "Autoresearch Console",
        exportName: "OptimizerPage"
      },
      {
        type: "dashboardWidget",
        id: "optimizer-overview-widget",
        displayName: "Optimizer Overview",
        exportName: "OptimizerDashboardWidget"
      },
      {
        type: "detailTab",
        id: "optimizer-project-tab",
        displayName: "Optimizer",
        exportName: "ProjectOptimizerTab",
        entityTypes: ["project"]
      },
      {
        type: "projectSidebarItem",
        id: "optimizer-project-link",
        displayName: "Optimizer",
        exportName: "ProjectOptimizerSidebarLink",
        entityTypes: ["project"]
      }
    ]
  }
};

export default manifest;
