import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeTaskItemAccessIfPossible} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {
    convertTaskCollectionIndexDocToItem,
    convertTaskIndexDocToItem,
} from "~/server/tasks/data/internal/convert_task_index_doc_to_item.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export function authorizeTaskIndexDocAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskIndexDoc: TaskIndexDoc,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskIndexDoc: (taskId: TaskId) => Promise<TaskIndexDoc>;
        getCollectionIndexDoc: (taskId: TaskCollectionId) => Promise<TaskCollectionIndexDoc>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    return authorizeTaskItemAccessIfPossible(
        context,
        convertTaskIndexDocToItem(taskIndexDoc),
        expectedAccessLevel,
        {
            getTaskItem: async taskId => {
                const taskIndexDoc = await loaders.getTaskIndexDoc(taskId);
                return convertTaskIndexDocToItem(taskIndexDoc);
            },
            getCollectionItem: async collectionId => {
                const collectionIndexDoc = await loaders.getCollectionIndexDoc(collectionId);
                return convertTaskCollectionIndexDocToItem(collectionIndexDoc);
            },
        },
        options,
    );
}
