import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {SpaceId, TaskCollectionId, TaskId, TaskQueryModelId} from "~/shared/id/types/id_types.js";
import {
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryModel} from "~/shared/tasks/model/task_query_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
} from "~/shared/tasks/task_realtime_protocol.js";

type TaskModelStoreTaskEntry =
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

type TaskModelStoreCollectionEntry =
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
 * The task model store holds all our task data for a space on the client.
 * Similar to `TaskRealtimeQueryStore` but whereas `TaskRealtimeQueryStore`
 * lives on the server in `TaskRealtimeService` and contains all tasks
 * irregardless of authorization rules, `TaskModelStore` lives on the client
 * and only contains data the user is allowed to see as dictated by
 * `TaskRealtimeService`.
 *
 * `TaskModelStore` is immutable which makes it easier to implement optimistic
 * updates and makes it easier to integrate with React. We can select a subset
 * of the store for React (like a single task) and React will intelligently
 * only update components that depend on the selected data. This only works
 * since we can grab immutable snapshots from our store with referential
 * identity.
 */
export class TaskModelStore {
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
     * We recommend you write any functions that read data from the store to ask
     * for evidence of a subscription that includes the task. For example if you're
     * reading a task in a query you should pass in a query subscription object and
     * we'll verify the task is actually part of the subscription.
     */
    // TODO(calebmer): We should implement some form of manual garbage collection
    // to free memory when certain tasks are no longer in use.
    private readonly _taskById: ImmutableMap<TaskId, TaskModelStoreTaskEntry>;

    /**
     * The collections currently in our store.
     *
     * Like `taskById`, it's not guaranteed that a collection is up-to-date if it's
     * in this map. See the documentation on `taskById` for more of an explanation.
     */
    // TODO(calebmer): We should implement some form of manual garbage collection
    // to free memory when certain collections are no longer in use.
    private readonly _collectionById: ImmutableMap<TaskCollectionId, TaskModelStoreCollectionEntry>;

    /**
     * The queries our client is currently subscribed to.
     *
     * We use a normal `Map` instead of `ImmutableMap` since the number of
     * subscribed queries is small enough that it's worth cloning this object
     * entirely when updating it.
     */
    private readonly _queryById: ReadonlyMap<TaskQueryModelId, TaskQueryModel>;

    private constructor({
        spaceId,
        taskById,
        collectionById,
        queryById,
    }: {
        spaceId: SpaceId;
        taskById: ImmutableMap<TaskId, TaskModelStoreTaskEntry>;
        collectionById: ImmutableMap<TaskCollectionId, TaskModelStoreCollectionEntry>;
        queryById: ReadonlyMap<TaskQueryModelId, TaskQueryModel>;
    }) {
        this._spaceId = spaceId;
        this._taskById = taskById;
        this._collectionById = collectionById;
        this._queryById = queryById;
    }

    public static new({spaceId}: {spaceId: SpaceId}) {
        return new TaskModelStore({
            spaceId,
            taskById: ImmutableMap.empty(),
            collectionById: ImmutableMap.empty(),
            queryById: new Map(),
        });
    }

    /**
     * Get a task in the store.
     *
     * We only allow this to be called in tests. UI code reading from our store
     * should show that it's somehow subscribed in realtime to the data it's
     * requesting.
     */
    public getTaskForTest(taskId: TaskId) {
        assert(import.meta.jest);
        return assertExists(this._taskById.get(taskId)?.task);
    }

    /**
     * Get a collection in the store.
     *
     * We only allow this to be called in tests. UI code reading from our store
     * should show that it's somehow subscribed in realtime to the data it's
     * requesting.
     */
    public getCollectionForTest(collectionId: TaskCollectionId) {
        assert(import.meta.jest);
        return assertExists(this._collectionById.get(collectionId)?.collection);
    }

    /**
     * Apply an update event from our WebSocket connection to `TaskRealtimeService`
     * to our store. This method is commutative and idempotent. That means you can
     * call it with events in any order or call it with an event multiple times and
     * we'll converge to the same result.
     */
    public applyUpdateEvent(event: TaskRealtimeUpdateEvent): TaskModelStore {
        let taskById = this._taskById;
        let collectionById = this._collectionById;

        // Backfill authorized tasks:
        for (const backfillTask of event.backfillAuthorizedTasks) {
            taskById = taskById.update(backfillTask.id, (taskEntry): TaskModelStoreTaskEntry => {
                if (!taskEntry) {
                    return {
                        task: backfillTask,
                        actions: null,
                        isAuthorized: true,
                        authorizationEventNumber: event.number,
                    };
                }

                // If a task is uninitialized we may have received some events for the task
                // before we received the task itself.
                let newTask: TaskModel;
                if (taskEntry.task === null) {
                    newTask = taskEntry.actions.reduce(
                        (task, action) => task.apply(action),
                        backfillTask,
                    );
                } else {
                    newTask = taskEntry.task.merge(backfillTask);
                }

                // Authorization state is unknown, mark the task as authorized.
                if (taskEntry.isAuthorized === null) {
                    return {
                        task: newTask,
                        actions: null,
                        isAuthorized: true,
                        authorizationEventNumber: event.number,
                    };
                }

                // The authorization status in our store wins, use that instead of updating the
                // authorization event number.
                if (taskEntry.authorizationEventNumber >= event.number) {
                    // Optimization: If nothing in our entry changed then return the referentially
                    // identical entry so we don't have to update the map.
                    if (newTask === taskEntry.task) return taskEntry;

                    return {
                        // We update the task even if it's unauthorized since we may receive events
                        // out-of-order.
                        task: newTask,
                        actions: null,
                        isAuthorized: taskEntry.isAuthorized,
                        authorizationEventNumber: taskEntry.authorizationEventNumber,
                    };
                }

                return {
                    task: newTask,
                    actions: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                };
            });
        }

        // Backfill unauthorized tasks:
        for (const backfillUnauthorizedTaskId of event.backfillUnauthorizedTaskIds) {
            taskById = taskById.update(
                backfillUnauthorizedTaskId,
                (taskEntry): TaskModelStoreTaskEntry => {
                    if (!taskEntry) {
                        return {
                            task: null,
                            actions: [],
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state is unknown, mark the task as unauthorized.
                    if (taskEntry.isAuthorized === null) {
                        return {
                            ...taskEntry,
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state in the store wins. We may be applying events
                    // out-of-order. We return a referentially identical entry to avoid updating
                    // the map.
                    if (taskEntry.authorizationEventNumber >= event.number) return taskEntry;

                    return {
                        ...taskEntry,
                        isAuthorized: false,
                        authorizationEventNumber: event.number,
                    };
                },
            );
        }

        // Backfill authorized collections:
        for (const backfillCollection of event.backfillAuthorizedCollections) {
            collectionById = collectionById.update(
                backfillCollection.id,
                (collectionEntry): TaskModelStoreCollectionEntry => {
                    if (!collectionEntry) {
                        return {
                            collection: backfillCollection,
                            actions: null,
                            isAuthorized: true,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // If a collection is uninitialized we may have received some events for the
                    // collection before we received the collection itself.
                    let newCollection: TaskCollectionModel;
                    if (collectionEntry.collection === null) {
                        newCollection = collectionEntry.actions.reduce(
                            (collection, action) => collection.apply(action),
                            backfillCollection,
                        );
                    } else {
                        newCollection = collectionEntry.collection.merge(backfillCollection);
                    }

                    // Authorization state is unknown, mark the collection as authorized.
                    if (collectionEntry.isAuthorized === null) {
                        return {
                            collection: newCollection,
                            actions: null,
                            isAuthorized: true,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // The authorization status in our store wins, use that instead of updating the
                    // authorization event number.
                    if (collectionEntry.authorizationEventNumber >= event.number) {
                        // Optimization: If nothing in our entry changed then return the referentially
                        // identical entry so we don't have to update the map.
                        if (newCollection === collectionEntry.collection) return collectionEntry;

                        return {
                            // We update the collection even if it's unauthorized since we may receive
                            // events out-of-order.
                            collection: newCollection,
                            actions: null,
                            isAuthorized: collectionEntry.isAuthorized,
                            authorizationEventNumber: collectionEntry.authorizationEventNumber,
                        };
                    }

                    return {
                        collection: newCollection,
                        actions: null,
                        isAuthorized: true,
                        authorizationEventNumber: event.number,
                    };
                },
            );
        }

        // Backfill unauthorized collections:
        for (const backfillUnauthorizedCollectionId of event.backfillUnauthorizedCollectionIds) {
            collectionById = collectionById.update(
                backfillUnauthorizedCollectionId,
                (collectionEntry): TaskModelStoreCollectionEntry => {
                    if (!collectionEntry) {
                        return {
                            collection: null,
                            actions: [],
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state is unknown, mark the collection as unauthorized.
                    if (collectionEntry.isAuthorized === null) {
                        return {
                            ...collectionEntry,
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state in the store wins. We may be applying events
                    // out-of-order. We return a referentially identical entry to avoid updating
                    // the map.
                    if (collectionEntry.authorizationEventNumber >= event.number)
                        return collectionEntry;

                    return {
                        ...collectionEntry,
                        isAuthorized: false,
                        authorizationEventNumber: event.number,
                    };
                },
            );
        }

        // Apply actions:
        for (const action of event.actions) {
            switch (action.type) {
                case "UpdateTask": {
                    taskById = taskById.update(
                        action.taskId,
                        (taskEntry): TaskModelStoreTaskEntry => {
                            if (!taskEntry) {
                                return {
                                    task: null,
                                    actions: [action],
                                    isAuthorized: null,
                                    authorizationEventNumber: null,
                                };
                            }

                            if (taskEntry.task === null) {
                                if (action.taskAction.type !== "Create") {
                                    return {
                                        ...taskEntry,
                                        actions: [...taskEntry.actions, action],
                                    };
                                } else {
                                    let newTask = TaskModel.createFromAction(
                                        this._spaceId,
                                        action.taskId,
                                        action.time,
                                        action.taskAction,
                                    );

                                    // Apply any actions we received out-of-order now that the task has
                                    // been created.
                                    newTask = taskEntry.actions.reduce(
                                        (task, action) => task.apply(action),
                                        newTask,
                                    );

                                    return {
                                        task: newTask,
                                        actions: null,
                                        // If we receive the create event for a task we assume it to be
                                        // authorized. In practice when a task is created we'll get a backfill for the
                                        // task instead of the create action.
                                        isAuthorized: taskEntry.isAuthorized ?? true,
                                        authorizationEventNumber:
                                            taskEntry.authorizationEventNumber ?? event.number,
                                    };
                                }
                            }

                            const newTask = taskEntry.task.apply(action);

                            // Optimization: If the task didn't change then don't update our store.
                            if (newTask === taskEntry.task) return taskEntry;

                            return {
                                task: newTask,
                                actions: null,
                                isAuthorized: taskEntry.isAuthorized,
                                authorizationEventNumber: taskEntry.authorizationEventNumber,
                            };
                        },
                    );
                    break;
                }
                case "UpdateCollection": {
                    collectionById = collectionById.update(
                        action.collectionId,
                        (collectionEntry): TaskModelStoreCollectionEntry => {
                            if (!collectionEntry) {
                                return {
                                    collection: null,
                                    actions: [action],
                                    isAuthorized: null,
                                    authorizationEventNumber: null,
                                };
                            }

                            if (collectionEntry.collection === null) {
                                if (action.collectionAction.type !== "Create") {
                                    return {
                                        ...collectionEntry,
                                        actions: [...collectionEntry.actions, action],
                                    };
                                } else {
                                    let newCollection = TaskCollectionModel.createFromAction(
                                        this._spaceId,
                                        action.collectionId,
                                        action.time,
                                        action.collectionAction,
                                    );

                                    // Apply any actions we received out-of-order now that the task has
                                    // been created.
                                    newCollection = collectionEntry.actions.reduce(
                                        (task, action) => task.apply(action),
                                        newCollection,
                                    );

                                    return {
                                        collection: newCollection,
                                        actions: null,
                                        // If we receive the create event for a collection we assume it to be
                                        // authorized. In practice when a collection is created we'll get a backfill
                                        // for the collection instead of the create action.
                                        isAuthorized: collectionEntry.isAuthorized ?? true,
                                        authorizationEventNumber:
                                            collectionEntry.authorizationEventNumber ??
                                            event.number,
                                    };
                                }
                            }

                            const newCollection = collectionEntry.collection.apply(action);

                            // Optimization: If the collection didn't change then don't update our store.
                            if (newCollection === collectionEntry.collection)
                                return collectionEntry;

                            return {
                                collection: newCollection,
                                actions: null,
                                isAuthorized: collectionEntry.isAuthorized,
                                authorizationEventNumber: collectionEntry.authorizationEventNumber,
                            };
                        },
                    );
                    break;
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

        let queryById = this._queryById;

        // If our tasks changed then report those changes to all our queries in case it
        // effects the query's output.
        if (taskById !== this._taskById) {
            const newQueryById = new Map<TaskQueryModelId, TaskQueryModel>(queryById);
            queryById = newQueryById;

            for (const change of this._taskById.symmetricDiff(taskById)) {
                switch (change.type) {
                    case "CreateEntry": {
                        for (const [queryId, query] of newQueryById) {
                            if (change.newValue.task === null) continue;

                            const newQuery = query.onTaskCreate(change.newValue.task);
                            if (query !== newQuery) newQueryById.set(queryId, newQuery);
                        }
                        break;
                    }
                    case "UpdateEntry": {
                        for (const [queryId, query] of newQueryById) {
                            // Tasks do not go from initialized to uninitialized in this function.
                            if (change.newValue.task === null) continue;

                            if (change.oldValue.task === null) {
                                const newQuery = query.onTaskCreate(change.newValue.task);
                                if (query !== newQuery) newQueryById.set(queryId, newQuery);
                            } else {
                                const newQuery = query.onTaskUpdate(
                                    change.oldValue.task,
                                    change.newValue.task,
                                );
                                if (query !== newQuery) newQueryById.set(queryId, newQuery);
                            }
                        }
                        break;
                    }
                    case "DeleteEntry": {
                        // We don't delete entries in this function.
                        break;
                    }
                    default:
                        throw exhaustive(change);
                }
            }
        }

        // Optimization: If nothing in the store changed while applying the update then
        // don't construct a new store. This will short-circuit any UI updates.
        if (
            taskById === this._taskById &&
            collectionById === this._collectionById &&
            queryById === this._queryById
        ) {
            return this;
        }

        return new TaskModelStore({
            spaceId: this._spaceId,
            taskById,
            collectionById,
            queryById,
        });
    }

    /**
     * Creates a new query model in our store. The query will be kept up-to-date in
     * realtime whenever there's a change to a task that affects the query.
     */
    public newQuery(
        queryId: TaskQueryModelId,
        {
            filters,
            sorts,
        }: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        },
    ): TaskModelStore {
        assert(!this._queryById.has(queryId));

        const queryById = new Map(this._queryById);

        const query = TaskQueryModel.new({filters, sorts});
        queryById.set(queryId, query);

        return new TaskModelStore({
            spaceId: this._spaceId,
            taskById: this._taskById,
            collectionById: this._collectionById,
            queryById,
        });
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
        queryId: TaskQueryModelId,
        {
            loadedState,
            previouslyBackfilledTaskIds,
        }: {
            loadedState: TaskRealtimeQueryLoadedState;
            previouslyBackfilledTaskIds: ReadonlyArray<TaskId>;
        },
    ) {
        let query = assertExists(this._queryById.get(queryId));

        for (const taskId of previouslyBackfilledTaskIds) {
            const taskEntry = this._taskById.get(taskId);

            // The server only includes tasks in `previouslyBackfilledTaskIds` that it has
            // previously backfilled in our client in the `backfillAuthorizedTasks`
            // property of a `TaskRealtimeUpdateEvent` event. If the server sends a task
            // the server hasn't backfilled then the server is broken.
            //
            // Instead of trying to silently recover (which to the user is perceived as an
            // unexplainable glitch), loudly blow up.
            //
            // NOTE(calebmer, 2023-08-31): At some point we'd like to implement task
            // garbage collection. Some care will need to be taken to make sure we don't
            // break this assertion. We can't garbage collect tasks the server assumes the
            // client has and will attempt to reference in the future!
            assert(taskEntry?.task);

            query = query.maybeAddVisibleTask(taskEntry.task);
        }

        query = query.extendLoadedState(loadedState);

        const queryById = new Map(this._queryById);
        queryById.set(queryId, query);

        return new TaskModelStore({
            spaceId: this._spaceId,
            taskById: this._taskById,
            collectionById: this._collectionById,
            queryById,
        });
    }

    /**
     * Iterate through all the queries in our store.
     */
    public iterateQueries() {
        return this._queryById;
    }
}
