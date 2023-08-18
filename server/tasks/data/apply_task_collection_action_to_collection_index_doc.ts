import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskCollectionAction} from "~/shared/tasks/actions/task_collection_action.js";

/**
 * Applies a `TaskCollectionAction` to a `TaskCollectionIndexDoc`.
 * `TaskCollectionAction`s are commutative and idempotent. This means they can
 * be applied in any order or multiple times and we'll converge to the same
 * result every time.
 */
export function applyTaskCollectionActionToCollectionIndexDoc(
    collection: TaskCollectionIndexDoc,
    actionTime: HybridLogicalTime,
    action: TaskCollectionAction,
): TaskCollectionIndexDoc {
    switch (action.type) {
        case "Create": {
            if (collection.createdTime.getTime() !== actionTime[0]) {
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
