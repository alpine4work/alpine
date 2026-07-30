import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import type {TaskCollectionEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

export async function getTaskCollectionItemForTest(
    context: DynamoContext,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionEssentialAttributesItem> {
    assert(isTestNodeEnvOrAdminScenariosScript);

    return await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });
}
