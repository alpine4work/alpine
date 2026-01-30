import {useMemo} from "react";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function TaskCloseConfirmationModalDialog({
    store,
    taskId,
    onClose,
    onConfirm,
}: {
    store: TaskClientReadonlyStore;
    taskId: TaskId | null;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const {locale} = useClientInfo();

    const taskEntryStore = taskId !== null ? store.getTaskEntryStore(taskId) : null;
    const taskEntry = useStore(taskEntryStore);
    const childTaskCount = taskEntry?.task?.getOpenChildTaskCount() ?? 0;

    const childTaskCountPrettyNumber = useMemo(
        () => printPrettyNumber(locale, childTaskCount, "open subtask"),
        [childTaskCount, locale],
    );

    return (
        <ModalDialog
            title="Mark task as closed?"
            description={`This task has ${childTaskCountPrettyNumber} that will stay open if this task is closed.`}
            primaryButtonLabel="Mark closed"
            primaryButtonPressErrorTitle="Couldn\u2019t mark task as closed"
            onPrimaryButtonPress={() => {
                onConfirm?.();
            }}
            onClose={onClose}
        />
    );
}
