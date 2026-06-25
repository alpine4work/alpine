import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getApiTaskCollectionItems} from "~/server/api/internal/tasks/internal/get_api_task_collection_items.js";
import {intoApiTaskLayout} from "~/server/api/internal/tasks/internal/into_api_task_layout.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiTaskNotesResponse,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export async function intoApiTask(
    context: ServerActionContext,
    task: TaskModel,
    notes: ApiTaskNotesResponse,
): Promise<ApiTaskResponse> {
    const dueDate = task.getDueDate();
    const assigneeId = task.getAssignee()?.assignee.accountId;
    const parent = task.getParent();

    const [assignee, collections] = await runAllPromises([
        assigneeId
            ? getApiAccount(context, task.getSpaceId(), assigneeId, {
                  consistency: "StrongWithinCache",
              })
            : null,
        getApiTaskCollectionItems(
            context,
            task.getSpaceId(),
            task
                .getCollections()
                .getArray()
                .map(({collectionId}) => collectionId),
        ),
    ]);

    return {
        id: task.id,
        creator: {id: task.getCreator().accountId},
        status: intoApiTaskStatus(task.getDisplayStatus()),
        title: task.getTitle().getText(),
        assignee: assignee ?? undefined,
        due: dueDate ? {date: dueDate.toString()} : undefined,
        priority: task.getPriority() ?? undefined,
        layout: intoApiTaskLayout(task.getLayout()),
        // Keep API parent visibility aligned with `prepareTaskForClient()` in
        // `server/tasks/data/prepare_task_for_client.ts`: AppService also exposes parent
        // task IDs even when the parent task itself is not authorized. See that file for
        // the security tradeoff.
        parent: parent ? {task: {id: parent.taskId}} : undefined,
        collections,
        notes,
    };
}
