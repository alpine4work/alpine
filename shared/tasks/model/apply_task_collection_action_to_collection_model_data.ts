import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskCollectionAction} from "~/shared/tasks/actions/task_collection_action.js";
import {TaskCollectionModelData} from "~/shared/tasks/model/task_collection_model.js";

export function applyTaskCollectionActionToCollectionModelData(
    collection: TaskCollectionModelData,
    actionTime: HybridLogicalTime,
    action: TaskCollectionAction,
): TaskCollectionModelData {
    switch (action.type) {
        case "Create": {
            if (compareHybridLogicalTimes(collection.createdTime, actionTime)) {
                throw new FailedPreconditionError("Incompatible create action");
            }
            return collection;
        }
        case "Delete": {
            const newDeletedTime =
                collection.deletedTime !== null
                    ? maxHybridLogicalTime(collection.deletedTime, actionTime)
                    : actionTime;

            if (newDeletedTime === collection.deletedTime) return collection;
            return {...collection, deletedTime: newDeletedTime};
        }
        case "Undelete": {
            const newUndeletedTime =
                collection.undeletedTime !== null
                    ? maxHybridLogicalTime(collection.undeletedTime, actionTime)
                    : actionTime;

            if (newUndeletedTime === collection.undeletedTime) return collection;
            return {...collection, undeletedTime: newUndeletedTime};
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
        case "UpdateDefaults": {
            const newDefaults = collection.defaults.apply({
                value: action.defaults,
                version: actionTime,
            });

            if (collection.defaults === newDefaults) return collection;

            return {
                ...collection,
                defaults: newDefaults,
            };
        }
        default:
            throw exhaustive(action);
    }
}
