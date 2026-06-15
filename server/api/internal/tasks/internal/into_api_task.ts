import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {intoApiTaskStatus} from "~/shared/api/content/into_api_task_status.js";
import {
    ApiTaskNotesResponse,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export async function intoApiTask(
    context: ServerAccountActionContext,
    task: TaskModel,
    notes: ApiTaskNotesResponse,
): Promise<ApiTaskResponse> {
    const dueDate = task.getDueDate();
    const assigneeId = task.getAssignee()?.assignee.accountId;

    const assignee = assigneeId
        ? await getApiAccount(context, task.getSpaceId(), assigneeId, {
              consistency: "StrongWithinCache",
          })
        : null;

    return {
        id: task.id,
        creator: {id: task.getCreator().accountId},
        status: intoApiTaskStatus(task.getDisplayStatus()),
        title: task.getTitle().getText(),
        assignee: assignee ?? undefined,
        due: dueDate ? {date: dueDate.toString()} : undefined,
        priority: task.getPriority() ?? undefined,
        notes,
    };
}
