# War3ModelView AI Collaboration Hard Rules

These are mandatory guardrails for future AI-assisted changes.

## 1. File Size Limits

- Component files: max `400` lines
- Container/page/modal files: max `600` lines
- Store files: max `300` lines
- Service/gateway/command files: max `300` lines
- Utility files: max `250` lines unless they are math-only modules

If a target file is already larger than the limit, do not extend it without first extracting a new module.

## 2. Platform Isolation

- Components must not directly import:
  - `@tauri-apps/api/*`
  - `@tauri-apps/plugin-*`
  - `electron`
  - Node or filesystem APIs
- All platform capabilities must be accessed through gateway/service modules.

Approved examples:

- `FileGateway`
- `WindowBridgeService`
- `MpqGateway`
- `TextureGateway`
- `SettingsGateway`

## 3. Document Mutation Rules

- UI components must not directly modify `Document State`.
- All canonical document changes must go through `CommandBus.execute()`.
- Detached windows must submit commands; they must not mutate the canonical model directly.
- Preview-only changes must not enter undo/redo history.

## 4. State Separation

- `Document State`: canonical model only
- `Session State`: editor-local form and workflow state
- `Preview State`: temporary render-only state

Do not put all three into one store or one component.

## 5. History Rules

- Do not call `useHistoryStore.getState().push()` from components.
- Do not mix command-based history and ad-hoc history in the same feature.
- A change must have one entry path into undo/redo.

## 6. Third-Party Dependency Rules

- UI must not directly import `war3-model`.
- `war3-model` usage must be wrapped in adapter modules.
- Do not add cross-directory hard references to external private folders.

Forbidden example:

```ts
import { ModelResourceManager } from '../../../../../war3-model-4.0.0/renderer/modelResourceManager'
```

## 7. Type Safety Rules

- No new `any`
- No new `@ts-ignore`
- No new `@ts-expect-error`

Exception rule:

- Only allowed with an inline comment that explains:
  - why the bypass is required,
  - what exact boundary it is limited to,
  - what follow-up cleanup is needed.

## 8. Verification Rules

Every task must include at least one of:

- a focused automated test, or
- a minimal acceptance script/checklist entry

Required commands by change type:

- shared state / command pipeline / config / IPC / persistence changes:
  - `npm run typecheck`
- shell/build changes:
  - relevant build command

## 9. Review Checklist for AI Changes

Before finishing, verify:

1. Did any UI component directly access platform APIs?
2. Did any component directly mutate document state?
3. Did any preview path accidentally become a history path?
4. Did any new `any` or suppression get introduced?
5. Did the change extend an oversized file instead of extracting a module?
6. Did the change introduce a new detached-window sync pattern instead of using the shared bridge?

If any answer is yes, the change is not ready.
