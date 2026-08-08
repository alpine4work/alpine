import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedObjectValue} from "~/shared/schema/schema.open_source.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskQueryDefaults} from "~/shared/tasks/task_query_defaults.js";

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const collectionId = generateId<TaskCollectionId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const collection1 = TaskCollectionModel.createFromAction(spaceId, collectionId, createdTime, {
        type: "Create",
        creator: null,
        name: "Test",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });
    const collection2 = TaskCollectionModel.createFromAction(spaceId, collectionId, createdTime, {
        type: "Create",
        creator: null,
        name: "Test",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    expect(collection1.merge(collection2)).toBe(collection1);
    expect(collection1.merge(collection2)).not.toBe(collection2);
    expect(collection2.merge(collection1)).toBe(collection2);
    expect(collection2.merge(collection1)).not.toBe(collection1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn\u2019t change", () => {
    const spaceId = generateId<SpaceId>();
    const collectionId = generateId<TaskCollectionId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const collection1a = TaskCollectionModel.createFromAction(spaceId, collectionId, createdTime, {
        type: "Create",
        creator: null,
        name: "Test",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });
    const collection2 = TaskCollectionModel.createFromAction(spaceId, collectionId, createdTime, {
        type: "Create",
        creator: null,
        name: "Test",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const collection1b = new TaskCollectionModel({
        ...collection1a.rawData,
        name: new LabelStringRegister("Test Collection 42", [createdTime[0], 1]),
    });

    expect(collection1b.merge(collection2)).toBe(collection1b);
    expect(collection1b.merge(collection2)).not.toBe(collection2);
    expect(collection2.merge(collection1b)).not.toBe(collection2);
    expect(collection2.merge(collection1b)).not.toBe(collection1b);
    expect(collection2.merge(collection1b)).toEqual(collection1b);
});

function createTestCollection() {
    const spaceId = generateId<SpaceId>();
    const collectionId = generateId<TaskCollectionId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    return TaskCollectionModel.createFromAction(spaceId, collectionId, createdTime, {
        type: "Create",
        creator: null,
        name: "Test",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });
}

test("applying an update defaults action updates the defaults", () => {
    const collection1 = createTestCollection();

    const defaults: TaskQueryDefaults = {
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ],
        sorts: [{type: "DueDate", direction: "Ascending"}],
    };

    const collection2 = collection1.applyAction({
        type: "UpdateCollection",
        time: [collection1.getCreatedTime()[0] + 1, 0],
        collectionId: collection1.id,
        collectionAction: {type: "UpdateDefaults", defaults},
    });

    expect(collection2.getDefaults()).toEqual(defaults);
});

test("an older update defaults action loses to a newer one", () => {
    const collection1 = createTestCollection();

    const newerDefaults: TaskQueryDefaults = {
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ],
        sorts: [],
    };

    const collection2 = collection1
        .applyAction({
            type: "UpdateCollection",
            time: [collection1.getCreatedTime()[0] + 2, 0],
            collectionId: collection1.id,
            collectionAction: {type: "UpdateDefaults", defaults: newerDefaults},
        })
        .applyAction({
            type: "UpdateCollection",
            time: [collection1.getCreatedTime()[0] + 1, 0],
            collectionId: collection1.id,
            collectionAction: {
                type: "UpdateDefaults",
                defaults: {
                    filters: [
                        {type: "Priority", operation: {type: "OneOf", priorities: new Set()}},
                    ],
                    sorts: [{type: "DueDate", direction: "Descending"}],
                },
            },
        });

    expect(collection2.getDefaults()).toEqual(newerDefaults);
});

test("a collection deserialized without defaults has empty defaults", () => {
    const collection1 = createTestCollection();

    const serializedCollection = TaskCollectionModel.schema.serialize(
        collection1,
    ) as SchemaSerializedObjectValue;
    const {defaults, ...serializedCollectionWithoutDefaults} = serializedCollection;

    const collection2 = TaskCollectionModel.schema.deserialize(serializedCollectionWithoutDefaults);

    expect(collection2.getDefaults()).toEqual({filters: [], sorts: []});
});
