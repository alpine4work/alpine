import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/task_model.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";

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

    private constructor({
        spaceId,
        taskById,
        collectionById,
    }: {
        spaceId: SpaceId;
        taskById: ImmutableMap<TaskId, TaskModelStoreTaskEntry>;
        collectionById: ImmutableMap<TaskCollectionId, TaskModelStoreCollectionEntry>;
    }) {
        this._spaceId = spaceId;
        this._taskById = taskById;
        this._collectionById = collectionById;
    }

    public static new({spaceId}: {spaceId: SpaceId}) {
        return new TaskModelStore({
            spaceId,
            taskById: ImmutableMap.empty(),
            collectionById: ImmutableMap.empty(),
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
            taskById = taskById.update(backfillTask.id, (entry): TaskModelStoreTaskEntry => {
                if (!entry) {
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
                if (entry.task === null) {
                    newTask = entry.actions.reduce(
                        (task, action) => task.apply(action),
                        backfillTask,
                    );
                } else {
                    newTask = entry.task.merge(backfillTask);
                }

                // Authorization state is unknown, mark the task as authorized.
                if (entry.isAuthorized === null) {
                    return {
                        task: newTask,
                        actions: null,
                        isAuthorized: true,
                        authorizationEventNumber: event.number,
                    };
                }

                // The authorization status in our store wins, use that instead of updating the
                // authorization event number.
                if (entry.authorizationEventNumber >= event.number) {
                    // Optimization: If nothing in our entry changed then return the referentially
                    // identical entry so we don't have to update the map.
                    if (newTask === entry.task) return entry;

                    return {
                        // We update the task even if it's unauthorized since we may receive events
                        // out-of-order.
                        task: newTask,
                        actions: null,
                        isAuthorized: entry.isAuthorized,
                        authorizationEventNumber: entry.authorizationEventNumber,
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
                (entry): TaskModelStoreTaskEntry => {
                    if (!entry) {
                        return {
                            task: null,
                            actions: [],
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state is unknown, mark the task as unauthorized.
                    if (entry.isAuthorized === null) {
                        return {
                            ...entry,
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state in the store wins. We may be applying events
                    // out-of-order. We return a referentially identical entry to avoid updating
                    // the map.
                    if (entry.authorizationEventNumber >= event.number) return entry;

                    return {
                        ...entry,
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
                (entry): TaskModelStoreCollectionEntry => {
                    if (!entry) {
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
                    if (entry.collection === null) {
                        newCollection = entry.actions.reduce(
                            (collection, action) => collection.apply(action),
                            backfillCollection,
                        );
                    } else {
                        newCollection = entry.collection.merge(backfillCollection);
                    }

                    // Authorization state is unknown, mark the collection as authorized.
                    if (entry.isAuthorized === null) {
                        return {
                            collection: newCollection,
                            actions: null,
                            isAuthorized: true,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // The authorization status in our store wins, use that instead of updating the
                    // authorization event number.
                    if (entry.authorizationEventNumber >= event.number) {
                        // Optimization: If nothing in our entry changed then return the referentially
                        // identical entry so we don't have to update the map.
                        if (newCollection === entry.collection) return entry;

                        return {
                            // We update the collection even if it's unauthorized since we may receive
                            // events out-of-order.
                            collection: newCollection,
                            actions: null,
                            isAuthorized: entry.isAuthorized,
                            authorizationEventNumber: entry.authorizationEventNumber,
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
                (entry): TaskModelStoreCollectionEntry => {
                    if (!entry) {
                        return {
                            collection: null,
                            actions: [],
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state is unknown, mark the collection as unauthorized.
                    if (entry.isAuthorized === null) {
                        return {
                            ...entry,
                            isAuthorized: false,
                            authorizationEventNumber: event.number,
                        };
                    }

                    // Authorization state in the store wins. We may be applying events
                    // out-of-order. We return a referentially identical entry to avoid updating
                    // the map.
                    if (entry.authorizationEventNumber >= event.number) return entry;

                    return {
                        ...entry,
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
                    taskById = taskById.update(action.taskId, (entry): TaskModelStoreTaskEntry => {
                        if (!entry) {
                            return {
                                task: null,
                                actions: [action],
                                isAuthorized: null,
                                authorizationEventNumber: null,
                            };
                        }

                        if (entry.task === null) {
                            if (action.taskAction.type !== "Create") {
                                return {
                                    ...entry,
                                    actions: [...entry.actions, action],
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
                                newTask = entry.actions.reduce(
                                    (task, action) => task.apply(action),
                                    newTask,
                                );

                                return {
                                    task: newTask,
                                    actions: null,
                                    // If we receive the create event for a task we assume it to be
                                    // authorized. In practice when a task is created we'll get a backfill for the
                                    // task instead of the create action.
                                    isAuthorized: entry.isAuthorized ?? true,
                                    authorizationEventNumber:
                                        entry.authorizationEventNumber ?? event.number,
                                };
                            }
                        }

                        const newTask = entry.task.apply(action);

                        // Optimization: If the task didn't change then don't update our store.
                        if (newTask === entry.task) return entry;

                        return {
                            task: newTask,
                            actions: null,
                            isAuthorized: entry.isAuthorized,
                            authorizationEventNumber: entry.authorizationEventNumber,
                        };
                    });
                    break;
                }
                case "UpdateCollection": {
                    collectionById = collectionById.update(
                        action.collectionId,
                        (entry): TaskModelStoreCollectionEntry => {
                            if (!entry) {
                                return {
                                    collection: null,
                                    actions: [action],
                                    isAuthorized: null,
                                    authorizationEventNumber: null,
                                };
                            }

                            if (entry.collection === null) {
                                if (action.collectionAction.type !== "Create") {
                                    return {
                                        ...entry,
                                        actions: [...entry.actions, action],
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
                                    newCollection = entry.actions.reduce(
                                        (task, action) => task.apply(action),
                                        newCollection,
                                    );

                                    return {
                                        collection: newCollection,
                                        actions: null,
                                        // If we receive the create event for a collection we assume it to be
                                        // authorized. In practice when a collection is created we'll get a backfill
                                        // for the collection instead of the create action.
                                        isAuthorized: entry.isAuthorized ?? true,
                                        authorizationEventNumber:
                                            entry.authorizationEventNumber ?? event.number,
                                    };
                                }
                            }

                            const newCollection = entry.collection.apply(action);

                            // Optimization: If the collection didn't change then don't update our store.
                            if (newCollection === entry.collection) return entry;

                            return {
                                collection: newCollection,
                                actions: null,
                                isAuthorized: entry.isAuthorized,
                                authorizationEventNumber: entry.authorizationEventNumber,
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

        // Optimization: If nothing in the store changed while applying the update then
        // don't construct a new store. This will short-circuit any UI updates.
        if (taskById === this._taskById && collectionById === this._collectionById) {
            return this;
        }

        return new TaskModelStore({
            spaceId: this._spaceId,
            taskById,
            collectionById,
        });
    }
}
