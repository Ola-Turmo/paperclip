import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk";
import manifest from "../src/autopilot/manifest.js";
import plugin from "../src/autopilot/worker.js";

type HarnessSetup = {
  harness: ReturnType<typeof createTestHarness>;
  projectId: string;
  companyId: string;
  otherCompanyId: string;
  otherProjectId: string;
};

async function setupHarness(): Promise<HarnessSetup> {
  const harness = createTestHarness({ manifest });
  const companyId = "company-1";
  const projectId = "project-1";
  const otherCompanyId = "company-2";
  const otherProjectId = "project-2";

  harness.seed({
    companies: [
      { id: companyId, name: "Test Co" } as never,
      { id: otherCompanyId, name: "Other Co" } as never
    ],
    projects: [
      { id: projectId, companyId, name: "Project" } as never,
      { id: otherProjectId, companyId: otherCompanyId, name: "Other Project" } as never
    ]
  });
  await plugin.definition.setup(harness.ctx);

  return { harness, projectId, companyId, otherCompanyId, otherProjectId };
}

describe("autopilot worker", () => {
  let setup: HarnessSetup;

  beforeEach(async () => {
    setup = await setupHarness();
  });

  describe("VAL-AUTOPILOT-001: Enable autopilot for a project", () => {
    it("enables autopilot for a company/project pair with settings", async () => {
      const { harness, companyId, projectId } = setup;

      const result = await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120,
        repoUrl: "https://github.com/test/repo"
      });

      expect(result).toMatchObject({
        autopilotId: expect.any(String),
        companyId,
        projectId,
        enabled: true,
        automationTier: "semiauto",
        budgetMinutes: 120,
        repoUrl: "https://github.com/test/repo",
        paused: false
      });
    });

    it("persists autopilot settings and retrieves them after reload", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable autopilot
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 240
      });

      // Simulate reload by querying the data
      const autopilotData = await harness.getData("autopilot-project", {
        companyId,
        projectId
      });

      expect(autopilotData).toMatchObject({
        companyId,
        projectId,
        enabled: true,
        automationTier: "fullauto",
        budgetMinutes: 240
      });
    });

    it("updates existing autopilot settings", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable with initial settings
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "supervised",
        budgetMinutes: 60
      });

      // Update settings
      await harness.performAction("save-autopilot-project", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      const autopilotData = await harness.getData("autopilot-project", {
        companyId,
        projectId
      });

      expect(autopilotData).toMatchObject({
        automationTier: "semiauto",
        budgetMinutes: 120
      });
    });
  });

  describe("VAL-AUTOPILOT-002: Create and edit Product Program revisions", () => {
    it("creates an initial Product Program revision", async () => {
      const { harness, companyId, projectId } = setup;

      const result = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "# Product Program\n\nThis is the initial product program content."
      });

      expect(result).toMatchObject({
        revisionId: expect.any(String),
        companyId,
        projectId,
        content: "# Product Program\n\nThis is the initial product program content.",
        version: 1
      });
    });

    it("saves edits to an existing revision", async () => {
      const { harness, companyId, projectId } = setup;

      // Create initial revision
      const initial = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Initial content"
      }) as { revisionId: string };

      // Edit the revision
      await harness.performAction("save-product-program-revision", {
        companyId,
        projectId,
        revisionId: initial.revisionId,
        content: "Updated content with changes"
      });

      // Verify the content was updated
      const revisions = await harness.getData("product-program-revisions", {
        companyId,
        projectId
      }) as Array<{ revisionId: string; content: string; version: number }>;

      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        revisionId: initial.revisionId,
        content: "Updated content with changes",
        version: 1
      });
    });

    it("creates a new revision when editing an existing one", async () => {
      const { harness, companyId, projectId } = setup;

      // Create initial revision
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Version 1 content"
      });

      // Create a new revision
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Version 2 content with updates"
      });

      const revisions = await harness.getData("product-program-revisions", {
        companyId,
        projectId
      }) as Array<{ version: number; content: string }>;

      expect(revisions).toHaveLength(2);
      expect(revisions[0]).toMatchObject({ version: 2, content: "Version 2 content with updates" });
      expect(revisions[1]).toMatchObject({ version: 1, content: "Version 1 content" });
    });

    it("shows revision history with versions", async () => {
      const { harness, companyId, projectId } = setup;

      // Create multiple revisions
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Version 1"
      });
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Version 2"
      });
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Version 3"
      });

      const revisions = await harness.getData("product-program-revisions", {
        companyId,
        projectId
      }) as Array<{ version: number; createdAt: string }>;

      expect(revisions).toHaveLength(3);
      expect(revisions[0].version).toBe(3);
      expect(revisions[1].version).toBe(2);
      expect(revisions[2].version).toBe(1);
      // Verify createdAt is set for each revision
      expect(revisions[0].createdAt).toBeDefined();
    });
  });

  describe("VAL-AUTOPILOT-003: Program content is versioned and recoverable", () => {
    it("preserves the latest revision after reload", async () => {
      const { harness, companyId, projectId } = setup;

      // Create revision
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Important program content"
      });

      // Simulate reload by fetching revisions
      const latestRevision = await harness.getData("product-program-revision", {
        companyId,
        projectId,
        revisionId: (await harness.getData("product-program-revisions", {
          companyId,
          projectId
        }) as Array<{ revisionId: string }>)[0].revisionId
      });

      expect(latestRevision).toMatchObject({
        content: "Important program content"
      });
    });

    it("exposes prior revisions for the same project", async () => {
      const { harness, companyId, projectId } = setup;

      // Create multiple revisions with distinct content
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "First version content"
      });
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Second version content"
      });

      const revisions = await harness.getData("product-program-revisions", {
        companyId,
        projectId
      }) as Array<{ content: string; version: number }>;

      expect(revisions).toHaveLength(2);
      // All prior revisions should be accessible
      const contents = revisions.map((r) => r.content);
      expect(contents).toContain("First version content");
      expect(contents).toContain("Second version content");
    });

    it("version numbers increment correctly", async () => {
      const { harness, companyId, projectId } = setup;

      const v1 = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "v1"
      }) as { version: number };

      const v2 = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "v2"
      }) as { version: number };

      const v3 = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "v3"
      }) as { version: number };

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
    });
  });

  describe("VAL-CROSS-002: Company isolation is preserved across autopilot data", () => {
    it("denies access to another company's autopilot project", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      // Enable autopilot for company-1/project-1
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Try to access from company-2 - should return null (denied)
      const otherCompanyAutopilot = await harness.getData("autopilot-project", {
        companyId: otherCompanyId,
        projectId
      });

      expect(otherCompanyAutopilot).toBeNull();
    });

    it("denies access to another company's Product Program revisions", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      // Create revision for company-1/project-1
      const revision = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Company 1 confidential program"
      }) as { revisionId: string };

      // Try to access from company-2 - should be denied
      const otherCompanyRevision = await harness.getData("product-program-revision", {
        companyId: otherCompanyId,
        projectId,
        revisionId: revision.revisionId
      });

      expect(otherCompanyRevision).toBeNull();
    });

    it("lists only company-1's autopilot projects for company-1", async () => {
      const { harness, companyId, projectId, otherCompanyId, otherProjectId } = setup;

      // Enable autopilot for company-1
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 60
      });

      // Enable autopilot for company-2
      await harness.performAction("enable-autopilot", {
        companyId: otherCompanyId,
        projectId: otherProjectId,
        automationTier: "fullauto",
        budgetMinutes: 100
      });

      // Company 1 should only see their own autopilot project
      const company1Projects = await harness.getData("autopilot-projects", {
        companyId
      }) as Array<{ companyId: string; projectId: string }>;

      expect(company1Projects).toHaveLength(1);
      expect(company1Projects[0]).toMatchObject({
        companyId,
        projectId
      });
    });

    it("isolates Product Program revisions by company", async () => {
      const { harness, companyId, projectId, otherCompanyId, otherProjectId } = setup;

      // Create revision for company-1
      await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Company 1 program"
      });

      // Create revision for company-2
      await harness.performAction("create-product-program-revision", {
        companyId: otherCompanyId,
        projectId: otherProjectId,
        content: "Company 2 program"
      });

      // Company 1 should only see their own revisions
      const company1Revisions = await harness.getData("product-program-revisions", {
        companyId,
        projectId
      }) as Array<{ content: string }>;

      expect(company1Revisions).toHaveLength(1);
      expect(company1Revisions[0].content).toBe("Company 1 program");

      // Company 2 should only see their own revisions
      const company2Revisions = await harness.getData("product-program-revisions", {
        companyId: otherCompanyId,
        projectId: otherProjectId
      }) as Array<{ content: string }>;

      expect(company2Revisions).toHaveLength(1);
      expect(company2Revisions[0].content).toBe("Company 2 program");
    });

    it("cross-company revision ID lookup returns null", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      // Create revision for company-1
      const revision = await harness.performAction("create-product-program-revision", {
        companyId,
        projectId,
        content: "Confidential"
      }) as { revisionId: string };

      // Try to look up company-1's revision from company-2 context
      const deniedRevision = await harness.getData("product-program-revision", {
        companyId: otherCompanyId, // Wrong company
        projectId,
        revisionId: revision.revisionId
      });

      expect(deniedRevision).toBeNull();
    });
  });
});
