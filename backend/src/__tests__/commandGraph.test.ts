import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";
import { SemanticIntentClassifier } from "../ai/routing/semanticIntentClassifier.js";
import { ToolRegistryService } from "../tools/toolRegistryService.js";
import { PolicyService } from "../policy/policyService.js";
import { ActivityService } from "../activity/activityService.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";

vi.mock("../activity/activityService.js");
vi.mock("../ai/routing/semanticIntentClassifier.js");
vi.mock("../ai/providers/providerRegistry.js");
vi.mock("../sse/eventBus.js", () => ({ publishEvent: vi.fn() }));

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

describe("CommandGraph Flow Tests", () => {
  let fakeDb: FakeFirestore;
  let db: Firestore;
  let commandGraphService: CommandGraphService;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = new FakeFirestore();
    db = asDb(fakeDb);
    commandGraphService = new CommandGraphService(db);

    // Mock ActivityService
    vi.spyOn(ActivityService.prototype, "createEvent").mockResolvedValue({ id: "act_1" } as any);
    
    // Mock ToolRegistryService methods to prevent undefined returns
    vi.spyOn(ToolRegistryService.prototype, "getMissingCapabilities").mockResolvedValue([]);
    vi.spyOn(ToolRegistryService.prototype, "listCapabilities").mockResolvedValue([]);
    
    // Mock PolicyService to prevent missing tool errors
    vi.spyOn(PolicyService.prototype, "assertActionAllowed").mockReturnValue({
      toolName: "mockTool",
      actionType: "mockAction",
      status: "allowed",
      riskLevel: "low",
      requiresApproval: false,
      reason: "Mock policy reason",
    });
    
    // Seed test workspace and user
    fakeDb.seed("workspaces/ws_test", {
      name: "Test Workspace",
      ownerId: "user_test",
      plan: "pro",
      planSource: "system",
      monthlyCreditsLimit: 1000,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    fakeDb.seed("users/user_test", {
      id: "user_test",
      email: "test@example.com",
      displayName: "Test User",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });

  describe("Gideon Expansion: Email Intelligence & Missing Context", () => {
    it("should handle missing context via clarification_needed intent", async () => {
      // Mock the semantic intent classifier to return clarification_needed
      vi.spyOn(SemanticIntentClassifier.prototype, "classify").mockResolvedValue({
        intent: "clarification_needed",
        expertCapabilityId: null,
        integrationParams: null,
        reason: "Which email thread would you like me to draft a reply for?",
      });

      // The graph should use the reason from the classifier or let the LLM generate a response
      // For this test, we just want to ensure it completes and returns a clarification request
      const mockLlm = {
        modelName: "mock-model",
        generateStructured: vi.fn().mockResolvedValue({
          answer: "I need to know which email thread you want to reply to.",
          clarificationQuestion: "Which email thread would you like me to draft a reply for?",
          sections: [],
          missingContext: ["Which email thread would you like me to draft a reply for?"],
          intent: "clarification",
          requestedTools: [],
          requestedCapabilities: []
        }),
        generateText: vi.fn(),
      };
      (createLlmProvider as any).mockReturnValue(mockLlm);

      const currentWorkspaceMock = {
        id: "ws_test",
        workspace: { id: "ws_test", plan: "pro", monthlyCreditsLimit: 1000, monthlyCreditsUsed: 0 },
        member: { role: "owner" },
        role: "owner"
      } as any;

      const result = await commandGraphService.run({
        input: "Draft a reply saying I agree.",
        userId: "user_test",
        currentWorkspace: currentWorkspaceMock,
      });

      expect(result.missingContext).toContain("Which email thread would you like me to draft a reply for?");
      expect(result.resultType).toBe("clarification");
    });
  });

  describe("Workflow Refinement: workflow.generate", () => {
    it("should successfully plan and generate a workflow", async () => {
      // Intent -> workflow_create
      vi.spyOn(SemanticIntentClassifier.prototype, "classify").mockResolvedValue({
        intent: "workflow_create",
        expertCapabilityId: null,
        integrationParams: null,
        reason: "User wants to create a new automation.",
      });

      // Planner LLM
      const mockLlm = {
        modelName: "mock-model",
        generateStructured: vi.fn().mockResolvedValue({
          answer: "I have drafted a workflow for you.",
          sections: [],
          workflowDraft: {
            name: "Monitor and Email",
            triggerType: "schedule",
            steps: [
              { id: "step1", type: "monitor", name: "Monitor Blog", config: { targetType: "url", target: "https://openai.com/blog" }, order: 0 },
              { id: "step2", type: "agent", name: "Summarize", config: { task: "Summarize the changes" }, order: 1 },
              { id: "step3", type: "integration.action", name: "Draft Email", config: { provider: "gmail", operation: "sendEmail" }, order: 2 },
            ]
          },
          requestedTools: ["workflow.generate"],
          requestedCapabilities: [],
          missingContext: [],
          intent: "workflow"
        }),
        generateText: vi.fn(),
      };
      (createLlmProvider as any).mockReturnValue(mockLlm);

      // Mock ToolRegistryService to return a fake workflow tool execution
      vi.spyOn(ToolRegistryService.prototype, "buildToolSet").mockResolvedValue([{
        name: "workflow.generate",
        description: "Generate workflow",
        invoke: async () => ({
          workflowId: "wf_gen_1",
          name: "Monitor and Email",
          triggerType: "schedule",
          stepCount: 3,
        })
      }] as any);

      const currentWorkspaceMock = {
        id: "ws_test",
        workspace: { id: "ws_test", plan: "pro", monthlyCreditsLimit: 1000, monthlyCreditsUsed: 0 },
        member: { role: "owner" },
        role: "owner"
      } as any;

      const result = await commandGraphService.run({
        input: "Create a workflow to monitor OpenAI blog and email me changes.",
        mode: "workflow",
        userId: "user_test",
        currentWorkspace: currentWorkspaceMock,
      });

      expect(result.createdWorkflow).toBeDefined();
      expect(typeof result.createdWorkflow?.workflowId).toBe("string");
      expect(result.createdWorkflow?.name).toBe("Monitor and Email");
      expect(result.createdWorkflow?.stepCount).toBe(3);
      expect(result.resultType).toBe("workflow");
      expect(result.answer).toBe("I have drafted a workflow for you.");
    });
  });
});
