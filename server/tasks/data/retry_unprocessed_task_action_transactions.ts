import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {processTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    TaskActionTable,
    UnprocessedActionTransactionsIndex,
} from "~/server/tasks/data/internal/task_table.js";
import {taskIndexWaitForRefreshDelayMs} from "~/server/tasks/data/task_index.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function retryUnprocessedTaskActionTransactions(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    span: TracerSpan,
) {
    const currentTime = Date.now();

    const indexItems = await arrayFromAsyncIterable(
        UnprocessedActionTransactionsIndex.query(context, {
            partitionKey: {wasProcessed: false},
            // Unprocessed action transactions that are less than 12 seconds old are probably
            // being actively processed. Only retry processing after a task has been
            // unprocessed for more than 12 seconds.
            //
            // p99 action transaction processing currently peeks at ~6s.
            endSortKey: {committedTime: new Date(currentTime - 1000 * 12)},
            limit: "All",
        }),
    );

    span.addData({common: {count: indexItems.length}});

    await runAllPromises(
        indexItems.map(async indexItem => {
            const item = await TaskActionTable.getItem(context, indexItem);

            // `UpdateAccountName` actions take a lot longer to process than other actions
            // since they need to wait for the task index to refresh. Don't retry processing of
            // an `UpdateAccountName` action until it has been twice the task index refresh
            // delay interval.
            if (
                item.actions.some(action => action.type === "UpdateAccountName") &&
                item.committedTime.getTime() + taskIndexWaitForRefreshDelayMs * 2 < currentTime
            ) {
                return;
            }

            await processTaskActionTransaction(context, item);
        }),
    );
}
