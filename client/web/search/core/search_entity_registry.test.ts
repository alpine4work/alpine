import {
    SearchEntityRegistry,
    SearchEntityRegistryFriend,
} from "~/client/web/search/core/search_entity_registry.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {TaskTitleSnapshot} from "~/shared/tasks/title/task_title.js";

import.meta.jest.useFakeTimers();

test("updates search entity models with a friend store as expected", () => {
    const taskId = generateId<TaskId>();

    const snapshotA = new Uint8Array([
        1, 164, 188, 238, 172, 11, 1, 5, 3, 1, 164, 188, 238, 172, 11, 64,
    ]) as TaskTitleSnapshot;

    const snapshotB = new Uint8Array([...snapshotA]) as TaskTitleSnapshot;

    const entity1a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenActive",
            version: [1752681042095, 1],
        },
    });

    const entity1b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenActive",
            version: [1752681042095, 1],
        },
    });

    const entity2a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenInactive",
            version: [1752681042095, 2],
        },
    });

    const entity2b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenInactive",
            version: [1752681042095, 2],
        },
    });

    const entity3a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "Closed",
            version: [1752681042095, 3],
        },
    });

    const entity3b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "Closed",
            version: [1752681042095, 3],
        },
    });

    expect(entity1a).toEqual(entity1b);
    expect(entity1a).not.toBe(entity1b);
    expect(entity1a.initialData).toEqual(entity1b.initialData);
    expect(entity1a.initialData).not.toBe(entity1b.initialData);
    expect(entity2a).toEqual(entity2b);
    expect(entity2a).not.toBe(entity2b);
    expect(entity2a.initialData).toEqual(entity2b.initialData);
    expect(entity2a.initialData).not.toBe(entity2b.initialData);
    expect(entity3a).toEqual(entity3b);
    expect(entity3a).not.toBe(entity3b);
    expect(entity3a.initialData).toEqual(entity3b.initialData);
    expect(entity3a.initialData).not.toBe(entity3b.initialData);

    const friendEntityStore = new ValueStore(entity1b.initialData);

    const friend: SearchEntityRegistryFriend = {
        getSearchEntityRegistryFriendStoreIfExists: entityId => {
            if (entityId !== `Task:${taskId}`) return null;
            return friendEntityStore;
        },
    };

    const registry = new SearchEntityRegistry();
    registry.withSetTimeoutSchedulerForTest();
    registry.addFriend(friend);

    // Matches data from friend. There shouldn't be a scheduled update.
    const entityStore = registry.getEntityStore(entity1a);

    let entityStoreUpdateCount = 0;

    entityStore.subscribe(() => {
        entityStoreUpdateCount++;
    });

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity1b.initialData);

    import.meta.jest.runAllTimers();

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity1b.initialData);

    expect(registry.getEntityStore(entity1a)).toBe(entityStore);

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity1b.initialData);

    // Update data from friend. This should update the entity store.
    friendEntityStore.set(entity2b.initialData);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity2b.initialData);

    // Getting the store with an old entity doesn't change the store.
    expect(registry.getEntityStore(entity1a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity2b.initialData);

    // Getting the store with a matching new entity doesn't change the store.
    expect(registry.getEntityStore(entity2a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity2b.initialData);

    // Update data through scheduled update.
    expect(registry.getEntityStore(entity3a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    expect(entityStore.getSnapshot()).toBe(entity2b.initialData);

    import.meta.jest.runOnlyPendingTimers();

    expect(entityStoreUpdateCount).toEqual(2);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity3a.initialData);

    // Later, data updates from friend through realtime.
    friendEntityStore.set(entity3b.initialData);

    expect(entityStoreUpdateCount).toEqual(3);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity3b.initialData);

    // Getting the store again doesn't schedule a new update.
    expect(registry.getEntityStore(entity3a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(3);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toBe(entity3b.initialData);
});

test("updates search entity models with a friend store as expected when the entities have different titles (but same versions)", () => {
    const taskId = generateId<TaskId>();

    const snapshotA = new Uint8Array([
        1, 164, 188, 238, 172, 11, 1, 5, 3, 1, 164, 188, 238, 172, 11, 64,
    ]) as TaskTitleSnapshot;

    const snapshotB = new Uint8Array([...snapshotA]) as TaskTitleSnapshot;

    const entity1a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (a)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenActive",
            version: [1752681042095, 1],
        },
    });

    const entity1b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (b)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenActive",
            version: [1752681042095, 1],
        },
    });

    const entity2a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (a)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenInactive",
            version: [1752681042095, 2],
        },
    });

    const entity2b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (b)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "OpenInactive",
            version: [1752681042095, 2],
        },
    });

    const entity3a = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (a)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotA},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "Closed",
            version: [1752681042095, 3],
        },
    });

    const entity3b = new SearchEntityModel({
        id: `Task:${taskId}`,
        title: "Fix realtime privacy bug across forum and messaging systems (b)",
        titleVersion: {type: "TaskTitle", snapshot: snapshotB},
        media: {
            type: "TaskDisplayStatus",
            displayStatus: "Closed",
            version: [1752681042095, 3],
        },
    });

    const friendEntityStore = new ValueStore(entity1b.initialData);

    const friend: SearchEntityRegistryFriend = {
        getSearchEntityRegistryFriendStoreIfExists: entityId => {
            if (entityId !== `Task:${taskId}`) return null;
            return friendEntityStore;
        },
    };

    const registry = new SearchEntityRegistry();
    registry.withSetTimeoutSchedulerForTest();
    registry.addFriend(friend);

    // Matches data from friend. There shouldn't be a scheduled update.
    const entityStore = registry.getEntityStore(entity1a);

    let entityStoreUpdateCount = 0;

    entityStore.subscribe(() => {
        entityStoreUpdateCount++;
    });

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity1a.initialData);

    import.meta.jest.runAllTimers();

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity1a.initialData);

    expect(registry.getEntityStore(entity1a)).toBe(entityStore);

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStoreUpdateCount).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity1a.initialData);

    // Update data from friend. This should update the entity store.
    friendEntityStore.set(entity2b.initialData);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity2a.initialData);

    // Getting the store with an old entity doesn't change the store.
    expect(registry.getEntityStore(entity1a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity2a.initialData);

    // Getting the store with a matching new entity doesn't change the store.
    expect(registry.getEntityStore(entity2a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity2a.initialData);

    // Update data through scheduled update.
    expect(registry.getEntityStore(entity3a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(1);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    expect(entityStore.getSnapshot()).toEqual(entity2a.initialData);

    import.meta.jest.runOnlyPendingTimers();

    expect(entityStoreUpdateCount).toEqual(2);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity3a.initialData);

    // Later, data updates from friend through realtime.
    friendEntityStore.set(entity3b.initialData);

    expect(entityStoreUpdateCount).toEqual(3);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity3a.initialData);

    // Getting the store again doesn't schedule a new update.
    expect(registry.getEntityStore(entity3a)).toBe(entityStore);

    expect(entityStoreUpdateCount).toEqual(3);
    expect(import.meta.jest.getTimerCount()).toEqual(0);
    expect(entityStore.getSnapshot()).toEqual(entity3a.initialData);
});
