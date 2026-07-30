import {
    AuthorizeSpaceAccessContext,
    authorizeSpaceAccess,
} from "~/server/spaces/authorize_space_access.js";
import {backfillTaskActionTransactionHistoryTestCounter} from "~/server/tasks/data/backfill_task_action_transaction_history_test_counter.js";
import {TaskActionTable} from "~/server/tasks/data/internal/task_table.js";
import {getMinId} from "~/shared/id/id.js";
import {SpaceId, TaskActionTransactionId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

/**
 * Get all action transactions since the provided start time in the provided space.
 */
export async function backfillTaskActionTransactionHistory(
    context: AuthorizeSpaceAccessContext,
    spaceId: SpaceId,
    startCommittedTime: Date,
): Promise<
    Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }>
> {
    // Must have system access since we return all actions. We don't filter out actions
    // the current session doesn't have access to.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    const actionTransactions: Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }> = [];

    backfillTaskActionTransactionHistoryTestCounter.incrementForTest(spaceId);

    for await (const item of TaskActionTable.query(context, {
        partitionKey: {
            partitionType: "TaskActions",
            spaceId,
        },
        startSortKey: {
            sortRangeType: "ActionTransaction",
            committedTime: startCommittedTime,
            actionTransactionId: getMinId<TaskActionTransactionId>(),
        },
        limit: "All",
        consistency: "Strong",
    })) {
        actionTransactions.push({
            spaceId: item.spaceId,
            committedTime: item.committedTime,
            actions: item.actions,
        });
    }

    return actionTransactions;
}
