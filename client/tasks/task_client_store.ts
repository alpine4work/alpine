import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {joinPrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {Store} from "~/client/helpers/store/store.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery, TaskClientQueryInternal} from "~/client/tasks/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {getSynchronizedSystemClock} from "~/client/tracer/synchronized_system_clock.js";
import {Context} from "~/shared/context/context.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {Clock} from "~/shared/helpers/clock/clock.js";
import {
    HybridLogicalClock,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {
    TaskAction,
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskTitleUpdate, mergeTaskTitleUpdates} from "~/shared/tasks/task_title.js";

export type TaskClientStoreTaskEntry =
    // Task initialized and known authorization state:
    | {
          readonly task: TaskModel;
          readonly actions: null;
          readonly optimisticState: TaskClientStoreTaskEntryOptimisticState | null;
          readonly isAuthorized: boolean;
          readonly authorizationEventNumber: number;
      }
    // Task uninitialized and known authorization state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskUpdateTaskAction>;
          readonly optimisticState:
              | (TaskClientStoreTaskEntryOptimisticState & {original: {task: null}})
              | null;
          readonly isAuthorized: boolean;
          readonly authorizationEventNumber: number;
      }
    // Task uninitialized and unknown authorization state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskUpdateTaskAction>;
          readonly optimisticState:
              | (TaskClientStoreTaskEntryOptimisticState & {original: {task: null}})
              | null;
          readonly isAuthorized: null;
          readonly authorizationEventNumber: null;
      };

/**
 * If the task has some optimistic updates then this optimistic state object
 * will be populated on the task entry until the server either accepts or
 * rejects our actions.
 *
 * We keep track of the original task before any optimistic updates and all
 * actions (optimistic and non-optimistic) after. If one of our optimistic
 * actions fails then we take the original task, apply all the actions in our
 * optimistic state excluding the failed action, and set that as our new
 * `TaskModel`. This effectively reverts the failed action.
 */
// NOTE(calebmer, 2023-09-08): Instead of adding non-optimistic updates to an
// `actions` array could we directly apply them to `original`? Would this
// simplify the code?
export type TaskClientStoreTaskEntryOptimisticState = {
    readonly original:
        | {
              readonly task: TaskModel;
              readonly actions: null;
          }
        | {
              readonly task: null;
              readonly actions: ReadonlyArray<TaskUpdateTaskAction>;
          };
    readonly actions: ReadonlyArray<{
        readonly isOptimistic: boolean;
        readonly action: TaskUpdateTaskAction;
    }>;
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
    private readonly _internal: TaskClientStoreInternal;
    public readonly accountStore: AccountClientStore;
    public readonly spaceId: SpaceId;
    public readonly clock: HybridLogicalClock;

    constructor({
        accountStore,
        spaceId,
        onDisplayError,
    }: {
        accountStore: AccountClientStore;
        spaceId: SpaceId;
        onDisplayError: (options: {title: string; error: unknown}) => void;
    }) {
        this._internal = new TaskClientStoreInternal(this, {
            accountStore,
            spaceId,
            onDisplayError,
        });
        this.accountStore = this._internal.accountStore;
        this.spaceId = this._internal.spaceId;
        this.clock = this._internal.clock;
    }

    public getTaskCountForTest() {
        return this._internal.getTaskCountForTest();
    }

    public getCollectionCountForTest() {
        return this._internal.getCollectionCountForTest();
    }

    public getTaskEntryStoreIfExists(taskId: TaskId) {
        return this._internal.getTaskEntryStoreIfExists(taskId);
    }

    public getCollectionEntryStoreIfExists(collectionId: TaskCollectionId) {
        return this._internal.getCollectionEntryStoreIfExists(collectionId);
    }

    public getSubscriptionsStore() {
        return this._internal.getSubscriptionsStore();
    }

    public applyUpdateEvent(event: TaskRealtimeUpdateEvent): void {
        this._internal.applyUpdateEvent(event);
    }

    public subscribeToBatchUpdate(
        listener: (
            taskEntryUpdateById: ReadonlyMap<
                TaskId,
                {
                    readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;
                    readonly oldTaskEntry: TaskClientStoreTaskEntry | null;
                    readonly newTaskEntry: TaskClientStoreTaskEntry;
                }
            >,
        ) => void,
    ) {
        return this._internal.subscribeToBatchUpdate(listener);
    }

    public commitTaskActionTransaction(
        context: Context<{rpc: RpcContextModuleBase}>,
        actions: ReadonlyArray<TaskAction>,
    ): {finally: (callback: () => void) => void} {
        return this._internal.commitTaskActionTransaction(context, actions);
    }

    public getTaskUpdateTitleActionTransactionBuilder(
        taskId: TaskId,
        initialTitleUpdate: TaskTitleUpdate,
    ): {
        add: (titleUpdate: TaskTitleUpdate) => void;
        commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
            finally: (callback: () => void) => void;
        };
    } {
        return this._internal.getTaskUpdateTitleActionTransactionBuilder(
            taskId,
            initialTitleUpdate,
        );
    }

    public deleteTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
    ): {finally: (callback: () => void) => void} {
        return this._internal.deleteTaskAndAllChildren(context, taskId);
    }

    public createAndRetainQuery(options: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }): TaskClientQuery {
        return this._internal.createAndRetainQuery(options);
    }

    public createAndRetainQueries(
        queries: ReadonlyArray<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        }>,
    ): Array<TaskClientQuery> {
        return this._internal.createAndRetainQueries(queries);
    }

    public loadTasksIntoQuery(
        query: TaskClientQuery,
        options: {
            limit: number;
            loadedState: TaskRealtimeQueryLoadedState;
            previouslyBackfilledTaskIds: ReadonlyArray<TaskId>;
        },
    ): void {
        this._internal.loadTasksIntoQuery(query, options);
    }

    public ensureAndRetainTaskChildrenQuery(parentTaskId: TaskId): TaskClientQuery {
        return this._internal.ensureAndRetainTaskChildrenQuery(parentTaskId);
    }

    public getTaskChildrenQueryStore(parentTaskId: TaskId): Store<TaskClientQuery | undefined> {
        return this._internal.getTaskChildrenQueryStore(parentTaskId);
    }

    public createAndRetainTaskSubscription(taskId: TaskId): TaskClientTaskSubscription {
        return this._internal.createAndRetainTaskSubscription(taskId);
    }

    public createAndRetainCollectionSubscription(
        collectionId: TaskCollectionId,
    ): TaskClientCollectionSubscription {
        return this._internal.createAndRetainCollectionSubscription(collectionId);
    }
}

export class TaskClientStoreInternal {
    public readonly external: TaskClientStore;

    public readonly accountStore: AccountClientStore;
    public readonly spaceId: SpaceId;
    private readonly _onDisplayError: (options: {title: string; error: unknown}) => void;

    /**
     * The clock we use on the client for assigning a time to actions. This clock
     * is backed by our client's synchronized system clock which uses an NTP
     * protocol with the server to get within a few milliseconds of the
     * correct time.
     */
    public readonly clock: HybridLogicalClock;

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
    private readonly _taskEntryStoreById = new AdvancedWeakValuesMap<
        TaskId,
        ValueStore<TaskClientStoreTaskEntry>
    >();

    /**
     * The collections currently in our store.
     *
     * Like `taskById`, it's not guaranteed that a collection is up-to-date if it's
     * in this map. See the documentation on `taskById` for more of an explanation.
     */
    private readonly _collectionEntryStoreById = new AdvancedWeakValuesMap<
        TaskCollectionId,
        ValueStore<TaskClientStoreCollectionEntry>
    >();

    /**
     * The various subscriptions our client is currently holding on to.
     */
    private readonly _subscriptionsStore = new ValueStore<{
        readonly queries: ReadonlySet<TaskClientQuery>;
        readonly taskSubscriptions: ReadonlySet<TaskClientTaskSubscription>;
        readonly collectionSubscriptions: ReadonlySet<TaskClientCollectionSubscription>;
    }>({
        queries: new Set(),
        taskSubscriptions: new Set(),
        collectionSubscriptions: new Set(),
    });

    /**
     * Queries for the child tasks of a given parent task.
     */
    private readonly _taskChildrenQueryByParentTaskId = new StoreMap<TaskId, TaskClientQuery>();

    /**
     * We want to send our `commitTaskActionTransaction()` calls in order. If one
     * transaction creates a task and another updates that task we need to wait for
     * the task creation transaction to commit. This mutex coordinates the queue.
     */
    private readonly _commitTaskActionTransactionMutex = new Mutex();

    constructor(
        external: TaskClientStore,
        {
            accountStore,
            spaceId,
            onDisplayError,
        }: {
            accountStore: AccountClientStore;
            spaceId: SpaceId;
            onDisplayError: (options: {title: string; error: unknown}) => void;
        },
    ) {
        this.external = external;
        this.accountStore = accountStore;
        this.spaceId = spaceId;
        this._onDisplayError = onDisplayError;

        const synchronizedSystemClockPromise = getSynchronizedSystemClock();
        let synchronizedSystemClock: Clock | null = null;

        this.clock = new HybridLogicalClock({
            now: () => {
                if (synchronizedSystemClock !== null) return synchronizedSystemClock.now();

                const synchronizedSystemClockPromiseState =
                    synchronizedSystemClockPromise.getStateWithoutListening();

                // While our synchronized system clock is loading (or if it failed to load) use
                // our unsynchronized system clock time.
                //
                // 90% of the time our synchronized system clock is available synchronously.
                // Because we add timing information to a `Server-Timing` HTTP header which is
                // available synchronously in JavaScript. The `Server-Timing` HTTP header is
                // unfortunately unavailable in Safari.
                if (synchronizedSystemClockPromiseState.status === "fulfilled") {
                    synchronizedSystemClock = synchronizedSystemClockPromiseState.value;
                    return synchronizedSystemClockPromiseState.value.now();
                } else {
                    return unsynchronizedSystemClock.now();
                }
            },
        });
    }

    public getTaskCountForTest() {
        assert(import.meta.jest);
        return this._taskEntryStoreById.getSizeForTest();
    }

    public getCollectionCountForTest() {
        assert(import.meta.jest);
        return this._collectionEntryStoreById.getSizeForTest();
    }

    public getSubscriptionsStore(): Store<{
        readonly queries: ReadonlySet<TaskClientQuery>;
        readonly taskSubscriptions: ReadonlySet<TaskClientTaskSubscription>;
        readonly collectionSubscriptions: ReadonlySet<TaskClientCollectionSubscription>;
    }> {
        // Importantly our return type returns a `Store` not a `ValueStore`. Callers
        // shouldn't be able to access `set()`.
        return this._subscriptionsStore;
    }

    public getTaskEntryStoreIfExists(taskId: TaskId): Store<TaskClientStoreTaskEntry> | null {
        return this._taskEntryStoreById.get(taskId) ?? null;
    }

    public getCollectionEntryStoreIfExists(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry> | null {
        return this._collectionEntryStoreById.get(collectionId) ?? null;
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
                // This backfill introduced new data. Make sure our logical clock's time is
                // beyond any times used in this object.
                backfillTask.tick(this.clock);

                newTaskEntryById.set(backfillTask.id, {
                    task: backfillTask,
                    actions: null,
                    optimisticState: null,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // When backfilling the task, we may have received actions out-of-order from
            // the server or we may have some out-of-order optimistic actions. We need to
            // apply actions we received (from the server and optimistic) to the task. We
            // also need to update our original task in `optimisticState` so if we need to
            // revert an optimistic action we preserve the backfilled task.
            let newTask: TaskModel;
            let newOptimisticState: TaskClientStoreTaskEntryOptimisticState | null;
            if (oldTaskEntry.task === null) {
                newTask = backfillTask;

                newTask = oldTaskEntry.actions.reduce(
                    (task, action) => task.apply(action),
                    newTask,
                );

                if (oldTaskEntry.optimisticState === null) {
                    newOptimisticState = null;
                } else {
                    newOptimisticState = {
                        original: {
                            task: backfillTask,
                            actions: null,
                        },
                        actions: oldTaskEntry.optimisticState.actions,
                    };
                }
            } else {
                newTask = oldTaskEntry.task.merge(backfillTask);

                if (oldTaskEntry.optimisticState === null) {
                    newOptimisticState = null;
                } else {
                    newOptimisticState = {
                        original: {
                            task:
                                oldTaskEntry.optimisticState.original.task === null
                                    ? oldTaskEntry.optimisticState.original.actions.reduce(
                                          (task, action) => task.apply(action),
                                          backfillTask,
                                      )
                                    : oldTaskEntry.optimisticState.original.task.merge(
                                          backfillTask,
                                      ),
                            actions: null,
                        },
                        actions: oldTaskEntry.optimisticState.actions,
                    };
                }
            }

            if (newTask !== oldTaskEntry.task) {
                // This backfill introduced new data. Make sure our logical clock's time is
                // beyond any times used in this object.
                newTask.tick(this.clock);
            }

            // Authorization state is unknown, mark the task as authorized.
            if (oldTaskEntry.isAuthorized === null) {
                newTaskEntryById.set(backfillTask.id, {
                    task: newTask,
                    actions: null,
                    optimisticState: newOptimisticState,
                    isAuthorized: true,
                    authorizationEventNumber: event.number,
                });
                continue;
            }

            // The authorization status in our store wins, use that instead of updating the
            // authorization event number.
            if (oldTaskEntry.authorizationEventNumber >= event.number) {
                // If nothing in our entry changed then don't update the task.
                if (
                    newTask === oldTaskEntry.task &&
                    newOptimisticState?.original.task ===
                        oldTaskEntry.optimisticState?.original.task
                ) {
                    continue;
                }

                newTaskEntryById.set(backfillTask.id, {
                    // We update the task even if it's unauthorized since we may receive events
                    // out-of-order.
                    task: newTask,
                    actions: null,
                    optimisticState: newOptimisticState,
                    isAuthorized: oldTaskEntry.isAuthorized,
                    authorizationEventNumber: oldTaskEntry.authorizationEventNumber,
                });
                continue;
            }

            newTaskEntryById.set(backfillTask.id, {
                task: newTask,
                actions: null,
                optimisticState: newOptimisticState,
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
                    optimisticState: null,
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
                // This backfill introduced new data. Make sure our logical clock's time is
                // beyond any times used in this object.
                backfillCollection.tick(this.clock);

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

            if (newCollection !== oldCollectionEntry.collection) {
                // This backfill introduced new data. Make sure our logical clock's time is
                // beyond any times used in this object.
                newCollection.tick(this.clock);
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
            // All actions our client commits will have a greater logical time than the
            // actions we've already seen.
            this.clock.tick(action.time);

            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.getSnapshot();

                    if (!oldTaskEntry) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                task: null,
                                actions: [action],
                                optimisticState: null,
                                isAuthorized: null,
                                authorizationEventNumber: null,
                            });
                        } else {
                            const newTask = TaskModel.createFromAction(
                                this.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                            );

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: null,
                                // If we receive the create event for a task we assume it to be
                                // authorized. In practice when a task is created we'll get a backfill for the
                                // task instead of the create action.
                                isAuthorized: true,
                                authorizationEventNumber: event.number,
                            });
                        }
                        continue;
                    }

                    if (oldTaskEntry.task === null) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                ...oldTaskEntry,
                                actions: [...oldTaskEntry.actions, action],
                                optimisticState: oldTaskEntry.optimisticState
                                    ? {
                                          original: oldTaskEntry.optimisticState.original,
                                          actions: [
                                              ...oldTaskEntry.optimisticState.actions,
                                              {isOptimistic: false, action},
                                          ],
                                      }
                                    : null,
                            });
                            continue;
                        } else {
                            let newTask = TaskModel.createFromAction(
                                this.spaceId,
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

                            if (oldTaskEntry.optimisticState) {
                                newTask = oldTaskEntry.optimisticState.actions.reduce(
                                    (task, {action}) => task.apply(action),
                                    newTask,
                                );
                            }

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: oldTaskEntry.optimisticState
                                    ? {
                                          original: oldTaskEntry.optimisticState.original,
                                          actions: [
                                              ...oldTaskEntry.optimisticState.actions,
                                              {isOptimistic: false, action},
                                          ],
                                      }
                                    : null,
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

                    // Optimization: If the task didn't change and we don't have optimistic state
                    // for the task then don't update our store.
                    if (newTask === oldTaskEntry.task && oldTaskEntry.optimisticState === null) {
                        continue;
                    }

                    newTaskEntryById.set(action.taskId, {
                        task: newTask,
                        actions: null,
                        optimisticState: oldTaskEntry.optimisticState
                            ? {
                                  original: oldTaskEntry.optimisticState.original,
                                  actions: [
                                      ...oldTaskEntry.optimisticState.actions,
                                      {isOptimistic: false, action},
                                  ],
                              }
                            : null,
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
                                this.spaceId,
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

        this._updateStore(newTaskEntryById, newCollectionEntryById);
    }

    /**
     * Makes a change to the tasks in this space as the current user. We
     * optimistically make the change and send a network request to the server. If
     * the server responds without an error, great! Our tasks don't need to change.
     * If the server responds with an error then we need to revert the changes made
     * by this transaction.
     *
     * To accomplish this revert, while we're waiting on the server to accept or
     * reject our transaction we keep track of all changes made to the task. If the
     * server rejects our update then we take the original task and apply all
     * actions we saw after our optimistic action excluding the optimistic action.
     */
    public commitTaskActionTransaction(
        context: Context<{rpc: RpcContextModuleBase}>,
        actions: ReadonlyArray<TaskAction>,
    ): {finally: (callback: () => void) => void} {
        // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
        // close the page if we haven't finished committing their task action. It will
        // look committed on their machine but might not be on the server.
        const commitPromise = this._commitTaskActionTransactionMutex.withLock(() =>
            commitTaskActionTransaction(context, {
                spaceId: this.spaceId,
                actions,
            }),
        );

        const optimisticExtraActions = this._getOptimisticExtraActions(actions);

        const optimisticExtraActionsByTaskId = new Map<TaskId, Array<TaskAction>>();
        for (const action of optimisticExtraActions) {
            getOrSetDefaultMapValue(optimisticExtraActionsByTaskId, action.taskId, () => []).push(
                action,
            );
        }

        this._applyOptimisticTaskActions(
            optimisticExtraActions.length > 0 ? [...actions, ...optimisticExtraActions] : actions,
        );

        commitPromise.then(
            ({extraActions, referencedAccounts}) => {
                // Between applying an update event and committing our optimistic actions we
                // have a lot of store updates we want to batch together.
                batchStoreUpdates(() => {
                    this._commitOptimisticTaskActions(actions);

                    // The code below is all about reconciling `optimisticExtraActions`. The
                    // procedure is:
                    //
                    // 1. Apply `extraActions` from the server
                    // 2. Commit any `optimisticExtraActions` that "match" the `extraActions` from
                    //    the server and revert any that don't
                    //
                    // Our check that `optimisticExtraActions` match `extraActions` tests whether
                    // applying `optimisticExtraActions` at this point would be a noop. If it would
                    // be a noop then we consider `optimisticExtraActions` to match `extraActions`.

                    const taskByIdBeforeExtraActions = new Map<TaskId, TaskModel | null>();
                    for (const taskId of optimisticExtraActionsByTaskId.keys()) {
                        taskByIdBeforeExtraActions.set(
                            taskId,
                            this._taskEntryStoreById.get(taskId)?.getSnapshot().task ?? null,
                        );
                    }

                    if (extraActions.length > 0) {
                        this.applyUpdateEvent({
                            type: "Update",
                            // NOCOMMIT: Proper event number?
                            number: 0,
                            actions: extraActions,
                            backfillAuthorizedTasks: [],
                            backfillUnauthorizedTaskIds: [],
                            backfillAuthorizedCollections: [],
                            backfillUnauthorizedCollectionIds: [],
                            referencedAccounts,
                        });
                    }

                    for (const [taskId, optimisticExtraActions] of optimisticExtraActionsByTaskId) {
                        const taskEntry = this._taskEntryStoreById.get(taskId)?.getSnapshot();

                        // This task:
                        //
                        // - Has `optimisticExtraActions` applied
                        // - Does not have `extraActions` applied
                        const taskBeforeExtraActions =
                            taskByIdBeforeExtraActions.get(taskId) ?? null;

                        // In the most common case we'll have a task entry with some optimistic state
                        // and an original task. In unexpected cases perform the safe logic of
                        // reverting optimistic extra task actions. Since we apply the true extra
                        // actions above.
                        //
                        // These unexpected cases are:
                        //
                        // - If there is no task entry (maybe it was garbage collected); OR
                        // - If there is no optimistic state (maybe it was garbage collected); OR
                        // - If there is no original task; OR
                        // - If there was no task entry before applying `extraActions`
                        if (!taskEntry?.optimisticState?.original.task || !taskBeforeExtraActions) {
                            this._revertOptimisticTaskActions(optimisticExtraActions);
                            continue;
                        }

                        // This task:
                        //
                        // - Has `extraActions` applied
                        // - Does not have `optimisticExtraActions` applied
                        const taskWithoutOptimisticExtraActions =
                            taskEntry.optimisticState.actions.reduce(
                                (task, {action}) =>
                                    !optimisticExtraActions.includes(action)
                                        ? task.apply(action)
                                        : task,
                                taskEntry.optimisticState.original.task,
                            );

                        // We want to check that `optimisticExtraActions` are a noop after
                        // `extraActions` are applied. If they are not a noop then our generated
                        // `optimisticExtraActions` are incorrect and the server sent us the real extra
                        // actions.
                        //
                        // We know `optimisticExtraActions` are a noop if a task with `extraActions`
                        // but not `optimisticExtraActions` survives a merge with a task that has
                        // `optimisticExtraActions`. That means the task with `optimisticExtraActions`
                        // does not contribute any changes to the final, merged, task.
                        if (
                            taskWithoutOptimisticExtraActions.merge(taskBeforeExtraActions) ===
                            taskWithoutOptimisticExtraActions
                        ) {
                            this._commitOptimisticTaskActions(optimisticExtraActions);
                        } else {
                            this._revertOptimisticTaskActions(optimisticExtraActions);
                        }
                    }
                });
            },
            error => {
                const taskIds = new Set<TaskId>();
                const collectionIds = new Set<TaskCollectionId>();
                let notepadPageCount = 0;

                for (const action of actions) {
                    switch (action.type) {
                        case "UpdateTask": {
                            taskIds.add(action.taskId);
                            break;
                        }
                        case "UpdateCollection": {
                            collectionIds.add(action.collectionId);
                            break;
                        }
                        case "UpdateNotepadPage": {
                            notepadPageCount++;
                            break;
                        }
                        default:
                            throw exhaustive(action);
                    }
                }

                const failedNouns = [];
                if (taskIds.size > 0) {
                    failedNouns.push(taskIds.size === 1 ? "task" : "tasks");
                }
                if (collectionIds.size > 0) {
                    failedNouns.push(collectionIds.size === 1 ? "collection" : "collections");
                }
                if (notepadPageCount > 0) {
                    failedNouns.push("notepad");
                }

                this._onDisplayError({
                    title:
                        failedNouns.length === 0
                            ? "Couldn’t save changes"
                            : `Couldn’t save changes to ${joinPrettyConjunctionList(
                                  failedNouns,
                                  "and",
                              )}`,
                    error,
                });

                this._revertOptimisticTaskActions(
                    optimisticExtraActions.length > 0
                        ? [...actions, ...optimisticExtraActions]
                        : actions,
                );
            },
        );

        return {
            finally: callback => {
                commitPromise.finally(callback);
            },
        };
    }

    /**
     * Helps build a merged task `UpdateTitle` transaction from many individual
     * actions. Each individual `UpdateTitle` transaction is applied optimistically
     * to our store but when `commit()` is called we send one, merged, action to
     * the server.
     *
     * We only send one `UpdateTitle` action at a time so it's naturally throttled
     * by the network. If the user's network is slow we send fewer, larger,
     * `UpdateTitle` actions. If the user's network is fast we send many smaller
     * `UpdateTitle` actions.
     *
     * Under the hood this has the same logic as `commitTaskActionTransaction()`
     * but allows you to merge individual actions into a single action for the
     * server.
     */
    public getTaskUpdateTitleActionTransactionBuilder(
        taskId: TaskId,
        initialTitleUpdate: TaskTitleUpdate,
    ): {
        add: (titleUpdate: TaskTitleUpdate) => void;
        commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
            finally: (callback: () => void) => void;
        };
    } {
        let isFinished = false;
        let mergedTitleUpdate = initialTitleUpdate;

        const actions: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time: this.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: initialTitleUpdate,
                },
            },
        ];

        this._applyOptimisticTaskActions(actions);

        return {
            add: (titleUpdate: TaskTitleUpdate) => {
                assert(!isFinished);

                mergedTitleUpdate = mergeTaskTitleUpdates(mergedTitleUpdate, titleUpdate);

                const action: TaskAction = {
                    type: "UpdateTask",
                    time: this.clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                };
                actions.push(action);

                this._applyOptimisticTaskActions([action]);
            },
            commit: context => {
                assert(!isFinished);
                isFinished = true;

                // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                // close the page if we haven't finished committing their task action. It will
                // look committed on their machine but might not be on the server.
                const commitPromise = this._commitTaskActionTransactionMutex.withLock(() =>
                    commitTaskActionTransaction(context, {
                        spaceId: this.spaceId,
                        actions: [
                            {
                                type: "UpdateTask",
                                time: this.clock.now(),
                                taskId,
                                taskAction: {
                                    type: "UpdateTitle",
                                    titleUpdate: mergedTitleUpdate,
                                },
                            },
                        ],
                    }),
                );

                commitPromise.then(
                    () => {
                        this._commitOptimisticTaskActions(actions);
                    },
                    error => {
                        this._onDisplayError({
                            title: "Couldn’t save changes to task",
                            error,
                        });

                        this._revertOptimisticTaskActions(actions);
                    },
                );

                return {
                    finally: callback => {
                        commitPromise.finally(callback);
                    },
                };
            },
        };
    }

    /**
     * Deletes a task and all of its children. We will optimistically delete the
     * task and any children of the task we've loaded. However, the task may have
     * more children that we haven't loaded. The server will send us the full list
     * of actions to commit.
     */
    public deleteTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
    ): {finally: (callback: () => void) => void} {
        const actionTime = this.clock.now();

        // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
        // close the page if we haven't finished committing their task action. It will
        // look committed on their machine but might not be on the server.
        const deletePromise = this._commitTaskActionTransactionMutex.withLock(() =>
            deleteTaskAndAllChildren(context, {
                taskId,
                actionTime,
            }),
        );

        const optimisticDeleteActions: Array<TaskUpdateTaskAction> = [];

        const addOptimisticDeleteActions = (taskId: TaskId) => {
            optimisticDeleteActions.push({
                type: "UpdateTask",
                time: actionTime,
                taskId,
                taskAction: {type: "Delete"},
            });

            const childrenQuery = this.getTaskChildrenQueryStore(taskId).getSnapshot();
            if (!childrenQuery) return;

            const childrenQueryIterator = childrenQuery.taskOrderStore.getSnapshot().begin;
            while (childrenQueryIterator.valid) {
                const childCursor = childrenQueryIterator.key!;
                addOptimisticDeleteActions(getTaskQuerySortCursorTaskId(childCursor));
                childrenQueryIterator.next();
            }
        };

        addOptimisticDeleteActions(taskId);

        // Get any extra actions from our delete (e.g. changing child task counts).
        const optimisticExtraActions = this._getOptimisticExtraActions(optimisticDeleteActions);

        const optimisticActions = [...optimisticDeleteActions, ...optimisticExtraActions];

        // All of our actions are associated with a task. Make our optimistic actions
        // easier to search by putting them in a map keyed by `TaskId`.
        const optimisticActionsByTaskId = new Map<TaskId, Array<TaskAction>>();
        for (const action of optimisticActions) {
            getOrSetDefaultMapValue(optimisticActionsByTaskId, action.taskId, () => []).push(
                action,
            );
        }

        this._applyOptimisticTaskActions(optimisticActions);

        deletePromise.then(
            ({actions, referencedAccounts}) => {
                // Batch committing optimistic actions and apply any other actions we did not
                // see optimistically.
                batchStoreUpdates(() => {
                    const newActions: Array<TaskAction> = [];
                    const matchedOptimisticActions = new Set<TaskAction>();

                    // For all the actions we ended up committing, look for an exact match with a
                    // corresponding optimistic action with `isDeepEqual()`.
                    //
                    // - If the action doesn't have an exact match with an optimistic action we'll
                    //   have to apply it
                    // - Otherwise if the action does have an exact match with an optimistic task we
                    //   should mark the optimistic task as committed
                    // - If we have optimistic tasks without an exact match then those optimistic
                    //   tasks were incorrect and need to be reverted
                    for (const action of actions) {
                        if (action.type !== "UpdateTask") {
                            newActions.push(action);
                            continue;
                        }

                        const optimisticActions = optimisticActionsByTaskId.get(action.taskId);
                        const matchedOptimisticAction = optimisticActions?.find(optimisticAction =>
                            isDeepEqual(action, optimisticAction),
                        );

                        if (matchedOptimisticAction) {
                            matchedOptimisticActions.add(matchedOptimisticAction);
                        } else {
                            newActions.push(action);
                        }
                    }

                    const unmatchedOptimisticActions: Array<TaskAction> = [];
                    for (const optimisticAction of optimisticActions) {
                        if (!matchedOptimisticActions.has(optimisticAction)) {
                            unmatchedOptimisticActions.push(optimisticAction);
                        }
                    }

                    if (matchedOptimisticActions.size > 0) {
                        this._commitOptimisticTaskActions(matchedOptimisticActions);
                    }

                    if (unmatchedOptimisticActions.length > 0) {
                        this._revertOptimisticTaskActions(unmatchedOptimisticActions);
                    }

                    if (newActions.length > 0) {
                        this.applyUpdateEvent({
                            type: "Update",
                            // NOCOMMIT: Proper event number?
                            number: 0,
                            actions,
                            backfillAuthorizedTasks: [],
                            backfillUnauthorizedTaskIds: [],
                            backfillAuthorizedCollections: [],
                            backfillUnauthorizedCollectionIds: [],
                            referencedAccounts,
                        });
                    }
                });
            },
            error => {
                this._onDisplayError({
                    title: "Couldn’t delete task",
                    error,
                });

                this._revertOptimisticTaskActions(optimisticActions);
            },
        );

        return {
            finally: callback => {
                deletePromise.finally(callback);
            },
        };
    }

    private _applyOptimisticTaskActions(actions: ReadonlyArray<TaskAction>) {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        // Apply actions optimistically:
        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.getSnapshot();

                    // If we do not have a task entry yet then let's create one.
                    if (!oldTaskEntry) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                task: null,
                                actions: [action],
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions: [],
                                    },
                                    actions: [{isOptimistic: true, action}],
                                },
                                isAuthorized: null,
                                authorizationEventNumber: null,
                            });
                            continue;
                        } else {
                            const newTask = TaskModel.createFromAction(
                                this.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                            );

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions: [],
                                    },
                                    actions: [{isOptimistic: true, action}],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                isAuthorized: true,
                                // NOCOMMIT: Proper authorization event number!!
                                authorizationEventNumber: 0,
                            });
                            continue;
                        }
                    }

                    if (oldTaskEntry.task === null) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                ...oldTaskEntry,
                                actions: [...oldTaskEntry.actions, action],
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions:
                                            oldTaskEntry.optimisticState?.original.actions ??
                                            oldTaskEntry.actions,
                                    },
                                    actions: [
                                        ...(oldTaskEntry.optimisticState?.actions ?? []),
                                        {isOptimistic: true, action},
                                    ],
                                },
                            });
                            continue;
                        } else {
                            let newTask = TaskModel.createFromAction(
                                this.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                            );

                            // Apply any actions we received now that the task has been created.
                            newTask = oldTaskEntry.actions.reduce(
                                (task, action) => task.apply(action),
                                newTask,
                            );

                            // Apply any optimistic actions we received now that the task has been created.
                            if (oldTaskEntry.optimisticState) {
                                newTask = oldTaskEntry.optimisticState.actions.reduce(
                                    (task, {action}) => task.apply(action),
                                    newTask,
                                );
                            }

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions:
                                            oldTaskEntry.optimisticState?.original.actions ??
                                            oldTaskEntry.actions,
                                    },
                                    actions: [
                                        ...(oldTaskEntry.optimisticState?.actions ?? []),
                                        {isOptimistic: true, action},
                                    ],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                isAuthorized: true,
                                // NOCOMMIT: Proper authorization event number!!
                                authorizationEventNumber: 0,
                            });
                            continue;
                        }
                    }

                    const newTask = oldTaskEntry.task.apply(action);

                    newTaskEntryById.set(action.taskId, {
                        task: newTask,
                        actions: null,
                        optimisticState: {
                            original: oldTaskEntry.optimisticState?.original ?? {
                                task: oldTaskEntry.task,
                                actions: null,
                            },
                            actions: [
                                ...(oldTaskEntry.optimisticState?.actions ?? []),
                                {isOptimistic: true, action},
                            ],
                        },
                        isAuthorized: oldTaskEntry.isAuthorized,
                        authorizationEventNumber: oldTaskEntry.authorizationEventNumber,
                    });
                    continue;
                }
                case "UpdateCollection": {
                    // NOCOMMIT: Optimistically update collections!
                    continue;
                }
                case "UpdateNotepadPage": {
                    // NOCOMMIT: I think something needs to be done here?
                    continue;
                }
                default:
                    throw exhaustive(action);
            }
        }

        this._updateStore(newTaskEntryById, newCollectionEntryById);
    }

    private _commitOptimisticTaskActions(actions: Iterable<TaskAction>) {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.getSnapshot();

                    // Entry has been garbage collected, ignore.
                    if (!oldTaskEntry) {
                        continue;
                    }

                    // Entry has been recreated since we added our action to optimistic
                    // state, ignore.
                    if (!oldTaskEntry.optimisticState) {
                        continue;
                    }

                    let newOptimisticActions = oldTaskEntry.optimisticState.actions.filter(
                        optimisticAction => optimisticAction.action !== action,
                    );

                    // Optimistic action is not present in task entry's optimistic state. Maybe
                    // entry has been recreated, ignore.
                    if (
                        newOptimisticActions.length === oldTaskEntry.optimisticState.actions.length
                    ) {
                        continue;
                    }

                    // Remove any `isOptimistic: false` actions from the start of the optimistic
                    // actions array. These are actions we'd need to re-apply on top of
                    // `originalTask` to revert an optimistic action. Since there are no optimistic
                    // actions that come before we won't need to reapply these.
                    const firstActuallyOptimisticActionIndex = newOptimisticActions.findIndex(
                        optimisticAction => optimisticAction.isOptimistic,
                    );
                    let removedNonOptimisticActions: Array<TaskUpdateTaskAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions.map(
                            ({action}) => action,
                        );
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions
                            .slice(0, firstActuallyOptimisticActionIndex)
                            .map(({action}) => action);
                        newOptimisticActions = newOptimisticActions.slice(
                            firstActuallyOptimisticActionIndex,
                        );
                    }

                    // Our task is caught up! There's no more optimistic state for the task.
                    if (newOptimisticActions.length === 0) {
                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            optimisticState: null,
                        });
                        continue;
                    }

                    // Update `original` to include the committed action and any non-optimistic
                    // actions we don't need to keep anymore.
                    if (oldTaskEntry.task === null) {
                        // If there was a create action then `oldTaskEntry.task` should be non-null.
                        assert(
                            removedNonOptimisticActions.every(
                                action => action.taskAction.type !== "Create",
                            ),
                        );

                        const newOriginal = {
                            task: null,
                            actions: [
                                ...oldTaskEntry.optimisticState.original.actions,
                                action,
                                ...removedNonOptimisticActions,
                            ],
                        };

                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            optimisticState: {
                                original: newOriginal,
                                actions: newOptimisticActions,
                            },
                        });
                        continue;
                    }

                    let newOriginal = oldTaskEntry.optimisticState.original;

                    if (action.taskAction.type === "Create" && newOriginal.task === null) {
                        newOriginal = {
                            task: newOriginal.actions.reduce(
                                (task, action) => task.apply(action),
                                TaskModel.createFromAction(
                                    this.spaceId,
                                    action.taskId,
                                    action.time,
                                    action.taskAction,
                                ),
                            ),
                            actions: null,
                        };
                    } else {
                        newOriginal =
                            newOriginal.task !== null
                                ? {task: newOriginal.task.apply(action), actions: null}
                                : {task: null, actions: [...newOriginal.actions, action]};
                    }

                    if (newOriginal.task !== null) {
                        newOriginal = {
                            task: removedNonOptimisticActions.reduce(
                                (task, action) => task.apply(action),
                                newOriginal.task,
                            ),
                            actions: null,
                        };
                    } else {
                        const nonOptimisticCreateAction = removedNonOptimisticActions.find(
                            (
                                action,
                            ): action is TaskUpdateTaskAction & {
                                taskAction: {type: "Create"};
                            } => action.taskAction.type === "Create",
                        );

                        if (!nonOptimisticCreateAction) {
                            newOriginal = {
                                task: null,
                                actions: [...newOriginal.actions, ...removedNonOptimisticActions],
                            };
                        } else {
                            newOriginal = {
                                task: removedNonOptimisticActions.reduce(
                                    (task, action) => task.apply(action),
                                    newOriginal.actions.reduce(
                                        (task, action) => task.apply(action),
                                        TaskModel.createFromAction(
                                            this.spaceId,
                                            nonOptimisticCreateAction.taskId,
                                            nonOptimisticCreateAction.time,
                                            nonOptimisticCreateAction.taskAction,
                                        ),
                                    ),
                                ),
                                actions: null,
                            };
                        }
                    }

                    newTaskEntryById.set(action.taskId, {
                        ...oldTaskEntry,
                        optimisticState: {
                            original: newOriginal,
                            actions: newOptimisticActions,
                        },
                    });
                    continue;
                }
                case "UpdateCollection": {
                    // NOCOMMIT: Optimistically update collections!
                    continue;
                }
                case "UpdateNotepadPage": {
                    // NOCOMMIT: I think something needs to be done here?
                    continue;
                }
                default:
                    throw exhaustive(action);
            }
        }

        this._updateStore(newTaskEntryById, newCollectionEntryById);
    }

    private _revertOptimisticTaskActions(actions: ReadonlyArray<TaskAction>) {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.getSnapshot();

                    // Entry has been garbage collected, ignore.
                    if (!oldTaskEntry) {
                        continue;
                    }

                    // Entry has been recreated since we added our action to optimistic
                    // state, ignore.
                    if (!oldTaskEntry.optimisticState) {
                        continue;
                    }

                    let newOptimisticActions = oldTaskEntry.optimisticState.actions.filter(
                        optimisticAction => optimisticAction.action !== action,
                    );

                    // Optimistic action is not present in task entry's optimistic state. Maybe
                    // entry has been recreated, ignore.
                    if (
                        newOptimisticActions.length === oldTaskEntry.optimisticState.actions.length
                    ) {
                        continue;
                    }

                    // Remove any `isOptimistic: false` actions from the start of the optimistic
                    // actions array. These are actions we'd need to re-apply on top of
                    // `originalTask` to revert an optimistic action.
                    //
                    // We'll apply these to the original task now and won't need them for future
                    // optimistic actions.
                    const firstActuallyOptimisticActionIndex = newOptimisticActions.findIndex(
                        optimisticAction => optimisticAction.isOptimistic,
                    );
                    let removedNonOptimisticActions: Array<TaskUpdateTaskAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions.map(
                            ({action}) => action,
                        );
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions
                            .slice(0, firstActuallyOptimisticActionIndex)
                            .map(({action}) => action);
                        newOptimisticActions = newOptimisticActions.slice(
                            firstActuallyOptimisticActionIndex,
                        );
                    }

                    if (
                        oldTaskEntry.task !== null &&
                        oldTaskEntry.optimisticState.original.task !== null
                    ) {
                        const newOriginal = {
                            task: removedNonOptimisticActions.reduce(
                                (task, action) => task.apply(action),
                                oldTaskEntry.optimisticState.original.task,
                            ),
                            actions: null,
                        };

                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: newOptimisticActions.reduce(
                                (task, {action}) => task.apply(action),
                                newOriginal.task,
                            ),
                            actions: null,
                            optimisticState:
                                newOptimisticActions.length > 0
                                    ? {
                                          original: newOriginal,
                                          actions: newOptimisticActions,
                                      }
                                    : null,
                        });
                        continue;
                    }

                    const nonOptimisticCreateAction = removedNonOptimisticActions.find(
                        (
                            action,
                        ): action is TaskUpdateTaskAction & {
                            taskAction: {type: "Create"};
                        } => action.taskAction.type === "Create",
                    );

                    let newOriginal;
                    if (!nonOptimisticCreateAction) {
                        newOriginal = {
                            task: null,
                            actions: [
                                ...oldTaskEntry.optimisticState.original.actions!,
                                ...removedNonOptimisticActions,
                            ],
                        };
                    } else {
                        newOriginal = {
                            task: removedNonOptimisticActions.reduce(
                                (task, action) => task.apply(action),
                                oldTaskEntry.optimisticState.original.actions!.reduce(
                                    (task, action) => task.apply(action),
                                    TaskModel.createFromAction(
                                        this.spaceId,
                                        nonOptimisticCreateAction.taskId,
                                        nonOptimisticCreateAction.time,
                                        nonOptimisticCreateAction.taskAction,
                                    ),
                                ),
                            ),
                            actions: null,
                        };
                    }

                    if (newOriginal.task !== null) {
                        // If our new original task is non-null because there was a non-optimistic
                        // create action then the task entry as a whole should also have a
                        // non-null task.
                        assert(oldTaskEntry.task !== null);

                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: newOptimisticActions.reduce(
                                (task, {action}) => task.apply(action),
                                newOriginal.task,
                            ),
                            actions: null,
                            optimisticState:
                                newOptimisticActions.length > 0
                                    ? {
                                          original: newOriginal,
                                          actions: newOptimisticActions,
                                      }
                                    : null,
                        });
                        continue;
                    }

                    const optimisticCreateAction = newOptimisticActions.find(
                        (
                            optimisticAction,
                        ): optimisticAction is {
                            isOptimistic: boolean;
                            action: TaskUpdateTaskAction & {taskAction: {type: "Create"}};
                        } => optimisticAction.action.taskAction.type === "Create",
                    );

                    if (!optimisticCreateAction) {
                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: null,
                            actions: [
                                ...newOriginal.actions,
                                ...newOptimisticActions.map(({action}) => action),
                            ],
                            optimisticState:
                                newOptimisticActions.length > 0
                                    ? {
                                          original: newOriginal,
                                          actions: newOptimisticActions,
                                      }
                                    : null,
                        });
                    } else {
                        newTaskEntryById.set(action.taskId, {
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: newOptimisticActions.reduce(
                                (task, {action}) => task.apply(action),
                                newOriginal.actions.reduce(
                                    (task, action) => task.apply(action),
                                    TaskModel.createFromAction(
                                        this.spaceId,
                                        optimisticCreateAction.action.taskId,
                                        optimisticCreateAction.action.time,
                                        optimisticCreateAction.action.taskAction,
                                    ),
                                ),
                            ),
                            actions: null,
                            optimisticState:
                                newOptimisticActions.length > 0
                                    ? {
                                          original: newOriginal,
                                          actions: newOptimisticActions,
                                      }
                                    : null,
                            // If we receive an optimistic create action it's from our account (other
                            // creates will be rejected by the backend) so the task is authorized.
                            isAuthorized: oldTaskEntry.isAuthorized ?? true,
                            // NOCOMMIT: Proper authorization event number!!
                            authorizationEventNumber: oldTaskEntry.authorizationEventNumber ?? 0,
                        });
                    }
                    continue;
                }
                case "UpdateCollection": {
                    // NOCOMMIT: Optimistically update collections!
                    continue;
                }
                case "UpdateNotepadPage": {
                    // NOCOMMIT: I think something needs to be done here?
                    continue;
                }
                default:
                    throw exhaustive(action);
            }
        }

        this._updateStore(newTaskEntryById, newCollectionEntryById);
    }

    private _updateStore(
        newTaskEntryById: ReadonlyMap<TaskId, TaskClientStoreTaskEntry>,
        newCollectionEntryById: Map<TaskCollectionId, TaskClientStoreCollectionEntry>,
    ) {
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
                let taskEntryStore = this._taskEntryStoreById.get(taskId);
                const oldTaskEntry = taskEntryStore?.getSnapshot() ?? null;

                if (taskEntryStore === undefined) {
                    taskEntryStore = new ValueStore(newTaskEntry);
                    this._taskEntryStoreById.set(taskId, taskEntryStore);
                } else {
                    taskEntryStore.set(newTaskEntry);
                }

                taskEntryUpdateById.set(taskId, {
                    taskEntryStore: taskEntryStore,
                    oldTaskEntry,
                    newTaskEntry,
                });

                // If the old task entry was not deleted but the new task entry is then if we
                // have a query for this task's children, delete the reference to that query.
                //
                // NOCOMMIT: Test this
                if (
                    !(oldTaskEntry?.task?.isDeleted() ?? true) &&
                    (newTaskEntry.task?.isDeleted() ?? true)
                ) {
                    this._taskChildrenQueryByParentTaskId.delete(taskId);
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
            for (const query of this._subscriptionsStore.getSnapshot().queries) {
                query._getInternal(this).onTasksUpdated(taskEntryUpdateById);
            }

            this._batchUpdateEventEmitter.emit(taskEntryUpdateById);
        });
    }

    private readonly _batchUpdateEventEmitter = new EventEmitter<
        ReadonlyMap<
            TaskId,
            {
                readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;
                readonly oldTaskEntry: TaskClientStoreTaskEntry | null;
                readonly newTaskEntry: TaskClientStoreTaskEntry;
            }
        >
    >();

    /**
     * Subscribes to all store task updates.
     *
     * Store task updates are made in batch in a `batchStoreUpdates()` call. This
     * listener is called within that `batchStoreUpdates()` context which means you
     * can make your own store updates that will fire listeners in the same batch.
     */
    public subscribeToBatchUpdate(
        listener: (
            taskEntryUpdateById: ReadonlyMap<
                TaskId,
                {
                    readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;
                    readonly oldTaskEntry: TaskClientStoreTaskEntry | null;
                    readonly newTaskEntry: TaskClientStoreTaskEntry;
                }
            >,
        ) => void,
    ) {
        return this._batchUpdateEventEmitter.subscribe(listener);
    }

    /**
     * When committing actions, the server will sometimes generate extra actions
     * based on data it has available that the client doesn't have available.
     *
     * This function attempts to guess what those actions are optimistically so we
     * can immediately apply them to our local client state instead of waiting on a
     * server roundtrip.
     *
     * It's ok to miss actions that the server will return or to get the action
     * wrong. When the server returns we will apply the server's extra actions and
     * revert any incorrect actions.
     *
     * This function should be called before applying the optimistic actions
     * against our store since it needs to read old task values.
     */
    private _getOptimisticExtraActions(
        actions: ReadonlyArray<TaskAction>,
    ): Array<TaskUpdateTaskAction> {
        if (actions.length === 0) return [];

        let maxActionTime = actions[0]!.time;
        for (let i = 1; i < actions.length; i++) {
            maxActionTime = maxHybridLogicalTime(maxActionTime, actions[i]!.time);
        }

        const childTaskCountsByParentTaskId = new Map<
            TaskId,
            {
                addedChildTaskCount: number;
                removedChildTaskCount: number;
                addedClosedChildTaskCount: number;
                removedClosedChildTaskCount: number;
            }
        >();

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i]!;

            const applyPreviousActions = (taskId: TaskId, task: TaskModel | null) => {
                const pendingActions: Array<TaskUpdateTaskAction> = [];

                for (let j = 0; j < i; j++) {
                    const action = actions[j]!;
                    if (action.type !== "UpdateTask" || action.taskId !== taskId) continue;

                    if (task !== null) {
                        task = task.apply(action);
                    } else {
                        if (action.taskAction.type !== "Create") {
                            pendingActions.push(action);
                        } else {
                            task = pendingActions.reduce(
                                (task, action) => task.apply(action),
                                TaskModel.createFromAction(
                                    this.spaceId,
                                    taskId,
                                    action.time,
                                    action.taskAction,
                                ),
                            );
                        }
                    }
                }

                return task;
            };

            // If the parent tasks involved are available in our client store then we
            // update their children counts after the parent task change.
            if (action.type === "UpdateTask" && action.taskAction.type === "UpdateParentTaskId") {
                const taskEntryStore = this._taskEntryStoreById.get(action.taskId);
                const task = applyPreviousActions(
                    action.taskId,
                    taskEntryStore?.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const oldParentTaskId = task.getParent()?.taskId ?? null;
                const newParentTaskId = action.taskAction.parentTaskId;
                if (oldParentTaskId === newParentTaskId) continue;

                if (oldParentTaskId) {
                    const oldParentTaskEntryStore = this._taskEntryStoreById.get(oldParentTaskId);
                    const oldParentTask = applyPreviousActions(
                        oldParentTaskId,
                        oldParentTaskEntryStore?.getSnapshot().task ?? null,
                    );

                    if (oldParentTask) {
                        const childTaskCounts = getOrSetDefaultMapValue(
                            childTaskCountsByParentTaskId,
                            oldParentTaskId,
                            () => ({
                                addedChildTaskCount: oldParentTask.rawData.addedChildTaskCount,
                                removedChildTaskCount: oldParentTask.rawData.removedChildTaskCount,
                                addedClosedChildTaskCount:
                                    oldParentTask.rawData.addedClosedChildTaskCount,
                                removedClosedChildTaskCount:
                                    oldParentTask.rawData.removedClosedChildTaskCount,
                            }),
                        );

                        childTaskCounts.removedChildTaskCount += 1;
                        childTaskCounts.removedClosedChildTaskCount +=
                            task.rawData.status.value.type === "Closed" ? 1 : 0;
                    }
                }

                if (newParentTaskId) {
                    const newParentTaskEntryStore = this._taskEntryStoreById.get(newParentTaskId);
                    const newParentTask = applyPreviousActions(
                        newParentTaskId,
                        newParentTaskEntryStore?.getSnapshot().task ?? null,
                    );

                    if (newParentTask) {
                        const childTaskCounts = getOrSetDefaultMapValue(
                            childTaskCountsByParentTaskId,
                            newParentTaskId,
                            () => ({
                                addedChildTaskCount: newParentTask.rawData.addedChildTaskCount,
                                removedChildTaskCount: newParentTask.rawData.removedChildTaskCount,
                                addedClosedChildTaskCount:
                                    newParentTask.rawData.addedClosedChildTaskCount,
                                removedClosedChildTaskCount:
                                    newParentTask.rawData.removedClosedChildTaskCount,
                            }),
                        );

                        childTaskCounts.addedChildTaskCount += 1;
                        childTaskCounts.addedClosedChildTaskCount +=
                            task.rawData.status.value.type === "Closed" ? 1 : 0;
                    }
                }
            }

            // If the parent tasks involved are available in our client store then we
            // update their children counts after the parent task change.
            if (action.type === "UpdateTask" && action.taskAction.type === "UpdateStatus") {
                const taskEntryStore = this._taskEntryStoreById.get(action.taskId);
                const task = applyPreviousActions(
                    action.taskId,
                    taskEntryStore?.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const oldStatusType = task.rawData.status.value.type;
                const newStatusType = action.taskAction.status.type;
                if (oldStatusType === newStatusType) continue;

                const parentTaskId = task.getParent()?.taskId;
                if (!parentTaskId) continue;

                const parentTaskEntryStore = this._taskEntryStoreById.get(parentTaskId);
                const parentTask = applyPreviousActions(
                    parentTaskId,
                    parentTaskEntryStore?.getSnapshot().task ?? null,
                );
                if (!parentTask) continue;

                const childTaskCounts = getOrSetDefaultMapValue(
                    childTaskCountsByParentTaskId,
                    parentTaskId,
                    () => ({
                        addedChildTaskCount: parentTask.rawData.addedChildTaskCount,
                        removedChildTaskCount: parentTask.rawData.removedChildTaskCount,
                        addedClosedChildTaskCount: parentTask.rawData.addedClosedChildTaskCount,
                        removedClosedChildTaskCount: parentTask.rawData.removedClosedChildTaskCount,
                    }),
                );

                childTaskCounts.addedClosedChildTaskCount +=
                    oldStatusType !== "Closed" && newStatusType === "Closed" ? 1 : 0;
                childTaskCounts.removedClosedChildTaskCount +=
                    oldStatusType === "Closed" && newStatusType !== "Closed" ? 1 : 0;
            }

            // When a task is deleted, we change the task's children count since deleted
            // tasks don't show up in child task queries.
            if (action.type === "UpdateTask" && action.taskAction.type === "Delete") {
                const taskEntryStore = this._taskEntryStoreById.get(action.taskId);
                const task = applyPreviousActions(
                    action.taskId,
                    taskEntryStore?.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const parentTaskId = task.getParent()?.taskId;
                if (!parentTaskId) continue;

                const parentTaskEntryStore = this._taskEntryStoreById.get(parentTaskId);
                const parentTask = applyPreviousActions(
                    parentTaskId,
                    parentTaskEntryStore?.getSnapshot().task ?? null,
                );

                if (!parentTask) continue;

                const childTaskCounts = getOrSetDefaultMapValue(
                    childTaskCountsByParentTaskId,
                    parentTaskId,
                    () => ({
                        addedChildTaskCount: parentTask.rawData.addedChildTaskCount,
                        removedChildTaskCount: parentTask.rawData.removedChildTaskCount,
                        addedClosedChildTaskCount: parentTask.rawData.addedClosedChildTaskCount,
                        removedClosedChildTaskCount: parentTask.rawData.removedClosedChildTaskCount,
                    }),
                );

                childTaskCounts.removedChildTaskCount += 1;
                childTaskCounts.removedClosedChildTaskCount +=
                    task.rawData.status.value.type === "Closed" ? 1 : 0;
            }

            // When a task is undeleted, we change the task's children count since deleted
            // tasks don't show up in child task queries.
            if (action.type === "UpdateTask" && action.taskAction.type === "Undelete") {
                const taskEntryStore = this._taskEntryStoreById.get(action.taskId);
                const task = applyPreviousActions(
                    action.taskId,
                    taskEntryStore?.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const parentTaskId = task.getParent()?.taskId;
                if (!parentTaskId) continue;

                const parentTaskEntryStore = this._taskEntryStoreById.get(parentTaskId);
                const parentTask = applyPreviousActions(
                    parentTaskId,
                    parentTaskEntryStore?.getSnapshot().task ?? null,
                );

                if (!parentTask) continue;

                const childTaskCounts = getOrSetDefaultMapValue(
                    childTaskCountsByParentTaskId,
                    parentTaskId,
                    () => ({
                        addedChildTaskCount: parentTask.rawData.addedChildTaskCount,
                        removedChildTaskCount: parentTask.rawData.removedChildTaskCount,
                        addedClosedChildTaskCount: parentTask.rawData.addedClosedChildTaskCount,
                        removedClosedChildTaskCount: parentTask.rawData.removedClosedChildTaskCount,
                    }),
                );

                childTaskCounts.addedChildTaskCount += 1;
                childTaskCounts.addedClosedChildTaskCount +=
                    task.rawData.status.value.type === "Closed" ? 1 : 0;
            }
        }

        const extraActions: Array<TaskUpdateTaskAction> = [];

        for (const [parentTaskId, childTaskCounts] of childTaskCountsByParentTaskId) {
            extraActions.push({
                type: "UpdateTask",
                // For our extra action's time, add a tick to the max action time.
                time: [maxActionTime[0], maxActionTime[1] + 1],
                taskId: parentTaskId,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    ...childTaskCounts,
                },
            });
        }

        return extraActions;
    }

    /**
     * Creates a new query model in our store. The query will be kept up-to-date in
     * realtime whenever there's a change to a task that affects the query.
     *
     * Also retains the query once. You are responsible for calling `release()` on
     * the query when you're done with it to make sure resources the query uses are
     * cleaned up.
     */
    public createAndRetainQuery({
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }): TaskClientQuery {
        return batchStoreUpdates(() => {
            const query = new TaskClientQueryInternal({
                store: this,
                filters,
                sorts,
            });

            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Set(subscriptions.queries);
                newQueries.add(query.external);
                return {...subscriptions, queries: newQueries};
            });

            // Detect if this is a child task query (filters for all child tasks, sorted by
            // parent position). If this is a child task then add it to our child task
            // query map.
            const parentTaskId = getParentTaskIdIfChildrenQuery(query);
            if (parentTaskId && !this._taskChildrenQueryByParentTaskId.getSnapshot(parentTaskId)) {
                this._taskChildrenQueryByParentTaskId.set(parentTaskId, query.external);
            }

            return query.external;
        });
    }

    /**
     * Same as `createAndRetainQuery()` but efficiently creates many queries at once.
     */
    public createAndRetainQueries(
        queries: ReadonlyArray<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        }>,
    ): Array<TaskClientQuery> {
        return batchStoreUpdates(() => {
            const createdQueries = queries.map(({filters, sorts}) => {
                const query = new TaskClientQueryInternal({
                    store: this,
                    filters,
                    sorts,
                });

                // Detect if this is a child task query (filters for all child tasks, sorted by
                // parent position). If this is a child task then add it to our child task
                // query map.
                const parentTaskId = getParentTaskIdIfChildrenQuery(query);
                if (
                    parentTaskId &&
                    !this._taskChildrenQueryByParentTaskId.getSnapshot(parentTaskId)
                ) {
                    this._taskChildrenQueryByParentTaskId.set(parentTaskId, query.external);
                }

                return query.external;
            });

            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Set(subscriptions.queries);

                for (const query of createdQueries) {
                    newQueries.add(query);
                }

                return {...subscriptions, queries: newQueries};
            });

            return createdQueries;
        });
    }

    public onQueryFinallyReleased(query: TaskClientQueryInternal) {
        batchStoreUpdates(() => {
            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Set(subscriptions.queries);
                newQueries.delete(query.external);
                return {...subscriptions, queries: newQueries};
            });

            // If this is a child task query then remove our query from the child task map.
            // We will need to send a new query from here on out if you want to see child
            // tasks.
            const parentTaskId = getParentTaskIdIfChildrenQuery(query);
            if (
                parentTaskId &&
                this._taskChildrenQueryByParentTaskId.getSnapshot(parentTaskId) === query.external
            ) {
                this._taskChildrenQueryByParentTaskId.delete(parentTaskId);
            }
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
        query: TaskClientQuery,
        {
            limit,
            loadedState,
            previouslyBackfilledTaskIds,
        }: {
            limit: number;
            loadedState: TaskRealtimeQueryLoadedState;
            previouslyBackfilledTaskIds: ReadonlyArray<TaskId>;
        },
    ): void {
        assert(query.store === this.external);

        query._getInternal(this).onTasksLoaded({
            limit,
            loadedState,
            previouslyBackfilledTasks: previouslyBackfilledTaskIds.map(taskId => {
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
        });
    }

    /**
     * If a children query for the provided task does not exist then we create a
     * query and retain it. Otherwise we return the existing children query and
     * retain it again (if it was pre-existing that implies some other code is
     * already retaining the children query, we add an additional retain).
     *
     * You should call `release()` when done with the query to free up resources.
     */
    public ensureAndRetainTaskChildrenQuery(taskId: TaskId): TaskClientQuery {
        const existingChildrenQuery = this._taskChildrenQueryByParentTaskId.getSnapshot(taskId);
        if (existingChildrenQuery) {
            existingChildrenQuery.retain();
            return existingChildrenQuery;
        }

        const query = this.createAndRetainQuery({
            filters: {
                displayStatusFilter: {
                    ifOpenInactive: true,
                    ifOpenActive: true,
                    ifClosed: true,
                },
                parentFilter: {
                    parentTaskId: taskId,
                },
            },
            sorts: [
                {
                    type: "ParentPosition",
                    direction: "Ascending",
                    missing: "Last",
                },
                {
                    type: "CreatedTime",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });

        // Make sure the created query was added as a children query for this task.
        assert(this._taskChildrenQueryByParentTaskId.getSnapshot(taskId));

        return query;
    }

    /**
     * Gets the query for the provided task's children if it exists. If the query
     * doesn't exist it means the task's children are not loaded.
     */
    public getTaskChildrenQueryStore(parentTaskId: TaskId): Store<TaskClientQuery | undefined> {
        return this._taskChildrenQueryByParentTaskId.get(parentTaskId);
    }

    /**
     * Create and retain a new task subscription. You must call `release()` on the
     * subscription when you're done with it to free up resources.
     *
     * If the `TaskId` is not currently loaded in the store, `TaskRealtimeClient`
     * listens to our subscribed tasks and will subscribe to the task on the server.
     */
    public createAndRetainTaskSubscription(taskId: TaskId): TaskClientTaskSubscription {
        const taskEntryStore = getOrSetDefaultMapValue(
            this._taskEntryStoreById,
            taskId,
            () =>
                new ValueStore<TaskClientStoreTaskEntry>({
                    task: null,
                    actions: [],
                    optimisticState: null,
                    isAuthorized: null,
                    authorizationEventNumber: null,
                }),
        );

        const taskSubscription = new TaskClientTaskSubscription(this, taskId, taskEntryStore);

        this._subscriptionsStore.set(subscriptions => {
            const newTaskSubscriptions = new Set(subscriptions.taskSubscriptions);
            newTaskSubscriptions.add(taskSubscription);
            return {...subscriptions, taskSubscriptions: newTaskSubscriptions};
        });

        return taskSubscription;
    }

    public onTaskSubscriptionFinallyReleased(taskSubscription: TaskClientTaskSubscription) {
        batchStoreUpdates(() => {
            this._subscriptionsStore.set(subscriptions => {
                const newTaskSubscriptions = new Set(subscriptions.taskSubscriptions);
                newTaskSubscriptions.delete(taskSubscription);
                return {...subscriptions, taskSubscriptions: newTaskSubscriptions};
            });
        });
    }

    /**
     * Create and retain a new collection subscription. You must call `release()`
     * on the subscription when you're done with it to free up resources.
     *
     * If the `TaskCollectionId` is not currently loaded in the store,
     * `TaskRealtimeClient` listens to our subscribed collections and will
     * subscribe to the task on the server.
     */
    public createAndRetainCollectionSubscription(
        collectionId: TaskCollectionId,
    ): TaskClientCollectionSubscription {
        const collectionEntryStore = getOrSetDefaultMapValue(
            this._collectionEntryStoreById,
            collectionId,
            () =>
                new ValueStore<TaskClientStoreCollectionEntry>({
                    collection: null,
                    actions: [],
                    isAuthorized: null,
                    authorizationEventNumber: null,
                }),
        );

        const collectionSubscription = new TaskClientCollectionSubscription(
            this,
            collectionId,
            collectionEntryStore,
        );

        this._subscriptionsStore.set(subscriptions => {
            const newCollectionSubscriptions = new Set(subscriptions.collectionSubscriptions);
            newCollectionSubscriptions.add(collectionSubscription);
            return {...subscriptions, collectionSubscriptions: newCollectionSubscriptions};
        });

        return collectionSubscription;
    }

    public onCollectionSubscriptionFinallyReleased(
        collectionSubscription: TaskClientCollectionSubscription,
    ) {
        batchStoreUpdates(() => {
            this._subscriptionsStore.set(subscriptions => {
                const newCollectionSubscriptions = new Set(subscriptions.collectionSubscriptions);
                newCollectionSubscriptions.delete(collectionSubscription);
                return {...subscriptions, collectionSubscriptions: newCollectionSubscriptions};
            });
        });
    }
}

export function getParentTaskIdIfChildrenQuery({
    filters,
    sorts,
}: {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}): TaskId | null {
    if (
        filters.parentFilter &&
        filters.displayStatusFilter.ifOpenInactive &&
        filters.displayStatusFilter.ifOpenActive &&
        filters.displayStatusFilter.ifClosed &&
        Object.keys(filters).length === 2 &&
        sorts.length === 2 &&
        sorts[0]!.type === "ParentPosition" &&
        sorts[0]!.direction === "Ascending" &&
        sorts[0]!.missing === "Last" &&
        sorts[1]!.type === "CreatedTime" &&
        sorts[1]!.direction === "Ascending" &&
        sorts[1]!.missing === "Last"
    ) {
        return filters.parentFilter.parentTaskId;
    }

    return null;
}
