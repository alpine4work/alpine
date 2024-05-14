import {ModalDialog} from "~/client/design/modal_dialog.js";
import {usePrettyNumber} from "~/client/design/pretty_number.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function TaskCloseConfirmationModalDialog({
    store,
    taskId,
    onClose,
    onConfirm,
}: {
    store: TaskClientStore;
    taskId: TaskId;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const taskEntryStore = store.getTaskEntryStoreIfExists(taskId);
    const taskEntry = useStore(taskEntryStore);
    const childTaskCount = taskEntry?.task?.getOpenChildTaskCount() ?? 0;

    const childTaskCountPrettyNumber = usePrettyNumber({
        number: childTaskCount,
        label: "open subtask",
    });

    return (
        <ModalDialog
            title="Mark task closed?"
            description={`This task has ${childTaskCountPrettyNumber} that will stay open if this task is closed.`}
            primaryButtonLabel="Mark closed"
            primaryButtonPressErrorTitle="Couldn’t mark task as closed"
            onPrimaryButtonPress={() => {
                onConfirm?.();
            }}
            onClose={onClose}
        />
    );
}
