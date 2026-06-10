import {TaskCollectionIndexDocBase} from "~/server/tasks/data/task_collection_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskCollectionAction} from "~/shared/tasks/actions/task_collection_action.js";

/**
 * Applies a `TaskCollectionAction` to a `TaskCollectionIndexDoc`.
 * `TaskCollectionAction`s are commutative and idempotent. This means they can be
 * applied in any order or multiple times and we'll converge to the same result
 * every time.
 */
export function applyTaskCollectionActionToCollectionIndexDoc<
    Collection extends TaskCollectionIndexDocBase,
>(collection: Collection, actionTime: HybridLogicalTime, action: TaskCollectionAction): Collection {
    switch (action.type) {
        case "Create": {
            if (compareHybridLogicalTimes(collection.createdTime, actionTime)) {
                throw new FailedPreconditionError("Incompatible create action");
            }
            return collection;
        }
        case "Delete": {
            const newRawDeletedTime =
                collection.rawDeletedTime !== null
                    ? maxHybridLogicalTime(collection.rawDeletedTime, actionTime)
                    : actionTime;

            if (newRawDeletedTime === collection.rawDeletedTime) return collection;

            return {
                ...collection,
                rawDeletedTime: newRawDeletedTime,
            };
        }
        case "Undelete": {
            const newRawUndeletedTime =
                collection.rawUndeletedTime !== null
                    ? maxHybridLogicalTime(collection.rawUndeletedTime, actionTime)
                    : actionTime;

            if (newRawUndeletedTime === collection.rawUndeletedTime) return collection;

            return {
                ...collection,
                rawUndeletedTime: newRawUndeletedTime,
            };
        }
        case "UpdateName": {
            const newName = collection.name.apply({
                value: action.name,
                version: actionTime,
            });

            if (collection.name === newName) return collection;

            return {
                ...collection,
                name: newName,
            };
        }
        case "UpdateColor": {
            const newColor = collection.color.apply({
                value: action.color,
                version: actionTime,
            });

            if (collection.color === newColor) return collection;

            return {
                ...collection,
                color: newColor,
            };
        }
        case "UpdateAccessPolicy": {
            const newAccessPolicy = collection.accessPolicy.apply({
                value: action.accessPolicy,
                version: actionTime,
            });

            if (collection.accessPolicy === newAccessPolicy) return collection;

            return {
                ...collection,
                accessPolicy: newAccessPolicy,
            };
        }
        default:
            throw exhaustive(action);
    }
}
