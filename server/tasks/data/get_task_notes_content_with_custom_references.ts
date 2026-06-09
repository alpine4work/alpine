import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeTaskAccessAndGetCommentsSummaryAndNotesItems} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskNotesContent, emptyTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

export function getTaskNotesContentWithCustomReferences<Content>(
    context: ServerAccountActionContext,
    taskId: TaskId,
    buildContent: (
        context: ServerAccountActionContext,
        spaceId: SpaceId,
        task: {assigneeId: AccountId | null; content: TaskNotesContent},
    ) => Promise<Content>,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: Content;
    stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
}> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: await buildContent(context, item.spaceId, {
                assigneeId: item.assigneeId.value,
                content: notesItem?.content ?? emptyTaskNotesContent,
            }),
            stepCountByNonCreatorAccountId:
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map()),
        }),
        {consistency},
    );
}
