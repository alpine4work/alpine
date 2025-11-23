import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    TaskClientStore,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export function showTaskDeleteConfirmationModalDialog({
    context,
    reporter,
    store,
    undoManager,
    taskId,
    onBeforeDelete,
    onAfterDelete,
    onAfterClose,
}: {
    context: AppContext;
    reporter: Reporter;
    store: TaskClientStore;
    undoManager: TaskClientStoreUndoManager;
    taskId: TaskId;
    onBeforeDelete?: () => MaybePromise<void>;
    onAfterDelete?: () => MaybePromise<void>;
    onAfterClose?: () => void;
}) {
    const taskEntryStore = store.getTaskEntryStore(taskId);
    const childTaskCount = taskEntryStore.getSnapshot()?.task?.getChildTaskCount() ?? 0;

    const childTaskCountPrettyNumber = printPrettyNumber(
        getClientInfo().locale,
        childTaskCount,
        "subtask",
    );

    reporter.showDialog({
        title: "Delete task?",
        description: `${
            childTaskCount === 0
                ? "The task’s subtasks will also be deleted."
                : `The task’s ${childTaskCountPrettyNumber} will also be deleted.`
        } To keep a record of finished work you can close tasks instead of deleting them.`,
        primaryButtonLabel: "Delete",
        primaryButtonPressErrorTitle: "Couldn’t delete task",
        onPrimaryButtonPress: async () => {
            await onBeforeDelete?.();

            await store.deleteTaskAndAllChildren(context, taskId, {
                undoManager,
            });

            await onAfterDelete?.();
        },
        onAfterClose,
    });
}
