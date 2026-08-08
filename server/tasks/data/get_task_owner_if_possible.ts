import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {
    authorizeTaskItemAccessIfPossible,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export async function getTaskOwnerIfPossible(
    context: ServerActionContext,
    taskId: TaskId,
    options?: {dangerouslyAllowDeleted?: boolean},
): Promise<Result<{owner: AccountModel; isDeleted: boolean}, ErrorBase>> {
    const taskItem = await getTaskItemForAuthorization(context, taskId, null);

    const result = await authorizeTaskItemAccessIfPossible(
        context,
        taskItem,
        "View",
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        },
        options,
    );
    if (!result.ok) return result;

    const owner = taskItem.assigneeId.value
        ? await getAccount(context, taskItem.spaceId, taskItem.assigneeId.value)
        : await getAccount(context, taskItem.spaceId, taskItem.creatorId);

    return {ok: true, value: {owner, isDeleted: !!taskItem.deletedTime}};
}
