import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskUpdateCollectionAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskCollectionAction,
    TaskCollectionCreateAction,
} from "~/shared/tasks/actions/task_collection_action.js";
import {LabelStringSchemaRegister} from "~/shared/tasks/label_string_schema_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";

export type TaskCollectionModelData = SchemaType<typeof TaskCollectionModelDataSchema>;

const TaskCollectionModelDataSchema = Schema.object({
    id: Schema.id<TaskCollectionId>(),
    spaceId: Schema.id<SpaceId>(),

    createdTime: HybridLogicalTimeSchema,
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    name: LabelStringSchemaRegister.schema,
    accessPolicy: TaskCollectionAccessPolicyRegister.schema,
});

// Doesn't use the `Model` class since `rawData` contains "raw" properties
// we want to provide clean accessors for. Like `isDeleted()` comparing
// `deletedTime` and `undeletedTime`.
export class TaskCollectionModel {
    public static readonly schema = TaskCollectionModelDataSchema.transform<TaskCollectionModel>({
        serialize: task => task.rawData,
        deserialize: rawData => new TaskCollectionModel(rawData),
    });

    public readonly id: TaskCollectionId;
    public readonly rawData: TaskCollectionModelData;

    constructor(rawData: TaskCollectionModelData) {
        this.id = rawData.id;
        this.rawData = rawData;
    }

    public static createFromAction(
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        actionTime: HybridLogicalTime,
        action: TaskCollectionCreateAction,
    ) {
        return new TaskCollectionModel({
            spaceId,
            id: collectionId,
            createdTime: actionTime,
            deletedTime: null,
            undeletedTime: null,
            name: new LabelStringSchemaRegister(action.name, actionTime),
            accessPolicy: new TaskCollectionAccessPolicyRegister(action.accessPolicy, actionTime),
        });
    }

    /**
     * Apply an action to this collection. Collections are [CRDTs][1] which means
     * their actions are commutative and idempotent. In practical language: you can
     * apply actions many times and in any order. Our task backend takes advantage
     * of this and doesn't bother enforcing a canonical task order.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public apply(action: TaskUpdateCollectionAction): TaskCollectionModel {
        if (this.id !== action.collectionId) {
            throw new InternalError(
                "Can only apply action for a collection with the same `TaskCollectionId`",
            );
        }

        const rawData = applyTaskCollectionActionToCollectionModelData(
            this.rawData,
            action.time,
            action.collectionAction,
        );

        // Optimization: Maintain referential integrity if the collection's data
        // didn't change.
        if (rawData === this.rawData) return this;

        return new TaskCollectionModel(rawData);
    }

    /**
     * Merge this collection with another. Collections are [CRDTs][1] which means
     * they have a well-defined merge operation where we converge eventually to the
     * latest representation of a collection.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public merge(otherCollection: TaskCollectionModel): TaskCollectionModel {
        const rawData = mergeTaskCollectionModelData(this.rawData, otherCollection.rawData);

        // Optimization: Maintain referential integrity if the collection's data didn't
        // change.
        if (rawData === this.rawData) return this;

        return new TaskCollectionModel(rawData);
    }

    /**
     * Make sure the hybrid logical clock's time is beyond any time observed by
     * this collection.
     */
    public tick(clock: HybridLogicalClock) {
        return tickTaskCollectionModelData(this.rawData, clock);
    }

    public getCreatedTime() {
        return this.rawData.createdTime;
    }

    public isDeleted() {
        return (
            !!this.rawData.deletedTime &&
            (!this.rawData.undeletedTime ||
                compareHybridLogicalTimes(this.rawData.deletedTime, this.rawData.undeletedTime) > 0)
        );
    }

    public getName() {
        return this.rawData.name.value;
    }

    public getAccessPolicy() {
        return this.rawData.accessPolicy.value;
    }
}

function mergeTaskCollectionModelData(
    collection1: TaskCollectionModelData,
    collection2: TaskCollectionModelData,
) {
    if (collection1.id !== collection2.id)
        throw new InternalError("Can only merge tasks with the same `TaskCollectionId`");

    if (collection1.spaceId !== collection2.spaceId)
        throw new InternalError("Incompatible task `spaceId` when merging");

    if (compareHybridLogicalTimes(collection1.createdTime, collection2.createdTime) !== 0)
        throw new InternalError("Incompatible task `createdTime` when merging");

    const newCollection: TaskCollectionModelData = {
        id: collection1.id,
        spaceId: collection1.spaceId,

        createdTime: collection1.createdTime,
        deletedTime:
            collection1.deletedTime !== null && collection2.deletedTime !== null
                ? maxHybridLogicalTime(collection1.deletedTime, collection2.deletedTime)
                : collection1.deletedTime ?? collection2.deletedTime,
        undeletedTime:
            collection1.undeletedTime !== null && collection2.undeletedTime !== null
                ? maxHybridLogicalTime(collection1.undeletedTime, collection2.undeletedTime)
                : collection1.undeletedTime ?? collection2.undeletedTime,

        name: collection1.name.merge(collection2.name),
        accessPolicy: collection1.accessPolicy.merge(collection2.accessPolicy),
    };

    // Optimization: If nothing changed between `collection1` and the merged
    // collection then return `collection1` so the new collection is referentially
    // equal to the old one.
    if (isDeepEqual(collection1, newCollection)) return collection1;

    return newCollection;
}

function applyTaskCollectionActionToCollectionModelData(
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

function tickTaskCollectionModelData(task: TaskCollectionModelData, clock: HybridLogicalClock) {
    clock.tick(task.createdTime);
    if (task.deletedTime !== null) clock.tick(task.deletedTime);
    if (task.undeletedTime !== null) clock.tick(task.undeletedTime);
    clock.tick(task.name.version);
    clock.tick(task.accessPolicy.version);
}
