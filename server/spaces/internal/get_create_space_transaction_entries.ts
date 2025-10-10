import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export const getCreateSpaceTransactionEntries = ({
    spaceId,
    name,
    createdTime,
}: {
    spaceId: SpaceId;
    name: string;
    createdTime: Date;
}) => {
    const createSpaceTransactionItem = SpacesTable.transactionCreateItem({
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId,
        name,
        createdTime,
    });

    return {
        transactionEntries: [createSpaceTransactionItem],
        newItem: createSpaceTransactionItem.newItem,
    };
};
