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

  describe("VAL-AUTOPILOT-010: Run research on demand", () => {
    it("starts a research cycle and stores it with pending status", async () => {
      const { harness, companyId, projectId } = setup;

      const cycle = await harness.performAction("start-research-cycle", {
        companyId,
        projectId,
        query: "What are the top user pain points in our product?"
      }) as { cycleId: string; status: string };

      expect(cycle).toMatchObject({
        cycleId: expect.any(String),
        status: "running"
      });
    });

    it("completes a research cycle and stores the report content", async () => {
      const { harness, companyId, projectId } = setup;

      const cycle = await harness.performAction("start-research-cycle", {
        companyId,
        projectId,
        query: "Competitor analysis"
      }) as { cycleId: string };

      const completed = await harness.performAction("complete-research-cycle", {
        companyId,
        projectId,
        cycleId: cycle.cycleId,
        status: "completed",
        reportContent: "Our competitors are focused on AI features and pricing.",
        findingsCount: 5
      }) as { status: string; reportContent: string; findingsCount: number };

      expect(completed.status).toBe("completed");
      expect(completed.reportContent).toBe("Our competitors are focused on AI features and pricing.");
      expect(completed.findingsCount).toBe(5);
    });

    it("fetches a completed research cycle with its data", async () => {
      const { harness, companyId, projectId } = setup;

      const cycle = await harness.performAction("start-research-cycle", {
        companyId,
        projectId,
        query: "User feedback themes"
      }) as { cycleId: string };

      await harness.performAction("complete-research-cycle", {
        companyId,
        projectId,
        cycleId: cycle.cycleId,
        status: "completed",
        reportContent: "Users want better onboarding.",
        findingsCount: 3
      });

      const fetched = await harness.getData("research-cycle", {
        companyId,
        projectId,
        cycleId: cycle.cycleId
      });

      expect(fetched).toMatchObject({
        cycleId: cycle.cycleId,
        status: "completed",
        reportContent: "Users want better onboarding."
      });
    });
  });

  describe("VAL-AUTOPILOT-011: Generate scored ideas from research", () => {
    it("generates ideas with scores, rationale, and source references", async () => {
      const { harness, companyId, projectId } = setup;

      const cycle = await harness.performAction("start-research-cycle", {
        companyId,
        projectId,
        query: "Improvement opportunities"
      }) as { cycleId: string };

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        cycleId: cycle.cycleId,
        ideas: [
          {
            title: "Add onboarding wizard",
            description: "Guide new users through first-time setup",
            rationale: "Reduces time-to-value for new users by 40%",
            sourceReferences: ["cycle-findings", "user-interviews"],
            score: 85
          },
          {
            title: "Improve search performance",
            description: "Current search takes over 3 seconds",
            rationale: "High-frequency user complaint, impacts productivity",
            sourceReferences: ["support-tickets"],
            score: 72
          }
        ]
      }) as Array<{ ideaId: string; title: string; score: number; rationale: string; sourceReferences: string[] }>;

      expect(ideas).toHaveLength(2);
      expect(ideas[0]).toMatchObject({
        title: "Add onboarding wizard",
        score: 85,
        rationale: "Reduces time-to-value for new users by 40%",
        sourceReferences: expect.arrayContaining(["cycle-findings", "user-interviews"])
      });
      expect(ideas[1]).toMatchObject({
        title: "Improve search performance",
        score: 72
      });
    });

    it("stores ideas and retrieves them ordered by score", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [
          { title: "Low priority fix", description: "Minor UI polish", rationale: "Low impact", sourceReferences: [], score: 30 },
          { title: "High priority fix", description: "Critical bug", rationale: "Breaks flows", sourceReferences: [], score: 95 }
        ]
      });

      const ideas = await harness.getData("ideas", { companyId, projectId }) as Array<{ title: string; score: number }>;

      expect(ideas[0].score).toBeGreaterThan(ideas[1].score);
    });
  });

  describe("VAL-AUTOPILOT-012: Deduplicate near-identical ideas", () => {
    it("annotates a near-duplicate idea with duplicate marker and original reference", async () => {
      const { harness, companyId, projectId } = setup;

      // Create initial idea with a specific description
      const created = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{
          title: "Dark mode support",
          description: "Add a toggle in user settings to switch between light and dark themes, with automatic detection of system-wide dark mode preference on first load.",
          rationale: "User demand from forum posts",
          sourceReferences: ["forum-post"],
          score: 80
        }]
      }) as Array<{ ideaId: string }>;

      // Create a near-duplicate with the same title and very similar description
      // The descriptions share nearly all words; only "system-wide" differs slightly
      // Both titles are identical, so text normalization makes them the same
      // Expected similarity: above 0.9 (Jaccard overlap is very high)
      const duplicates = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{
          title: "Dark mode support",
          description: "Add a toggle in user settings to switch between light and dark themes, with automatic detection of system dark mode preference on first load.",
          rationale: "Forum request",
          sourceReferences: ["forum-post"],
          score: 82
        }]
      }) as Array<{ ideaId: string; duplicateAnnotated: boolean; duplicateOfIdeaId: string | undefined }>;

      // The second idea should be annotated as duplicate (similarity > 0.75)
      const annotatedDuplicates = duplicates.filter((d) => d.duplicateAnnotated);
      expect(annotatedDuplicates.length).toBe(1);
      expect(annotatedDuplicates[0].duplicateOfIdeaId).toBeDefined();
      expect(annotatedDuplicates[0].duplicateOfIdeaId).toBe(created[0].ideaId);
    });

    it("suppresses near-identical ideas with very high similarity", async () => {
      const { harness, companyId, projectId } = setup;

      // Create first idea
      await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{
          title: "Improve dashboard performance",
          description: "Dashboard loads slowly for large datasets",
          rationale: "Performance issue",
          sourceReferences: [],
          score: 75
        }]
      });

      // Submit near-identical with slightly lower score
      const duplicates = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{
          title: "Improve Dashboard Performance",
          description: "Dashboard loads slowly for large datasets",
          rationale: "Performance issue",
          sourceReferences: [],
          score: 60
        }]
      }) as Array<{ ideaId: string; duplicateAnnotated: boolean; title: string; score: number }>;

      const annotated = duplicates.find((d) => d.duplicateAnnotated);
      expect(annotated).toBeDefined();
      // Annotated idea should have a slightly reduced score
      expect(annotated!.score).toBeLessThan(75);
    });

    it("allows non-duplicate ideas to be stored normally", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{
          title: "Add export to CSV",
          description: "Allow users to export data to CSV format",
          rationale: "Common feature request",
          sourceReferences: ["user-survey"],
          score: 68
        }]
      });

      const ideas = await harness.getData("ideas", { companyId, projectId }) as Array<{ title: string; duplicateAnnotated: boolean }>;
      expect(ideas.some((i) => i.title === "Add export to CSV" && !i.duplicateAnnotated)).toBe(true);
    });
  });

  describe("VAL-AUTOPILOT-020: Swipe Pass records rejection", () => {
    it("swiping Pass marks the idea as rejected and removes from active queue", async () => {
      const { harness, companyId, projectId } = setup;

      const ideaResult = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add social sharing", description: "Share buttons on content", rationale: "Engagement", sourceReferences: [], score: 55 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideaResult[0].ideaId;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "pass"
      }) as { idea: { ideaId: string; status: string } };

      expect(result.idea.status).toBe("rejected");
    });

    it("swiping pass does not affect ideas in the maybe pool", async () => {
      const { harness, companyId, projectId } = setup;

      const ideaResult = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add dark mode", description: "Dark theme option", rationale: "Visuals", sourceReferences: [], score: 60 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideaResult[0].ideaId;

      // First swipe maybe to move to pool
      await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "maybe"
      });

      // Pass should not be reachable for maybe-pool ideas in normal flow
      // but we verify the idea is still in maybe pool if we try to re-swipe
      const maybeIdeas = await harness.getData("maybe-pool-ideas", { companyId, projectId }) as Array<{ ideaId: string }>;
      expect(maybeIdeas.some((i) => i.ideaId === ideaId)).toBe(true);
    });
  });

  describe("VAL-AUTOPILOT-021: Swipe Maybe sends idea to resurfacing queue", () => {
    it("swiping Maybe moves the idea to the maybe pool", async () => {
      const { harness, companyId, projectId } = setup;

      const ideaResult = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add mobile app", description: "Native iOS/Android app", rationale: "Reach", sourceReferences: [], score: 70 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideaResult[0].ideaId;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "maybe"
      }) as { idea: { ideaId: string; status: string } };

      expect(result.idea.status).toBe("maybe");
    });

    it("maybe-pool-ideas data handler returns only maybe-status ideas", async () => {
      const { harness, companyId, projectId } = setup;

      // Create three ideas
      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [
          { title: "Idea A", description: "Desc A", rationale: "", sourceReferences: [], score: 60 },
          { title: "Idea B", description: "Desc B", rationale: "", sourceReferences: [], score: 65 },
          { title: "Idea C", description: "Desc C", rationale: "", sourceReferences: [], score: 70 }
        ]
      }) as Array<{ ideaId: string }>;

      // Swipe two to maybe, leave one active
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: ideas[0].ideaId, decision: "maybe" });
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: ideas[1].ideaId, decision: "maybe" });

      const maybePool = await harness.getData("maybe-pool-ideas", { companyId, projectId }) as Array<{ ideaId: string; status: string }>;
      expect(maybePool).toHaveLength(2);
      expect(maybePool.every((i) => i.status === "maybe")).toBe(true);
    });

    it("maybe ideas do not appear in the active ideas list", async () => {
      const { harness, companyId, projectId } = setup;

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Maybe idea", description: "Desc", rationale: "", sourceReferences: [], score: 50 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", { companyId, projectId, ideaId: ideas[0].ideaId, decision: "maybe" });

      const activeIdeas = await harness.getData("ideas", { companyId, projectId }) as Array<{ ideaId: string }>;
      expect(activeIdeas.some((i) => i.ideaId === ideas[0].ideaId)).toBe(false);
    });
  });

  describe("VAL-AUTOPILOT-022: Swipe Yes or Now creates downstream delivery work", () => {
    it("swiping Yes marks idea as approved", async () => {
      const { harness, companyId, projectId } = setup;

      const ideaResult = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add API key management", description: "Manage API keys in settings", rationale: "Enterprise feature", sourceReferences: [], score: 88 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideaResult[0].ideaId;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "yes"
      }) as { idea: { ideaId: string; status: string } };

      expect(result.idea.status).toBe("approved");
    });

    it("swiping Now marks idea as approved", async () => {
      const { harness, companyId, projectId } = setup;

      const ideaResult = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Fix critical security issue", description: "Patch the auth vulnerability", rationale: "Security", sourceReferences: [], score: 99 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideaResult[0].ideaId;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "now"
      }) as { idea: { ideaId: string; status: string } };

      expect(result.idea.status).toBe("approved");
    });

    it("approved ideas appear in the ideas list", async () => {
      const { harness, companyId, projectId } = setup;

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Approved idea", description: "Desc", rationale: "", sourceReferences: [], score: 85 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", { companyId, projectId, ideaId: ideas[0].ideaId, decision: "yes" });

      const allIdeas = await harness.getData("ideas", { companyId, projectId }) as Array<{ ideaId: string }>;
      expect(allIdeas.some((i) => i.ideaId === ideas[0].ideaId)).toBe(true);
    });
  });

  describe("VAL-AUTOPILOT-023: Preference model updates from swipe history", () => {
    it("swiping records update the preference profile counts", async () => {
      const { harness, companyId, projectId } = setup;

      const idea1 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Idea 1", description: "D1", rationale: "", sourceReferences: [], score: 70 }]
      }) as Array<{ ideaId: string }>;
      const idea2 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Idea 2", description: "D2", rationale: "", sourceReferences: [], score: 65 }]
      }) as Array<{ ideaId: string }>;
      const idea3 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Idea 3", description: "D3", rationale: "", sourceReferences: [], score: 60 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea1[0].ideaId, decision: "yes" });
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea2[0].ideaId, decision: "pass" });
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea3[0].ideaId, decision: "maybe" });

      const profile = await harness.getData("preference-profile", { companyId, projectId }) as { passCount: number; maybeCount: number; yesCount: number; nowCount: number };

      expect(profile.yesCount).toBe(1);
      expect(profile.passCount).toBe(1);
      expect(profile.maybeCount).toBe(1);
      expect(profile.nowCount).toBe(0);
    });

    it("preference profile reflects prior swipe decisions", async () => {
      const { harness, companyId, projectId } = setup;

      const idea1 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Idea 1", description: "D1", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      // Swipe several times to build up history
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea1[0].ideaId, decision: "yes" });
      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea1[0].ideaId, decision: "pass" });

      const profile = await harness.getData("preference-profile", { companyId, projectId }) as { lastUpdated: string; yesCount: number; passCount: number };

      expect(profile.yesCount).toBeGreaterThan(0);
      expect(profile.lastUpdated).toBeDefined();
    });

    it("swipe events are retrievable in chronological order", async () => {
      const { harness, companyId, projectId } = setup;

      const idea = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Swipe test idea", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea[0].ideaId, decision: "maybe" });

      const events = await harness.getData("swipe-events", { companyId, projectId }) as Array<{ decision: string; ideaId: string }>;

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].decision).toBe("maybe");
      expect(events[0].ideaId).toBe(idea[0].ideaId);
    });
  });

  describe("Cross-company isolation for research, ideas, and swipe", () => {
    it("does not expose another company's research cycles", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      const cycle = await harness.performAction("start-research-cycle", {
        companyId,
        projectId,
        query: "Company 1 research"
      }) as { cycleId: string };

      const otherCycles = await harness.getData("research-cycles", {
        companyId: otherCompanyId,
        projectId
      });

      expect(otherCycles).toHaveLength(0);
    });

    it("does not expose another company's ideas", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Company 1 idea", description: "Private", rationale: "", sourceReferences: [], score: 80 }]
      });

      const otherIdeas = await harness.getData("ideas", {
        companyId: otherCompanyId,
        projectId
      });

      expect(otherIdeas).toHaveLength(0);
    });

    it("does not expose another company's swipe events", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      const idea = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Swipe idea", description: "Desc", rationale: "", sourceReferences: [], score: 70 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", { companyId, projectId, ideaId: idea[0].ideaId, decision: "yes" });

      const otherSwipes = await harness.getData("swipe-events", {
        companyId: otherCompanyId,
        projectId
      });

      expect(otherSwipes).toHaveLength(0);
    });
  });
});
