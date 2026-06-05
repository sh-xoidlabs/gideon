# Gideon

**AI Chief of Staff for founders and operators.**

Gideon is a workspace-based operating layer — not a chatbot. It gives founders a single command surface to research, draft, automate, and act across Gmail, HubSpot, and other tools, with every external write routed through a human approval gate before execution. The intelligence layer is built on LangGraph with provider-swappable LLMs, a dynamic capability manifest, and a structured memory system that learns from every session.

---

## Product Surfaces

| Surface | Route | Purpose |
|---------|-------|---------|
| **Command Center** | `/` | Primary interface — conversational commands with structured AI responses, inline approvals, session continuity |
| **Agents** | `/agents` | Six specialist assistants (Executive, Sales, Research, Operations, Customer, Recruiting) — each with scoped tools, behavior rules, and output formats |
| **Workflows** | `/workflows` | Prebuilt and custom automations — scheduled or manual triggers, step-level execution tracing, visual canvas editor |
| **Approvals** | `/approvals` | Every external write (email, CRM update, Slack message) lands here — review, edit, approve, or reject before Gideon acts |
| **Library** | `/library` | Agent-generated artifacts — reports, briefs, drafts — with source attribution and freshness metadata |
| **Memory & Knowledge** | `/context` | Workspace facts, user preferences, and patterns extracted from sessions, confirmed by the user |
| **Integrations** | `/integrations` | Connect Gmail and HubSpot — each with a dedicated 3-pane workspace UI for reading and acting on records |
| **Settings** | `/settings` | Profile, workspace, members, billing (coupon-code upgrades), security, and appearance |

---

## Architecture

```
frontend/   Next.js 15 · React 19 · TypeScript · Tailwind · shadcn/ui
backend/    Node.js · Express 5 · TypeScript · LangGraph · Firebase Admin
worker/     Separate runtime process (backend/src/worker.ts)
```

### AI Intelligence Layer

All LLM calls are contained in `backend/src/ai/`. No raw SDK calls outside that boundary.

```
CommandGraphService (LangGraph StateGraph)
  ├── classify      Mode resolution: auto / search / research / extract_url / workflow
  ├── context       RAG retrieval + session history + Gideon capability manifest
  ├── tool          Web research (Parallel Task API) or URL extraction (Parallel Extract API)
  ├── plan          Structured plan generation against CommandPlan Zod schema
  ├── guard         Safety check, policy enforcement, approval routing
  └── output        Result assembly, artifact persistence, approval creation, activity logging
```

**Sub-modules:**

| Module | Purpose |
|--------|---------|
| `ai/providers/` | Swappable LLM and embedding adapters (`ParallelLlmProvider`, `OpenAILlmProvider`, `OpenAIEmbeddingProvider`) |
| `ai/manifests/` | `GideonManifestService` — builds a real-time capability manifest injected into every planner prompt (connected integrations, active workflows, pending approvals, plan tier) |
| `ai/prompts/` | `CommandPromptPackage` — composable prompt builder; base persona + SOP injections + workspace context |
| `ai/sops/` | `SopRegistryService` — semantic retrieval of operating procedures matched to the user's intent |
| `ai/context/` | `WorkspaceContextService` — assembles user profile, integration status, agent list, and workspace state |
| `ai/retrieval/` | `RetrievalService` — Firestore vector search across artifacts, memory, and compressed session summaries |
| `ai/safety/` | Safety classification and approval routing |
| `ai/agents/` | Per-agent graph node configurations |
| `ai/embeddings/` | Embedding pipeline via LangChain `Embeddings` abstraction |

**LLM Providers** (controlled by `LLM_PROVIDER` env var):

| Role | Default | Fallback |
|------|---------|----------|
| Planning & orchestration | Parallel Chat (`speed`) | OpenAI `gpt-4o` |
| Mode classification | Parallel Chat (`speed`) | OpenAI `gpt-4o` |
| Web research | Parallel Task API | — |
| URL extraction | Parallel Extract API | — |
| Embeddings | OpenAI `text-embedding-3-small` | — |

### Backend Services

| Service | Responsibility |
|---------|---------------|
| `CommandGraphService` | LangGraph command execution engine |
| `GideonManifestService` | Real-time capability manifest builder |
| `WorkspaceContextService` | Context assembly — user profile, integrations, agents |
| `CommandSessionService` | Session lifecycle, compression, memory promotion |
| `RetrievalService` | Vector search across workspace knowledge |
| `ApprovalService` | Create / edit / approve / reject with full state machine |
| `ArtifactService` | Artifact storage with source refs and freshness tracking |
| `WorkflowService` | Workflow CRUD, activation, step execution, run state |
| `JobLockService` | Firestore-backed job queue — transactional claiming, deduplication, QStash webhook delivery |
| `MemoryService` | Workspace memory nodes — dedup, `needs_review` lifecycle, user confirmation |
| `PolicyService` | Risk classification and approval routing |
| `UsageService` | Credit tracking, hourly rate limits, plan-tier enforcement |
| `IntegrationService` | OAuth flows, AES-256 encrypted token storage, delta sync |
| `SopRegistryService` | Semantic SOP retrieval — matched to intent, injected into planner |

### Worker

A separate Node.js process (`backend/src/worker.ts`) that:

- Receives jobs via **Upstash QStash webhooks** (signed, verified) — no polling in production
- Falls back to Firestore polling in local dev when QStash is not configured
- Processes: `run_workflow`, `run_agent`, `send_notification`, `sync_integration`, `gmail_delta_sync`, `hubspot_delta_sync`
- Claims jobs with Firestore transactions to prevent duplicate processing
- Resets stuck jobs (running > 10 min) after 3 attempts

### Real-Time Layer

Server-sent events (`backend/src/sse/`) push events to the frontend:

- `command.progress` — live status copy during command execution
- `approval.created` — new approval badge in the UI
- `workflow.status` — step-level progress
- `notification.new` — in-app alerts

---

## Data Model

All collections workspace-scoped under `workspaces/{workspaceId}/`:

```
workspaces/{workspaceId}
  members/            Users + roles (owner / admin / operator / member / viewer)
  integrations/       Connected providers — encrypted token refs, sync state
  agents/             Agent config overrides per workspace
  workflows/          Prebuilt templates + custom drafts with step definitions
  workflowRuns/       Per-run execution traces with step-level progress
  approvals/          Actions pending review — full edit history, status machine
  artifacts/          Reports, briefs, drafts — source refs, type, freshness
  commandSessions/    Conversation sessions with compressed context summaries
    messages/         Per-turn messages with tool/artifact refs
  memory/             Workspace facts and preferences (active / needs_review / archived)
  embeddings/         OpenAI vector embeddings for semantic retrieval
  jobQueue/           Global flat job queue (queued / running / completed / failed)
  jobLocks/           Per-workspace job mirror for UI-facing reads
  activity/           Audit log
  notifications/      In-app user notifications
  contextBundles/     Cached context snapshots with freshness timestamps
  usage/              Per-period credit and command counts
```

Top-level: `users/{userId}` — auth profile and workspace membership.

---

## Billing & Access

No payment gateway. Plans are workspace-based, upgraded via **coupon codes**.

| Limit | Free | Plus | Pro |
|-------|-----:|-----:|----:|
| Monthly credits | 50 | 1,500 | 7,500 |
| Connected integrations | 1 | 3 | 8 |
| Active agents | 1 | 4 | 10 |
| Active workflows | 2 | 10 | 50 |
| Custom workflows | 1 | 5 | 25 |
| Commands / user / hour | 20 | 120 | 500 |
| Commands / workspace / hour | 60 | 300 | 1,200 |

**Coupon codes** → upgrade plan + grant credits (`POST /billing/apply-coupon`).  
**Invite codes** → add a user to a workspace (`POST /workspaces/:id/join`).  
These are distinct systems and must not be conflated.

---

## Local Development

### Requirements
- Node.js 18.18+ (tested on 22.11.0)
- Firebase project with Authentication and Firestore enabled

### 1. Frontend
```bash
cd frontend
cp .env.example .env.local
# fill in Firebase client config
npm install
npm run dev          # → http://localhost:3000
```

### 2. Backend API
```bash
cd backend
cp .env.example .env
# fill in Firebase Admin credentials + at least one LLM provider key
npm install
npm run dev          # → http://localhost:3001
# GET /health  — sanity check
```

### 3. Worker (separate terminal)
```bash
cd backend
npm run worker
```

---

## Environment Variables

### Frontend — `frontend/.env.local`

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false
```

### Backend — `backend/.env`

```env
# Firebase Admin
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# LLM — primary
LLM_PROVIDER=parallel          # or: openai
PARALLEL_API_KEY=
PARALLEL_CHAT_MODEL=speed

# LLM — fallback
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o

# Embeddings
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536

# Web intelligence
WEB_RESEARCH_PROVIDER=parallel
WEB_EXTRACT_PROVIDER=parallel

# Google Workspace OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/integrations/google/callback
GOOGLE_POST_AUTH_REDIRECT=http://localhost:3000/integrations/google
INTEGRATION_STATE_SECRET=
INTEGRATION_ENCRYPTION_KEY=

# HubSpot OAuth
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
HUBSPOT_REDIRECT_URI=http://localhost:3001/integrations/hubspot/callback

# Job Queue — Upstash QStash (optional in local dev; falls back to polling)
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
WORKER_WEBHOOK_URL=

# App
NODE_ENV=development
PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
LOG_LEVEL=info
WORKER_TRIGGER_SECRET=
```

---

## Scripts

**Frontend:**
```bash
npm run dev       # Next.js dev server
npm run build     # Production build
npm run start     # Serve production build
```

**Backend:**
```bash
npm run dev                       # API server (tsx watch)
npm run worker                    # Background worker (tsx watch)
npm run build                     # Compile to dist/
npm run start                     # Run compiled build
npm run eval:intelligence         # Run evaluation suite (requires Firestore emulator)
npm run eval:intelligence:list    # List eval test cases
```

**Eval suite** — 18 typed test cases across: product awareness, integration awareness, workflow awareness, agent behavior, session continuity, memory retrieval, safety/approval.

```bash
# Full suite against Firestore emulator
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run eval:intelligence

# Single case
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run eval:intelligence -- --case SA-01

# By category
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run eval:intelligence -- --category safety-approval
```

---

## Current Limitations

The following are known gaps being actively worked on:

- **File uploads** — users cannot upload documents or PDFs as context sources yet
- **Gmail production send** — Gmail OAuth is in restricted test mode pending Google's app verification; real sends only go to whitelisted accounts
- **HubSpot end-to-end QA** — integration is built; needs full test coverage before production sign-off
- **IP-based rate limiting** — current limits are per-user and per-workspace; IP-layer controls coming before broader open signup
- **Payment gateway** — deferred post-MVP; billing managed via coupon codes