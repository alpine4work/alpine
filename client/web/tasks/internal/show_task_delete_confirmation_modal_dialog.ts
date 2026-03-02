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
    const task = taskEntryStore.getSnapshot()?.task ?? null;
    const layout = task?.getLayout() ?? null;
    const noun = layout === "Project" ? "project" : "task";
    const childNoun = layout === "Project" ? "task" : "subtask";
    const childTaskCount = task?.getChildTaskCount() ?? 0;

    const childTaskCountPrettyNumber = printPrettyNumber(
        getClientInfo().locale,
        childTaskCount,
        childNoun,
    );

    reporter.showDialog({
        title: `Delete ${noun}?`,
        description: `${
            childTaskCount === 0
                ? `The ${noun}\u2019s ${childNoun}s will also be deleted.`
                : `The ${noun}\u2019s ${childTaskCountPrettyNumber} will also be deleted.`
        } To keep a record of finished work you can close ${noun}s instead of deleting them.`,
        primaryButtonLabel: "Delete",
        primaryButtonPressErrorTitle: `Couldn\u2019t delete ${noun}`,
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
