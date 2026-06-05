import { randomUUID } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import { invalidateCachedCommandSessions } from "../cache/requestStateCache.js";
import { MemoryService } from "../memory/memoryService.js";
import { logger } from "../observability/logger.js";
import { CommandSessionRepository } from "../repositories/commandSessionRepository.js";
import type {
  CommandSession,
  CommandSessionMessage,
  CommandSessionMode,
  MemoryNodeType,
  SourceRef,
} from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { RetrievalService } from "../services/retrievalService.js";
import { IndexingLifecycleService } from "../ai/indexing/indexingLifecycleService.js";
import { ApiError } from "../utils/apiError.js";

const compressionOutputSchema = z.object({
  summary: z.string().describe("2-4 sentence summary of what was accomplished in this session"),
  stableFacts: z.array(z.string()).describe("Key facts established that are unlikely to change"),
  openLoops: z.array(z.string()).describe("Unresolved questions or tasks that were raised but not completed"),
  preferences: z.array(z.string()).describe("User preferences or working style observations"),
  referencedArtifacts: z.array(z.string()).optional().describe("Titles of artifacts created or referenced in this session"),
  referencedWorkflows: z.array(z.string()).optional().describe("Names of workflows created or discussed in this session"),
});

const memoryExtractionSchema = z.object({
  nodes: z.array(
    z.object({
      type: z.enum(["fact", "preference", "pattern", "contact", "decision"]),
      content: z.string().max(500).describe("Concise statement of the memory, max 500 chars"),
    }),
  ).max(8).describe("Up to 8 high-value memory nodes extracted from this session"),
});

type SessionCreateFallback = {
  firstQuery: string;
  mode: CommandSessionMode;
  source?: "web" | "email" | "whatsapp" | "api" | "slack";
};

// Shape of CommandResponse fields we use here — avoids importing the full graph output type
type CommandResponseLike = {
  answer?: string | null;
  sources?: Array<{ sourceId: string; sourceType: string; [key: string]: unknown }>;
  createdArtifact?: { artifactId: string } | null;
};

function getExpiryDays(plan: "free" | "plus" | "pro"): number {
  return plan === "pro" ? 365 : plan === "plus" ? 90 : 30;
}

function toSessionMode(mode: string | undefined | null): CommandSessionMode {
  if (!mode || mode === "auto") return "default";
  if (mode === "extract_url") return "extract";
  if (mode === "search" || mode === "research" || mode === "workflow" || mode === "extract") {
    return mode as CommandSessionMode;
  }
  return "default";
}

export class CommandSessionService {
  private readonly repo: CommandSessionRepository;

  constructor(private readonly db: Firestore) {
    this.repo = new CommandSessionRepository(db);
  }

  async getOrCreate(
    workspace: CurrentWorkspace,
    sessionId: string | null | undefined,
    fallback: SessionCreateFallback,
  ): Promise<CommandSession> {
    if (sessionId) {
      const existing = await this.repo.get(workspace.id, sessionId);
      if (!existing || existing.workspaceId !== workspace.id) {
        throw new ApiError({
          code: "SESSION_NOT_FOUND_OR_NOT_ACCESSIBLE",
          message: "Session not found or not accessible.",
          status: 403,
        });
      }
      return existing;
    }

    const expiryDays = getExpiryDays(workspace.workspace.plan);
    const expiresAt = Timestamp.fromMillis(Date.now() + expiryDays * 86_400_000);

    return this.repo.create(workspace.id, {
      id: randomUUID(),
      workspaceId: workspace.id,
      title: fallback.firstQuery.slice(0, 60),
      mode: fallback.mode,
      source: fallback.source ?? "web",
      status: "active",
      pinned: false,
      bookmarked: false,
      firstQuery: fallback.firstQuery,
      lastMessagePreview: "",
      turnCount: 0,
      artifactIds: [],
      sourceRefs: [],
      expiresAt,
    });
  }

  async appendUserMessage(
    workspace: CurrentWorkspace,
    sessionId: string,
    query: string,
    mode: CommandSessionMode,
    agentId?: string | null,
    source: "web" | "email" | "whatsapp" | "api" | "slack" = "web",
  ) {
    return this.repo.appendMessage(workspace.id, sessionId, {
      id: randomUUID(),
      role: "user",
      content: query,
      mode,
      source,
      ...(agentId ? { agentId } : {}),
      sourceRefs: [],
      artifactIds: [],
      starredByUserIds: [],
    });
  }

  async appendAssistantMessage(
    workspace: CurrentWorkspace,
    sessionId: string,
    response: CommandResponseLike,
    mode: CommandSessionMode,
    agentId?: string | null,
    agentName?: string | null,
    source: "web" | "email" | "whatsapp" | "api" | "slack" = "web",
  ) {
    const artifactIds = response.createdArtifact ? [response.createdArtifact.artifactId] : [];
    const sourceRefs: SourceRef[] = Array.isArray(response.sources) ? (response.sources as SourceRef[]) : [];

    return this.repo.appendMessage(workspace.id, sessionId, {
      id: randomUUID(),
      role: "assistant",
      content: response.answer ?? "",
      responseJson: JSON.stringify(response),
      mode,
      source,
      ...(agentId ? { agentId } : {}),
      ...(agentName ? { agentName } : {}),
      sourceRefs,
      artifactIds,
      starredByUserIds: [],
    });
  }

  async finalizeSession(
    workspace: CurrentWorkspace,
    sessionId: string,
    response: CommandResponseLike,
    currentSession: CommandSession,
  ): Promise<void> {
    const preview = (response.answer ?? "").slice(0, 160);
    const newArtifactIds = response.createdArtifact ? [response.createdArtifact.artifactId] : [];
    const newSourceRefs: SourceRef[] = Array.isArray(response.sources) ? (response.sources as SourceRef[]) : [];

    const mergedArtifactIds = Array.from(new Set([...currentSession.artifactIds, ...newArtifactIds]));
    const existingSourceIds = new Set(currentSession.sourceRefs.map((s) => s.sourceId));
    const mergedSourceRefs = [
      ...currentSession.sourceRefs,
      ...newSourceRefs.filter((s) => !existingSourceIds.has(s.sourceId)),
    ];

    await this.repo.update(workspace.id, sessionId, {
      lastMessagePreview: preview,
      turnCount: currentSession.turnCount + 1,
      artifactIds: mergedArtifactIds,
      sourceRefs: mergedSourceRefs,
    });
    invalidateCachedCommandSessions(workspace.id);
  }

  async buildSessionContext(workspace: CurrentWorkspace, sessionId: string): Promise<string> {
    const [messages, session] = await Promise.all([
      this.repo.getMessages(workspace.id, sessionId, 24),
      this.repo.get(workspace.id, sessionId),
    ]);
    if (messages.length === 0) return "";

    // Derive metadata from all fetched messages
    type ArtifactRef = { id: string; title: string; type: string };
    type WorkflowRef = { id: string; name: string; trigger: string };
    type ApprovalRef = { id: string; label: string };

    const artifactRefs: ArtifactRef[] = [];
    const workflowRefs: WorkflowRef[] = [];
    const approvalRefs: ApprovalRef[] = [];
    const modesUsed = new Set<string>();
    const agentsUsed = new Map<string, string>();

    for (const msg of messages) {
      if (msg.mode && msg.mode !== "default") modesUsed.add(msg.mode);
      if (msg.agentId && msg.agentName) agentsUsed.set(msg.agentId, msg.agentName);

      if (msg.role === "assistant" && msg.responseJson) {
        try {
          const resp = JSON.parse(msg.responseJson) as Record<string, unknown>;

          if (resp.createdArtifact && typeof resp.createdArtifact === "object") {
            const a = resp.createdArtifact as Record<string, unknown>;
            if (typeof a.artifactId === "string" && typeof a.title === "string") {
              if (!artifactRefs.some((r) => r.id === a.artifactId)) {
                artifactRefs.push({ id: a.artifactId, title: a.title, type: (a.artifactType as string) ?? "document" });
              }
            }
          }

          if (resp.createdWorkflow && typeof resp.createdWorkflow === "object") {
            const w = resp.createdWorkflow as Record<string, unknown>;
            if (typeof w.workflowId === "string" && typeof w.name === "string") {
              if (!workflowRefs.some((r) => r.id === w.workflowId)) {
                workflowRefs.push({ id: w.workflowId, name: w.name, trigger: (w.triggerType as string) ?? "manual" });
              }
            }
          }

          if (resp.createdApproval && typeof resp.createdApproval === "object") {
            const ap = resp.createdApproval as Record<string, unknown>;
            if (typeof ap.approvalId === "string" && typeof ap.label === "string") {
              if (!approvalRefs.some((r) => r.id === ap.approvalId)) {
                approvalRefs.push({ id: ap.approvalId, label: ap.label });
              }
            }
          }
        } catch {
          // malformed responseJson — skip
        }
      }
    }

    const lines: string[] = [];
    lines.push("=== CURRENT SESSION CONTEXT ===");

    // Session metadata header
    const turnCount = session?.turnCount ?? messages.length;
    const metaParts: string[] = [`turns: ${turnCount}`];
    if (modesUsed.size > 0) metaParts.push(`modes: ${Array.from(modesUsed).join(", ")}`);
    if (agentsUsed.size > 0) metaParts.push(`agents: ${Array.from(agentsUsed.values()).join(", ")}`);
    lines.push(`Session: ${metaParts.join(" | ")}`);
    lines.push("");

    // Compressed summary block
    if (session?.compressedContext) {
      try {
        const parsed = compressionOutputSchema.parse(JSON.parse(session.compressedContext));
        lines.push("Session summary:");
        lines.push(parsed.summary);
        if (parsed.stableFacts.length) {
          lines.push(`Key facts: ${parsed.stableFacts.join("; ")}`);
        }
        if (parsed.openLoops.length) {
          lines.push("Open loops:");
          for (const loop of parsed.openLoops) lines.push(`  - ${loop}`);
        }
        if (parsed.preferences.length) {
          lines.push(`Preferences noted: ${parsed.preferences.join("; ")}`);
        }
        lines.push("");
      } catch {
        lines.push("Session summary:");
        lines.push(session.compressedContext.slice(0, 500));
        lines.push("");
      }
    }

    // Artifacts created in this session
    if (artifactRefs.length > 0) {
      lines.push("Artifacts created in this session:");
      for (const a of artifactRefs) {
        lines.push(`  - "${a.title}" [${a.type}] (id: ${a.id})`);
      }
      lines.push("");
    }

    // Workflows created in this session
    if (workflowRefs.length > 0) {
      lines.push("Workflows created in this session:");
      for (const w of workflowRefs) {
        lines.push(`  - "${w.name}" [trigger: ${w.trigger}] (id: ${w.id})`);
      }
      lines.push("");
    }

    // Pending approvals from this session
    if (approvalRefs.length > 0) {
      lines.push("Approvals pending in this session:");
      for (const ap of approvalRefs) {
        lines.push(`  - "${ap.label}" — pending`);
      }
      lines.push("");
    }

    // Recent turns — last 8 messages, assistant trimmed to 300 chars (except last assistant message, kept to 3000)
    const recentMessages = messages.slice(-8);
    lines.push("Recent turns:");
    let lastAssistantIdx = -1;
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      if (recentMessages[i].role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    
    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      if (msg.role === "user") {
        lines.push(`User: ${msg.content}`);
      } else {
        const isLastAssistant = i === lastAssistantIdx;
        lines.push(`Gideon: ${isLastAssistant ? msg.content.slice(0, 3000) : msg.content.slice(0, 300)}`);
      }
    }

    lines.push("=== END SESSION CONTEXT ===");

    return lines.join("\n");
  }

  async listRecent(
    workspace: CurrentWorkspace,
    limit = 20,
    sourceFilter: "web" | "email" | "whatsapp" | "api" | "slack" | null = null,
  ): Promise<CommandSession[]> {
    const sessions = await this.repo.list(workspace.id, limit + 20);
    return sessions
      .filter((s) => s.status === "active")
      .filter((s) => (sourceFilter ? s.source === sourceFilter : true))
      .slice(0, limit);
  }

  async getWithMessages(
    workspace: CurrentWorkspace,
    sessionId: string,
  ): Promise<{ session: CommandSession; messages: CommandSessionMessage[] }> {
    const session = await this.repo.get(workspace.id, sessionId);
    if (!session || session.workspaceId !== workspace.id) {
      throw new ApiError({
        code: "SESSION_NOT_FOUND_OR_NOT_ACCESSIBLE",
        message: "Session not found or not accessible.",
        status: 403,
      });
    }
    const messages = await this.repo.getMessages(workspace.id, sessionId);
    return { session, messages };
  }

  async update(
    workspace: CurrentWorkspace,
    sessionId: string,
    updates: { title?: string; pinned?: boolean; bookmarked?: boolean; status?: "active" | "archived" },
  ): Promise<void> {
    const existing = await this.repo.get(workspace.id, sessionId);
    if (!existing || existing.workspaceId !== workspace.id) {
      throw new ApiError({
        code: "SESSION_NOT_FOUND_OR_NOT_ACCESSIBLE",
        message: "Session not found or not accessible.",
        status: 403,
      });
    }
    await this.repo.update(workspace.id, sessionId, updates);
    invalidateCachedCommandSessions(workspace.id);
  }

  async starAssistantMessage(
    workspace: CurrentWorkspace,
    sessionId: string,
    messageId: string,
    userId: string,
  ): Promise<boolean> {
    const message = await this.repo.getMessage(workspace.id, sessionId, messageId);
    if (!message || message.role !== "assistant") {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Assistant message not found.",
        status: 404,
      });
    }

    if (message.starredByUserIds.includes(userId)) {
      return true;
    }

    await this.repo.updateMessage(workspace.id, sessionId, messageId, {
      starredByUserIds: [...message.starredByUserIds, userId],
    });
    return true;
  }

  async unstarAssistantMessage(
    workspace: CurrentWorkspace,
    sessionId: string,
    messageId: string,
    userId: string,
  ): Promise<boolean> {
    const message = await this.repo.getMessage(workspace.id, sessionId, messageId);
    if (!message || message.role !== "assistant") {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Assistant message not found.",
        status: 404,
      });
    }

    if (!message.starredByUserIds.includes(userId)) {
      return false;
    }

    await this.repo.updateMessage(workspace.id, sessionId, messageId, {
      starredByUserIds: message.starredByUserIds.filter((id) => id !== userId),
    });
    return false;
  }

  async summarizeIfNeeded(workspace: CurrentWorkspace, sessionId: string): Promise<void> {
    const session = await this.repo.get(workspace.id, sessionId);
    if (!session) return;
    if (session.compressedContext || session.summaryStatus === "completed") return;
    if (session.summaryStatus === "queued") return; // already in progress
    if ((session.summaryAttempts ?? 0) >= 3) return; // permanent failure ceiling
    if (session.turnCount < 10) return;

    // Mark in-progress to prevent concurrent duplicate attempts
    await this.repo.update(workspace.id, sessionId, { summaryStatus: "queued" });

    try {
      const messages = await this.repo.getMessages(workspace.id, sessionId, 30);
      if (messages.length < 6) {
        await this.repo.update(workspace.id, sessionId, { summaryStatus: "idle" });
        return;
      }

      const conversationText = messages
        .map((m) => `${m.role === "user" ? "User" : "Gideon"}: ${m.content.slice(0, 600)}`)
        .join("\n\n");

      const llm = createLlmProvider("fast");
      const result = await llm.generateStructured({
        schema: compressionOutputSchema,
        systemPrompt:
          "You are a session summarizer for Gideon, an AI chief of staff. Compress a conversation into structured memory fields. Be concise and factual. Fewer, sharper entries are better than many vague ones. If any artifacts (documents, reports, briefs) were created or explicitly named, list their titles in referencedArtifacts. If any workflows were created or named, list them in referencedWorkflows.",
        userPrompt: `Compress the following session conversation:\n\n${conversationText}`,
      });

      await this.repo.update(workspace.id, sessionId, {
        compressedContext: JSON.stringify(result),
        summaryStatus: "completed",
      });

      logger.info("session compressed", { sessionId, workspaceId: workspace.id, turnCount: session.turnCount });

      // B5: index session summary for vector retrieval
      void new RetrievalService(this.db).indexSessionSummary(
        workspace.id,
        sessionId,
        session.title,
        result.summary,
      );

      // Phase 2: parallel dual-write to unified IndexedSources store
      void new IndexingLifecycleService(this.db).onSessionSummarized({
        workspaceId: workspace.id,
        sessionId,
        title: session.title,
        summary: result.summary,
        plan: workspace.workspace.plan,
      });

      // B7: extract and promote memory nodes (fire-and-forget)
      void this.promoteMemoriesFromCompression(workspace.id, sessionId, conversationText);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.repo.update(workspace.id, sessionId, {
        summaryStatus: "failed",
        summaryAttempts: (session.summaryAttempts ?? 0) + 1,
        lastSummaryError: errorMessage,
        lastSummaryAttemptAt: Timestamp.now(),
      });
      logger.warn("session compression failed", {
        sessionId,
        workspaceId: workspace.id,
        attempt: (session.summaryAttempts ?? 0) + 1,
        error: errorMessage,
      });
    }
  }

  private async promoteMemoriesFromCompression(
    workspaceId: string,
    sessionId: string,
    conversationText: string,
  ): Promise<void> {
    try {
      const llm = createLlmProvider("fast");
      const result = await llm.generateStructured({
        schema: memoryExtractionSchema,
        systemPrompt:
          "You are a memory extractor for a business AI assistant. Extract high-value, durable facts from the conversation that would help the AI be more useful in future sessions. Focus on facts about the user's business, preferences, contacts, or key decisions. Skip transient details and conversational filler. Return only information worth remembering long-term.",
        userPrompt: `Extract memory nodes from this session:\n\n${conversationText.slice(0, 4000)}`,
      });

      const memoryService = new MemoryService(this.db);
      let promoted = 0;
      for (const node of result.nodes) {
        const created = await memoryService.createFromPromotion(workspaceId, {
          type: node.type as MemoryNodeType,
          content: node.content,
          source: "session",
          sourceId: sessionId,
        });
        if (created) promoted++;
      }
      logger.info("memory promotion complete", { workspaceId, sessionId, promoted, total: result.nodes.length });
    } catch (err) {
      logger.warn("memory promotion from compression failed", {
        workspaceId,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export { toSessionMode };
