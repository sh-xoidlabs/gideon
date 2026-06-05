import { competitorBattlecardSchema } from "./schemas/competitorBattlecard.js";
import { contactBriefSchema } from "./schemas/contactBrief.js";
import { opportunityScorecardSchema } from "./schemas/opportunityScorecard.js";
import { outreachDraftSchema } from "./schemas/outreachDraft.js";
import { preCallBriefSchema } from "./schemas/preCallBrief.js";
import { signalRadarSchema } from "./schemas/signalRadar.js";
import { documentAnalysisSchema } from "./schemas/documentAnalysis.js";
import { salesIntelligenceSchema } from "./schemas/salesIntelligence.js";
import { accountSnapshotSchema } from "./schemas/accountSnapshot.js";
import { pipelineHealthSchema } from "./schemas/pipelineHealth.js";
import { dealRiskSchema } from "./schemas/dealRisk.js";
import { meetingSummarySchema } from "./schemas/meetingSummary.js";
import type { ExpertRegistryEntry, ExpertTypeId } from "./types.js";

export const expertRegistry: Record<ExpertTypeId, ExpertRegistryEntry> = {
  contact_brief: {
    expertType: "contact_brief",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales"],
    rendererKey: "contact-brief-card",
    schema: contactBriefSchema,
    triggerExamples: ["brief this lead", "analyze this contact", "what should I know about this account"],
    routingHints: [
      {
        intentKeywords: ["lead", "contact", "account", "buyer", "prospect", "brief", "analyze", "analyse"],
        selectedItemProviders: ["hubspot"],
        selectedItemTypes: ["contacts", "companies"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["hubspot_record", "company_or_person_details"],
    preferredIntegrations: ["hubspot", "gmail"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: true,
  },
  pre_call_brief: {
    expertType: "pre_call_brief",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales"],
    rendererKey: "pre-call-brief-card",
    schema: preCallBriefSchema,
    triggerExamples: ["prep me for this call", "how should I open this meeting", "coach me for this prospect call"],
    routingHints: [
      {
        intentKeywords: ["call", "meeting", "prep", "pre-call", "precall", "discovery", "objection"],
        selectedItemProviders: ["hubspot", "gmail"],
        selectedItemTypes: ["contacts", "companies", "deals", "email_thread"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["hubspot_record", "gmail_thread", "company_or_person_details"],
    preferredIntegrations: ["hubspot", "gmail"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: false,
  },
  opportunity_scorecard: {
    expertType: "opportunity_scorecard",
    expertGroup: "opportunity_analysis",
    mappedAgents: ["sales", "executive"],
    rendererKey: "opportunity-scorecard",
    schema: opportunityScorecardSchema,
    triggerExamples: ["analyze this deal", "is this a good opportunity", "what should we do next on this deal"],
    routingHints: [
      {
        intentKeywords: ["deal", "opportunity", "renewal", "pipeline", "account", "score", "why now", "next step"],
        selectedItemProviders: ["hubspot"],
        selectedItemTypes: ["deals", "companies", "contacts"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["hubspot_record", "company_or_person_details"],
    preferredIntegrations: ["hubspot", "gmail"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "uses_existing_approval_flows",
    canSuggestWorkflow: true,
  },
  outreach_draft: {
    expertType: "outreach_draft",
    expertGroup: "outreach_messaging",
    mappedAgents: ["sales", "operations", "customer"],
    rendererKey: "outreach-draft-card",
    schema: outreachDraftSchema,
    triggerExamples: ["draft a follow-up", "write a reply", "give me an outreach email"],
    routingHints: [
      {
        intentKeywords: ["draft", "reply", "follow up", "follow-up", "outreach", "email", "message"],
        selectedItemProviders: ["gmail", "hubspot"],
        selectedItemTypes: ["email_thread", "contacts", "companies", "deals"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["gmail_thread", "hubspot_record", "company_or_person_details"],
    preferredIntegrations: ["gmail", "hubspot"],
    artifactBehavior: "save_on_request",
    approvalBehavior: "uses_existing_approval_flows",
    canSuggestWorkflow: false,
  },
  competitor_battlecard: {
    expertType: "competitor_battlecard",
    expertGroup: "market_research",
    mappedAgents: ["research", "sales", "executive"],
    rendererKey: "competitor-battlecard",
    schema: competitorBattlecardSchema,
    triggerExamples: ["compare us to this competitor", "build a battlecard", "what are their weaknesses"],
    routingHints: [
      {
        intentKeywords: ["competitor", "battlecard", "compare", "positioning", "vs", "weakness", "attack angle"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["web_research_context"],
    preferredIntegrations: [],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: true,
  },
  signal_radar: {
    expertType: "signal_radar",
    expertGroup: "market_research",
    mappedAgents: ["research", "sales", "executive"],
    rendererKey: "signal-radar-card",
    schema: signalRadarSchema,
    triggerExamples: ["what signals matter here", "what changed in this market", "scan for business signals"],
    routingHints: [
      {
        intentKeywords: ["signal", "what changed", "market move", "watch", "monitor", "trend", "why now"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["web_research_context"],
    preferredIntegrations: [],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: true,
  },
  document_analysis: {
    expertType: "document_analysis",
    expertGroup: "market_research",
    mappedAgents: ["executive", "sales", "research", "operations", "customer", "recruiting"],
    rendererKey: "expert-result-renderer",
    schema: documentAnalysisSchema,
    triggerExamples: ["summarize this document", "analyze this contract", "what does the report say"],
    routingHints: [
      {
        intentKeywords: ["document", "contract", "file", "pdf", "report", "agreement", "deck", "presentation", "memo"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: [],
    preferredIntegrations: [],
    artifactBehavior: "save_on_request",
    approvalBehavior: "none",
    canSuggestWorkflow: false,
  },
  sales_intelligence: {
    expertType: "sales_intelligence",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales", "research"],
    rendererKey: "sales-intelligence-card",
    schema: salesIntelligenceSchema,
    triggerExamples: ["tell me about this company", "sales intel on this prospect", "what is their tech stack"],
    routingHints: [
      {
        intentKeywords: ["sales intel", "intelligence", "tech stack", "firmographics", "company intel"],
        selectedItemProviders: ["hubspot"],
        selectedItemTypes: ["companies"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["company_or_person_details"],
    preferredIntegrations: ["hubspot"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: true,
  },
  account_snapshot: {
    expertType: "account_snapshot",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales", "executive"],
    rendererKey: "account-snapshot-card",
    schema: accountSnapshotSchema,
    triggerExamples: ["give me a snapshot of this account", "account health", "what's the latest on this account"],
    routingHints: [
      {
        intentKeywords: ["snapshot", "account health", "latest activity", "crm status"],
        selectedItemProviders: ["hubspot"],
        selectedItemTypes: ["companies", "contacts", "deals"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["hubspot_record"],
    preferredIntegrations: ["hubspot"],
    artifactBehavior: "save_on_request",
    approvalBehavior: "none",
    canSuggestWorkflow: false,
  },
  pipeline_health: {
    expertType: "pipeline_health",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales", "executive"],
    rendererKey: "pipeline-health-card",
    schema: pipelineHealthSchema,
    triggerExamples: ["how is my pipeline", "pipeline health", "show me my deals"],
    routingHints: [
      {
        intentKeywords: ["pipeline", "funnel", "deal flow", "forecast"],
        selectedItemProviders: ["hubspot"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: [],
    preferredIntegrations: ["hubspot"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "none",
    canSuggestWorkflow: true,
  },
  deal_risk: {
    expertType: "deal_risk",
    expertGroup: "opportunity_analysis",
    mappedAgents: ["sales", "executive"],
    rendererKey: "deal-risk-card",
    schema: dealRiskSchema,
    triggerExamples: ["is this deal at risk", "what are the risks here", "deal risk analysis"],
    routingHints: [
      {
        intentKeywords: ["risk", "at risk", "deal risk", "red flags"],
        selectedItemProviders: ["hubspot"],
        selectedItemTypes: ["deals"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["hubspot_record"],
    preferredIntegrations: ["hubspot"],
    artifactBehavior: "suggest_save",
    approvalBehavior: "uses_existing_approval_flows",
    canSuggestWorkflow: true,
  },
  meeting_summary: {
    expertType: "meeting_summary",
    expertGroup: "revenue_intelligence",
    mappedAgents: ["sales", "executive", "operations", "customer"],
    rendererKey: "meeting-summary-card",
    schema: meetingSummarySchema,
    triggerExamples: ["summarize my last meeting", "meeting notes", "action items from the call"],
    routingHints: [
      {
        intentKeywords: ["meeting", "summary", "notes", "action items", "decisions", "follow-ups"],
        selectedItemProviders: ["gmail", "hubspot"],
        selectedItemTypes: ["email_thread", "contacts", "companies", "deals"],
        prefersModes: ["auto", "search", "research"],
      },
    ],
    requiredContext: ["gmail_thread", "hubspot_record", "company_or_person_details"],
    preferredIntegrations: ["gmail", "hubspot"],
    artifactBehavior: "save_on_request",
    approvalBehavior: "uses_existing_approval_flows",
    canSuggestWorkflow: true,
  },
};

