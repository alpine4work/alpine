import {ModalDialog} from "~/client/design/modal_dialog.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state.js";
import {LocalTaskId} from "~/shared/id/types/id_types.js";

export function TaskDeleteConfirmationModalDialog({
    state,
    dispatch,
    taskId,
    onClose,
    onAfterDelete,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    taskId: LocalTaskId;
    onClose: () => void;
    onAfterDelete?: () => void;
}) {
    const task = state.database.getTask(taskId);
    const childTaskCount = task.childTaskIdByOrderKey.size;

    return (
        <ModalDialog
            title="Delete task"
            description={
                <>
                    {childTaskCount === 0 ? (
                        "The task’s subtasks will also be deleted."
                    ) : (
                        <>
                            The task’s <PrettyNumber number={childTaskCount} label="subtask" /> will
                            also be deleted.
                        </>
                    )}{" "}
                    To keep a record of finished work you can close tasks instead of deleting them.
                </>
            }
            primaryButtonLabel="Delete"
            primaryButtonPressErrorTitle="Couldn’t delete task"
            onPrimaryButtonPress={() => {
                // TODO(calebmer): There seems to be a bug here where the modal dialog
                // re-renders with a bad `state` before the `onClose` render.
                dispatch({type: "DeleteTaskAndAllChildren", taskId});
                onAfterDelete?.();
            }}
            onClose={onClose}
        />
    );
}
