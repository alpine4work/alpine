import {InternalError} from "~/shared/error/error.js";
import {
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskCollectionModelData} from "~/shared/tasks/model/task_collection_model.js";

export function mergeTaskCollectionModelData(
    collection1: TaskCollectionModelData,
    collection2: TaskCollectionModelData,
) {
    if (collection1.id !== collection2.id)
        throw new InternalError("Can only merge tasks with the same `TaskCollectionId`");

    if (collection1.spaceId !== collection2.spaceId)
        throw new InternalError("Incompatible task `spaceId` when merging");

    if (collection1.creatorId !== collection2.creatorId)
        throw new InternalError("Incompatible task `creatorId` when merging");

    if (compareHybridLogicalTimes(collection1.createdTime, collection2.createdTime) !== 0)
        throw new InternalError("Incompatible task `createdTime` when merging");

    const newCollection: TaskCollectionModelData = {
        id: collection1.id,
        spaceId: collection1.spaceId,

        creatorId: collection1.creatorId,
        createdTime: collection1.createdTime,
        deletedTime:
            collection1.deletedTime !== null && collection2.deletedTime !== null
                ? maxHybridLogicalTime(collection1.deletedTime, collection2.deletedTime)
                : (collection1.deletedTime ?? collection2.deletedTime),
        undeletedTime:
            collection1.undeletedTime !== null && collection2.undeletedTime !== null
                ? maxHybridLogicalTime(collection1.undeletedTime, collection2.undeletedTime)
                : (collection1.undeletedTime ?? collection2.undeletedTime),

        name: collection1.name.merge(collection2.name),
        color: collection1.color.merge(collection2.color),
        accessPolicy: collection1.accessPolicy.merge(collection2.accessPolicy),
    };

    // Optimization: If nothing changed between `collection1` and the merged collection
    // then return `collection1` so the new collection is referentially equal to the
    // old one.
    if (isDeepEqual(collection1, newCollection)) return collection1;

    return newCollection;
}
