import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {TaskCommentsSummaryItem, TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export async function getTaskCommentsSummaryItemIfExistsForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskCommentsSummaryItem | null> {
    assert(isTestNodeEnvOrAdminScenariosScript);

    return await TaskTable.getItemIfExists(context, {
        partitionType: "Task",
        sortRangeType: "CommentsSummary",
        taskId,
    });
}
