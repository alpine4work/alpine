import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {afterCommitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    TaskActionTable,
    TaskActionTransactionItem,
} from "~/server/tasks/data/internal/task_table.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskActionTransactionId} from "~/shared/id/types/id_types.js";

export function internalGetUpdateOurAccountNameTaskTransactionEntries(
    context: ServerSessionActionContext,
    {
        spaceIds,
        name,
        nameVersion,
    }: {
        spaceIds: ReadonlySet<SpaceId>;
        name: string;
        nameVersion: number;
    },
): Array<DynamoTransactionEntry> {
    const currentTime = new Date();

    const actionTransactionItems = Array.from(spaceIds, spaceId => {
        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId,
            committedTime: currentTime,
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                {
                    type: "UpdateAccountName",
                    time: [currentTime.getTime(), 0],
                    accountId: context.actor.getAccountId(),
                    accountName: name,
                    accountNameVersion: nameVersion,
                },
            ],
            wasProcessed: false,
            actor: {
                accountId: context.actor.getAccountId(),
                from: null,
            },
            clientId: null,
        };

        return actionTransactionItem;
    });

    return actionTransactionItems.map(actionTransactionItem =>
        TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem, {
            onAfterTransactionExecutedSuccessfully: async () => {
                await afterCommitTaskActionTransaction(context, actionTransactionItem);
            },
        }),
    );
}
