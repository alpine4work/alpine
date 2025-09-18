import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";

export async function runBackfillAccountEmailCreationTimeMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    for await (const initialOldItem of AccountsTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "AccountEmailAddress", sortRangeType: "Attributes"}],
    })) {
        if (
            initialOldItem.partitionType !== "AccountEmailAddress" ||
            initialOldItem.sortRangeType !== "Attributes"
        ) {
            break;
        }

        await AccountsTable.updateItem(
            context,
            {
                partitionType: "AccountEmailAddress",
                sortRangeType: "Attributes",
                emailAddress: initialOldItem.emailAddress,
            },
            item => {
                return {
                    ...item,
                    partitionType: "AccountEmailAddress",
                    sortRangeType: "Attributes",
                    createdTime: initialOldItem.createdTime ?? new Date("2025-09-05T11:11:00.000Z"),
                };
            },
            {initialItem: initialOldItem},
        );
    }
}
