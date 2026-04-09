import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.autopilot";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Product Autopilot",
  description: "Company-scoped Product Autopilot onboarding with versioned Product Program authoring.",
  author: "Codex",
  categories: ["automation", "workspace"],
  capabilities: [
    "companies.read",
    "projects.read",
    "project.workspaces.read",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "ui.page.register",
    "ui.detailTab.register",
    "ui.sidebar.register"
  ],
  entrypoints: {
    worker: "./dist/autopilot/worker.js",
    ui: "./dist/autopilot/ui"
  },
  ui: {
    slots: [
      {
        type: "detailTab",
        id: "autopilot-project-tab",
        displayName: "Autopilot",
        exportName: "AutopilotProjectTab",
        entityTypes: ["project"]
      },
      {
        type: "projectSidebarItem",
        id: "autopilot-project-link",
        displayName: "Autopilot",
        exportName: "AutopilotProjectSidebarLink",
        entityTypes: ["project"]
      }
    ]
  }
};

export default manifest;
