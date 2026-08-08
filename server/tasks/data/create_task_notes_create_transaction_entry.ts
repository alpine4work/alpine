import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

export function createTaskNotesCreateTransactionEntry({
    spaceId,
    taskId,
    content,
    createdTime,
}: {
    spaceId: SpaceId;
    taskId: TaskId;
    content: TaskNotesContent;
    createdTime?: Date;
}): DynamoTransactionEntry {
    // Create the initial notes row at version 0 in the same transaction as task
    // creation so we never end up with a task that exists without its initial notes.
    return TaskTable.transactionCreateItem({
        partitionType: "Task",
        sortRangeType: "Notes",
        spaceId,
        taskId,
        createdTime: createdTime ?? new Date(),
        version: 0,
        content,
        stepCountByAccountId: new TaskStepCountByAccountId(new Map()),
    });
}
