import type {TaskCollectionEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";

export function isTaskCollectionItemDeleted(
    collectionItem: Pick<
        TaskCollectionEssentialAttributesItem,
        "rawDeletedTime" | "rawUndeletedTime"
    >,
): boolean {
    return (
        !!collectionItem.rawDeletedTime &&
        (!collectionItem.rawUndeletedTime ||
            compareHybridLogicalTimes(
                collectionItem.rawDeletedTime,
                collectionItem.rawUndeletedTime,
            ) > 0)
    );
}
