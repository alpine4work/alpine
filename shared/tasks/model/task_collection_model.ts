import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {InternalError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskUpdateCollectionAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskCollectionCreateAction,
    getTaskCollectionCreateActionCreator,
} from "~/shared/tasks/actions/task_collection_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {applyTaskCollectionActionToCollectionModelData} from "~/shared/tasks/model/apply_task_collection_action_to_collection_model_data.js";
import {mergeTaskCollectionModelData} from "~/shared/tasks/model/merge_task_collection_model_data.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskCreatorSchema} from "~/shared/tasks/task_creator.js";
import {
    TaskQueryDefaultsRegister,
    emptyTaskQueryDefaults,
} from "~/shared/tasks/task_query_defaults.js";

export type TaskCollectionModelData = SchemaType<typeof TaskCollectionModelDataSchema>;

const TaskCollectionModelDataSchema = Schema.object({
    id: Schema.id<TaskCollectionId>(),
    spaceId: Schema.id<SpaceId>(),

    createdTime: HybridLogicalTimeSchema,
    creator: TaskCreatorSchema.nullable(),
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    name: LabelStringRegister.schema,
    color: TaskCollectionColorRegister.schema,
    accessPolicy: AccessPolicyRegister.schema,

    // Collections created before defaults existed don't have this property so we
    // default to an empty register which loses to any update.
    defaults: TaskQueryDefaultsRegister.schema.default(
        () => new TaskQueryDefaultsRegister(emptyTaskQueryDefaults, zeroHybridLogicalTime),
    ),
});

// Doesn't use the `Model` class since `rawData` contains "raw" properties we want
// to provide clean accessors for. Like `isDeleted()` comparing `deletedTime` and
// `undeletedTime`.
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
        const creator = getTaskCollectionCreateActionCreator(action);
        return new TaskCollectionModel({
            spaceId,
            id: collectionId,
            createdTime: actionTime,
            creator,
            deletedTime: null,
            undeletedTime: null,
            name: new LabelStringRegister(action.name, actionTime),
            color: new TaskCollectionColorRegister(null, actionTime),
            accessPolicy: new AccessPolicyRegister(action.accessPolicy, actionTime),
            defaults: new TaskQueryDefaultsRegister(emptyTaskQueryDefaults, actionTime),
        });
    }

    /**
     * Apply an action to this collection. Collections are [CRDTs][1] which means their
     * actions are commutative and idempotent. In practical language: you can apply
     * actions many times and in any order. Our task backend takes advantage of this
     * and doesn't bother enforcing a canonical task order.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public applyAction(action: TaskUpdateCollectionAction): TaskCollectionModel {
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

        // Optimization: Maintain referential integrity if the collection's data didn't
        // change.
        if (rawData === this.rawData) return this;

        return new TaskCollectionModel(rawData);
    }

    /**
     * Merge this collection with another. Collections are [CRDTs][1] which means they
     * have a well-defined merge operation where we converge eventually to the latest
     * representation of a collection.
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
     * Make sure the hybrid logical clock's time is beyond any time observed by this
     * collection.
     */
    public tick(clock: {tick(time: HybridLogicalTime): void}) {
        return tickTaskCollectionModelData(this.rawData, clock);
    }

    public getSpaceId() {
        return this.rawData.spaceId;
    }

    public getCreatedTime() {
        return this.rawData.createdTime;
    }

    public getCreator() {
        return this.rawData.creator;
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

    public getColor() {
        return this.rawData.color.value;
    }

    public getAccessPolicy() {
        return this.rawData.accessPolicy.value;
    }

    public getDefaults() {
        return this.rawData.defaults.value;
    }
}

function tickTaskCollectionModelData(
    task: TaskCollectionModelData,
    clock: {tick(time: HybridLogicalTime): void},
) {
    clock.tick(task.createdTime);
    if (task.deletedTime !== null) clock.tick(task.deletedTime);
    if (task.undeletedTime !== null) clock.tick(task.undeletedTime);
    clock.tick(task.name.version);
    clock.tick(task.accessPolicy.version);
    clock.tick(task.defaults.version);
}
