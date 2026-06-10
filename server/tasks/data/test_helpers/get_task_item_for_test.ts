import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import type {TaskEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export async function getTaskItemForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskEssentialAttributesItem> {
    assert(isTestNodeEnvOrAdminScenariosScript);

    return await TaskTable.getItem(context, {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId,
    });
}
