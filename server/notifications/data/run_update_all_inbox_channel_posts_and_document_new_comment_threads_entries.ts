import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {InternalError} from "~/shared/error/error.open_source.js";

export async function runUpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    for await (const initialOldItem of InboxTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Inbox", sortRangeType: "ChannelPostsEntry"},
            {partitionType: "Inbox", sortRangeType: "DocumentNewCommentThreadsEntry"},
        ],
    })) {
        if (initialOldItem.partitionType !== "Inbox") {
            throw new InternalError("Invalid partition type");
        }
        if (
            initialOldItem.sortRangeType !== "ChannelPostsEntry" &&
            initialOldItem.sortRangeType !== "DocumentNewCommentThreadsEntry"
        ) {
            throw new InternalError("Invalid sort range type");
        }

        let hasAlreadyAttempted = false;

        await context.dynamo.retryTransaction(async context => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const item = isInitialAttempt
                ? initialOldItem
                : await InboxTable.getItem(context, initialOldItem);

            await InboxTable.dangerouslyDirectlyUpdateItemWithoutEvent(context, item);
        });
    }
}
