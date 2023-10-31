import {MutableRefObject, RefObject, useEffect} from "react";
import * as Y from "yjs";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {TaskUndoActions} from "~/client/tasks/internal/create_task_undo_actions_if_possible.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {Id} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";

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
export type TaskUndoStackEntry =
    | {
          readonly type: "Actions";
          readonly rootParentTaskId: TaskId;
          readonly undoActions: TaskUndoActions;
          readonly removedFromQueries: ReadonlySet<TaskClientQuery>;
          readonly release: () => void;
      }
    | {
          readonly type: "YDoc";
          readonly rootParentTaskId: TaskId;
          readonly taskId: TaskId;
          readonly yUndoManager: Y.UndoManager;
          readonly release: () => void;
      }
    | {
          readonly type: "Notes";
          readonly rootParentTaskId: TaskId;
          readonly taskId: TaskId;
          readonly contentEditorRef: RefObject<ContentEditorRef | null>;
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
export function useTaskUndoStackState({
    clock,
    stateKey,
}: {
    clock: HybridLogicalClock;
    stateKey: Id | undefined;
}) {
    const [undoState] = useStateWithDependencies(
        stateKey => ({
            undoStackRef: cast<
                MutableRefObject<Array<TaskUndoStackEntry & {readonly fromRedo: boolean}>>
            >({current: []}),
            redoStackRef: cast<MutableRefObject<Array<TaskUndoStackEntry>>>({current: []}),
        }),
        [stateKey],
    );

    // Clear the undo stack when the component unmounts. Undo stack entries may
    // retain some data.
    useEffect(() => {
        return () => {
            for (const entry of undoState.undoStackRef.current) entry.release();
            undoState.undoStackRef.current = [];

            for (const entry of undoState.redoStackRef.current) entry.release();
            undoState.redoStackRef.current = [];
        };
    }, [undoState.redoStackRef, undoState.undoStackRef]);

    const pushUndoStackEntry = (entry: TaskUndoStackEntry) => {
        // Any action that's not an undo or redo clears our redo stack.
        for (const oldEntry of undoState.redoStackRef.current) oldEntry.release();
        undoState.redoStackRef.current = [];

        undoState.undoStackRef.current.push({
            ...entry,
            fromRedo: false,
        });
    };

    const pushUndoStackEntryFromRedo = (entry: TaskUndoStackEntry) => {
        undoState.undoStackRef.current.push({
            ...entry,
            fromRedo: true,
        });
    };

    const pushRedoStackEntry = (entry: TaskUndoStackEntry) => {
        undoState.redoStackRef.current.push(entry);
    };

    const popUndoStackEntry = (): DistributiveOmit<TaskUndoStackEntry, "release"> | null => {
        const undoStackEntry = undoState.undoStackRef.current.pop();
        if (!undoStackEntry) return null;

        const {release, ...remainingUndoStackEntry} = undoStackEntry;

        // You must do something synchronously with the resources retained by the
        // `undoStackEntry` or else those resources will be released.
        scheduleMicrotask(release);

        return remainingUndoStackEntry;
    };

    const popRedoStackEntry = (): DistributiveOmit<TaskUndoStackEntry, "release"> | null => {
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
