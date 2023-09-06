import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {TaskClientQueryInternal} from "~/client/tasks/internal/store/task_client_query.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskClientQueryId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
} from "~/shared/tasks/task_realtime_protocol.js";

export type TaskClientStoreTaskEntry =
    // Task initialized and known authorization state:
    | {
          readonly task: TaskModel;
          readonly actions: null;
          readonly isAuthorized: boolean;
          readonly authorizationEventNumber: number;
      }
    // Task uninitialized and unknown authorization state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskUpdateTaskAction>;
          readonly isAuthorized: null;
          readonly authorizationEventNumber: null;
      }
    // Task uninitialized and known unauthorized state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskUpdateTaskAction>;
          readonly isAuthorized: false;
          readonly authorizationEventNumber: number;
      };

export type TaskClientStoreCollectionEntry =
    // Collection initialized and known authorization state:
    | {
          readonly collection: TaskCollectionModel;
          readonly actions: null;
          readonly isAuthorized: boolean;
          readonly authorizationEventNumber: number;
      }
    // Collection uninitialized and unknown authorization state:
    | {
          readonly collection: null;
          readonly actions: ReadonlyArray<TaskUpdateCollectionAction>;
          readonly isAuthorized: null;
          readonly authorizationEventNumber: null;
      }
    // Collection uninitialized and known unauthorized state:
    | {
          readonly collection: null;
          readonly actions: ReadonlyArray<TaskUpdateCollectionAction>;
          readonly isAuthorized: false;
          readonly authorizationEventNumber: number;
      };

/**
 * The client model store holds all our task data for a space on the client.
 * Similar to `TaskRealtimeStore` but whereas `TaskRealtimeStore` lives on the
 * server in `TaskRealtimeService` and contains all tasks irregardless of
 * authorization rules, `TaskClientStore` lives on the client and only contains
 * data the user is allowed to see as dictated by `TaskRealtimeService`.
 *
 * `TaskClientStore` holds data in `Store` objects. Which allows downstream
 * UI components to have granular subscriptions to exactly the data they need.
 * We can also use our tree store helpers to incrementally compute information
 * based on our client queries.
 */
export class TaskClientStore {
    private readonly _spaceId: SpaceId;

    /**
     * The tasks currently in our store.
     *
     * It's not guaranteed that every task in our store is up-to-date! Only data we
     * have an active subscription to in `TaskRealtimeService` will be kept
     * up-to-date in realtime. If a task leaves a query then our WebSocket
     * connection will give us the final action which caused the task to leave but
     * will not deliver any future updates to the task. Instead the WebSocket will
     * backfill the task if it becomes visible again.
     *
     * We use a weak map to hold tasks. This means when a task leaves all queries
     * and is no longer visible in the UI then the JavaScript garbage collector
     * will eventually clean it up and remove it from this map. You need to hold a
     * reference to the `ValueStore` for all tasks that are currently visible.
     */
    private readonly _taskEntryStoreById: AdvancedWeakValuesMap<
        TaskId,
        ValueStore<TaskClientStoreTaskEntry>
    >;

    /**
     * The collections currently in our store.
     *
     * Like `taskById`, it's not guaranteed that a collection is up-to-date if it's
     * in this map. See the documentation on `taskById` for more of an explanation.
     */
    private readonly _collectionEntryStoreById: AdvancedWeakValuesMap<
        TaskCollectionId,
        ValueStore<TaskClientStoreCollectionEntry>
    >;

    /**
     * The queries our client is currently subscribed to.
     */
    private readonly _queryById: Map<TaskClientQueryId, TaskClientQueryInternal>;

    constructor({spaceId}: {spaceId: SpaceId}) {
        this._spaceId = spaceId;
        this._taskEntryStoreById = new AdvancedWeakValuesMap();
        this._collectionEntryStoreById = new AdvancedWeakValuesMap();
        this._queryById = new Map();
    }

    public getTaskCountForTest() {
        return this._taskEntryStoreById.getSizeForTest();
    }

    public getCollectionCountForTest() {
        return this._collectionEntryStoreById.getSizeForTest();
    }

    /**
     * Get a single task in a unit testing environment. Even if you added a task
     * recently it may have been garbage collected.
     */
    public getTaskIfExistsForTest(taskId: TaskId) {
        assert(import.meta.jest);
        return this._taskEntryStoreById.get(taskId)?.getSnapshot().task ?? null;
    }

    /**
     * Get a single collection in a unit testing environment. Even if you added a
     * collection recently it may have been garbage collected.
     */
    public getCollectionIfExistsForTest(collectionId: TaskCollectionId) {
        assert(import.meta.jest);
        return this._collectionEntryStoreById.get(collectionId)?.getSnapshot().collection ?? null;
    }

    /**
     * Apply an update event from our WebSocket connection to `TaskRealtimeService`
     * to our store. This method is commutative and idempotent. That means you can
     * call it with events in any order or call it with an event multiple times and
     * we'll converge to the same result.
     */
    public applyUpdateEvent(event: TaskRealtimeUpdateEvent): void {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        // Backfill authorized tasks:
        for (const backfillTask of event.backfillAuthorizedTasks) {
            const oldTaskEntry =
                newTaskEntryById.get(backfillTask.id) ??
                this._taskEntryStoreById.get(backfillTask.id)?.getSnapshot();

            if (!oldTaskEntry) {
                newTaskEntryById.set(backfillTask.id, {
                    task: backfillTask,
                    actions: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // If a task is uninitialized we may have received some events for the task
            // before we received the task itself.
            let newTask: TaskModel;
            if (oldTaskEntry.task === null) {
                newTask = oldTaskEntry.actions.reduce(
                    (task, action) => task.apply(action),
                    backfillTask,
                );
            } else {
                newTask = oldTaskEntry.task.merge(backfillTask);
            }

            // Authorization state is unknown, mark the task as authorized.
            if (oldTaskEntry.isAuthorized === null) {
                newTaskEntryById.set(backfillTask.id, {
                    task: newTask,
                    actions: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // The authorization status in our store wins, use that instead of updating the
            // authorization event number.
            if (oldTaskEntry.authorizationEventNumber >= event.number) {
                // If nothing in our entry changed then don't update the task.
                if (newTask === oldTaskEntry.task) continue;

                newTaskEntryById.set(backfillTask.id, {
                    // We update the task even if it's unauthorized since we may receive events
                    // out-of-order.
                    task: newTask,
                    actions: null,
                    isAuthorized: oldTaskEntry.isAuthorized,
                    authorizationEventNumber: oldTaskEntry.authorizationEventNumber,
                });
                continue;
            }

            newTaskEntryById.set(backfillTask.id, {
                task: newTask,
                actions: null,
                isAuthorized: true,
                authorizationEventNumber: event.number,
            });
        }

        // Backfill unauthorized tasks:
        for (const backfillUnauthorizedTaskId of event.backfillUnauthorizedTaskIds) {
            const oldTaskEntry =
                newTaskEntryById.get(backfillUnauthorizedTaskId) ??
                this._taskEntryStoreById.get(backfillUnauthorizedTaskId)?.getSnapshot();

            if (!oldTaskEntry) {
                newTaskEntryById.set(backfillUnauthorizedTaskId, {
                    task: null,
                    actions: [],
                    isAuthorized: false,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // Authorization state is unknown, mark the task as unauthorized.
            if (oldTaskEntry.isAuthorized === null) {
                newTaskEntryById.set(backfillUnauthorizedTaskId, {
                    ...oldTaskEntry,
                    isAuthorized: false,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // Authorization state in the store wins. We may be applying events
            // out-of-order. We return a referentially identical entry to avoid updating
            // the map.
            if (oldTaskEntry.authorizationEventNumber >= event.number) continue;

            newTaskEntryById.set(backfillUnauthorizedTaskId, {
                ...oldTaskEntry,
                isAuthorized: false,
                authorizationEventNumber: event.number,
            });
        }

        // Backfill authorized collections:
        for (const backfillCollection of event.backfillAuthorizedCollections) {
            const oldCollectionEntry =
                newCollectionEntryById.get(backfillCollection.id) ??
                this._collectionEntryStoreById.get(backfillCollection.id)?.getSnapshot();

            if (!oldCollectionEntry) {
                newCollectionEntryById.set(backfillCollection.id, {
                    collection: backfillCollection,
                    actions: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // If a collection is uninitialized we may have received some events for the
            // collection before we received the collection itself.
            let newCollection: TaskCollectionModel;
            if (oldCollectionEntry.collection === null) {
                newCollection = oldCollectionEntry.actions.reduce(
                    (collection, action) => collection.apply(action),
                    backfillCollection,
                );
            } else {
                newCollection = oldCollectionEntry.collection.merge(backfillCollection);
            }

            // Authorization state is unknown, mark the collection as authorized.
            if (oldCollectionEntry.isAuthorized === null) {
                newCollectionEntryById.set(backfillCollection.id, {
                    collection: newCollection,
                    actions: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // The authorization status in our store wins, use that instead of updating the
            // authorization event number.
            if (oldCollectionEntry.authorizationEventNumber >= event.number) {
                // If nothing in our entry changed then don't update the collection.
                if (newCollection === oldCollectionEntry.collection) continue;

                newCollectionEntryById.set(backfillCollection.id, {
                    // We update the collection even if it's unauthorized since we may receive
                    // events out-of-order.
                    collection: newCollection,
                    actions: null,
                    isAuthorized: oldCollectionEntry.isAuthorized,
                    authorizationEventNumber: oldCollectionEntry.authorizationEventNumber,
                });
                continue;
            }

            newCollectionEntryById.set(backfillCollection.id, {
                collection: newCollection,
                actions: null,
                isAuthorized: true,
                authorizationEventNumber: event.number,
            });
        }

        // Backfill unauthorized collections:
        for (const backfillUnauthorizedCollectionId of event.backfillUnauthorizedCollectionIds) {
            const oldCollectionEntry =
                newCollectionEntryById.get(backfillUnauthorizedCollectionId) ??
                this._collectionEntryStoreById.get(backfillUnauthorizedCollectionId)?.getSnapshot();

            if (!oldCollectionEntry) {
                newCollectionEntryById.set(backfillUnauthorizedCollectionId, {
                    collection: null,
                    actions: [],
                    isAuthorized: false,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // Authorization state is unknown, mark the collection as unauthorized.
            if (oldCollectionEntry.isAuthorized === null) {
                newCollectionEntryById.set(backfillUnauthorizedCollectionId, {
                    ...oldCollectionEntry,
                    isAuthorized: false,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // Authorization state in the store wins. We may be applying events
            // out-of-order. We return a referentially identical entry to avoid updating
            // the map.
            if (oldCollectionEntry.authorizationEventNumber >= event.number) continue;

            newCollectionEntryById.set(backfillUnauthorizedCollectionId, {
                ...oldCollectionEntry,
                isAuthorized: false,
                authorizationEventNumber: event.number,
            });
        }

        // Apply actions:
        for (const action of event.actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.getSnapshot();

                    if (!oldTaskEntry) {
                        newTaskEntryById.set(action.taskId, {
                            task: null,
                            actions: [action],
                            isAuthorized: null,
                            authorizationEventNumber: null,
                        });
                        continue;
                    }

                    if (oldTaskEntry.task === null) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                ...oldTaskEntry,
                                actions: [...oldTaskEntry.actions, action],
                            });
                            continue;
                        } else {
                            let newTask = TaskModel.createFromAction(
                                this._spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                            );

                            // Apply any actions we received out-of-order now that the task has
                            // been created.
                            newTask = oldTaskEntry.actions.reduce(
                                (task, action) => task.apply(action),
                                newTask,
                            );

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                // If we receive the create event for a task we assume it to be
                                // authorized. In practice when a task is created we'll get a backfill for the
                                // task instead of the create action.
                                isAuthorized: oldTaskEntry.isAuthorized ?? true,
                                authorizationEventNumber:
                                    oldTaskEntry.authorizationEventNumber ?? event.number,
                            });
                            continue;
                        }
                    }

                    const newTask = oldTaskEntry.task.apply(action);

                    // Optimization: If the task didn't change then don't update our store.
                    if (newTask === oldTaskEntry.task) continue;

                    newTaskEntryById.set(action.taskId, {
                        task: newTask,
                        actions: null,
                        isAuthorized: oldTaskEntry.isAuthorized,
                        authorizationEventNumber: oldTaskEntry.authorizationEventNumber,
                    });
                    continue;
                }
                case "UpdateCollection": {
                    const oldCollectionEntry =
                        newCollectionEntryById.get(action.collectionId) ??
                        this._collectionEntryStoreById.get(action.collectionId)?.getSnapshot();

                    if (!oldCollectionEntry) {
                        newCollectionEntryById.set(action.collectionId, {
                            collection: null,
                            actions: [action],
                            isAuthorized: null,
                            authorizationEventNumber: null,
                        });
                        continue;
                    }

                    if (oldCollectionEntry.collection === null) {
                        if (action.collectionAction.type !== "Create") {
                            newCollectionEntryById.set(action.collectionId, {
                                ...oldCollectionEntry,
                                actions: [...oldCollectionEntry.actions, action],
                            });
                            continue;
                        } else {
                            let newCollection = TaskCollectionModel.createFromAction(
                                this._spaceId,
                                action.collectionId,
                                action.time,
                                action.collectionAction,
                            );

                            // Apply any actions we received out-of-order now that the task has
                            // been created.
                            newCollection = oldCollectionEntry.actions.reduce(
                                (task, action) => task.apply(action),
                                newCollection,
                            );

                            newCollectionEntryById.set(action.collectionId, {
                                collection: newCollection,
                                actions: null,
                                // If we receive the create event for a collection we assume it to be
                                // authorized. In practice when a collection is created we'll get a backfill
                                // for the collection instead of the create action.
                                isAuthorized: oldCollectionEntry.isAuthorized ?? true,
                                authorizationEventNumber:
                                    oldCollectionEntry.authorizationEventNumber ?? event.number,
                            });
                            continue;
                        }
                    }

                    const newCollection = oldCollectionEntry.collection.apply(action);

                    // Optimization: If the collection didn't change then don't update our store.
                    if (newCollection === oldCollectionEntry.collection) continue;

                    newCollectionEntryById.set(action.collectionId, {
                        collection: newCollection,
                        actions: null,
                        isAuthorized: oldCollectionEntry.isAuthorized,
                        authorizationEventNumber: oldCollectionEntry.authorizationEventNumber,
                    });
                    continue;
                }
                case "UpdateNotepadPage": {
                    // NOCOMMIT: I think this needs an implementation?
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        // NOCOMMIT: Accounts??

        // Apply all the updates to our store in one batch...
        batchStoreUpdates(() => {
            const taskEntryUpdateById = new Map<
                TaskId,
                {
                    taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
                    oldTaskEntry: TaskClientStoreTaskEntry | null;
                    newTaskEntry: TaskClientStoreTaskEntry;
                }
            >();

            // Update all our task stores and create new ones when necessary. Listeners
            // will be called at the end of the batch.
            for (const [taskId, newTaskEntry] of newTaskEntryById) {
                const taskEntryStore = this._taskEntryStoreById.get(taskId);
                if (taskEntryStore === undefined) {
                    const newTaskEntryStore = new ValueStore(newTaskEntry);
                    this._taskEntryStoreById.set(taskId, newTaskEntryStore);

                    taskEntryUpdateById.set(taskId, {
                        taskEntryStore: newTaskEntryStore,
                        oldTaskEntry: null,
                        newTaskEntry,
                    });
                } else {
                    taskEntryUpdateById.set(taskId, {
                        taskEntryStore,
                        oldTaskEntry: taskEntryStore.getSnapshot(),
                        newTaskEntry,
                    });

                    taskEntryStore.set(newTaskEntry);
                }
            }

            // Update all our collection stores and create new ones when necessary.
            // Listeners will be called at the end of the batch.
            for (const [collectionId, newCollectionEntry] of newCollectionEntryById) {
                const collectionEntryStore = this._collectionEntryStoreById.get(collectionId);
                if (collectionEntryStore === undefined) {
                    this._collectionEntryStoreById.set(
                        collectionId,
                        new ValueStore(newCollectionEntry),
                    );
                } else {
                    collectionEntryStore.set(newCollectionEntry);
                }
            }

            // Apply task updates to all our queries. This will also update stores within
            // the query which will call listeners at the end of the batch.
            for (const query of this._queryById.values()) {
                query.onTasksUpdated(taskEntryUpdateById);
            }
        });
    }

    /**
     * Creates a new query model in our store. The query will be kept up-to-date in
     * realtime whenever there's a change to a task that affects the query.
     */
    public createQuery({
        id = generateId<TaskClientQueryId>(),
        filters,
        sorts,
    }: {
        id?: TaskClientQueryId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }): void {
        assert(!this._queryById.has(id));

        const queryById = new Map(this._queryById);

        const query = new TaskClientQueryInternal({filters, sorts});
        queryById.set(id, query);
    }

    /**
     * Finish loading tasks into the query with the provided `TaskQueryModelId` we
     * assigned on the client. This will extend the query's loaded range.
     *
     * All the tasks for the query should already have been backfilled in our
     * store. Tasks that were backfilled before we initialized the query (and so
     * the query has not gotten an `onTaskCreate()` event for) are present in
     * `previouslyBackfilledTaskIds`.
     */
    public loadTasksIntoQuery(
        queryId: TaskClientQueryId,
        {
            loadedState,
            previouslyBackfilledTaskIds,
        }: {
            loadedState: TaskRealtimeQueryLoadedState;
            previouslyBackfilledTaskIds: ReadonlyArray<TaskId>;
        },
    ): void {
        const query = assertExists(this._queryById.get(queryId));

        query.onTasksLoaded(
            loadedState,
            previouslyBackfilledTaskIds.map(taskId => {
                const taskEntryStore = this._taskEntryStoreById.get(taskId);
                const taskEntry = taskEntryStore?.getSnapshot();

                // The server only includes tasks in `previouslyBackfilledTaskIds` that it has
                // previously backfilled in our client in the `backfillAuthorizedTasks`
                // property of a `TaskRealtimeUpdateEvent` event and is actively keeping the
                // task up-to-date in realtime. If the server sends a task the server hasn't
                // backfilled then the server is broken.
                //
                // Instead of trying to silently recover (which to the user is perceived as an
                // unexplainable glitch), loudly blow up.
                //
                // Even considering garbage collection, the task should be loaded in some other
                // query (or else the server would not be keeping the task up-to-date in
                // realtime) which means we've kept the reference to the task alive since it's
                // been created.
                assert(taskEntryStore && taskEntry?.task);

                return {taskEntryStore, taskEntry};
            }),
        );
    }

    // NOCOMMIT: This stuff!!

    // /**
    //  * Iterate through all the queries in our store.
    //  */
    // public iterateQueries() {
    //     return this._queryById;
    // }

    // /**
    //  * Get a query by its `TaskQueryModelId`. Throws if the query doesn't exist.
    //  */
    // public getQuery(queryId: TaskClientQueryId) {
    //     return assertExists(this._queryById.get(queryId));
    // }

    // /**
    //  * Gets the query for a task's children or creates a new query if one doesn't
    //  * exist.
    //  */
    // public getOrCreateTaskChildrenQuery(
    //     parentTaskId: TaskId,
    // ): [TaskClientStore, TaskClientQueryId] {
    //     const existingQueryId = this._childrenQueryIdByParentTaskId.get(parentTaskId);
    //     if (existingQueryId) return [this, existingQueryId];

    //     const queryId = generateId<TaskClientQueryId>();

    //     let database = this.createQuery(queryId, {
    //         filters: {
    //             displayStatusFilter: {
    //                 ifOpenInactive: true,
    //                 ifOpenActive: true,
    //                 ifClosed: true,
    //             },
    //             parentFilter: {
    //                 parentTaskId,
    //             },
    //         },
    //         sorts: [
    //             {
    //                 type: "ParentPosition",
    //                 direction: "Ascending",
    //                 missing: "Last",
    //             },
    //             {
    //                 type: "CreatedTime",
    //                 direction: "Ascending",
    //                 missing: "Last",
    //             },
    //         ],
    //     });

    //     const childrenQueryIdByParentTaskId = new Map(this._childrenQueryIdByParentTaskId);
    //     childrenQueryIdByParentTaskId.set(parentTaskId, queryId);

    //     database = new TaskClientStore({
    //         spaceId: database._spaceId,
    //         taskById: database._taskEntryStoreById,
    //         collectionById: database._collectionEntryStoreById,
    //         queryById: database._queryById,
    //         childrenQueryIdByParentTaskId,
    //     });

    //     return [database, queryId];
    // }

    // /**
    //  * Gets the query for the provided task's children if it exists. If it doesn't
    //  * exist that means the task's children are unloaded.
    //  */
    // public getTaskChildrenQueryIfExists(parentTaskId: TaskId): TaskQueryModel | null {
    //     const childrenQueryId = this._childrenQueryIdByParentTaskId.get(parentTaskId);
    //     if (!childrenQueryId) return null;
    //     return this.getQuery(childrenQueryId);
    // }
}
