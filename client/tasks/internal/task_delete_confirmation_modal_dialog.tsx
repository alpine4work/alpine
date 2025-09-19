import {useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {
    TaskClientStore,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function TaskDeleteConfirmationModalDialog({
    store,
    undoManager,
    taskId,
    onClose,
    onAfterDelete,
}: {
    store: TaskClientStore;
    undoManager: TaskClientStoreUndoManager | null;
    taskId: TaskId;
    onClose: () => void;
    onAfterDelete?: () => void;
}) {
    const context = useAppContext();
    const {locale} = useClientInfo();

    const taskEntryStore = store.getTaskEntryStore(taskId);
    const taskEntry = useStore(taskEntryStore);
    const childTaskCount = taskEntry?.task?.getChildTaskCount() ?? 0;

    const childTaskCountPrettyNumber = useMemo(
        () => printPrettyNumber(locale, childTaskCount, "subtask"),
        [childTaskCount, locale],
    );

    return (
        <ModalDialog
            title="Delete task?"
            description={`${
                childTaskCount === 0
                    ? "The task’s subtasks will also be deleted."
                    : `The task’s ${childTaskCountPrettyNumber} will also be deleted.`
            } To keep a record of finished work you can close tasks instead of deleting them.`}
            primaryButtonLabel="Delete"
            primaryButtonPressErrorTitle="Couldn’t delete task"
            onPrimaryButtonPress={async () => {
                // Task is deleted optimistically. If there's an error we will show a
                // toast later.
                await store.deleteTaskAndAllChildren(context, taskId, {undoManager});

                onAfterDelete?.();
            }}
            onClose={onClose}
        />
    );
}
