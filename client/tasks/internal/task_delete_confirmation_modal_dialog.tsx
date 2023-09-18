import {useAppContext} from "~/client/context/app_context.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function TaskDeleteConfirmationModalDialog({
    store,
    taskId,
    onClose,
    onAfterDelete,
}: {
    store: TaskClientStore;
    taskId: TaskId;
    onClose: () => void;
    onAfterDelete?: () => void;
}) {
    const context = useAppContext();
    const taskEntryStore = store.getTaskEntryStoreIfExists(taskId);
    const taskEntry = useStore(taskEntryStore);
    const childTaskCount = taskEntry?.task?.getChildTaskCount() ?? 0;

    return (
        <ModalDialog
            title="Delete task?"
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
            onPrimaryButtonPress={() => {
                // Task is deleted optimistically. If there's an error we will show a
                // toast later.
                store.deleteTaskAndAllChildren(context, taskId);

                onAfterDelete?.();
            }}
            onClose={onClose}
        />
    );
}
