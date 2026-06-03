import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

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
