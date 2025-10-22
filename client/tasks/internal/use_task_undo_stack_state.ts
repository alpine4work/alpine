import {MutableRefObject, RefObject, useEffect} from "react";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {TaskUndoActions} from "~/client/tasks/core/create_task_undo_actions_if_possible.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {undoMergeTextUpdatesDelayMs} from "~/shared/design/core/timing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {TaskActionTransactionLeaseId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * An entry in our undo stack. Entries need to identify the task we're
 * modifying so we can scroll to it and provide a way to actually perform the
 * undo action.
 *
 * `rootParentTaskId` is included since even if we know the `TaskId` we're
 * updating, the `TaskId` may appear twice in our view. `rootParentTaskId`
 * helps us disambiguate the task's position. If a task is nested in a parent
 * task we know it's unique within that subtree.
 */
export type TaskUndoStackEntry<Extra = unknown> =
    | {
          readonly type: "Actions";
          readonly rootParentTaskId: TaskId;
          readonly extra: Extra;
          readonly undoActions: TaskUndoActions;
          readonly removedFromQueries: ReadonlySet<TaskClientQuery>;
          readonly leaseId: TaskActionTransactionLeaseId | null;
          readonly release: () => void;
      }
    | {
          readonly type: "Notes";
          readonly rootParentTaskId: TaskId;
          readonly extra: Extra;
          readonly taskId: TaskId;
          readonly contentEditorRef: RefObject<ContentEditorRef<TaskNotesContentWithReferences> | null>;
          readonly release: () => void;
      };

/**
 * Maintains the state of our undo stack. Features:
 *
 * - Automatically handles releasing stack entries when no longer used
 * - Merges adjacent `UpdateTitle` actions that happen within a short window
 *   of time
 * - Clears redo stack when progress is made
 */
export function useTaskUndoStackState<Extra = unknown>({
    stateKey,
}: {stateKey?: string | undefined} = emptyObject) {
    const undoState = useStateWithDependenciesWithoutDispatch(
        () => ({
            undoStackRef: cast<
                MutableRefObject<
                    Array<
                        TaskUndoStackEntry<Extra> & {
                            readonly time: number;
                            readonly fromRedo: boolean;
                        }
                    >
                >
            >({current: []}),
            redoStackRef: cast<MutableRefObject<Array<TaskUndoStackEntry<Extra>>>>({current: []}),
        }),
        [stateKey],
    );

    // Clear the undo stack when the component unmounts. Undo stack entries may
    // retain some data.
    useEffect(() => {
        return () => {
            for (const entry of undoState.undoStackRef.current) entry.release();
            // eslint-disable-next-line react-compiler/react-compiler
            undoState.undoStackRef.current = [];

            for (const entry of undoState.redoStackRef.current) entry.release();
            undoState.redoStackRef.current = [];
        };
    }, [undoState.redoStackRef, undoState.undoStackRef]);

    const pushUndoStackEntry = (entry: TaskUndoStackEntry<Extra>) => {
        // Any action that's not an undo or redo clears our redo stack.
        for (const oldEntry of undoState.redoStackRef.current) oldEntry.release();
        undoState.redoStackRef.current = [];

        const currentTime = Date.now();
        const undoStack = undoState.undoStackRef.current;

        // Decide whether to merge this entry with the previous entry. We want to merge
        // title text updates otherwise when the user hits undo we'll be removing every
        // individual keystroke which is a bad experience.
        //
        // We'll merge this entry with the previous entry if:
        //
        // 1. This entry only updates the title of one task (see
        //    `exclusiveUpdateTitleTaskId`); AND
        //
        // 2. The previous entry has some title update on the same task; AND
        //
        // 3. This entry happened <500ms after the previous entry
        //    (`mergeUndoTextUpdatesDelayMs` is currently 500ms); AND
        //
        // 4. This entry doesn't remove tasks from any queries (we check
        //    `entry.removedFromQueries` and `entry.leaseId` for this); AND
        //
        // 5. This entry is in the same position in the view as the last one
        //    (we check `entry.rootParentTaskId` hasn't changed)
        if (
            entry.type === "Actions" &&
            entry.removedFromQueries.size === 0 &&
            entry.leaseId === null
        ) {
            const lastEntry = undoStack[undoStack.length - 1];

            if (
                lastEntry?.type === "Actions" &&
                !lastEntry.fromRedo &&
                lastEntry.rootParentTaskId === entry.rootParentTaskId &&
                currentTime - lastEntry.time < undoMergeTextUpdatesDelayMs
            ) {
                let exclusiveUpdateTitleTaskId: TaskId | null = null;
                for (const action of entry.undoActions.getWithoutReconciliation()) {
                    if (
                        action.taskAction.type !== "UpdateTitle" ||
                        action.taskAction.withoutUndoMerge
                    ) {
                        exclusiveUpdateTitleTaskId = null;
                        break;
                    } else {
                        if (exclusiveUpdateTitleTaskId === null) {
                            exclusiveUpdateTitleTaskId = action.taskId;
                        } else if (exclusiveUpdateTitleTaskId !== action.taskId) {
                            exclusiveUpdateTitleTaskId = null;
                            break;
                        }
                    }
                }

                if (
                    exclusiveUpdateTitleTaskId !== null &&
                    lastEntry.undoActions
                        .getWithoutReconciliation()
                        .some(
                            action =>
                                action.taskAction.type === "UpdateTitle" &&
                                action.taskId === exclusiveUpdateTitleTaskId &&
                                !action.taskAction.withoutUndoMerge,
                        )
                ) {
                    undoStack[undoStack.length - 1] = {
                        ...lastEntry,
                        time: currentTime,
                        undoActions: lastEntry.undoActions.concat(entry.undoActions),
                    };
                    return;
                }
            }
        }

        undoStack.push({
            ...entry,
            time: currentTime,
            fromRedo: false,
        });
    };

    const pushUndoStackEntryFromRedo = (entry: TaskUndoStackEntry<Extra>) => {
        undoState.undoStackRef.current.push({
            ...entry,
            time: Date.now(),
            fromRedo: true,
        });
    };

    const pushRedoStackEntry = (entry: TaskUndoStackEntry<Extra>) => {
        undoState.redoStackRef.current.push(entry);
    };

    const popUndoStackEntry = (): DistributiveOmit<TaskUndoStackEntry<Extra>, "release"> | null => {
        const undoStackEntry = undoState.undoStackRef.current.pop();
        if (!undoStackEntry) return null;

        const {release, ...remainingUndoStackEntry} = undoStackEntry;

        // You must do something synchronously with the resources retained by the
        // `undoStackEntry` or else those resources will be released.
        scheduleMicrotask(release);

        return remainingUndoStackEntry;
    };

    const popRedoStackEntry = (): DistributiveOmit<TaskUndoStackEntry<Extra>, "release"> | null => {
        const undoStackEntry = undoState.redoStackRef.current.pop();
        if (!undoStackEntry) return null;

        const {release, ...remainingUndoStackEntry} = undoStackEntry;

        // You must do something synchronously with the resources retained by the
        // `undoStackEntry` or else those resources will be released.
        scheduleMicrotask(release);

        return remainingUndoStackEntry;
    };

    return {
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        popUndoStackEntry,
        popRedoStackEntry,
    };
}
