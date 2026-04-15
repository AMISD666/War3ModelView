# Memorix — Automatic Memory Rules

You have access to Memorix memory tools. Follow these rules to maintain persistent context across sessions.

## RULE 1: Session Start — Load Context

At the **beginning of every conversation**, BEFORE responding to the user:

1. Call `memorix_session_start` to get the previous session summary and key memories (this is a direct read, not a search — no fragmentation risk)
2. Then call `memorix_search` with a query related to the user's first message for additional context
3. If search results are found, use `memorix_detail` to fetch the most relevant ones
4. Reference relevant memories naturally — the user should feel you "remember" them

## RULE 2: Store Important Context

**Proactively** call `memorix_store` when any of the following happen:

### What MUST be recorded:
- Architecture/design decisions → type: `decision`
- Bug identified and fixed → type: `problem-solution`
- Unexpected behavior or gotcha → type: `gotcha`
- Config changed (env vars, ports, deps) → type: `what-changed`
- Feature completed or milestone → type: `what-changed`
- Trade-off discussed with conclusion → type: `trade-off`

### What should NOT be recorded:
- Simple file reads, greetings, trivial commands (ls, pwd, git status)

### Use topicKey for evolving topics:
For decisions, architecture docs, or any topic that evolves over time, ALWAYS use `topicKey` parameter.
This ensures the memory is UPDATED instead of creating duplicates.
Use `memorix_suggest_topic_key` to generate a stable key.

Example: `topicKey: "architecture/auth-model"` — subsequent stores with the same key update the existing memory.

### Track progress with the progress parameter:
When working on features or tasks, include the `progress` parameter:
```json
{
  "progress": {
    "feature": "user authentication",
    "status": "in-progress",
    "completion": 60
  }
}
```
Status values: `in-progress`, `completed`, `blocked`

## RULE 3: Resolve Completed Memories

When a task is completed, a bug is fixed, or information becomes outdated:

1. Call `memorix_resolve` with the observation IDs to mark them as resolved
2. Resolved memories are hidden from default search, preventing context pollution

This is critical — without resolving, old bug reports and completed tasks will keep appearing in future searches.

## RULE 4: Session End — Store Decision Chain Summary

When the conversation is ending, create a **decision chain summary** (not just a checklist):

1. Call `memorix_store` with type `session-request` and `topicKey: "session/latest-summary"`:

   **Required structure:**
   ```
   ## Goal
   [What we were working on — specific, not vague]

   ## Key Decisions & Reasoning
   - Chose X because Y. Rejected Z because [reason].
   - [Every architectural/design decision with WHY]

   ## What Changed
   - [File path] — [what changed and why]

   ## Current State
   - [What works now, what's pending]
   - [Any blockers or risks]

   ## Next Steps
   - [Concrete next actions, in priority order]
   ```

   **Critical: Include the "Key Decisions & Reasoning" section.** Without it, the next AI session will lack the context to understand WHY things were done a certain way and may suggest conflicting approaches.

2. Call `memorix_resolve` on any memories for tasks completed in this session

## RULE 5: Compact Awareness

Memorix automatically compacts memories on store:
- **With LLM API configured:** Smart dedup — extracts facts, compares with existing, merges or skips duplicates
- **Without LLM (free mode):** Heuristic dedup — uses similarity scores to detect and merge duplicate memories
- **You don't need to manually deduplicate.** Just store naturally and compact handles the rest.
- If you notice excessive duplicate memories, call `memorix_deduplicate` for batch cleanup.

## Guidelines

- **Use concise titles** (~5-10 words) and structured facts
- **Include file paths** in filesModified when relevant
- **Include related concepts** for better searchability
- **Always use topicKey** for recurring topics to prevent duplicates
- **Always resolve** completed tasks and fixed bugs
- **Always include reasoning** — "chose X because Y" is 10x more valuable than "did X"
- Search defaults to `status="active"` — use `status="all"` to include resolved memories

---

# War3ModelView Project Guardrails

These rules are repository-specific and must be followed by human contributors and AI agents.

## Architecture Boundaries

- Use `Tauri` as the only supported desktop shell for new work. Do not add new Electron code paths.
- UI components must not directly call `@tauri-apps/api`, `@tauri-apps/plugin-*`, `electron`, or raw platform APIs.
- All platform access must go through gateway/service modules under an infrastructure-oriented layer.
- UI components must not directly import `war3-model`. Wrap renderer/model library usage in adapter modules.
- Do not add new cross-directory hard references to external private code such as `../../../../../war3-model-4.0.0/*`.

## State and Data Flow

- Keep `Document State`, `Session State`, and `Preview State` separate. Do not mix all three in one module.
- UI components must not directly mutate `Document State`.
- All document mutations must go through a unified command entry such as `CommandBus` or an equivalent application-layer command service.
- Preview changes must not enter undo/redo history directly.
- Detached-window synchronization must go through a shared bridge/service. Do not invent a new ad-hoc RPC path in components.

## File Size Limits

- Component files should stay under `400` lines.
- Container/page/modal files should stay under `600` lines.
- Store files should stay under `300` lines.
- Service, gateway, and command files should stay under `300` lines.
- If a file exceeds the limit, split it before adding more feature logic unless there is a documented exception.

## Type Safety

- Do not add new `any`, `@ts-ignore`, or `@ts-expect-error` without an inline justification comment and cleanup plan.
- Prefer explicit domain types over compatibility shims.
- `typecheck` must remain runnable from the repository root.

## Verification

- Every new feature or refactor must include at least one minimal verification path:
  - a focused automated test, or
  - a reproducible acceptance script/checklist update.
- Changes that affect build config, window communication, persistence, platform access, or shared state must run `npm run typecheck`.

## Reference Docs

- Architecture plan: `docs/Architecture_Redesign_Blueprint.md`
- AI collaboration rules: `docs/AI_Collaboration_Hard_Rules.md`
