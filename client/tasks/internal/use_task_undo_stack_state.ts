import {MutableRefObject, useEffect} from "react";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {TaskUndoActions} from "~/client/tasks/internal/create_task_undo_actions_if_possible.js";
import {YRelativeSelection} from "~/client/tasks/internal/task_row_title_input.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Id} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {mergeTaskTitleUpdates} from "~/shared/tasks/task_title.js";

/**
 * When undoing, if we see two `UpdateTitle` actions within this number of
 * milliseconds from each other, we merge into a single undo.
 *
 * 500ms is the default [ProseMirror uses][1] and [Y.js uses][2].
 *
 * [1]: https://github.com/ProseMirror/prosemirror-history/blob/40d274a74d0fc0787aeca03634a64d0c78f18a50/src/history.ts#L392
 * [2]: https://github.com/yjs/yjs/blob/9a7b659919f6d603b1a8cc87b8dddcf5436e7ac9/src/utils/UndoManager.js#L161
 */
const mergeTaskUpdateTitleDebounceMs = 500;

export type TaskUndoStackEntry = {
    readonly rootParentTaskId: TaskId;
    readonly undoActions: TaskUndoActions;
    readonly previousTitleYRelativeSelection: YRelativeSelection | null;
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

    const registerUndoActions = (entry: TaskUndoStackEntry) => {
        // Any action that's not an undo or redo clears our redo stack.
        for (const oldEntry of undoState.redoStackRef.current) oldEntry.release();
        undoState.redoStackRef.current = [];

        undoState.undoStackRef.current.push({
            ...entry,
            fromRedo: false,
        });
    };

    const registerUndoActionsFromRedo = (entry: TaskUndoStackEntry) => {
        undoState.undoStackRef.current.push({
            ...entry,
            fromRedo: true,
        });
    };

    const registerRedoActions = (entry: TaskUndoStackEntry) => {
        undoState.redoStackRef.current.push(entry);
    };

    const popUndoActions = (): {
        rootParentTaskId: TaskId;
        undoActions: ReadonlyArray<TaskUpdateTaskAction>;
        previousTitleYRelativeSelection: YRelativeSelection | null;
    } | null => {
        const undoStackEntry = undoState.undoStackRef.current.pop();
        if (!undoStackEntry) return null;

        const releases = [undoStackEntry.release];

        // You must do something synchronously with the resources retained by the
        // `undoStackEntry` or else those resources will be released.
        scheduleMicrotask(() => {
            for (const release of releases) {
                release();
            }
        });

        const undoActionsWithOldTimes = undoStackEntry.undoActions.getWithOldTimes();

        // If we're undoing an `UpdateTitle` action, try to merge multiple adjacent
        // updates together.
        if (
            undoActionsWithOldTimes.length !== 1 ||
            undoActionsWithOldTimes[0]!.taskAction.type !== "UpdateTitle"
        ) {
            return {
                rootParentTaskId: undoStackEntry.rootParentTaskId,
                undoActions: undoStackEntry.undoActions.get(clock),
                previousTitleYRelativeSelection: undoStackEntry.previousTitleYRelativeSelection,
            };
        }

        const undoActionWithOldTime = undoActionsWithOldTimes[0]!;
        assert(undoActionWithOldTime.taskAction.type === "UpdateTitle");

        const taskId = undoActionWithOldTime.taskId;
        let time = undoActionWithOldTime.time;
        let titleUpdate = undoActionWithOldTime.taskAction.titleUpdate;
        let previousTitleYRelativeSelection = undoStackEntry.previousTitleYRelativeSelection;

        while (undoState.undoStackRef.current.length > 0) {
            const nextUndoStackEntry =
                undoState.undoStackRef.current[undoState.undoStackRef.current.length - 1]!;

            // Don't collapse updates from a redo.
            if (nextUndoStackEntry.fromRedo) {
                break;
            }

            const nextUndoActionsWithOldTimes = nextUndoStackEntry.undoActions.getWithOldTimes();

            // Not an update title action, don't merge.
            if (
                nextUndoActionsWithOldTimes.length !== 1 ||
                nextUndoActionsWithOldTimes[0]!.taskAction.type !== "UpdateTitle"
            ) {
                break;
            }

            const nextUndoActionWithOldTime = nextUndoActionsWithOldTimes[0]!;
            assert(nextUndoActionWithOldTime.taskAction.type === "UpdateTitle");

            // Title update for a different task, don't merge.
            if (taskId !== nextUndoActionWithOldTime.taskId) {
                break;
            }

            // Too much time has passed between the two title updates.
            //
            // This uses hybrid logical times which can get a bit wonky. It'll work fine if
            // our client's clock is synchronized with the server and other clients. Worst
            // case we merge actions more aggressively or don't merge some actions we would
            // have liked to merge. Both of these outcomes are fine.
            //
            // `time` should be larger than `nextUndoActionWithOldTime.time`. Because our
            // stack is last-in first-out.
            if (time[0] - nextUndoActionWithOldTime.time[0] > mergeTaskUpdateTitleDebounceMs) {
                break;
            }
            time = nextUndoActionWithOldTime.time;
            previousTitleYRelativeSelection = nextUndoStackEntry.previousTitleYRelativeSelection;

            // Consume the next undo action.
            undoState.undoStackRef.current.pop();
            releases.push(nextUndoStackEntry.release);

            titleUpdate = mergeTaskTitleUpdates(
                titleUpdate,
                nextUndoActionWithOldTime.taskAction.titleUpdate,
            );
        }

        return {
            rootParentTaskId: undoStackEntry.rootParentTaskId,
            undoActions: [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                },
            ],
            previousTitleYRelativeSelection,
        };
    };

    const popRedoActions = (): {
        rootParentTaskId: TaskId;
        undoActions: ReadonlyArray<TaskUpdateTaskAction>;
        previousTitleYRelativeSelection: YRelativeSelection | null;
    } | null => {
        const undoStackEntry = undoState.redoStackRef.current.pop();
        if (!undoStackEntry) return null;

        // You must do something synchronously with the resources retained by the
        // `undoStackEntry` or else those resources will be released.
        scheduleMicrotask(() => {
            undoStackEntry.release();
        });

        return {
            rootParentTaskId: undoStackEntry.rootParentTaskId,
            undoActions: undoStackEntry.undoActions.get(clock),
            previousTitleYRelativeSelection: undoStackEntry.previousTitleYRelativeSelection,
        };
    };

    return {
        registerUndoActions,
        registerUndoActionsFromRedo,
        registerRedoActions,
        popUndoActions,
        popRedoActions,
    };
}
