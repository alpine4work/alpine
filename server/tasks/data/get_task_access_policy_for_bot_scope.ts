import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    getTaskItemEffectiveAccessPolicyWithoutAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {EffectiveAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export async function getTaskAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    taskId: TaskId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<EffectiveAccessPolicy> {
    const scope = context.actor.getScope();
    if (scope.type !== "Task" || scope.taskId !== taskId) {
        throw new PermissionDeniedError("Can only get access policy for the scoped task");
    }

    const taskItem = await getTaskItemForAuthorization(context, taskId, null, options);

    const [, accessPolicy] = await runAllPromises([
        authorizeSpaceAccess(context, taskItem.spaceId),
        getTaskItemEffectiveAccessPolicyWithoutAuthorization(context, taskItem, options),
    ]);

    return accessPolicy;
}
