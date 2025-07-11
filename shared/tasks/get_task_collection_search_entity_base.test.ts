import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getTaskCollectionSearchEntityBase} from "~/shared/tasks/get_task_collection_search_entity_base.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {
    TaskCollectionModel,
    TaskCollectionModelData,
} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";

function makeRawData({
    name = "Test Collection",
    nameVersion = [1, 0],
    color = themeColors[0] as ThemeColor,
    colorVersion = [2, 0],
    deletedTime = null,
    undeletedTime = null,
}: Partial<{
    name: string;
    nameVersion: [number, number];
    color: ThemeColor | null;
    colorVersion: [number, number];
    deletedTime: [number, number] | null;
    undeletedTime: [number, number] | null;
}> = {}): TaskCollectionModelData {
    return {
        id: generateId(),
        spaceId: generateId(),
        createdTime: [0, 0],
        creatorId: generateId<AccountId>(),
        deletedTime,
        undeletedTime,
        name: new LabelStringRegister(name, nameVersion),
        color: new TaskCollectionColorRegister(color, colorVersion),
        accessPolicy: new AccessPolicyRegister(
            {accountGrantById: new Map(), defaultGrant: null, urlGrant: null},
            [0, 0],
        ),
    };
}

test("returns correct base for a normal collection", () => {
    const rawData = makeRawData();
    const collection = new TaskCollectionModel(rawData);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result).toEqual({
        title: rawData.name.value,
        titleVersion: {
            type: "HybridLogicalTime",
            time: rawData.name.version,
        },
        media: {
            type: "TaskCollectionColor",
            color: rawData.color.value,
            version: rawData.color.version,
        },
    });
});

test("returns null title for deleted collection", () => {
    const deletedTime: [number, number] = [10, 0];
    const rawData = makeRawData({deletedTime});
    const collection = new TaskCollectionModel(rawData);
    // isDeleted() should be true
    expect(collection.isDeleted()).toBe(true);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.title).toBeNull();
    // Other fields still correct
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: deletedTime,
    });
    expect(result.media).toEqual({
        type: "TaskCollectionColor",
        color: rawData.color.value,
        version: rawData.color.version,
    });
});

test("returns correct color in media for custom color", () => {
    const color = themeColors[3] as ThemeColor;
    const colorVersion: [number, number] = [5, 1];
    const rawData = makeRawData({color, colorVersion});
    const collection = new TaskCollectionModel(rawData);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.media.color).toBe(color);
    expect(result.media.version).toEqual(colorVersion);
});

test("`titleVersion` uses max of `name.version`, `deletedTime`, `undeletedTime`", () => {
    const nameVersion: [number, number] = [1, 0];
    const deletedTime: [number, number] = [10, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({nameVersion, deletedTime, undeletedTime});
    const collection = new TaskCollectionModel(rawData);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: undeletedTime,
    });
});

test("`isDeleted` is false if `undeletedTime` > `deletedTime`", () => {
    const deletedTime: [number, number] = [10, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({deletedTime, undeletedTime});
    const collection = new TaskCollectionModel(rawData);
    expect(collection.isDeleted()).toBe(false);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.title).toBe(rawData.name.value);
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: undeletedTime,
    });
});

test("`isDeleted` is true if `deletedTime` > `undeletedTime`", () => {
    const deletedTime: [number, number] = [30, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({deletedTime, undeletedTime});
    const collection = new TaskCollectionModel(rawData);
    expect(collection.isDeleted()).toBe(true);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.title).toBeNull();
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: deletedTime,
    });
});

test("works with only `undeletedTime` set (not deleted)", () => {
    const undeletedTime: [number, number] = [15, 0];
    const rawData = makeRawData({undeletedTime});
    const collection = new TaskCollectionModel(rawData);
    expect(collection.isDeleted()).toBe(false);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.title).toBe(rawData.name.value);
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: undeletedTime,
    });
});

test("works with only `deletedTime` set (is deleted)", () => {
    const deletedTime: [number, number] = [15, 0];
    const rawData = makeRawData({deletedTime});
    const collection = new TaskCollectionModel(rawData);
    expect(collection.isDeleted()).toBe(true);
    const result = getTaskCollectionSearchEntityBase(collection);
    expect(result.title).toBeNull();
    expect(result.titleVersion).toEqual({
        type: "HybridLogicalTime",
        time: deletedTime,
    });
});
