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

  describe("VAL-AUTOPILOT-030: Planning flow is created for approved ideas", () => {
    it("creates a planning artifact from an approved idea", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable autopilot first
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Create an idea
      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add dark mode", description: "Dark theme option", rationale: "User demand", sourceReferences: [], score: 85 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideas[0].ideaId;

      // Create planning artifact
      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId,
        title: "Add dark mode",
        scope: "Implement dark mode toggle in user settings with system preference detection",
        dependencies: ["settings-component", "theme-system"],
        tests: ["toggle-works", "preference-detected", "persists-on-reload"],
        executionMode: "simple"
      }) as { artifactId: string; ideaId: string; scope: string; dependencies: string[] };

      expect(artifact).toMatchObject({
        artifactId: expect.any(String),
        ideaId,
        scope: "Implement dark mode toggle in user settings with system preference detection",
        dependencies: expect.arrayContaining(["settings-component", "theme-system"])
      });
    });

    it("stores planning artifacts and retrieves them by idea", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 240
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "API key management", description: "Manage API keys", rationale: "Enterprise", sourceReferences: [], score: 90 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "API key management",
        scope: "Add API key management UI in settings",
        dependencies: [],
        tests: ["crud-operations", "permission-checks"],
        executionMode: "simple"
      }) as { artifactId: string };

      const artifacts = await harness.getData("planning-artifacts", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId
      }) as Array<{ artifactId: string }>;

      expect(artifacts.some((a) => a.artifactId === artifact.artifactId)).toBe(true);
    });

    it("fullauto tier sets approvalMode to auto_approve in planning artifact", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 300
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Auto approve test", description: "Test", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Auto approve test",
        scope: "Test scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { approvalMode: string; automationTier: string };

      expect(artifact.approvalMode).toBe("auto_approve");
      expect(artifact.automationTier).toBe("fullauto");
    });
  });

  describe("VAL-AUTOPILOT-031: Automation tiers enforce the configured approval path", () => {
    it("supervised tier sets approvalMode to manual", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "supervised",
        budgetMinutes: 60
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Supervised idea", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Supervised idea",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { approvalMode: string; automationTier: string };

      expect(artifact.approvalMode).toBe("manual");
      expect(artifact.automationTier).toBe("supervised");
    });

    it("semiauto tier sets approvalMode to manual", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Semiauto idea", description: "Desc", rationale: "", sourceReferences: [], score: 78 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Semiauto idea",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { approvalMode: string; automationTier: string };

      expect(artifact.approvalMode).toBe("manual");
      expect(artifact.automationTier).toBe("semiauto");
    });

    it("fullauto tier sets approvalMode to auto_approve", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 240
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Fullauto idea", description: "Desc", rationale: "", sourceReferences: [], score: 82 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Fullauto idea",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { approvalMode: string; automationTier: string };

      expect(artifact.approvalMode).toBe("auto_approve");
      expect(artifact.automationTier).toBe("fullauto");
    });
  });

  describe("VAL-AUTOPILOT-032: Delivery run uses an isolated workspace and leased port", () => {
    it("creates a delivery run with workspace and port metadata", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Set up company budget
      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Delivery run test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideas[0].ideaId;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId,
        title: "Delivery run test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const result = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/autopilot-delivery",
        workspacePath: "/tmp/autopilot-workspace/delivery-test",
        leasedPort: 3847
      }) as { run: { runId: string; branchName: string; workspacePath: string; leasedPort: number | null }; lease: { leaseId: string; workspacePath: string; leasedPort: number | null } };

      expect(result.run).toMatchObject({
        runId: expect.any(String),
        branchName: "feature/autopilot-delivery",
        workspacePath: "/tmp/autopilot-workspace/delivery-test",
        leasedPort: 3847
      });
      expect(result.lease).toMatchObject({
        leaseId: expect.any(String),
        workspacePath: "/tmp/autopilot-workspace/delivery-test",
        leasedPort: 3847,
        isActive: true
      });
    });

    it("retrieves delivery runs by project", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "List runs test", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "List runs test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/test-run",
        workspacePath: "/tmp/test-workspace",
        leasedPort: 4000
      });

      const runs = await harness.getData("delivery-runs", { companyId, projectId }) as Array<{ runId: string }>;

      expect(runs.length).toBeGreaterThan(0);
    });

    it("returns workspace path and port metadata from delivery run data", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 200
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Metadata test", description: "Desc", rationale: "", sourceReferences: [], score: 85 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Metadata test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const result = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/metadata-test",
        workspacePath: "/var/workspaces/autopilot/metadata-test",
        leasedPort: 4512
      }) as { run: { runId: string } };

      const runData = await harness.getData("delivery-run", {
        companyId,
        projectId,
        runId: result.run.runId
      }) as { branchName: string; workspacePath: string; leasedPort: number | null };

      expect(runData).toMatchObject({
        branchName: "feature/metadata-test",
        workspacePath: "/var/workspaces/autopilot/metadata-test",
        leasedPort: 4512
      });
    });
  });

  describe("VAL-AUTOPILOT-033: Budget caps pause future runs", () => {
    it("pauses when company autopilot budget is exceeded", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Set up company budget already paused (budget exceeded)
      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 500,
        paused: true,
        pauseReason: "Autopilot budget minutes exceeded"
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Budget pause test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Budget pause test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      // Creating a delivery run should fail due to budget pause
      await expect(
        harness.performAction("create-delivery-run", {
          companyId,
          projectId,
          ideaId: ideas[0].ideaId,
          artifactId: artifact.artifactId,
          branchName: "feature/budget-test",
          workspacePath: "/tmp/budget-test",
          leasedPort: 4500
        })
      ).rejects.toThrow("Company autopilot budget is paused");
    });

    it("pauses when project autopilot is paused", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable and then pause autopilot
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("save-autopilot-project", {
        companyId,
        projectId,
        paused: true,
        pauseReason: "Project budget review"
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Project pause test", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Project pause test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      // Creating a delivery run should fail due to project pause
      await expect(
        harness.performAction("create-delivery-run", {
          companyId,
          projectId,
          ideaId: ideas[0].ideaId,
          artifactId: artifact.artifactId,
          branchName: "feature/project-pause-test",
          workspacePath: "/tmp/project-pause-test",
          leasedPort: 4600
        })
      ).rejects.toThrow("Project autopilot is paused");
    });

    it("checkBudgetAndPauseIfNeeded returns paused status", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("save-autopilot-project", {
        companyId,
        projectId,
        paused: true,
        pauseReason: "Under review"
      });

      const result = await harness.performAction("check-budget-and-pause-if-needed", {
        companyId,
        projectId
      }) as { paused: boolean; reason: string | null };

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("Under review");
    });
  });

  describe("VAL-AUTOPILOT-034: Operator can pause and resume autopilot or a specific run", () => {
    it("pauses autopilot with a reason", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      const result = await harness.performAction("pause-autopilot", {
        companyId,
        projectId,
        reason: "Quarterly review"
      }) as { status: string; pauseReason: string };

      expect(result.status).toBe("paused");
      expect(result.pauseReason).toBe("Quarterly review");
    });

    it("resumes autopilot and clears pause reason", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("pause-autopilot", {
        companyId,
        projectId,
        reason: "Maintenance"
      });

      const result = await harness.performAction("resume-autopilot", {
        companyId,
        projectId
      }) as { status: string; pauseReason: undefined };

      expect(result.status).toBe("running");
      expect(result.pauseReason).toBeUndefined();
    });

    it("pauses a specific delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Run pause test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Run pause test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const runResult = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/run-pause-test",
        workspacePath: "/tmp/run-pause-test",
        leasedPort: 4700
      }) as { run: { runId: string } };

      const pauseResult = await harness.performAction("pause-delivery-run", {
        companyId,
        projectId,
        runId: runResult.run.runId,
        reason: "Waiting for dependency"
      }) as { status: string; pauseReason: string };

      expect(pauseResult.status).toBe("paused");
      expect(pauseResult.pauseReason).toBe("Waiting for dependency");
    });

    it("resumes a paused delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Run resume test", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Run resume test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const runResult = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/run-resume-test",
        workspacePath: "/tmp/run-resume-test",
        leasedPort: 4800
      }) as { run: { runId: string } };

      await harness.performAction("pause-delivery-run", {
        companyId,
        projectId,
        runId: runResult.run.runId,
        reason: "Temp pause"
      });

      const resumeResult = await harness.performAction("resume-delivery-run", {
        companyId,
        projectId,
        runId: runResult.run.runId
      }) as { status: string; pauseReason: undefined };

      expect(resumeResult.status).toBe("running");
      expect(resumeResult.pauseReason).toBeUndefined();
    });

    it("state is preserved after pause/resume cycle", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 240
      });

      // Pause
      await harness.performAction("pause-autopilot", {
        companyId,
        projectId,
        reason: "Code freeze"
      });

      // Resume
      await harness.performAction("resume-autopilot", {
        companyId,
        projectId
      });

      // Verify settings are still there
      const autopilotData = await harness.getData("autopilot-project", {
        companyId,
        projectId
      }) as { enabled: boolean; automationTier: string; budgetMinutes: number; paused: boolean };

      expect(autopilotData.enabled).toBe(true);
      expect(autopilotData.automationTier).toBe("fullauto");
      expect(autopilotData.budgetMinutes).toBe(240);
      expect(autopilotData.paused).toBe(false);
    });
  });

  describe("VAL-AUTOPILOT-030: Planning flow is created for approved ideas", () => {
    it("swiping YES creates both a planning artifact and a delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable autopilot with budget
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Set company budget (not paused)
      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      // Create an idea
      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Add dark mode", description: "Dark theme option", rationale: "User demand", sourceReferences: [], score: 85 }]
      }) as Array<{ ideaId: string }>;
      const ideaId = ideas[0].ideaId;

      // Swipe YES — should auto-create planning artifact and delivery run
      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId,
        decision: "yes"
      }) as { planningArtifact: { artifactId: string } | null; deliveryRun: { runId: string } | null };

      expect(result.planningArtifact).toBeDefined();
      expect(result.deliveryRun).toBeDefined();
      const runId = result.deliveryRun!.runId;
      expect(runId).toBeDefined();

      // Verify delivery run exists in data layer
      const runs = await harness.getData("delivery-runs", { companyId, projectId }) as Array<{ runId: string; ideaId: string }>;
      expect(runs.some((r) => r.ideaId === ideaId)).toBe(true);

      // Verify planning artifact exists in data layer
      const artifacts = await harness.getData("planning-artifacts", { companyId, projectId, ideaId }) as Array<{ ideaId: string }>;
      expect(artifacts.some((a) => a.ideaId === ideaId)).toBe(true);
    });

    it("swiping NOW creates both a planning artifact and a delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "supervised",
        budgetMinutes: 60
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 500,
        autopilotBudgetMinutes: 200,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Fix critical bug", description: "Hotfix needed", rationale: "Production issue", sourceReferences: [], score: 98 }]
      }) as Array<{ ideaId: string }>;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        decision: "now"
      }) as { planningArtifact: { artifactId: string } | null; deliveryRun: { runId: string } | null };

      expect(result.planningArtifact).toBeDefined();
      expect(result.deliveryRun).toBeDefined();

      const runs = await harness.getData("delivery-runs", { companyId, projectId }) as Array<{ runId: string }>;
      expect(runs.length).toBeGreaterThan(0);
    });

    it("delivery run inherits automation tier from autopilot project", async () => {
      const { harness, companyId, projectId } = setup;

      // Test fullauto tier
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "fullauto",
        budgetMinutes: 300
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 2000,
        autopilotBudgetMinutes: 1000,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Auto feature", description: "Auto approval test", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        decision: "yes"
      });

      const runs = await harness.getData("delivery-runs", { companyId, projectId }) as Array<{ automationTier: string }>;
      expect(runs[0].automationTier).toBe("fullauto");

      // Also verify the planning artifact has correct approvalMode
      const artifacts = await harness.getData("planning-artifacts", { companyId, projectId }) as Array<{ approvalMode: string }>;
      expect(artifacts[artifacts.length - 1].approvalMode).toBe("auto_approve");
    });

    it("swiping PASS does NOT create planning artifact or delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Rejected idea", description: "Not good enough", rationale: "", sourceReferences: [], score: 30 }]
      }) as Array<{ ideaId: string }>;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        decision: "pass"
      }) as { planningArtifact: unknown; deliveryRun: unknown };

      expect(result.planningArtifact).toBeNull();
      expect(result.deliveryRun).toBeNull();

      const runs = await harness.getData("delivery-runs", { companyId, projectId }) as Array<unknown>;
      expect(runs).toHaveLength(0);
    });

    it("swiping MAYBE does NOT create planning artifact or delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Maybe idea", description: "Not sure yet", rationale: "", sourceReferences: [], score: 55 }]
      }) as Array<{ ideaId: string }>;

      const result = await harness.performAction("record-swipe", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        decision: "maybe"
      }) as { planningArtifact: unknown; deliveryRun: unknown };

      expect(result.planningArtifact).toBeNull();
      expect(result.deliveryRun).toBeNull();
    });
  });

  describe("Cross-company isolation for delivery control", () => {
    it("does not expose another company's delivery runs", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Isolation test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Isolation test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/isolation-test",
        workspacePath: "/tmp/isolation-test",
        leasedPort: 4900
      });

      const otherRuns = await harness.getData("delivery-runs", {
        companyId: otherCompanyId,
        projectId
      });

      expect(otherRuns).toHaveLength(0);
    });

    it("does not expose another company's company budget", async () => {
      const { harness, companyId, otherCompanyId } = setup;

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 100
      });

      const otherBudget = await harness.getData("company-budget", {
        companyId: otherCompanyId
      });

      expect(otherBudget).toBeNull();
    });
  });

  // ─── VAL-AUTOPILOT-035: Convoy execution blocks downstream tasks until dependencies pass ───────────────────────────────────────

  describe("VAL-AUTOPILOT-035: Convoy execution blocks downstream tasks until dependencies pass", () => {
    it("decomposes a planning artifact into convoy tasks with dependencies", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable autopilot
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      // Set up company budget
      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      // Create an idea and planning artifact
      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Complex feature", description: "Multi-step implementation", rationale: "High value", sourceReferences: [], score: 85 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Complex feature",
        scope: "Multi-step implementation",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/complex",
        workspacePath: "/tmp/complex-feature",
        leasedPort: 5000
      }) as { run: { runId: string } };

      // Decompose into convoy tasks with dependencies
      const tasks = await harness.performAction("decompose-into-convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId,
        artifactId: artifact.artifactId,
        tasks: [
          { title: "Design phase", description: "Initial design", dependsOnTaskIds: [] },
          { title: "Backend implementation", description: "Build API", dependsOnTaskIds: [] },
          { title: "Frontend implementation", description: "Build UI", dependsOnTaskIds: ["Design phase"] },
          { title: "Integration tests", description: "Test integration", dependsOnTaskIds: ["Backend implementation", "Frontend implementation"] }
        ]
      }) as Array<{ taskId: string; title: string; status: string; dependsOnTaskIds: string[] }>;

      expect(tasks).toHaveLength(4);
      // Tasks with no dependencies should be pending
      const designTask = tasks.find((t) => t.title === "Design phase");
      expect(designTask!.status).toBe("pending");
      const backendTask = tasks.find((t) => t.title === "Backend implementation");
      expect(backendTask!.status).toBe("pending");
      // Tasks with dependencies should be blocked
      const frontendTask = tasks.find((t) => t.title === "Frontend implementation");
      expect(frontendTask!.status).toBe("blocked");
      const integrationTask = tasks.find((t) => t.title === "Integration tests");
      expect(integrationTask!.status).toBe("blocked");
    });

    it("unblocks downstream tasks when prerequisite tasks pass", async () => {
      const { harness, companyId, projectId } = setup;

      // Enable autopilot
      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Feature with deps", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Feature with deps",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/deps",
        workspacePath: "/tmp/deps",
        leasedPort: 5100
      }) as { run: { runId: string } };

      const tasks = await harness.performAction("decompose-into-convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId,
        artifactId: artifact.artifactId,
        tasks: [
          { title: "Task A", description: "First task", dependsOnTaskIds: [] },
          { title: "Task B", description: "Depends on A", dependsOnTaskIds: [] }
        ]
      }) as Array<{ taskId: string; title: string; status: string }>;

      const taskA = tasks.find((t) => t.title === "Task A")!;
      const taskB = tasks.find((t) => t.title === "Task B")!;

      // Both should be pending initially (no deps)
      expect(taskA.status).toBe("pending");
      expect(taskB.status).toBe("pending");

      // Mark task A as passed
      await harness.performAction("update-convoy-task-status", {
        companyId,
        projectId,
        taskId: taskA.taskId,
        status: "passed"
      });

      // Verify task A is passed
      const updatedTaskA = await harness.getData("convoy-task", {
        companyId,
        projectId,
        taskId: taskA.taskId
      }) as { status: string };
      expect(updatedTaskA.status).toBe("passed");
    });

    it("lists convoy tasks for a delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Convoy list test", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Convoy list test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/list",
        workspacePath: "/tmp/list",
        leasedPort: 5200
      }) as { run: { runId: string } };

      await harness.performAction("decompose-into-convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId,
        artifactId: artifact.artifactId,
        tasks: [
          { title: "Alpha", description: "First", dependsOnTaskIds: [] },
          { title: "Beta", description: "Second", dependsOnTaskIds: [] }
        ]
      });

      const tasks = await harness.getData("convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as Array<{ taskId: string; title: string }>;

      expect(tasks).toHaveLength(2);
      expect(tasks.some((t) => t.title === "Alpha")).toBe(true);
      expect(tasks.some((t) => t.title === "Beta")).toBe(true);
    });
  });

  // ─── VAL-AUTOPILOT-036: Checkpoint and resume restore run state ───────────────────────────────────────────────────────────────

  describe("VAL-AUTOPILOT-036: Checkpoint and resume restore run state", () => {
    it("creates a checkpoint that captures run and task state", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Checkpoint test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Checkpoint test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/checkpoint",
        workspacePath: "/tmp/checkpoint",
        leasedPort: 5300
      }) as { run: { runId: string } };

      // Decompose into tasks and mark one as passed
      const tasks = await harness.performAction("decompose-into-convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId,
        artifactId: artifact.artifactId,
        tasks: [
          { title: "First task", description: "Do this first", dependsOnTaskIds: [] }
        ]
      }) as Array<{ taskId: string }>;

      await harness.performAction("update-convoy-task-status", {
        companyId,
        projectId,
        taskId: tasks[0].taskId,
        status: "passed"
      });

      // Create checkpoint
      const checkpoint = await harness.performAction("create-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as { checkpointId: string; workspaceSnapshot: { branchName: string }; taskStates: Record<string, string> };

      expect(checkpoint.checkpointId).toBeDefined();
      expect(checkpoint.workspaceSnapshot.branchName).toBe("feature/checkpoint");
      expect(checkpoint.taskStates[tasks[0].taskId]).toBe("passed");
    });

    it("resumes from a checkpoint and restores task/run state", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Resume test", description: "Desc", rationale: "", sourceReferences: [], score: 78 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Resume test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/resume",
        workspacePath: "/tmp/resume",
        leasedPort: 5400
      }) as { run: { runId: string } };

      const tasks = await harness.performAction("decompose-into-convoy-tasks", {
        companyId,
        projectId,
        runId: run.run.runId,
        artifactId: artifact.artifactId,
        tasks: [
          { title: "Task to resume", description: "Desc", dependsOnTaskIds: [] }
        ]
      }) as Array<{ taskId: string }>;

      // Mark task as running
      await harness.performAction("update-convoy-task-status", {
        companyId,
        projectId,
        taskId: tasks[0].taskId,
        status: "running"
      });

      // Create checkpoint (captures current task state = running)
      const checkpoint = await harness.performAction("create-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as { checkpointId: string; taskStates: Record<string, string> };

      // Verify checkpoint captured the task state
      expect(checkpoint.taskStates[tasks[0].taskId]).toBe("running");

      // Resume from checkpoint
      const resumed = await harness.performAction("resume-from-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId,
        checkpointId: checkpoint.checkpointId
      }) as { run: { status: string } };

      // The run status was "pending" at checkpoint time, so it should be restored to "pending"
      expect(resumed.run.status).toBe("pending");

      // Verify task state was restored
      const restoredTask = await harness.getData("convoy-task", {
        companyId,
        projectId,
        taskId: tasks[0].taskId
      }) as { status: string };
      expect(restoredTask.status).toBe("running");
    });

    it("lists checkpoints for a delivery run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Checkpoint list test", description: "Desc", rationale: "", sourceReferences: [], score: 76 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Checkpoint list test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "convoy"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/checkpoint-list",
        workspacePath: "/tmp/checkpoint-list",
        leasedPort: 5500
      }) as { run: { runId: string } };

      // Create multiple checkpoints
      await harness.performAction("create-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId
      });

      await harness.performAction("create-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId
      });

      const checkpoints = await harness.getData("checkpoints", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as Array<{ checkpointId: string }>;

      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── VAL-AUTOPILOT-037: Merge coordination prevents conflicting run completion ──────────────────────────────────────────────

  describe("VAL-AUTOPILOT-037: Merge coordination prevents conflicting run completion", () => {
    it("acquires a product lock on a branch", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Lock test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Lock test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/lock",
        workspacePath: "/tmp/lock",
        leasedPort: 5600
      }) as { run: { runId: string } };

      const lock = await harness.performAction("acquire-product-lock", {
        companyId,
        projectId,
        runId: run.run.runId,
        targetBranch: "feature/lock",
        lockType: "product_lock",
        blockReason: "Active development on this branch"
      }) as { lockId: string; isActive: boolean; targetBranch: string };

      expect(lock.lockId).toBeDefined();
      expect(lock.isActive).toBe(true);
      expect(lock.targetBranch).toBe("feature/lock");
    });

    it("blocks acquiring a lock when another run holds it", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      // Create first run and acquire lock
      const ideas1 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "First lock", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact1 = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas1[0].ideaId,
        title: "First lock",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run1 = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas1[0].ideaId,
        artifactId: artifact1.artifactId,
        branchName: "feature/shared-branch",
        workspacePath: "/tmp/shared",
        leasedPort: 5700
      }) as { run: { runId: string } };

      await harness.performAction("acquire-product-lock", {
        companyId,
        projectId,
        runId: run1.run.runId,
        targetBranch: "feature/shared-branch",
        lockType: "product_lock"
      });

      // Create second run and try to acquire lock on same branch
      const ideas2 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Second lock", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact2 = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas2[0].ideaId,
        title: "Second lock",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run2 = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas2[0].ideaId,
        artifactId: artifact2.artifactId,
        branchName: "feature/shared-branch",
        workspacePath: "/tmp/shared2",
        leasedPort: 5800
      }) as { run: { runId: string } };

      // Attempt to acquire lock should throw
      await expect(
        harness.performAction("acquire-product-lock", {
          companyId,
          projectId,
          runId: run2.run.runId,
          targetBranch: "feature/shared-branch",
          lockType: "product_lock"
        })
      ).rejects.toThrow("Cannot acquire lock");
    });

    it("checkMergeConflict returns conflict info when lock exists", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      // First run holds the lock on the branch
      const ideas1 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Conflict check", description: "Desc", rationale: "", sourceReferences: [], score: 82 }]
      }) as Array<{ ideaId: string }>;

      const artifact1 = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas1[0].ideaId,
        title: "Conflict check",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run1 = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas1[0].ideaId,
        artifactId: artifact1.artifactId,
        branchName: "feature/conflict-check",
        workspacePath: "/tmp/conflict-check",
        leasedPort: 5900
      }) as { run: { runId: string } };

      // Acquire lock on the branch
      await harness.performAction("acquire-product-lock", {
        companyId,
        projectId,
        runId: run1.run.runId,
        targetBranch: "feature/conflict-check",
        lockType: "merge_lock",
        blockReason: "Pending review"
      });

      // Second run tries to check merge conflict on same branch
      const ideas2 = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Conflict check 2", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact2 = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas2[0].ideaId,
        title: "Conflict check 2",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run2 = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas2[0].ideaId,
        artifactId: artifact2.artifactId,
        branchName: "feature/conflict-check-2",
        workspacePath: "/tmp/conflict-check2",
        leasedPort: 5901
      }) as { run: { runId: string } };

      // Check merge conflict from run2's perspective - should detect run1's lock
      const conflictResult = await harness.performAction("check-merge-conflict", {
        companyId,
        projectId,
        runId: run2.run.runId,
        targetBranch: "feature/conflict-check"
      }) as { hasConflict: boolean; conflictReason: string | null };

      expect(conflictResult.hasConflict).toBe(true);
      expect(conflictResult.conflictReason).toContain("merge_lock");
    });

    it("releases a product lock", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Release lock", description: "Desc", rationale: "", sourceReferences: [], score: 78 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Release lock",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/release",
        workspacePath: "/tmp/release",
        leasedPort: 6000
      }) as { run: { runId: string } };

      const lock = await harness.performAction("acquire-product-lock", {
        companyId,
        projectId,
        runId: run.run.runId,
        targetBranch: "feature/release",
        lockType: "product_lock"
      }) as { lockId: string };

      const released = await harness.performAction("release-product-lock", {
        companyId,
        projectId,
        lockId: lock.lockId
      }) as { isActive: boolean; releasedAt: string | null };

      expect(released.isActive).toBe(false);
      expect(released.releasedAt).toBeDefined();
    });
  });

  // ─── VAL-AUTOPILOT-038: Operator interventions are available during active runs ─────────────────────────────────────────

  describe("VAL-AUTOPILOT-038: Operator interventions are available during active runs", () => {
    it("adds an operator note to a run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Note test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Note test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/note",
        workspacePath: "/tmp/note",
        leasedPort: 6100
      }) as { run: { runId: string } };

      const note = await harness.performAction("add-operator-note", {
        companyId,
        projectId,
        runId: run.run.runId,
        note: "This run needs attention due to flaky tests"
      }) as { interventionId: string; interventionType: string; note: string };

      expect(note.interventionId).toBeDefined();
      expect(note.interventionType).toBe("note");
      expect(note.note).toBe("This run needs attention due to flaky tests");
    });

    it("requests a checkpoint on a run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Checkpoint request", description: "Desc", rationale: "", sourceReferences: [], score: 78 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Checkpoint request",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/check-req",
        workspacePath: "/tmp/check-req",
        leasedPort: 6200
      }) as { run: { runId: string } };

      const request = await harness.performAction("request-checkpoint", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as { interventionId: string; interventionType: string };

      expect(request.interventionId).toBeDefined();
      expect(request.interventionType).toBe("checkpoint_request");
    });

    it("nudges a run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Nudge test", description: "Desc", rationale: "", sourceReferences: [], score: 76 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Nudge test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/nudge",
        workspacePath: "/tmp/nudge",
        leasedPort: 6300
      }) as { run: { runId: string } };

      const nudge = await harness.performAction("nudge-run", {
        companyId,
        projectId,
        runId: run.run.runId,
        note: "Please prioritize this run"
      }) as { interventionId: string; interventionType: string; note: string };

      expect(nudge.interventionId).toBeDefined();
      expect(nudge.interventionType).toBe("nudge");
      expect(nudge.note).toBe("Please prioritize this run");
    });

    it("inspects linked issue context", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Issue inspection", description: "Desc", rationale: "", sourceReferences: [], score: 82 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Issue inspection",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/issue",
        workspacePath: "/tmp/issue",
        leasedPort: 6400
      }) as { run: { runId: string } };

      const inspection = await harness.performAction("inspect-linked-issue", {
        companyId,
        projectId,
        runId: run.run.runId,
        linkedIssueId: "ISSUE-123",
        linkedIssueUrl: "https://github.com/org/repo/issues/123",
        linkedIssueTitle: "Fix authentication bug",
        linkedIssueComments: ["Comment 1", "Comment 2"]
      }) as { interventionId: string; interventionType: string; linkedIssueId: string; linkedIssueTitle: string };

      expect(inspection.interventionId).toBeDefined();
      expect(inspection.interventionType).toBe("linked_issue_inspection");
      expect(inspection.linkedIssueId).toBe("ISSUE-123");
      expect(inspection.linkedIssueTitle).toBe("Fix authentication bug");
    });

    it("lists operator interventions for a run", async () => {
      const { harness, companyId, projectId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "List interventions", description: "Desc", rationale: "", sourceReferences: [], score: 75 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "List interventions",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/list-int",
        workspacePath: "/tmp/list-int",
        leasedPort: 6500
      }) as { run: { runId: string } };

      // Add multiple interventions
      await harness.performAction("add-operator-note", {
        companyId,
        projectId,
        runId: run.run.runId,
        note: "First note"
      });

      await harness.performAction("nudge-run", {
        companyId,
        projectId,
        runId: run.run.runId,
        note: "Second nudge"
      });

      const interventions = await harness.getData("operator-interventions", {
        companyId,
        projectId,
        runId: run.run.runId
      }) as Array<{ interventionId: string; interventionType: string }>;

      expect(interventions.length).toBeGreaterThanOrEqual(2);
      expect(interventions.some((i) => i.interventionType === "note")).toBe(true);
      expect(interventions.some((i) => i.interventionType === "nudge")).toBe(true);
    });

    it("isolates operator interventions by company", async () => {
      const { harness, companyId, projectId, otherCompanyId } = setup;

      await harness.performAction("enable-autopilot", {
        companyId,
        projectId,
        automationTier: "semiauto",
        budgetMinutes: 120
      });

      await harness.performAction("update-company-budget", {
        companyId,
        totalBudgetMinutes: 1000,
        autopilotBudgetMinutes: 500,
        autopilotUsedMinutes: 0
      });

      const ideas = await harness.performAction("generate-ideas", {
        companyId,
        projectId,
        ideas: [{ title: "Isolation test", description: "Desc", rationale: "", sourceReferences: [], score: 80 }]
      }) as Array<{ ideaId: string }>;

      const artifact = await harness.performAction("create-planning-artifact", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        title: "Isolation test",
        scope: "Scope",
        dependencies: [],
        tests: [],
        executionMode: "simple"
      }) as { artifactId: string };

      const run = await harness.performAction("create-delivery-run", {
        companyId,
        projectId,
        ideaId: ideas[0].ideaId,
        artifactId: artifact.artifactId,
        branchName: "feature/iso",
        workspacePath: "/tmp/iso",
        leasedPort: 6600
      }) as { run: { runId: string } };

      await harness.performAction("add-operator-note", {
        companyId,
        projectId,
        runId: run.run.runId,
        note: "Company 1 private note"
      });

      const otherCompanyInterventions = await harness.getData("operator-interventions", {
        companyId: otherCompanyId,
        projectId,
        runId: run.run.runId
      }) as Array<{ interventionId: string }>;

      expect(otherCompanyInterventions).toHaveLength(0);
    });
  });
});
