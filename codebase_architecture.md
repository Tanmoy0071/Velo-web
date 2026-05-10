# Velo Codebase & Architecture Overview

## High-Level Architecture
Velo is an autonomous AI Web Design Agent that generates production-ready UI components and complete pages based on conversational prompts.

- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS 4, Radix UI.
- **Backend/Database**: InsForge BaaS (handles PostgreSQL database, Authentication, and Edge Functions).
- **AI Models**: Google Gemini 3.1 Pro (for generation) & Gemini 2.5 Flash Lite (for summaries), Anthropic Claude Sonnet 4.5 (for Intent Classification & Visual Architecture).
- **AI Streaming**: Vercel AI SDK (`createUIMessageStream`), enabling real-time streaming of UI generation status.

---

## Super Low-Level AI Pipeline (`app/api/project/route.ts`)
The true core of Velo's intelligence sits in the `POST /api/project` route. When a user sends a prompt, the system executes a highly coordinated, multi-stage, multi-model pipeline:

> [!IMPORTANT]
> The pipeline utilizes Server-Sent Events (SSE) via the Vercel AI SDK to stream UI status updates (like `pages-skeleton` and `generation` states) to the frontend *while* the LLMs are computing.

### 1. Stage 1: Intent Classification (Claude 4.5 Sonnet)
- **Invocation**: Calls `insforge.ai.chat.completions.create` with model `'anthropic/claude-sonnet-4.5'`.
- **Payload**: Injects `VELO_INTENT_PROMPT` as `system` role and `${latestUserMessage}\nCLASSIFY THE INTENT NOW. ONE WORD ONLY` as `user` role.
- **Processing**: Trims and lowercases the response (`classify_output.split(' ')[0]`). Fallbacks to `'chat'` if the output isn't exactly `chat`, `generate`, or `regenerate`.
- **Branching**:
  - If **`chat`**: 
    - Queries `google/gemini-2.5-pro` with `VELO_CHAT_PROMPT` and `stream: true`.
    - Streams output to the client via `writer.write({ type: "text-delta", id: chatId, delta })`.
    - Persists the chat response to the DB: `insforge.database.from("messages").insert([...])`.
    - Returns early, bypassing the design engine.
  - If **`generate`/`regenerate`**: Emits a `generation` SSE event (`status: "analyzing"`) via `emit(writer, ...)` and moves to Stage 2.

### 2. Stage 2: Visual Architecture Engine (Claude 4.5 Sonnet)
- **Invocation**: Calls `'anthropic/claude-sonnet-4.5'` with `maxTokens: 28000`.
- **Context Injection**: 
  - Passes `WEB_ANALYSIS_PROMPT` as the system prompt.
  - If regenerating (`isRegen`), injects the target page's current HTML and `rootStyles` to ensure surgical edits.
  - If generating new pages (`hasExistingPages`), injects the `rootStyles` of up to 2 prior pages to maintain theme consistency.
  - Appends any `imageParts` extracted from the user's message as `image_url` payloads for multimodal vision support.
- **Parsing**: The route forcefully extracts JSON from the markdown response using `indexOf('{')` and `lastIndexOf('}')` to ensure `JSON.parse` doesn't fail on surrounding prose.
- **Output JSON Schema**:
  - `layoutType`: String (e.g., "landing-page")
  - `pages`: Array containing `id`, `name`, `purpose`, `rootStyles` (raw CSS variables), and `visualDescription` (high-fidelity layout directives).

### 3. Stage 3: High-Fidelity Code Generation (Gemini 3.1 Pro)
- **`runGenerationWorker`**:
  - Emits `pages-skeleton` SSE event to render loading states for the requested pages on the UI.
  - Loops through each page in `analysis.pages`.
  - **Prompt Injection**: Joins the HTML of the last 2 generated pages into `previousPagesContext`.
  - **Invocation**: Calls `'google/gemini-3.1-pro-preview'` with `maxTokens: 30000`, providing `WEB_GENERATION_PROMPT` and a heavily constrained `user` prompt demanding raw HTML with Tailwind classes, strictly mapped to the CSS variables in `page.rootStyles`.
  - **Extraction**: Uses Regex `/<div[\s\S]*<\/div>/` to scrape the raw HTML from the response and strips out code fences (`` ``` ``).
  - **Database Persistence**: Executes `insforge.database.from("pages").insert({ projectId, name, rootStyles, htmlContent })`.
  - **SSE Update**: Emits a `page-created` event to replace the skeleton with the fully rendered HTML on the frontend.
- **`runRegenerateWorker`**:
  - Uses model `'google/gemini-3-flash-preview'` with `maxTokens: 28000`.
  - Instructs the model to surgically apply the requested change and return the complete page HTML without breaking existing components.
  - Updates the existing page via `insforge.database.from("pages").update(...)`.
- **Summarization**:
  - Calls `'google/gemini-2.5-flash-lite'` with `stream: true` to generate a 1-2 sentence summary of the work done.
  - Inserts the final `gen-card` JSON state and the text summary into the `messages` table to persist the session history.

---

## Directory & File Breakdown

### Root Configuration
- **`package.json`**: Defines dependencies. Key packages include `next`, `ai`, `@ai-sdk/react`, `tailwindcss`, `@insforge/nextjs`, and `radix-ui`.
- **`VELO_INITIAL_REPORT.md`**: The academic foundation of the project, detailing the problem statement, literature review, and architecture.
- **`AGENTS.md`**: Guidelines for the AI agent, specifically outlining how to interact with the InsForge SDK.

### `/app` (Next.js Application)
- **`layout.tsx` / `globals.css`**: The root layout. Wraps the application in necessary context providers (`theme-provider`, `insforge-provider`, `query-provider`) and initializes Tailwind styles.
- **`/api/project/route.ts`**: The AI generation pipeline (detailed above).
- **`/(routes)/project/[slugId]/page.tsx`**: The dynamic route for interacting with a specific project workspace.
- **`/auth`**: Directory containing authentication flows (login, register).

### `/components` (User Interface)
- **`/chat`**: 
  - `new-project-chat.tsx`: The initial screen where users drop their first prompt to create a project.
  - `chat-panel.tsx` & `chat-input.tsx`: The conversational interface for iterating on designs.
  - `canvas/`: Contains components responsible for safely rendering the generated raw HTML output (the live preview).
- **`/ai-elements`**: Components streamed from the server during generation (e.g., loading skeletons, generation cards).
- **`theme-provider.tsx` & `insforge-provider.tsx`**: Client-side context wrappers.
- **`logo.tsx`, `header.tsx`**: Reusable layout components.
- **`/ui`**: Likely contains base Radix UI / Shadcn components (buttons, dialogs, inputs).

### `/lib` (Core Logic & Constants)
- **`prompt.ts`**: The "DNA" of the AI models. It houses `VELO_INTENT_PROMPT`, `VELO_CHAT_PROMPT`, `WEB_ANALYSIS_PROMPT`, and `WEB_GENERATION_PROMPT`. These prompts define strict layout rules (e.g., zero tolerance for `h-screen` on root divs to prevent infinite iframe loops) and aesthetic standards.
- **`insforge-server.ts`**: Initializes the InsForge client on the server side using the edge function token and environment variables.
- **`insforge-client.ts`**: Initializes the InsForge client on the client side.
- **`utils.ts`**: Helper functions, usually containing a `cn()` function for merging Tailwind classes with `clsx` and `tailwind-merge`.
- **`project.ts`**: Project-specific TypeScript interfaces and types.
