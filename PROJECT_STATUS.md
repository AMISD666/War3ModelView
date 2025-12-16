# Project Handover: Animation Mode & Bone Gizmo Fixes

**Last Updated:** 2025-12-16
**Status:** Translation Gizmo Fully Functional (Parity with Mdlvis)

## 1. Current Progress (当前进度)

We have successfully resolved critical issues with the **Bone Translation Gizmo** in Animation Keyframe Mode. The behavior now matches the reference implementation (mdlvis).

### ✅ Completed Fixes
1.  **Gizmo World-Axis Movement:**
    *   **Issue:** Dragging Gizmo axes (X/Y/Z) caused incorrect diagonal movement due to wrong coordinate space transformation.
    *   **Fix:** Implemented correct **World-to-Local transformation**.
    *   **Algorithm:** `LocalDelta = Inverse(ParentRotation) * WorldDelta`.
    *   **Insight:** War3 Translation is relative to the *Parent's* coordinate system and is mathematically independent of the bone's own current rotation (it applies *before* rotation).

2.  **Mid-Frame T-Pose Jump:**
    *   **Issue:** Dragging a bone on a frame without an exact keyframe caused it to snap to [0,0,0] (T-Pose) before moving.
    *   **Fix:** Implemented **Real-time Linear Interpolation** for the base value.
    *   **Details:** Instead of using a static initial value or default [0,0,0], we now interpolate the `Translation` from the `modelStore`'s keyframes at the exact start of the drag.

3.  **MouseUp Commit Consistency:**
    *   **Issue:** The final keyframe committed on mouse release didn't match the preview position.
    *   **Fix:** Applied the same real-time interpolation logic to the `MouseUp` handler to ensure `BaseTranslation` matches the visual preview.

4.  **Bone Parameter Panel:**
    *   **Fix:** Panel now displays interpolated fields for the current frame and allows numeric input to create/update keyframes.

## 2. Technical Conclusions (关键结论)

*   **Coordinate Systems:**
    *   **Translation:** Relative to **Parent Bone's Rotation**. To move in World Space, you must transform by `Inverse(ParentWorldRotation)`.
    *   **Rotation:** Likely relative to Parent as well, but visual Gizmo rotation usually needs to handle Local vs World modes carefully.
*   **Data Source of Truth:**
    *   Always use `useModelStore` (the Redux/Zustand store) for reading Keyframe data (`Translation.Keys`).
    *   Do **not** rely on `rendererRef.current.model` for *reading* base data during edits, as the renderer state might be optimized or contain temporary preview keys.
*   **Interpolation:**
    *   For any editing operation at an arbitrary frame (float), you **must** linearly interpolate the existing keyframes to determine the "Start Value". Do not default to 0.

## 3. Pending/Next Tasks (下一步计划)

1.  **Refactoring:**
    *   Extract the interpolation logic (currently duplicated in `mousemove` and `mouseup` in `Viewer.tsx`) into `src/renderer/src/utils/animationUtils.ts`.
2.  **Rotation & Scaling Gizmos:**
    *   Verify if **Rotation** and **Scaling** Gizmos need similar parent-space transformation fixes. (Rotation likely does).
3.  **Keyframe Editor Features:**
    *   **Copy/Paste:** Implement clipboard support for keyframes.
    *   **Multi-Selection:** Allow selecting and moving multiple keyframes in the Timeline.
    *   **Block Selection:** Box select keys in the editor.

## 4. Key Code Locations

*   **`src/renderer/src/components/Viewer.tsx`**:
    *   `handleGizmoDrag`: Main logic for Gizmo interaction.
    *   `handleTranslateNodesKeyframe`: Logic for converting mouse movement to keyframe deltas.
    *   `MouseUp` handler: Commits the final keyframe command.
*   **`src/renderer/src/components/editors/BoneParameterPanel.tsx`**: UI for bone properties.

## 5. Handover Prompt (接手提示词)

To seamlessly continue work, provide the following context to the next AI:

> "Current State: The Bone Translation Gizmo in Animation Mode is FIXED and verified.
> Core Logic: We established that Translation updates must be transformed by the **Parent Bone's Inverse Rotation** to map correctly to World Space. We also fixed 'T-Pose jumps' by using real-time interpolation for base values.
> Immediate Goal: Please proceed to **Refactor** the interpolation logic into a utility function, then **Verify** that the Rotation and Scaling Gizmos work correctly using similar logic. After that, move on to implementing Copy/Paste for keyframes."
