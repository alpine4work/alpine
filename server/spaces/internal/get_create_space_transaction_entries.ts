import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {SpaceItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function getCreateSpaceTransactionEntries({
    spaceId,
    name,
    createdTime,
}: {
    spaceId: SpaceId;
    name: string;
    createdTime: Date;
}): {
    newItem: SpaceItem;
    transactionEntries: Array<DynamoTransactionEntry>;
} {
    const createSpaceTransactionItem = SpacesTable.transactionCreateItem({
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId,
        name,
        createdTime,
    });

    return {
        newItem: {
            ...createSpaceTransactionItem.newItem,
            avatars: {darkTheme: null, lightTheme: null},
        },
        transactionEntries: [createSpaceTransactionItem],
    };
}
