import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeTaskAccessAndGetCommentsSummaryAndNotesItems} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskNotesContent, emptyTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

export function getTaskNotesContentWithoutReferences(
    context: ServerActionContext,
    taskId: TaskId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContent;
    stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
}> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: notesItem?.content ?? emptyTaskNotesContent,
            stepCountByNonCreatorAccountId:
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map()),
        }),
        {consistency},
    );
}
