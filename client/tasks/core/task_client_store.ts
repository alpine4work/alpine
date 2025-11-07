import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {SearchEntityRegistryFriend} from "~/client/search/core/search_entity_registry.js";
import {GlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator_types.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/core/create_get_task_action_referenced_sortable_account.js";
import {
    TaskUndoActions,
    createTaskUndoActionsIfPossible,
} from "~/client/tasks/core/create_task_undo_actions_if_possible.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/core/task_client_collection_subscription.js";
import {TaskClientQuery, TaskClientQueryInternal} from "~/client/tasks/core/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {getSynchronizedSystemClock} from "~/client/tracer/synchronized_system_clock.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {Context} from "~/shared/context/context.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {DeadlineExceededError, InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Clock} from "~/shared/helpers/clock/clock.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    maxHybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
    duplicateTaskAndAllChildren,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModelData, SearchEntityModelId} from "~/shared/search/search_entity_model.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {nullStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {StoreMap} from "~/shared/store/store_map.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {
    TaskAction,
    TaskUpdateAccountNameAction,
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {
    TaskActionMaybeModel,
    TaskActionModel,
    TaskUpdateTaskActionMaybeModel,
    TaskUpdateTaskActionModel,
    fromTaskActionModel,
    fromTaskUpdateTaskActionModel,
} from "~/shared/tasks/actions/task_action_model.js";
import {getTaskCollectionSearchEntityBase} from "~/shared/tasks/get_task_collection_search_entity_base.js";
import {getTaskSearchEntityBase} from "~/shared/tasks/get_task_search_entity_base.js";
import {collectReferencedAccountIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_account_ids_from_task_model_data.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskAuthorizationStateRegister,
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
    taskAuthorizedState,
} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskTitleUpdateModel, mergeTaskTitleUpdates} from "~/shared/tasks/title/task_title.js";

export type TaskClientStoreTaskEntry =
    // Task initialized and known authorization state:
    | {
          readonly task: TaskModel;
          readonly actions: null;
          readonly optimisticState: TaskClientStoreTaskEntryOptimisticState | null;
          readonly authorizationState: TaskAuthorizationStateRegister;
      }
    // Task uninitialized and known authorization state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskClientStorePendingUpdateTaskAction>;
          readonly optimisticState:
              | (TaskClientStoreTaskEntryOptimisticState & {original: {task: null}})
              | null;
          readonly authorizationState: TaskAuthorizationStateRegister;
      }
    // Task uninitialized and unknown authorization state:
    | {
          readonly task: null;
          readonly actions: ReadonlyArray<TaskClientStorePendingUpdateTaskAction>;
          readonly optimisticState:
              | (TaskClientStoreTaskEntryOptimisticState & {original: {task: null}})
              | null;
          readonly authorizationState: null;
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
              readonly actions: ReadonlyArray<TaskClientStorePendingUpdateTaskAction>;
          };
    readonly actions: ReadonlyArray<
        TaskClientStorePendingUpdateTaskAction & {
            readonly isOptimistic: boolean;
        }
    >;
};

export type TaskClientStoreCollectionEntry =
    // Collection initialized and known authorization state:
    | {
          readonly collection: TaskCollectionModel;
          readonly actions: null;
          readonly optimisticState: TaskClientStoreCollectionEntryOptimisticState | null;
          readonly authorizationState: TaskAuthorizationStateRegister;
      }
    // Collection uninitialized and known unauthorized state:
    | {
          readonly collection: null;
          readonly actions: ReadonlyArray<TaskClientStorePendingUpdateCollectionAction>;
          readonly optimisticState:
              | (TaskClientStoreCollectionEntryOptimisticState & {original: {collection: null}})
              | null;
          readonly authorizationState: TaskAuthorizationStateRegister;
      }
    // Collection uninitialized and unknown authorization state:
    | {
          readonly collection: null;
          readonly actions: ReadonlyArray<TaskClientStorePendingUpdateCollectionAction>;
          readonly optimisticState:
              | (TaskClientStoreCollectionEntryOptimisticState & {original: {collection: null}})
              | null;
          readonly authorizationState: null;
      };

/**
 * If the collection has some optimistic updates then this object will be
 * populated with those updates until the server either accepts or rejects our
 * actions.
 *
 * See `TaskClientStoreTaskEntryOptimisticState` for more info.
 */
export type TaskClientStoreCollectionEntryOptimisticState = {
    readonly original:
        | {
              readonly collection: TaskCollectionModel;
              readonly actions: null;
          }
        | {
              readonly collection: null;
              readonly actions: ReadonlyArray<TaskClientStorePendingUpdateCollectionAction>;
          };
    readonly actions: ReadonlyArray<
        TaskClientStorePendingUpdateCollectionAction & {
            readonly isOptimistic: boolean;
        }
    >;
};

type TaskClientStorePendingAction = {
    readonly action: TaskActionMaybeModel;
    readonly getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
};

type TaskClientStorePendingUpdateTaskAction = {
    readonly action: TaskUpdateTaskActionMaybeModel | TaskUpdateAccountNameAction;
    readonly getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
};

type TaskClientStorePendingUpdateCollectionAction = {
    readonly action: TaskUpdateCollectionAction;
};

export type TaskClientStoreSubscriptions = {
    readonly queries: ReadonlyMap<TaskClientQuery, {readonly isUnsubscribing: boolean}>;
    readonly taskSubscriptionsById: ReadonlyMap<
        TaskId,
        ReadonlyMap<TaskClientTaskSubscription, {readonly isUnsubscribing: boolean}>
    >;
    readonly collectionSubscriptionsById: ReadonlyMap<
        TaskCollectionId,
        ReadonlyMap<TaskClientCollectionSubscription, {readonly isUnsubscribing: boolean}>
    >;
};

export type TaskClientStoreBatchUpdate = {
    readonly taskEntryUpdateById: ReadonlyMap<
        TaskId,
        {
            readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;
            readonly oldTaskEntry: TaskClientStoreTaskEntry | null;
            readonly newTaskEntry: TaskClientStoreTaskEntry;
        }
    >;
    readonly collectionEntryUpdateById: ReadonlyMap<
        TaskCollectionId,
        {
            readonly collectionEntryStore: Store<TaskClientStoreCollectionEntry>;
            readonly oldCollectionEntry: TaskClientStoreCollectionEntry | null;
            readonly newCollectionEntry: TaskClientStoreCollectionEntry;
        }
    >;
    readonly actions: ReadonlyArray<TaskActionMaybeModel>;
};

export interface TaskClientStoreUndoManager {
    pushUndoStackEntry(entry: {
        undoActions: TaskUndoActions;
        removedFromQueries: ReadonlySet<TaskClientQuery>;
        leaseId: TaskActionTransactionLeaseId | null;
        release: () => void;
    }): void;
}

export type TaskClientStoreUpdateTitleActionTransactionBuilder = {
    add(titleUpdate: TaskTitleUpdateModel): void;
    commit(
        context: Context<{
            rpc: RpcContextModuleBase;
        }>,
    ): {
        finally(callback: () => void): void;
    };
};

/**
 * An affinity manager object decides which search entity to give affinity
 * points on some update interaction. For instance, when editing tasks in a
 * collection we give affinity points to the collection. Not the task being
 * updated!
 *
 * These objects are typically constructed at the route level and passed down
 * through child components until we reach a
 * `store.commitTaskActionTransaction()` call.
 */
export interface TaskClientStoreSearchAffinityManager {
    /**
     * Whenever the user changes something within a task we want to track that as a
     * low intent update and feed it into our task affinity system.
     */
    markLowIntentUpdateInteraction(update: TaskClientStoreBatchUpdate): void;

    /**
     * Add a global loading indicator that lasts until the provided promise
     * resolves.
     */
    // TODO(calebmer): Adding this to affinity manager since it's required that we
    // pass an affinity manager into `commitActionTransaction()` but this method
    // has nothing to do with affinity. We should consider renaming "affinity
    // manager" to something else. Waiting until we have a third method to better
    // understand what that name should be. Maybe "route manager" since affinity
    // managers are created at a route level?
    addGlobalLoadingIndicator(promise: Promise<unknown>, indicator: GlobalLoadingIndicator): void;
}

/**
 * `TaskClientStore` but without any methods that mutate task data. Notably,
 * there's no `commitTaskActionTransaction()` function.
 */
export type TaskClientReadonlyStore = Pick<
    TaskClientStore,
    | "getTaskCountForTest"
    | "getCollectionCountForTest"
    | "accountRegistry"
    | "spaceId"
    | "currentAccountId"
    | "clock"
    | "getTaskEntrySnapshot"
    | "getCollectionEntrySnapshot"
    | "getTaskEntryStore"
    | "getCollectionEntryStore"
    | "getTaskAssigneeAccountStore"
    | "getReferencedAccountStoreIfExists"
    | "getSubscriptionsStore"
    | "subscribeToBatchUpdate"
    | "waitForCommitTaskActionTransactions"
    | "createAndRetainQuery"
    | "createAndRetainQueries"
    | "loadTasksIntoQuery"
    | "ensureAndRetainTaskChildrenQuery"
    | "getTaskChildrenQueryStore"
    | "createAndRetainTaskSubscription"
    | "createAndRetainCollectionSubscription"
>;

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
export class TaskClientStore implements SearchEntityRegistryFriend {
    private readonly _internal: TaskClientStoreInternal;
    public readonly accountRegistry: AccountRegistry;
    public readonly spaceId: SpaceId;
    public readonly currentAccountId: AccountId | null;
    public readonly clock: HybridLogicalClock;

    constructor({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError,
    }: {
        accountRegistry: AccountRegistry;
        spaceId: SpaceId;
        currentAccountId: AccountId | null;
        onError: (
            options:
                | {display: true; title: string; error: unknown}
                | {display: false; error: unknown},
        ) => void;
    }) {
        this._internal = new TaskClientStoreInternal(this, {
            accountRegistry,
            spaceId,
            currentAccountId,
            onError,
        });
        this.accountRegistry = this._internal.accountRegistry;
        this.spaceId = this._internal.spaceId;
        this.currentAccountId = this._internal.currentAccountId;
        this.clock = this._internal.clock;
    }

    public getInternalForTest() {
        assert(import.meta.jest);
        return this._internal;
    }

    public getTaskCountForTest() {
        return this._internal.getTaskCountForTest();
    }

    public getCollectionCountForTest() {
        return this._internal.getCollectionCountForTest();
    }

    public getTaskEntrySnapshot(taskId: TaskId) {
        return this._internal.getTaskEntrySnapshot(taskId);
    }

    public getCollectionEntrySnapshot(collectionId: TaskCollectionId) {
        return this._internal.getCollectionEntrySnapshot(collectionId);
    }

    public getTaskEntryStore(taskId: TaskId) {
        return this._internal.getTaskEntryStore(taskId);
    }

    public getCollectionEntryStore(collectionId: TaskCollectionId) {
        return this._internal.getCollectionEntryStore(collectionId);
    }

    public getTaskAssigneeAccountStore(task: TaskModel): Store<AccountModelData> | null {
        return this._internal.getTaskAssigneeAccountStore(task);
    }

    public getReferencedAccountStoreIfExists(accountId: AccountId): Store<AccountModelData> | null {
        return this._internal.getReferencedAccountStoreIfExists(accountId);
    }

    public getSubscriptionsStore() {
        return this._internal.getSubscriptionsStore();
    }

    public applyUpdateEvent(event: TaskRealtimeUpdateEvent): void {
        this._internal.applyUpdateEvent(event);
    }

    public subscribeToBatchUpdate(listener: (update: TaskClientStoreBatchUpdate) => void) {
        return this._internal.subscribeToBatchUpdate(listener);
    }

    public commitTaskActionTransaction(
        context: Context<{rpc: RpcContextModuleBase}>,
        actions: Iterable<TaskActionModel>,
        options: {
            undoManager: TaskClientStoreUndoManager | null;
            affinityManager: TaskClientStoreSearchAffinityManager;
            leaseId?: TaskActionTransactionLeaseId | null;
            undoableSlice?: {startIndex: number | null; endIndex: number | null} | null;
            updateAccessPolicyShareNotification?: ShareNotification;
        },
    ): {finally: (callback: () => void) => void} {
        return this._internal.commitTaskActionTransaction(context, actions, options);
    }

    public getTaskUpdateTitleActionTransactionBuilder(
        taskId: TaskId,
        initialTitleUpdate: TaskTitleUpdateModel,
        options: {
            undoManager: TaskClientStoreUndoManager | null;
            affinityManager: TaskClientStoreSearchAffinityManager;
        },
    ): TaskClientStoreUpdateTitleActionTransactionBuilder {
        return this._internal.getTaskUpdateTitleActionTransactionBuilder(
            taskId,
            initialTitleUpdate,
            options,
        );
    }

    public deleteTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
        options: {undoManager: TaskClientStoreUndoManager | null; time?: HybridLogicalTime},
    ): Promise<void> {
        return this._internal.deleteTaskAndAllChildren(context, taskId, options);
    }

    public duplicateTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
        timeZone: TimeZone,
        options: {undoManager: TaskClientStoreUndoManager | null; time?: HybridLogicalTime},
    ): Promise<{taskId: TaskId}> {
        return this._internal.duplicateTaskAndAllChildren(context, taskId, timeZone, options);
    }

    public waitForCommitTaskActionTransactions() {
        return this._internal.waitForCommitTaskActionTransactions();
    }

    public createAndRetainQuery(options: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        limit: number;
        withoutReuse?: boolean;
    }): TaskClientQuery {
        return this._internal.createAndRetainQuery(options);
    }

    public createAndRetainQueries(
        queries: ReadonlyArray<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        }>,
    ): Array<TaskClientQuery> {
        return this._internal.createAndRetainQueries(queries);
    }

    /**
     * Only `TaskRealtimeClient` should call this function. Which is why it's
     * prefixed with an underscore.
     */
    public _onQueryUnsubscribed(query: TaskClientQuery) {
        this._internal.onQueryUnsubscribed(query);
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

    public ensureAndRetainTaskChildrenQuery(
        parentTaskId: TaskId,
        options: {limit: number},
    ): TaskClientQuery {
        return this._internal.ensureAndRetainTaskChildrenQuery(parentTaskId, options);
    }

    public getTaskChildrenQueryStore(parentTaskId: TaskId): Store<TaskClientQuery | undefined> {
        return this._internal.getTaskChildrenQueryStore(parentTaskId);
    }

    public createAndRetainTaskSubscription(taskId: TaskId): TaskClientTaskSubscription {
        return this._internal.createAndRetainTaskSubscription(taskId);
    }

    /**
     * Only `TaskRealtimeClient` should call this function. Which is why it's
     * prefixed with an underscore.
     */
    public _onTaskSubscriptionUnsubscribed(subscription: TaskClientTaskSubscription) {
        this._internal.onTaskSubscriptionUnsubscribed(subscription);
    }

    public createAndRetainCollectionSubscription(
        collectionId: TaskCollectionId,
    ): TaskClientCollectionSubscription {
        return this._internal.createAndRetainCollectionSubscription(collectionId);
    }

    /**
     * Only `TaskRealtimeClient` should call this function. Which is why it's
     * prefixed with an underscore.
     */
    public _onCollectionSubscriptionUnsubscribed(subscription: TaskClientCollectionSubscription) {
        this._internal.onCollectionSubscriptionUnsubscribed(subscription);
    }

    /**
     * We can add `TaskClientStore` as a friend of `SearchEntityRegistry`.
     * `SearchEntityRegistry` uses friends to augment its normalized store of
     * search entities with data from another normalized store. So if we have a
     * search entity reference to a task it'll use the same task data that's
     * available in `TaskClientStore`.
     */
    public getSearchEntityRegistryFriendStoreIfExists(
        entityId: SearchEntityModelId,
    ): Store<SearchEntityModelData | null> | null {
        if (!entityId.startsWith("Task:") && !entityId.startsWith("TaskCollection:")) return null;

        const entityIdObject = parseSearchDynamicEntityId(
            entityId as SearchEntityModelId & (`Task:${string}` | `TaskCollection:${string}`),
        );

        if (entityIdObject.type === "Task") {
            return this.getTaskEntryStore(entityIdObject.taskId).map(
                (taskEntry): SearchEntityModelData | null => {
                    if (!taskEntry?.task) return null;
                    const {task} = taskEntry;

                    return {
                        ...getTaskSearchEntityBase(task),
                        id: `Task:${task.id}`,
                    };
                },
            );
        } else if (entityIdObject.type === "TaskCollection") {
            return this.getCollectionEntryStore(entityIdObject.collectionId).map(
                (collectionEntry): SearchEntityModelData | null => {
                    if (!collectionEntry?.collection) return null;
                    const {collection} = collectionEntry;

                    return {
                        ...getTaskCollectionSearchEntityBase(collection),
                        id: `TaskCollection:${collection.id}`,
                    };
                },
            );
        } else {
            throw new InternalError(quote`Unexpected search entity type: ${entityIdObject.type}`);
        }
    }
}

let shouldDisableCommitTaskActionTransactionMutexForTest = false;

export function setShouldDisableCommitTaskActionTransactionMutexForTest(shouldDisable: boolean) {
    assert(import.meta.jest);
    shouldDisableCommitTaskActionTransactionMutexForTest = shouldDisable;
}

export class TaskClientStoreInternal {
    public readonly external: TaskClientStore;

    public readonly accountRegistry: AccountRegistry;
    public readonly spaceId: SpaceId;
    public readonly currentAccountId: AccountId | null;
    private readonly _onError: (
        options: {display: true; title: string; error: unknown} | {display: false; error: unknown},
    ) => void;
    private readonly _clientId = generateId<TaskRealtimeClientId>();

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
    private readonly _taskEntryStoreById = new Map<
        TaskId,
        {
            referenceCount: number;
            store: ValueStore<TaskClientStoreTaskEntry>;
        }
    >();

    /**
     * The collections currently in our store.
     *
     * Like `taskById`, it's not guaranteed that a collection is up-to-date if it's
     * in this map. See the documentation on `taskById` for more of an explanation.
     */
    private readonly _collectionEntryStoreById = new Map<
        TaskCollectionId,
        {
            referenceCount: number;
            store: ValueStore<TaskClientStoreCollectionEntry>;
        }
    >();

    /**
     * Stores for `TaskId`s that update between the task entry and null based on
     * whether the task is in the store or not. By calling
     * `TaskClientStore.getTaskEntryStore()` even if the task doesn't currently
     * exist you'll get a `Store` whose value is null that will update to the task
     * entry if the task is later loaded (e.g. by `<TaskDetailView>`).
     *
     * To reduce memory usage we use an `AdvancedWeakValuesMap`. Users of
     * `TaskClientStore` get a simple API since there's no way to observe whether a
     * task entry store has been garbage collected or not. To `TaskClientStore`
     * users there's _always_ a store for _every_ `TaskId`. But in reality we
     * garbage collect stores that aren't used.
     */
    private readonly _taskEntryStoreByIdStores = new AdvancedWeakValuesMap<
        TaskId,
        Store<TaskClientStoreTaskEntry | null> & {
            set(value: ValueStore<TaskClientStoreTaskEntry> | null): void;
        }
    >();

    /**
     * Stores for `TaskCollectionId`s that update between the collection entry and
     * null based on whether the collection is in the store or not. By calling
     * `TaskClientStore.getCollectionEntryStore()` even if the collection doesn't
     * currently exist you'll get a `Store` whose value is null that will update to
     * the collection entry if the collection is later loaded (e.g. by
     * `<TaskCollectionView>`).
     *
     * To reduce memory usage we use an `AdvancedWeakValuesMap`. Users of
     * `TaskClientStore` get a simple API since there's no way to observe whether a
     * collection entry store has been garbage collected or not. To
     * `TaskClientStore` users there's _always_ a store for _every_
     * `TaskCollectionId`. But in reality we garbage collect stores that aren't
     * used.
     */
    private readonly _collectionEntryStoreByIdStores = new AdvancedWeakValuesMap<
        TaskCollectionId,
        Store<TaskClientStoreCollectionEntry | null> & {
            set(value: ValueStore<TaskClientStoreCollectionEntry> | null): void;
        }
    >();

    /**
     * Accounts referenced by our tasks.
     *
     * We can't rely on `AccountRegistry.weakGetAccountStoreByIdIfExists()` to
     * get an account referenced by a task. Since the account might be garbage
     * collected.
     */
    private readonly _referencedAccountStoreById = new Map<
        AccountId,
        {
            referenceCount: number;
            store: Store<AccountModelData>;
        }
    >();

    /**
     * The various subscriptions our client is currently holding on to.
     */
    private readonly _subscriptionsStore = new ValueStore<TaskClientStoreSubscriptions>({
        queries: new Map(),
        taskSubscriptionsById: new Map(),
        collectionSubscriptionsById: new Map(),
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

    // Allow releasing of task entry stores to be delayed. For example, while
    // updating our store if one query releases a task then another query retains
    // the same task then we want to keep the task around instead of garbage
    // collecting it.
    private _delayReleaseTaskEntryStoreIds: Set<TaskId> | null = null;
    private _delayReleaseCollectionEntryStoreIds: Set<TaskCollectionId> | null = null;

    /**
     * If this callback is set then when a task is removed from `TaskClientQuery`
     * it will call this function.
     */
    public onQueryLoadedTaskRemove:
        | ((query: TaskClientQueryInternal, taskId: TaskId) => void)
        | null = null;

    constructor(
        external: TaskClientStore,
        {
            accountRegistry,
            spaceId,
            currentAccountId,
            onError,
        }: {
            accountRegistry: AccountRegistry;
            spaceId: SpaceId;
            currentAccountId: AccountId | null;
            onError: (
                options:
                    | {display: true; title: string; error: unknown}
                    | {display: false; error: unknown},
            ) => void;
        },
    ) {
        this.external = external;
        this.accountRegistry = accountRegistry;
        this.spaceId = spaceId;
        this.currentAccountId = currentAccountId;
        this._onError = onError;

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
        return this._taskEntryStoreById.size;
    }

    public getCollectionCountForTest() {
        assert(import.meta.jest);
        return this._collectionEntryStoreById.size;
    }

    public getSubscriptionsStore(): Store<TaskClientStoreSubscriptions> {
        // Importantly our return type returns a `Store` not a `ValueStore`. Callers
        // shouldn't be able to access `set()`.
        return this._subscriptionsStore;
    }

    public _getTaskEntryStoreIfExists(taskId: TaskId): Store<TaskClientStoreTaskEntry> | null {
        return this._taskEntryStoreById.get(taskId)?.store ?? null;
    }

    public _getCollectionEntryStoreIfExists(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry> | null {
        return this._collectionEntryStoreById.get(collectionId)?.store ?? null;
    }

    public getTaskEntrySnapshot(taskId: TaskId): TaskClientStoreTaskEntry | null {
        return this._taskEntryStoreById.get(taskId)?.store.getSnapshot() ?? null;
    }

    public getCollectionEntrySnapshot(
        collectionId: TaskCollectionId,
    ): TaskClientStoreCollectionEntry | null {
        return this._collectionEntryStoreById.get(collectionId)?.store.getSnapshot() ?? null;
    }

    public getTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry | null> {
        return getOrSetDefaultMapValue(this._taskEntryStoreByIdStores, taskId, () => {
            const store = new ValueStore(this._taskEntryStoreById.get(taskId)?.store ?? null);

            return Object.assign(
                store.flatMap(store => store ?? nullStore),
                {set: store.set.bind(store)},
            );
        });
    }

    public getCollectionEntryStore(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry | null> {
        return getOrSetDefaultMapValue(this._collectionEntryStoreByIdStores, collectionId, () => {
            const store = new ValueStore(
                this._collectionEntryStoreById.get(collectionId)?.store ?? null,
            );

            return Object.assign(
                store.flatMap(store => store ?? nullStore),
                {set: store.set.bind(store)},
            );
        });
    }

    /**
     * Get the store representing the assignee account from our store.
     *
     * Must pass in the exact `TaskModel` object that's currently in the store for
     * the provided `TaskId`. Since the store only keeps track of accounts
     * referenced in the tasks it knows about.
     */
    public getTaskAssigneeAccountStore(task: TaskModel): Store<AccountModelData> | null {
        assert(
            this._taskEntryStoreById.get(task.id)?.store.getSnapshot().task === task,
            "Can’t get the assignee account for a `TaskModel` that’s not the latest task in our store",
        );

        const assignee = task.getAssignee();
        if (!assignee) return null;

        return assertExists(this._referencedAccountStoreById.get(assignee.assignee.accountId))
            .store;
    }

    /**
     * Gets an account store referenced by a task if the account is actually
     * referenced by one of our tasks. Returns null if the account isn't referenced
     * by one of our tasks.
     */
    public getReferencedAccountStoreIfExists(accountId: AccountId): Store<AccountModelData> | null {
        return this._referencedAccountStoreById.get(accountId)?.store ?? null;
    }

    public retainTaskEntryStore(taskId: TaskId) {
        const taskEntryStore = assertExists(this._taskEntryStoreById.get(taskId));
        taskEntryStore.referenceCount++;

        if (taskEntryStore.referenceCount === 1) {
            this._delayReleaseTaskEntryStoreIds?.delete(taskId);
        }
    }

    public releaseTaskEntryStore(taskId: TaskId) {
        const taskEntryStore = assertExists(this._taskEntryStoreById.get(taskId));
        taskEntryStore.referenceCount--;

        if (taskEntryStore.referenceCount === 0) {
            if (this._delayReleaseTaskEntryStoreIds) {
                this._delayReleaseTaskEntryStoreIds.add(taskId);
            } else {
                this._taskEntryStoreById.delete(taskId);
                this._taskEntryStoreByIdStores.get(taskId)?.set(null);
                this._updateReferencedAccountStores(taskEntryStore.store.getSnapshot(), null);
            }
        }
    }

    private _temporarilyRetainTaskEntryStore(taskId: TaskId) {
        this.retainTaskEntryStore(taskId);

        setTimeout(() => {
            const taskEntryStore = assertExists(this._taskEntryStoreById.get(taskId));

            // We may receive a `TaskAction` before the task is backfilled. When we receive
            // such an action we expect to receive the task shortly thereafter! If we don't
            // receive the task we consider it an error.
            const taskEntry = taskEntryStore.store.getSnapshot();
            if (
                taskEntryStore.referenceCount === 1 &&
                taskEntry.task === null &&
                taskEntry.actions.length > 0
            ) {
                this._onError({
                    // We don't display the error in a toast to the user since while this error
                    // will cause glitches the user might not see it. (They'd definitely see a
                    // toast.)
                    display: false,
                    error: new DeadlineExceededError(
                        "Received actions for a task that wasn’t loaded",
                    ),
                });
            }

            this.releaseTaskEntryStore(taskId);
        }, 1000 * 10);
    }

    public retainCollectionEntryStore(collectionId: TaskCollectionId) {
        const collectionEntryStore = assertExists(this._collectionEntryStoreById.get(collectionId));
        collectionEntryStore.referenceCount++;

        if (collectionEntryStore.referenceCount === 1) {
            this._delayReleaseCollectionEntryStoreIds?.delete(collectionId);
        }
    }

    public releaseCollectionEntryStore(collectionId: TaskCollectionId) {
        const collectionEntryStore = assertExists(this._collectionEntryStoreById.get(collectionId));
        collectionEntryStore.referenceCount--;

        if (collectionEntryStore.referenceCount === 0) {
            if (this._delayReleaseCollectionEntryStoreIds) {
                this._delayReleaseCollectionEntryStoreIds.add(collectionId);
            } else {
                this._collectionEntryStoreById.delete(collectionId);
                this._collectionEntryStoreByIdStores.get(collectionId)?.set(null);
            }
        }
    }

    private _temporarilyRetainCollectionEntryStore(collectionId: TaskCollectionId) {
        this.retainCollectionEntryStore(collectionId);

        setTimeout(() => {
            const collectionEntryStore = assertExists(
                this._collectionEntryStoreById.get(collectionId),
            );

            // We may receive a `TaskAction` before the collection is backfilled. When we
            // receive such an action we expect to receive the collection shortly
            // thereafter! If we don't receive the collection we consider it an error.
            const collectionEntry = collectionEntryStore.store.getSnapshot();
            if (
                collectionEntryStore.referenceCount === 1 &&
                collectionEntry.collection === null &&
                collectionEntry.actions.length > 0
            ) {
                this._onError({
                    // We don't display the error in a toast to the user since while this error
                    // will cause glitches the user might not see it. (They'd definitely see a
                    // toast.)
                    display: false,
                    error: new DeadlineExceededError(
                        "Received actions for a task collection that was never loaded",
                    ),
                });
            }

            this.releaseCollectionEntryStore(collectionId);
        }, 1000 * 10);
    }

    /**
     * Apply an update event from our WebSocket connection to `TaskRealtimeService`
     * to our store. This method is commutative and idempotent. That means you can
     * call it with events in any order or call it with an event multiple times and
     * we'll converge to the same result.
     */
    public applyUpdateEvent(event: TaskRealtimeUpdateEvent): void {
        batchStoreUpdates(() => {
            this._applyUpdateEvent(event, noop);
        });
    }

    private _applyUpdateEvent<Value>(
        event: TaskRealtimeUpdateEvent,
        action: (batchUpdate: TaskClientStoreBatchUpdate) => Value,
    ): Value {
        // If this event originated from our client then ignore it! We've already
        // applied the action or are in the process of applying it. (e.g. We're waiting
        // on a `commitTaskActionTransaction()` request to finish.)
        //
        // Actions are idempotent so it should be ok to apply the event but we avoid
        // warnings from `_temporarilyRetainTaskEntryStore()` this way. If you commit
        // an action that removes a task from a query (e.g. close a task) applying that
        // action a second time here will create a null task entry that is temporarily
        // retained. Then we warn when the task isn't retained by anyone else. By not
        // applying the action we avoid a warning.
        if (event.originClientId === this._clientId) {
            return action({
                taskEntryUpdateById: emptyMap,
                collectionEntryUpdateById: emptyMap,
                actions: emptyArray,
            });
        }

        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        // Incorporate referenced accounts into account store:
        for (const account of event.referencedAccounts) {
            this.accountRegistry.getAndImmediatelyUpdateAccountStore(account);
        }

        // Backfill tasks:
        for (const backfillTask of event.backfillTasks) {
            const authorizationStateVersion =
                backfillTask.authorizationStateVersion ?? event.defaultAuthorizationStateVersion;

            this.clock.tick(authorizationStateVersion);

            if (backfillTask.type === "Authorized") {
                const oldTaskEntry =
                    newTaskEntryById.get(backfillTask.task.id) ??
                    this._taskEntryStoreById.get(backfillTask.task.id)?.store.getSnapshot();

                if (!oldTaskEntry) {
                    // This backfill introduced new data. Make sure our logical clock's time is
                    // beyond any times used in this object.
                    backfillTask.task.tick(this.clock);

                    newTaskEntryById.set(backfillTask.task.id, {
                        task: backfillTask.task,
                        actions: null,
                        optimisticState: null,
                        authorizationState: new TaskAuthorizationStateRegister(
                            taskAuthorizedState,
                            authorizationStateVersion,
                        ),
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
                    newTask = backfillTask.task;

                    newTask = applyPendingTaskActions(newTask, oldTaskEntry.actions);

                    if (oldTaskEntry.optimisticState === null) {
                        newOptimisticState = null;
                    } else {
                        newOptimisticState = {
                            original: {
                                task: backfillTask.task,
                                actions: null,
                            },
                            actions: oldTaskEntry.optimisticState.actions,
                        };
                    }
                } else {
                    newTask = oldTaskEntry.task.merge(backfillTask.task);

                    if (oldTaskEntry.optimisticState === null) {
                        newOptimisticState = null;
                    } else {
                        newOptimisticState = {
                            original: {
                                task:
                                    oldTaskEntry.optimisticState.original.task === null
                                        ? applyPendingTaskActions(
                                              backfillTask.task,
                                              oldTaskEntry.optimisticState.original.actions,
                                          )
                                        : oldTaskEntry.optimisticState.original.task.merge(
                                              backfillTask.task,
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
                if (oldTaskEntry.authorizationState === null) {
                    newTaskEntryById.set(backfillTask.task.id, {
                        task: newTask,
                        actions: null,
                        optimisticState: newOptimisticState,
                        authorizationState: new TaskAuthorizationStateRegister(
                            taskAuthorizedState,
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                const newAuthorizationState = oldTaskEntry.authorizationState.apply({
                    value: taskAuthorizedState,
                    version: authorizationStateVersion,
                });

                // If nothing in our entry changed then don't update the task.
                if (
                    newTask === oldTaskEntry.task &&
                    newOptimisticState?.original.task ===
                        oldTaskEntry.optimisticState?.original.task &&
                    newAuthorizationState === oldTaskEntry.authorizationState
                ) {
                    // We do still, however, add the task to our `newTaskEntryById` map since we
                    // want to try adding all backfilled tasks to the queries in our store. Since
                    // when loading a query the server sends relevant tasks in `backfilledTasks`.
                    // If the server knows a task has already been backfilled
                    // (`TaskRealtimeConnection` keeps track) then it will include the task in a
                    // `previouslyBackfilledTaskIds` array. But the server only knows what it's
                    // backfilled in the current WebSocket connection. It does not know what the
                    // client has from before that.
                    //
                    // If applying an action results in a noop then we don't need to add to
                    // `newTaskEntryById` since queries should have already seen the task.
                    newTaskEntryById.set(backfillTask.task.id, oldTaskEntry);
                    continue;
                }

                newTaskEntryById.set(backfillTask.task.id, {
                    task: newTask,
                    actions: null,
                    optimisticState: newOptimisticState,
                    authorizationState: newAuthorizationState,
                });
            } else {
                cast<"Unauthorized">(backfillTask.type);

                const oldTaskEntry =
                    newTaskEntryById.get(backfillTask.taskId) ??
                    this._taskEntryStoreById.get(backfillTask.taskId)?.store.getSnapshot();

                if (!oldTaskEntry) {
                    newTaskEntryById.set(backfillTask.taskId, {
                        task: null,
                        actions: [],
                        optimisticState: null,
                        authorizationState: new TaskAuthorizationStateRegister(
                            {type: "Unauthorized", errorCode: backfillTask.errorCode},
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                // Authorization state is unknown, mark the task as unauthorized.
                if (oldTaskEntry.authorizationState === null) {
                    newTaskEntryById.set(backfillTask.taskId, {
                        ...oldTaskEntry,
                        authorizationState: new TaskAuthorizationStateRegister(
                            {type: "Unauthorized", errorCode: backfillTask.errorCode},
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                const newAuthorizationState = oldTaskEntry.authorizationState.apply({
                    value: {type: "Unauthorized", errorCode: backfillTask.errorCode},
                    version: authorizationStateVersion,
                });

                // Authorization state in the store wins. We may be applying events
                // out-of-order. We return a referentially identical entry to avoid updating
                // the map.
                if (oldTaskEntry.authorizationState === newAuthorizationState) continue;

                newTaskEntryById.set(backfillTask.taskId, {
                    ...oldTaskEntry,
                    authorizationState: newAuthorizationState,
                });
            }
        }

        // Backfill collections:
        for (const backfillCollection of event.backfillCollections) {
            const authorizationStateVersion =
                backfillCollection.authorizationStateVersion ??
                event.defaultAuthorizationStateVersion;

            this.clock.tick(authorizationStateVersion);

            if (backfillCollection.type === "Authorized") {
                const oldCollectionEntry =
                    newCollectionEntryById.get(backfillCollection.collection.id) ??
                    this._collectionEntryStoreById
                        .get(backfillCollection.collection.id)
                        ?.store.getSnapshot();

                if (!oldCollectionEntry) {
                    // This backfill introduced new data. Make sure our logical clock's time is
                    // beyond any times used in this object.
                    backfillCollection.collection.tick(this.clock);

                    newCollectionEntryById.set(backfillCollection.collection.id, {
                        collection: backfillCollection.collection,
                        actions: null,
                        optimisticState: null,
                        authorizationState: new TaskAuthorizationStateRegister(
                            taskAuthorizedState,
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                // When backfilling the collection, we may have received actions out-of-order from
                // the server or we may have some out-of-order optimistic actions. We need to
                // apply actions we received (from the server and optimistic) to the collection.
                // We also need to update our original collection in `optimisticState` so if we
                // need to revert an optimistic action we preserve the backfilled collection.
                let newCollection: TaskCollectionModel;
                let newOptimisticState: TaskClientStoreCollectionEntryOptimisticState | null;
                if (oldCollectionEntry.collection === null) {
                    newCollection = backfillCollection.collection;

                    newCollection = applyPendingTaskCollectionActions(
                        newCollection,
                        oldCollectionEntry.actions,
                    );

                    if (oldCollectionEntry.optimisticState === null) {
                        newOptimisticState = null;
                    } else {
                        newOptimisticState = {
                            original: {
                                collection: backfillCollection.collection,
                                actions: null,
                            },
                            actions: oldCollectionEntry.optimisticState.actions,
                        };
                    }
                } else {
                    newCollection = oldCollectionEntry.collection.merge(
                        backfillCollection.collection,
                    );

                    if (oldCollectionEntry.optimisticState === null) {
                        newOptimisticState = null;
                    } else {
                        newOptimisticState = {
                            original: {
                                collection:
                                    oldCollectionEntry.optimisticState.original.collection === null
                                        ? applyPendingTaskCollectionActions(
                                              backfillCollection.collection,
                                              oldCollectionEntry.optimisticState.original.actions,
                                          )
                                        : oldCollectionEntry.optimisticState.original.collection.merge(
                                              backfillCollection.collection,
                                          ),
                                actions: null,
                            },
                            actions: oldCollectionEntry.optimisticState.actions,
                        };
                    }
                }

                if (newCollection !== oldCollectionEntry.collection) {
                    // This backfill introduced new data. Make sure our logical clock's time is
                    // beyond any times used in this object.
                    newCollection.tick(this.clock);
                }

                // Authorization state is unknown, mark the collection as authorized.
                if (oldCollectionEntry.authorizationState === null) {
                    newCollectionEntryById.set(backfillCollection.collection.id, {
                        collection: newCollection,
                        actions: null,
                        optimisticState: newOptimisticState,
                        authorizationState: new TaskAuthorizationStateRegister(
                            taskAuthorizedState,
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                const newAuthorizationState = oldCollectionEntry.authorizationState.apply({
                    value: taskAuthorizedState,
                    version: authorizationStateVersion,
                });

                // If nothing in our entry changed then don't update the collection.
                if (
                    newCollection === oldCollectionEntry.collection &&
                    newOptimisticState?.original.collection ===
                        oldCollectionEntry.optimisticState?.original.collection &&
                    newAuthorizationState === oldCollectionEntry.authorizationState
                ) {
                    // For symmetry with tasks, backfilled collections go in
                    // `newCollectionEntryById` even if the backfill was a noop. Actions that are a
                    // noop do not go in `newCollectionEntryById`.
                    newCollectionEntryById.set(
                        backfillCollection.collection.id,
                        oldCollectionEntry,
                    );
                    continue;
                }

                newCollectionEntryById.set(backfillCollection.collection.id, {
                    collection: newCollection,
                    actions: null,
                    optimisticState: newOptimisticState,
                    authorizationState: newAuthorizationState,
                });
            } else {
                const oldCollectionEntry =
                    newCollectionEntryById.get(backfillCollection.collectionId) ??
                    this._collectionEntryStoreById
                        .get(backfillCollection.collectionId)
                        ?.store.getSnapshot();

                if (!oldCollectionEntry) {
                    newCollectionEntryById.set(backfillCollection.collectionId, {
                        collection: null,
                        actions: [],
                        optimisticState: null,
                        authorizationState: new TaskAuthorizationStateRegister(
                            {type: "Unauthorized", errorCode: backfillCollection.errorCode},
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                // Authorization state is unknown, mark the collection as unauthorized.
                if (oldCollectionEntry.authorizationState === null) {
                    newCollectionEntryById.set(backfillCollection.collectionId, {
                        ...oldCollectionEntry,
                        authorizationState: new TaskAuthorizationStateRegister(
                            {type: "Unauthorized", errorCode: backfillCollection.errorCode},
                            authorizationStateVersion,
                        ),
                    });
                    continue;
                }

                const newAuthorizationState = oldCollectionEntry.authorizationState.apply({
                    value: {type: "Unauthorized", errorCode: backfillCollection.errorCode},
                    version: authorizationStateVersion,
                });

                // Authorization state in the store wins. We may be applying events
                // out-of-order. We return a referentially identical entry to avoid updating
                // the map.
                if (oldCollectionEntry.authorizationState === newAuthorizationState) continue;

                newCollectionEntryById.set(backfillCollection.collectionId, {
                    ...oldCollectionEntry,
                    authorizationState: newAuthorizationState,
                });
            }
        }

        const updateAccountNameActions: Array<{
            action: TaskUpdateAccountNameAction;
            getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
        }> = [];

        // Apply actions:
        for (const action of event.actions) {
            // All actions our client commits will have a greater logical time than the
            // actions we've already seen.
            this.clock.tick(action.time);

            const getActionReferencedSortableAccount = createGetTaskActionReferencedSortableAccount(
                this.accountRegistry,
                action,
            );

            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.store.getSnapshot();

                    if (!oldTaskEntry) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                task: null,
                                actions: [{action, getActionReferencedSortableAccount}],
                                optimisticState: null,
                                authorizationState: null,
                            });
                        } else {
                            const newTask = TaskModel.createFromAction(
                                this.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                                getActionReferencedSortableAccount,
                            );

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: null,
                                // If we receive the create event for a task we assume it to be
                                // authorized. In practice when a task is created we'll get a backfill for the
                                // task instead of the create action.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    event.defaultAuthorizationStateVersion,
                                ),
                            });
                        }
                        continue;
                    }

                    if (oldTaskEntry.task === null) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                ...oldTaskEntry,
                                actions: [
                                    ...oldTaskEntry.actions,
                                    {action, getActionReferencedSortableAccount},
                                ],
                                optimisticState: oldTaskEntry.optimisticState
                                    ? {
                                          original: oldTaskEntry.optimisticState.original,
                                          actions: [
                                              ...oldTaskEntry.optimisticState.actions,
                                              {
                                                  isOptimistic: false,
                                                  action,
                                                  getActionReferencedSortableAccount,
                                              },
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
                                getActionReferencedSortableAccount,
                            );

                            // Apply any actions we received out-of-order now that the task has
                            // been created.
                            newTask = applyPendingTaskActions(newTask, oldTaskEntry.actions);

                            if (oldTaskEntry.optimisticState) {
                                newTask = applyPendingTaskActions(
                                    newTask,
                                    oldTaskEntry.optimisticState.actions,
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
                                              {
                                                  isOptimistic: false,
                                                  action,
                                                  getActionReferencedSortableAccount,
                                              },
                                          ],
                                      }
                                    : null,
                                // If we receive the create event for a task we assume it to be
                                // authorized. In practice when a task is created we'll get a backfill for the
                                // task instead of the create action.
                                authorizationState:
                                    oldTaskEntry.authorizationState ??
                                    new TaskAuthorizationStateRegister(
                                        taskAuthorizedState,
                                        event.defaultAuthorizationStateVersion,
                                    ),
                            });
                            continue;
                        }
                    }

                    const newTask = oldTaskEntry.task.applyAction(
                        action,
                        getActionReferencedSortableAccount,
                    );

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
                                      {
                                          isOptimistic: false,
                                          action,
                                          getActionReferencedSortableAccount,
                                      },
                                  ],
                              }
                            : null,
                        authorizationState: oldTaskEntry.authorizationState,
                    });
                    continue;
                }
                case "UpdateCollection": {
                    const oldCollectionEntry =
                        newCollectionEntryById.get(action.collectionId) ??
                        this._collectionEntryStoreById
                            .get(action.collectionId)
                            ?.store.getSnapshot();

                    if (!oldCollectionEntry) {
                        if (action.collectionAction.type !== "Create") {
                            newCollectionEntryById.set(action.collectionId, {
                                collection: null,
                                actions: [{action}],
                                optimisticState: null,
                                authorizationState: null,
                            });
                        } else {
                            const newCollection = TaskCollectionModel.createFromAction(
                                this.spaceId,
                                action.collectionId,
                                action.time,
                                action.collectionAction,
                            );

                            newCollectionEntryById.set(action.collectionId, {
                                collection: newCollection,
                                actions: null,
                                optimisticState: null,
                                // If we receive the create event for a collection we assume it to be
                                // authorized. In practice when a collection is created we'll get a backfill
                                // for the collection instead of the create action.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    event.defaultAuthorizationStateVersion,
                                ),
                            });
                        }
                        continue;
                    }

                    if (oldCollectionEntry.collection === null) {
                        if (action.collectionAction.type !== "Create") {
                            newCollectionEntryById.set(action.collectionId, {
                                ...oldCollectionEntry,
                                actions: [...oldCollectionEntry.actions, {action}],
                                optimisticState: oldCollectionEntry.optimisticState
                                    ? {
                                          original: oldCollectionEntry.optimisticState.original,
                                          actions: [
                                              ...oldCollectionEntry.optimisticState.actions,
                                              {isOptimistic: false, action},
                                          ],
                                      }
                                    : null,
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
                            newCollection = applyPendingTaskCollectionActions(
                                newCollection,
                                oldCollectionEntry.actions,
                            );

                            newCollectionEntryById.set(action.collectionId, {
                                collection: newCollection,
                                actions: null,
                                optimisticState: oldCollectionEntry.optimisticState
                                    ? {
                                          original: oldCollectionEntry.optimisticState.original,
                                          actions: [
                                              ...oldCollectionEntry.optimisticState.actions,
                                              {isOptimistic: false, action},
                                          ],
                                      }
                                    : null,
                                // If we receive the create event for a collection we assume it to be
                                // authorized. In practice when a collection is created we'll get a backfill
                                // for the collection instead of the create action.
                                authorizationState:
                                    oldCollectionEntry.authorizationState ??
                                    new TaskAuthorizationStateRegister(
                                        taskAuthorizedState,
                                        event.defaultAuthorizationStateVersion,
                                    ),
                            });
                            continue;
                        }
                    }

                    const newCollection = oldCollectionEntry.collection.applyAction(action);

                    // Optimization: If the collection didn't change then don't update our store.
                    if (newCollection === oldCollectionEntry.collection) continue;

                    newCollectionEntryById.set(action.collectionId, {
                        collection: newCollection,
                        actions: null,
                        optimisticState: oldCollectionEntry.optimisticState
                            ? {
                                  original: oldCollectionEntry.optimisticState.original,
                                  actions: [
                                      ...oldCollectionEntry.optimisticState.actions,
                                      {isOptimistic: false, action},
                                  ],
                              }
                            : null,
                        authorizationState: oldCollectionEntry.authorizationState,
                    });
                    continue;
                }
                case "UpdateAccountName": {
                    updateAccountNameActions.push({action, getActionReferencedSortableAccount});
                    break;
                }
                case "UpdateNotepadPage": {
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        for (const {action, getActionReferencedSortableAccount} of updateAccountNameActions) {
            // The server must provide an updated `AccountModel` for `UpdateTaskName`
            // actions so that when we apply actions in the future that reference this
            // `AccountId` they get the right account name.
            const account = event.referencedAccounts.find(
                account => account.id === action.accountId,
            );
            assert(
                account && account.initialData.nameVersion >= action.accountNameVersion,
                "Server expected to include updated `AccountModel` in `referencedAccounts` for `UpdateTaskName` actions",
            );

            const updateTaskEntry = (taskId: TaskId, oldTaskEntry: TaskClientStoreTaskEntry) => {
                // Skip tasks that haven't been backfilled yet. When we apply actions for these
                // tasks we'll read the updated account name from `AccountRegistry`.
                if (oldTaskEntry.task === null) return;

                const newTask = oldTaskEntry.task.applyUpdateAccountNameAction(action);

                // Optimization: If the task didn't change and we don't have optimistic state
                // for the task then don't update our store.
                if (newTask === oldTaskEntry.task && oldTaskEntry.optimisticState === null) {
                    return;
                }

                newTaskEntryById.set(taskId, {
                    task: newTask,
                    actions: null,
                    optimisticState: oldTaskEntry.optimisticState
                        ? {
                              original: oldTaskEntry.optimisticState.original,
                              actions: [
                                  ...oldTaskEntry.optimisticState.actions,
                                  {
                                      isOptimistic: false,
                                      action,
                                      getActionReferencedSortableAccount,
                                  },
                              ],
                          }
                        : null,
                    authorizationState: oldTaskEntry.authorizationState,
                });
            };

            for (const [taskId, oldTaskEntry] of this._taskEntryStoreById) {
                const taskEntry = newTaskEntryById.get(taskId) ?? oldTaskEntry.store.getSnapshot();

                updateTaskEntry(taskId, taskEntry);
            }

            for (const [taskId, taskEntry] of newTaskEntryById) {
                // Already covered by the loop above.
                if (this._taskEntryStoreById.has(taskId)) continue;

                updateTaskEntry(taskId, taskEntry);
            }
        }

        return this._batchUpdateStore(
            newTaskEntryById,
            newCollectionEntryById,
            event.actions,
            action,
        );
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
     *
     * If you are referencing some collections in your transaction that don't
     * already exist in the store then you need to provide the collections with
     * `referencedCollection` in the `AddCollection` action so we can add their
     * data to the store.
     */
    public commitTaskActionTransaction(
        context: Context<{rpc: RpcContextModuleBase}>,
        actionsIterable: Iterable<TaskActionModel>,
        {
            undoManager,
            affinityManager,
            leaseId = null,
            undoableSlice = null,
            updateAccessPolicyShareNotification = null,
        }: {
            // This property is required to force callers to make a decision on whether or
            // not to pass in `undoManager`. Most of the time you want to pass in
            // `undoManager`. If you pass in null the change can't be undone.
            undoManager: TaskClientStoreUndoManager | null;
            // This property is required to force callers to pass down a `affinityManager`
            // object from the route component.
            affinityManager: TaskClientStoreSearchAffinityManager;
            leaseId?: TaskActionTransactionLeaseId | null;
            undoableSlice?: {startIndex: number | null; endIndex: number | null} | null;
            updateAccessPolicyShareNotification?: ShareNotification | null;
        },
    ): {finally: (callback: () => void) => void} {
        const actions: ReadonlyArray<TaskActionModel> = isReadonlyArray(actionsIterable)
            ? actionsIterable
            : Array.from(actionsIterable);

        // Noop if there aren't any actions.
        if (actions.length === 0) return {finally: callback => scheduleMicrotask(callback)};

        const mutexLockedPromiseResolver = createPromiseResolver();
        const mutexUnlockPromiseResolver = createPromiseResolver();

        // Make sure we're immediately holding the action transaction mutex. In case
        // any synchronous code between now and when we actually call
        // `commitTaskActionTransaction()` runs some callback that needs to wait on the
        // mutex.
        //
        // We've observed pasting a bulleted list with indentation like:
        //
        // ```
        // - task 1
        //     - task 2
        // - task 3
        // ```
        //
        // Needs this. Since `_applyUpdateEvent()` will run some code in
        // `useTaskGridViewExpansionState()` that expands "task 1"'s children and
        // creates a query subscription for "task 1"'s children. However, that query
        // will fail if run before `commitTaskActionTransaction()` asynchronously
        // finishes creating the task in DynamoDB.
        if (!shouldDisableCommitTaskActionTransactionMutexForTest) {
            void this._commitTaskActionTransactionMutex.withLock(() => {
                mutexLockedPromiseResolver.resolve();
                return mutexUnlockPromiseResolver.promise;
            });
        }

        let undoActions: TaskUndoActions | null;
        let allPendingActions: Array<TaskClientStorePendingAction>;
        let createLeaseIfLostAccessId: TaskActionTransactionLeaseId | null;
        let release: () => void;
        try {
            // We need to create undo actions before applying our actions to the store so
            // we can read old task data from the store.
            undoActions = undoManager
                ? createTaskUndoActionsIfPossible(this, actions, undoableSlice)
                : null;

            assert(this.onQueryLoadedTaskRemove === null);
            const removedFromQueries = new Set<TaskClientQuery>();
            this.onQueryLoadedTaskRemove = (query: TaskClientQueryInternal) => {
                removedFromQueries.add(query.external);
            };

            let actuallyRelease: () => void;
            try {
                ({pendingActions: allPendingActions, release: actuallyRelease} = batchStoreUpdates(
                    () => {
                        const referencedCollections: Array<TaskCollectionModel> = [];

                        for (const action of actions) {
                            if (
                                action.type === "UpdateTask" &&
                                action.taskAction.type === "AddCollection" &&
                                action.taskAction.referencedCollection
                            ) {
                                referencedCollections.push(action.taskAction.referencedCollection);
                            }
                        }

                        if (referencedCollections.length === 0) {
                            const optimisticExtraActions = this._getOptimisticExtraActions(actions);

                            return this._applyOptimisticTaskActions(
                                optimisticExtraActions.length > 0
                                    ? [...actions, ...optimisticExtraActions]
                                    : actions,
                                update => {
                                    affinityManager.markLowIntentUpdateInteraction(update);
                                },
                            );
                        }

                        // If we have some `referencedCollections` then we want to backfill it in the
                        // store THEN apply our optimistic actions. We need to apply our optimistic
                        // actions in the `onBatchUpdate` callback or else the backfilled collections
                        // will be immediately released.
                        return this._applyUpdateEvent(
                            {
                                type: "Update",
                                actions: [],
                                backfillTasks: [],
                                backfillCollections: referencedCollections.map(collection => ({
                                    type: "Authorized",
                                    collection,
                                })),
                                // Any authorization state change from the server should override us.
                                defaultAuthorizationStateVersion: zeroHybridLogicalTime,
                                referencedAccounts: [],
                                // Don't pass `this._clientId` in since we don't want to ignore this event.
                                originClientId: null,
                            },
                            () => {
                                const optimisticExtraActions =
                                    this._getOptimisticExtraActions(actions);

                                return this._applyOptimisticTaskActions(
                                    optimisticExtraActions.length > 0
                                        ? [...actions, ...optimisticExtraActions]
                                        : actions,
                                    update => {
                                        affinityManager.markLowIntentUpdateInteraction(update);
                                    },
                                );
                            },
                        );
                    },
                ));
            } finally {
                this.onQueryLoadedTaskRemove = null;
            }

            // We hold onto collections and tasks that become unreferenced after applying
            // optimistic actions until both:
            //
            // 1. The action is commit (if it's reverted we need the collections/tasks back)
            // 2. The undo stack corresponding to this action is applied or released
            let referenceCount = 1;

            release = () => {
                referenceCount--;
                if (referenceCount === 0) actuallyRelease?.();
            };

            // Leases allow us to temporarily add a task back to our query with undo
            // actions even if we've lost access.
            createLeaseIfLostAccessId =
                removedFromQueries.size > 0 && undoManager && undoActions
                    ? generateId<TaskActionTransactionLeaseId>()
                    : null;

            if (undoManager && undoActions) {
                referenceCount++;

                let isUndoEntryReleased = false;

                undoManager.pushUndoStackEntry({
                    undoActions,
                    removedFromQueries,
                    leaseId: createLeaseIfLostAccessId,
                    release: () => {
                        assert(!isUndoEntryReleased);
                        isUndoEntryReleased = true;
                        release();
                    },
                });
            }
        } catch (error) {
            // Don't reject. We don't want unlocking the mutex to log some unhandled promise
            // rejection warnings. We handle errors on `commitPromise` below.
            mutexUnlockPromiseResolver.resolve();

            throw error;
        }

        const run = () =>
            commitTaskActionTransaction(context, {
                spaceId: this.spaceId,
                actions: actions.map(fromTaskActionModel),
                clientId: this._clientId,
                leaseId: leaseId ?? undefined,
                createLeaseIfLostAccess: createLeaseIfLostAccessId
                    ? {
                          id: createLeaseIfLostAccessId,
                          actions: assertExists(undoActions)
                              .get(this)
                              .map(fromTaskUpdateTaskActionModel),
                      }
                    : undefined,
                updateAccessPolicyShareNotification:
                    updateAccessPolicyShareNotification ?? undefined,
            }).then(
                output => {
                    mutexUnlockPromiseResolver.resolve();
                    return output;
                },
                error => {
                    // Don't reject. We don't want unlocking the mutex to log some unhandled promise
                    // rejection warnings. We handle errors on `commitPromise` below.
                    mutexUnlockPromiseResolver.resolve();

                    throw error;
                },
            );

        const commitPromise = shouldDisableCommitTaskActionTransactionMutexForTest
            ? run()
            : mutexLockedPromiseResolver.promise.then(run);

        // Will show a "Saving" indicator while we wait for the action transaction to
        // commit. Will also add a `beforeunload` listener that warns the user that we
        // have unsaved changes if they try to navigate away.
        affinityManager.addGlobalLoadingIndicator(commitPromise, {type: "Saving"});

        const pendingActions = allPendingActions.slice(0, actions.length);
        const optimisticExtraPendingActions = allPendingActions.slice(actions.length);

        const optimisticExtraPendingActionsByTaskId = new Map<
            TaskId,
            Array<TaskClientStorePendingUpdateTaskAction>
        >();
        for (const pendingAction of optimisticExtraPendingActions) {
            assert(pendingAction.action.type === "UpdateTask");

            getOrSetDefaultMapValue(
                optimisticExtraPendingActionsByTaskId,
                pendingAction.action.taskId,
                () => [],
            ).push({
                ...pendingAction,
                action: pendingAction.action,
            });
        }

        commitPromise.then(
            ({extraActions, referencedAccounts}) => {
                // Between applying an update event and committing our optimistic actions we
                // have a lot of store updates we want to batch together.
                batchStoreUpdates(() => {
                    this._commitOptimisticTaskActions(pendingActions);

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
                    for (const taskId of optimisticExtraPendingActionsByTaskId.keys()) {
                        taskByIdBeforeExtraActions.set(
                            taskId,
                            this._taskEntryStoreById.get(taskId)?.store.getSnapshot().task ?? null,
                        );
                    }

                    if (extraActions.length > 0) {
                        this.applyUpdateEvent({
                            type: "Update",
                            actions: extraActions,
                            backfillTasks: [],
                            backfillCollections: [],
                            // Any authorization state change from the server should override us.
                            defaultAuthorizationStateVersion: zeroHybridLogicalTime,
                            referencedAccounts,
                            // Don't pass `this._clientId` in since we don't want to ignore this event.
                            originClientId: null,
                        });
                    }

                    for (const [
                        taskId,
                        optimisticExtraActions,
                    ] of optimisticExtraPendingActionsByTaskId) {
                        const taskEntry = this._taskEntryStoreById.get(taskId)?.store.getSnapshot();

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
                        const taskWithoutOptimisticExtraActions = applyPendingTaskActions(
                            taskEntry.optimisticState.original.task,
                            taskEntry.optimisticState.actions.filter(({action}) =>
                                optimisticExtraActions.every(
                                    pendingAction => pendingAction.action !== action,
                                ),
                            ),
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

                    // Release any references held when we applied the optimistic action. If tasks
                    // are fully released by the optimistic action, we retain them until the action
                    // commits in case we need to revert the action.
                    release();
                });
            },
            error => {
                const taskIds = new Set<TaskId>();
                const collectionIds = new Set<TaskCollectionId>();

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
                        case "UpdateAccountName": {
                            // Generic error message if this fails. The client shouldn't be committing
                            // this anyway.
                            break;
                        }
                        case "UpdateNotepadPage": {
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

                this._onError({
                    display: true,
                    title:
                        failedNouns.length === 0
                            ? "Couldn’t save changes"
                            : `Couldn’t save changes to ${joinPrettyConjunctionList(
                                  failedNouns,
                                  "and",
                              )}`,
                    error,
                });

                batchStoreUpdates(() => {
                    this._revertOptimisticTaskActions(
                        optimisticExtraPendingActions.length > 0
                            ? [...pendingActions, ...optimisticExtraPendingActions]
                            : pendingActions,
                    );

                    // Release any references held when we applied the optimistic action. If tasks
                    // are fully released by the optimistic action, we retain them until the action
                    // commits in case we need to revert the action.
                    release();
                });
            },
        );

        return {
            finally: callback => {
                void commitPromise.finally(callback);
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
        initialTitleUpdate: TaskTitleUpdateModel,
        {
            undoManager,
            affinityManager,
        }: {
            // This property is required to force callers to make a decision on whether or
            // not to pass in `undoManager`. Most of the time you want to pass in
            // `undoManager`. If you pass in null the change can't be undone.
            undoManager: TaskClientStoreUndoManager | null;
            affinityManager: TaskClientStoreSearchAffinityManager;
        },
    ): TaskClientStoreUpdateTitleActionTransactionBuilder {
        let isFinished = false;
        let mergedTitleUpdate = initialTitleUpdate.raw;

        const individualActions: Array<TaskActionModel> = [];

        // We hold onto collections and tasks that become unreferenced after applying
        // optimistic actions until both:
        //
        // 1. The action is commit (if it's reverted we need the collections/tasks back)
        // 2. The undo stack corresponding to this action is applied or released
        let referenceCount = 1;
        const actualReleases: Array<() => void> = [];

        const release = () => {
            referenceCount--;
            if (referenceCount === 0) {
                for (const actuallyRelease of actualReleases) {
                    actuallyRelease();
                }
            }
        };

        const addTitleUpdate = (titleUpdate: TaskTitleUpdateModel) => {
            const action: TaskActionModel = {
                type: "UpdateTask",
                time: this.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate,
                },
            };

            individualActions.push(action);

            // We need to create undo actions before applying our actions to the store so
            // we can read old task data from the store.
            const undoActions = undoManager
                ? createTaskUndoActionsIfPossible(this, [action])
                : null;

            assert(this.onQueryLoadedTaskRemove === null);
            const removedFromQueries = new Set<TaskClientQuery>();
            this.onQueryLoadedTaskRemove = (query: TaskClientQueryInternal) => {
                removedFromQueries.add(query.external);
            };

            try {
                const {release: actuallyRelease} = this._applyOptimisticTaskActions(
                    [action],
                    update => {
                        affinityManager.markLowIntentUpdateInteraction(update);
                    },
                );
                actualReleases.push(actuallyRelease);
            } finally {
                this.onQueryLoadedTaskRemove = null;
            }

            if (undoManager && undoActions) {
                referenceCount++;

                let isUndoEntryReleased = false;

                undoManager.pushUndoStackEntry({
                    undoActions,
                    removedFromQueries,
                    // Changing the title can never remove the account's access to the task. Since
                    // task access is determined by the creator, assignee, parent task, and
                    // collections. So we'll never need to generate a lease.
                    leaseId: null,
                    release: () => {
                        assert(!isUndoEntryReleased);
                        isUndoEntryReleased = true;
                        release();
                    },
                });
            }
        };

        addTitleUpdate(initialTitleUpdate);

        return {
            add: (titleUpdate: TaskTitleUpdateModel) => {
                assert(!isFinished);

                mergedTitleUpdate = mergeTaskTitleUpdates(mergedTitleUpdate, titleUpdate.raw);
                addTitleUpdate(titleUpdate);
            },
            commit: context => {
                assert(!isFinished);
                isFinished = true;

                const finalActions: Array<TaskAction> = [
                    {
                        type: "UpdateTask",
                        time: this.clock.now(),
                        taskId,
                        taskAction: {
                            type: "UpdateTitle",
                            titleUpdate: mergedTitleUpdate,
                        },
                    },
                ];

                const run = () =>
                    commitTaskActionTransaction(context, {
                        spaceId: this.spaceId,
                        actions: finalActions,
                        clientId: this._clientId,
                    });

                const commitPromise = shouldDisableCommitTaskActionTransactionMutexForTest
                    ? run()
                    : this._commitTaskActionTransactionMutex.withLock(run);

                // Will show a "Saving" indicator while we wait for the action transaction to
                // commit. Will also add a `beforeunload` listener that warns the user that we
                // have unsaved changes if they try to navigate away.
                affinityManager.addGlobalLoadingIndicator(commitPromise, {type: "Saving"});

                commitPromise.then(
                    () => {
                        batchStoreUpdates(() => {
                            this._commitOptimisticTaskActions(
                                individualActions.map(action => ({
                                    action,
                                    getActionReferencedSortableAccount: () => {
                                        throw new InternalError(
                                            "`UpdateTitle` task action doesn’t reference any accounts",
                                        );
                                    },
                                })),
                            );

                            release();
                        });
                    },
                    error => {
                        this._onError({
                            display: true,
                            title: "Couldn’t save changes to task",
                            error,
                        });

                        batchStoreUpdates(() => {
                            this._revertOptimisticTaskActions(
                                individualActions.map(action => ({
                                    action,
                                    getActionReferencedSortableAccount: () => {
                                        throw new InternalError(
                                            "`UpdateTitle` task action doesn’t reference any accounts",
                                        );
                                    },
                                })),
                            );

                            release();
                        });
                    },
                );

                return {
                    finally: callback => {
                        void commitPromise.finally(callback);
                    },
                };
            },
        };
    }

    /**
     * Handles race conditions when committing a task action transaction. This
     * will apply the actions to the store and create undo actions if possible.
     *
     * @param undoManager - The undo manager to pass the undo actions to. If null
     * then no undo actions will be saved.
     *
     * @param run - A function that returns a promise that resolves with an object
     * containing at least the `actions` and `referencedAccounts` properties.
     *
     * @param mapUndoActions  - A function that takes an iterable of
     * `TaskAction` objects and returns an iterable of `TaskActionModel`
     * objects that will be passed to the undo manager. This function may remove any
     * actions that we don't want to undo.
     */

    private _withSpecializedCommitTaskActionTransaction<T>(
        {
            undoManager,
            mapUndoActions,
        }: {
            undoManager: TaskClientStoreUndoManager | null;
            mapUndoActions: (actions: Iterable<TaskAction>) => Iterable<TaskActionModel>;
        },
        run: () => Promise<
            T & {
                readonly actions: ReadonlyArray<TaskAction>;
                readonly referencedAccounts: ReadonlyArray<AccountModel>;
            }
        >,
    ): Promise<
        T & {
            readonly actions: ReadonlyArray<TaskAction>;
            readonly referencedAccounts: ReadonlyArray<AccountModel>;
        }
    > {
        // We don't use `addGlobalLoadingIndicator()` with this promise
        // because it's expected that the caller handle pending states and errors.
        const promise = shouldDisableCommitTaskActionTransactionMutexForTest
            ? run()
            : this._commitTaskActionTransactionMutex.withLock(run);

        return promise.then(result => {
            const {actions, referencedAccounts} = result;
            let hasUndoStackEntry = false;

            assert(this.onQueryLoadedTaskRemove === null);
            const removedFromQueries = new Set<TaskClientQuery>();
            this.onQueryLoadedTaskRemove = (query: TaskClientQueryInternal) => {
                removedFromQueries.add(query.external);
            };

            const previousDelayReleaseTaskEntryStoreIds = this._delayReleaseTaskEntryStoreIds;
            const previousDelayReleaseCollectionEntryStoreIds =
                this._delayReleaseCollectionEntryStoreIds;

            const delayReleaseTaskEntryStoreIds = new Set<TaskId>();
            const delayReleaseCollectionEntryStoreIds = new Set<TaskCollectionId>();

            this._delayReleaseTaskEntryStoreIds = delayReleaseTaskEntryStoreIds;
            this._delayReleaseCollectionEntryStoreIds = delayReleaseCollectionEntryStoreIds;

            let releaseTaskIds: Array<TaskId>;
            let releaseCollectionIds: Array<TaskCollectionId>;

            try {
                // We need to create undo actions before applying our actions to the store so
                // we can read old task data from the store.
                const undoActions = undoManager
                    ? createTaskUndoActionsIfPossible(this, mapUndoActions(actions))
                    : null;

                this.applyUpdateEvent({
                    type: "Update",
                    actions,
                    backfillTasks: [],
                    backfillCollections: [],
                    // Any authorization state change from the server should override us.
                    defaultAuthorizationStateVersion: zeroHybridLogicalTime,
                    referencedAccounts,
                    // Don't pass `this._clientId` in since we don't want to ignore this event.
                    originClientId: null,
                });

                // Push an undo stack entry that retains the deleted tasks so if we undo the
                // deletion we still have the task data.
                if (undoManager && undoActions) {
                    hasUndoStackEntry = true;
                    let isUndoEntryReleased = false;

                    undoManager.pushUndoStackEntry({
                        undoActions,
                        removedFromQueries,
                        leaseId: null,
                        release: () => {
                            assert(!isUndoEntryReleased);
                            isUndoEntryReleased = true;

                            for (const taskId of releaseTaskIds) {
                                this.releaseTaskEntryStore(taskId);
                            }

                            for (const collectionId of releaseCollectionIds) {
                                this.releaseCollectionEntryStore(collectionId);
                            }
                        },
                    });
                }
            } finally {
                this.onQueryLoadedTaskRemove = null;

                // Any tasks or collections that were released while updating our store, we
                // want to retain as long as we have an undo stack entry. Since hitting undo
                // may reintroduce the tasks to the store.

                releaseTaskIds = Array.from(delayReleaseTaskEntryStoreIds);
                releaseCollectionIds = Array.from(delayReleaseCollectionEntryStoreIds);

                if (hasUndoStackEntry) {
                    for (const taskId of releaseTaskIds) {
                        this.retainTaskEntryStore(taskId);
                    }

                    for (const collectionId of releaseCollectionIds) {
                        this.retainCollectionEntryStore(collectionId);
                    }

                    assert(delayReleaseTaskEntryStoreIds.size === 0);
                    assert(delayReleaseCollectionEntryStoreIds.size === 0);
                } else {
                    for (const taskId of delayReleaseTaskEntryStoreIds) {
                        const taskEntryStore = assertExists(this._taskEntryStoreById.get(taskId));
                        assert(taskEntryStore.referenceCount === 0);

                        this._taskEntryStoreById.delete(taskId);
                        this._taskEntryStoreByIdStores.get(taskId)?.set(null);

                        this._updateReferencedAccountStores(
                            taskEntryStore.store.getSnapshot(),
                            null,
                        );
                    }

                    for (const collectionId of delayReleaseCollectionEntryStoreIds) {
                        const collectionEntryStore = assertExists(
                            this._collectionEntryStoreById.get(collectionId),
                        );
                        assert(collectionEntryStore.referenceCount === 0);

                        this._collectionEntryStoreById.delete(collectionId);
                        this._collectionEntryStoreByIdStores.get(collectionId)?.set(null);
                    }
                }

                this._delayReleaseTaskEntryStoreIds = previousDelayReleaseTaskEntryStoreIds;
                this._delayReleaseCollectionEntryStoreIds =
                    previousDelayReleaseCollectionEntryStoreIds;
            }

            return result;
        });
    }

    /**
     * Deletes a task and all of its children. Does not optimistically update since
     * we may not know all of a task's children on the client. The UI should show a
     * loading spinner for this action. You also need to handle pending state and
     * errors from this action yourself. Unlike `commitTaskActionTransaction()`
     * which displays errors on its own.
     */
    public async deleteTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
        {
            undoManager,
            time: actionTime = this.clock.now(),
        }: {
            undoManager: TaskClientStoreUndoManager | null;
            time?: HybridLogicalTime;
        },
    ): Promise<void> {
        const mapUndoActions = (actions: Iterable<TaskAction>) =>
            // We need to create undo actions before applying our actions to the store so
            // we can read old task data from the store.
            mapIterable(actions, action => {
                if (action.type === "UpdateTask" && action.taskAction.type === "UpdateTitle") {
                    throw new InternalError(
                        "Unexpected task title update when deleting task and all children",
                    );
                }

                return action as TaskActionModel;
            });

        await this._withSpecializedCommitTaskActionTransaction(
            {undoManager, mapUndoActions},
            () => {
                return deleteTaskAndAllChildren(context, {
                    taskId,
                    actionTime,
                    clientId: this._clientId,
                });
            },
        );
    }

    /**
     * Duplicates a task and all of its children. Does not optimistically update since
     * we may not know all of a task's children on the client. The UI should show a
     * loading spinner for this action. You also need to handle pending state and
     * errors from this action yourself. Unlike `commitTaskActionTransaction()`
     * which displays errors on its own.
     */
    public async duplicateTaskAndAllChildren(
        context: Context<{rpc: RpcContextModuleBase}>,
        taskId: TaskId,
        timeZone: TimeZone,
        {
            undoManager,
            time: actionTime = this.clock.now(),
        }: {
            undoManager: TaskClientStoreUndoManager | null;
            time?: HybridLogicalTime;
        },
    ): Promise<{taskId: TaskId}> {
        const mapUndoActions = (actions: Iterable<TaskAction>) =>
            // The only undo actions we should care about is the create actions.
            // This will save time as we don't need to undo the other actions.
            filterMapIterable(actions, action => {
                return action.type === "UpdateTask" && action.taskAction.type === "Create"
                    ? (action as TaskActionModel)
                    : undefined;
            });

        const result = await this._withSpecializedCommitTaskActionTransaction(
            {undoManager, mapUndoActions},
            () => {
                return duplicateTaskAndAllChildren(context, {
                    taskId,
                    actionTime,
                    timeZone,
                });
            },
        );

        return {taskId: result.taskId};
    }

    /**
     * If we have any pending `commitTaskActionTransaction()` calls (or another
     * update like `deleteTaskAndAllChildren()`) then calling this function waits
     * for this pending calls to resolve before returning.
     */
    public waitForCommitTaskActionTransactions() {
        return this._commitTaskActionTransactionMutex.waitForUnlock();
    }

    private _applyOptimisticTaskActions<Value>(
        actions: ReadonlyArray<TaskActionModel>,
        action: (batchUpdate: TaskClientStoreBatchUpdate) => Value,
    ): {
        actionValue: Value;
        pendingActions: Array<TaskClientStorePendingAction>;
        release: () => void;
    } {
        if (actions.length === 0) {
            const actionValue = action({
                taskEntryUpdateById: emptyMap,
                collectionEntryUpdateById: emptyMap,
                actions: emptyArray,
            });
            return {actionValue, pendingActions: [], release: noop};
        }

        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        const pendingActions: Array<TaskClientStorePendingAction> = [];

        // Apply actions optimistically:
        for (const action of actions) {
            const getActionReferencedSortableAccount = createGetTaskActionReferencedSortableAccount(
                this.accountRegistry,
                action,
            );

            pendingActions.push({action, getActionReferencedSortableAccount});

            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.store.getSnapshot();

                    // If we do not have a task entry yet then let's create one.
                    if (!oldTaskEntry) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                task: null,
                                actions: [{action, getActionReferencedSortableAccount}],
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions: [],
                                    },
                                    actions: [
                                        {
                                            isOptimistic: true,
                                            action,
                                            getActionReferencedSortableAccount,
                                        },
                                    ],
                                },
                                authorizationState: null,
                            });
                            continue;
                        } else {
                            const newTask = TaskModel.createFromAction(
                                this.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                                getActionReferencedSortableAccount,
                            );

                            newTaskEntryById.set(action.taskId, {
                                task: newTask,
                                actions: null,
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions: [],
                                    },
                                    actions: [
                                        {
                                            isOptimistic: true,
                                            action,
                                            getActionReferencedSortableAccount,
                                        },
                                    ],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                            });
                            continue;
                        }
                    }

                    if (oldTaskEntry.task === null) {
                        if (action.taskAction.type !== "Create") {
                            newTaskEntryById.set(action.taskId, {
                                ...oldTaskEntry,
                                actions: [
                                    ...oldTaskEntry.actions,
                                    {action, getActionReferencedSortableAccount},
                                ],
                                optimisticState: {
                                    original: {
                                        task: null,
                                        actions:
                                            oldTaskEntry.optimisticState?.original.actions ??
                                            oldTaskEntry.actions,
                                    },
                                    actions: [
                                        ...(oldTaskEntry.optimisticState?.actions ?? []),
                                        {
                                            isOptimistic: true,
                                            action,
                                            getActionReferencedSortableAccount,
                                        },
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
                                getActionReferencedSortableAccount,
                            );

                            // Apply any actions we received now that the task has been created.
                            newTask = applyPendingTaskActions(newTask, oldTaskEntry.actions);

                            // Apply any optimistic actions we received now that the task has been created.
                            if (oldTaskEntry.optimisticState) {
                                newTask = applyPendingTaskActions(
                                    newTask,
                                    oldTaskEntry.optimisticState.actions,
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
                                        {
                                            isOptimistic: true,
                                            action,
                                            getActionReferencedSortableAccount,
                                        },
                                    ],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                            });
                            continue;
                        }
                    }

                    const newTask = oldTaskEntry.task.applyAction(
                        action,
                        getActionReferencedSortableAccount,
                    );

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
                                {isOptimistic: true, action, getActionReferencedSortableAccount},
                            ],
                        },
                        authorizationState: oldTaskEntry.authorizationState,
                    });
                    continue;
                }
                case "UpdateCollection": {
                    const oldCollectionEntry =
                        newCollectionEntryById.get(action.collectionId) ??
                        this._collectionEntryStoreById
                            .get(action.collectionId)
                            ?.store.getSnapshot();

                    // If we do not have a collection entry yet then let's create one.
                    if (!oldCollectionEntry) {
                        if (action.collectionAction.type !== "Create") {
                            newCollectionEntryById.set(action.collectionId, {
                                collection: null,
                                actions: [{action}],
                                optimisticState: {
                                    original: {
                                        collection: null,
                                        actions: [],
                                    },
                                    actions: [
                                        {
                                            isOptimistic: true,
                                            action,
                                        },
                                    ],
                                },
                                authorizationState: null,
                            });
                            continue;
                        } else {
                            const newCollection = TaskCollectionModel.createFromAction(
                                this.spaceId,
                                action.collectionId,
                                action.time,
                                action.collectionAction,
                            );

                            newCollectionEntryById.set(action.collectionId, {
                                collection: newCollection,
                                actions: null,
                                optimisticState: {
                                    original: {
                                        collection: null,
                                        actions: [],
                                    },
                                    actions: [{isOptimistic: true, action}],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                            });
                            continue;
                        }
                    }

                    if (oldCollectionEntry.collection === null) {
                        if (action.collectionAction.type !== "Create") {
                            newCollectionEntryById.set(action.collectionId, {
                                ...oldCollectionEntry,
                                actions: [...oldCollectionEntry.actions, {action}],
                                optimisticState: {
                                    original: {
                                        collection: null,
                                        actions:
                                            oldCollectionEntry.optimisticState?.original.actions ??
                                            oldCollectionEntry.actions,
                                    },
                                    actions: [
                                        ...(oldCollectionEntry.optimisticState?.actions ?? []),
                                        {isOptimistic: true, action},
                                    ],
                                },
                            });
                            continue;
                        } else {
                            let newCollection = TaskCollectionModel.createFromAction(
                                this.spaceId,
                                action.collectionId,
                                action.time,
                                action.collectionAction,
                            );

                            // Apply any actions we received now that the task has been created.
                            newCollection = applyPendingTaskCollectionActions(
                                newCollection,
                                oldCollectionEntry.actions,
                            );

                            // Apply any optimistic actions we received now that the task has been created.
                            if (oldCollectionEntry.optimisticState) {
                                newCollection = applyPendingTaskCollectionActions(
                                    newCollection,
                                    oldCollectionEntry.optimisticState.actions,
                                );
                            }

                            newCollectionEntryById.set(action.collectionId, {
                                collection: newCollection,
                                actions: null,
                                optimisticState: {
                                    original: {
                                        collection: null,
                                        actions:
                                            oldCollectionEntry.optimisticState?.original.actions ??
                                            oldCollectionEntry.actions,
                                    },
                                    actions: [
                                        ...(oldCollectionEntry.optimisticState?.actions ?? []),
                                        {
                                            isOptimistic: true,
                                            action,
                                        },
                                    ],
                                },
                                // If we receive an optimistic create action it's from our account (other
                                // creates will be rejected by the backend) so the task is authorized.
                                authorizationState: new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                            });
                            continue;
                        }
                    }

                    const newCollection = oldCollectionEntry.collection.applyAction(action);

                    newCollectionEntryById.set(action.collectionId, {
                        collection: newCollection,
                        actions: null,
                        optimisticState: {
                            original: oldCollectionEntry.optimisticState?.original ?? {
                                collection: oldCollectionEntry.collection,
                                actions: null,
                            },
                            actions: [
                                ...(oldCollectionEntry.optimisticState?.actions ?? []),
                                {isOptimistic: true, action},
                            ],
                        },
                        authorizationState: oldCollectionEntry.authorizationState,
                    });
                    continue;
                }
                case "UpdateAccountName":
                case "UpdateNotepadPage": {
                    throw new InternalError(
                        quote`Can’t optimistically apply ${action.type} action`,
                    );
                }
                default:
                    throw exhaustive(action);
            }
        }

        const previousDelayReleaseTaskEntryStoreIds = this._delayReleaseTaskEntryStoreIds;
        const previousDelayReleaseCollectionEntryStoreIds =
            this._delayReleaseCollectionEntryStoreIds;

        const delayReleaseTaskEntryStoreIds = new Set<TaskId>();
        const delayReleaseCollectionEntryStoreIds = new Set<TaskCollectionId>();

        this._delayReleaseTaskEntryStoreIds = delayReleaseTaskEntryStoreIds;
        this._delayReleaseCollectionEntryStoreIds = delayReleaseCollectionEntryStoreIds;

        let releaseTaskIds: Array<TaskId>;
        let releaseCollectionIds: Array<TaskCollectionId>;

        let actionValue;
        try {
            actionValue = this._batchUpdateStore(
                newTaskEntryById,
                newCollectionEntryById,
                actions,
                action,
            );
        } finally {
            // Any tasks or collections that were released while updating our store, we
            // want to retain until the optimistic action is committed or rejected. Because
            // the task may be reintroduced to a query, say, if the optimistic action was
            // rejected.

            releaseTaskIds = Array.from(delayReleaseTaskEntryStoreIds);
            releaseCollectionIds = Array.from(delayReleaseCollectionEntryStoreIds);

            for (const taskId of releaseTaskIds) {
                this.retainTaskEntryStore(taskId);
            }

            for (const collectionId of releaseCollectionIds) {
                this.retainCollectionEntryStore(collectionId);
            }

            assert(delayReleaseTaskEntryStoreIds.size === 0);
            assert(delayReleaseCollectionEntryStoreIds.size === 0);

            this._delayReleaseTaskEntryStoreIds = previousDelayReleaseTaskEntryStoreIds;
            this._delayReleaseCollectionEntryStoreIds = previousDelayReleaseCollectionEntryStoreIds;
        }

        return {
            actionValue,
            pendingActions,
            release: () => {
                for (const taskId of releaseTaskIds) {
                    this.releaseTaskEntryStore(taskId);
                }

                for (const collectionId of releaseCollectionIds) {
                    this.releaseCollectionEntryStore(collectionId);
                }
            },
        };
    }

    private _commitOptimisticTaskActions(pendingActions: Iterable<TaskClientStorePendingAction>) {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        for (const {action, getActionReferencedSortableAccount} of pendingActions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.store.getSnapshot();

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
                    let removedNonOptimisticActions: Array<TaskClientStorePendingUpdateTaskAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions;
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions.slice(
                            0,
                            firstActuallyOptimisticActionIndex,
                        );
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
                                ({action}) =>
                                    action.type !== "UpdateTask" ||
                                    action.taskAction.type !== "Create",
                            ),
                        );

                        const newOriginal = {
                            task: null,
                            actions: [
                                ...oldTaskEntry.optimisticState.original.actions,
                                {action, getActionReferencedSortableAccount},
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
                            task: applyPendingTaskActions(
                                TaskModel.createFromAction(
                                    this.spaceId,
                                    action.taskId,
                                    action.time,
                                    action.taskAction,
                                    getActionReferencedSortableAccount,
                                ),
                                newOriginal.actions,
                            ),
                            actions: null,
                        };
                    } else {
                        newOriginal =
                            newOriginal.task !== null
                                ? {
                                      task: newOriginal.task.applyAction(
                                          action,
                                          getActionReferencedSortableAccount,
                                      ),
                                      actions: null,
                                  }
                                : {
                                      task: null,
                                      actions: [
                                          ...newOriginal.actions,
                                          {action, getActionReferencedSortableAccount},
                                      ],
                                  };
                    }

                    if (newOriginal.task !== null) {
                        newOriginal = {
                            task: applyPendingTaskActions(
                                newOriginal.task,
                                removedNonOptimisticActions,
                            ),
                            actions: null,
                        };
                    } else {
                        const nonOptimisticCreateAction = removedNonOptimisticActions.find(
                            (
                                pendingAction,
                            ): pendingAction is TaskClientStorePendingAction & {
                                action: TaskUpdateTaskAction & {
                                    taskAction: {type: "Create"};
                                };
                            } =>
                                pendingAction.action.type === "UpdateTask" &&
                                pendingAction.action.taskAction.type === "Create",
                        );

                        if (!nonOptimisticCreateAction) {
                            newOriginal = {
                                task: null,
                                actions: [...newOriginal.actions, ...removedNonOptimisticActions],
                            };
                        } else {
                            newOriginal = {
                                task: applyPendingTaskActions(
                                    applyPendingTaskActions(
                                        TaskModel.createFromAction(
                                            this.spaceId,
                                            nonOptimisticCreateAction.action.taskId,
                                            nonOptimisticCreateAction.action.time,
                                            nonOptimisticCreateAction.action.taskAction,
                                            nonOptimisticCreateAction.getActionReferencedSortableAccount,
                                        ),
                                        newOriginal.actions,
                                    ),
                                    removedNonOptimisticActions,
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
                    const oldCollectionEntry =
                        newCollectionEntryById.get(action.collectionId) ??
                        this._collectionEntryStoreById
                            .get(action.collectionId)
                            ?.store.getSnapshot();

                    // Entry has been garbage collected, ignore.
                    if (!oldCollectionEntry) {
                        continue;
                    }

                    // Entry has been recreated since we added our action to optimistic
                    // state, ignore.
                    if (!oldCollectionEntry.optimisticState) {
                        continue;
                    }

                    let newOptimisticActions = oldCollectionEntry.optimisticState.actions.filter(
                        optimisticAction => optimisticAction.action !== action,
                    );

                    // Optimistic action is not present in task entry's optimistic state. Maybe
                    // entry has been recreated, ignore.
                    if (
                        newOptimisticActions.length ===
                        oldCollectionEntry.optimisticState.actions.length
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
                    let removedNonOptimisticActions: Array<TaskClientStorePendingUpdateCollectionAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions;
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions.slice(
                            0,
                            firstActuallyOptimisticActionIndex,
                        );
                        newOptimisticActions = newOptimisticActions.slice(
                            firstActuallyOptimisticActionIndex,
                        );
                    }

                    // Our task is caught up! There's no more optimistic state for the task.
                    if (newOptimisticActions.length === 0) {
                        newCollectionEntryById.set(action.collectionId, {
                            ...oldCollectionEntry,
                            optimisticState: null,
                        });
                        continue;
                    }

                    // Update `original` to include the committed action and any non-optimistic
                    // actions we don't need to keep anymore.
                    if (oldCollectionEntry.collection === null) {
                        // If there was a create action then `oldTaskEntry.task` should be non-null.
                        assert(
                            removedNonOptimisticActions.every(
                                ({action}) =>
                                    action.type !== "UpdateCollection" ||
                                    action.collectionAction.type !== "Create",
                            ),
                        );

                        const newOriginal = {
                            collection: null,
                            actions: [
                                ...oldCollectionEntry.optimisticState.original.actions,
                                {action, getActionReferencedSortableAccount},
                                ...removedNonOptimisticActions,
                            ],
                        };

                        newCollectionEntryById.set(action.collectionId, {
                            ...oldCollectionEntry,
                            optimisticState: {
                                original: newOriginal,
                                actions: newOptimisticActions,
                            },
                        });
                        continue;
                    }

                    let newOriginal = oldCollectionEntry.optimisticState.original;

                    if (
                        action.collectionAction.type === "Create" &&
                        newOriginal.collection === null
                    ) {
                        newOriginal = {
                            collection: applyPendingTaskCollectionActions(
                                TaskCollectionModel.createFromAction(
                                    this.spaceId,
                                    action.collectionId,
                                    action.time,
                                    action.collectionAction,
                                ),
                                newOriginal.actions,
                            ),
                            actions: null,
                        };
                    } else {
                        newOriginal =
                            newOriginal.collection !== null
                                ? {
                                      collection: newOriginal.collection.applyAction(action),
                                      actions: null,
                                  }
                                : {
                                      collection: null,
                                      actions: [...newOriginal.actions, {action}],
                                  };
                    }

                    if (newOriginal.collection !== null) {
                        newOriginal = {
                            collection: applyPendingTaskCollectionActions(
                                newOriginal.collection,
                                removedNonOptimisticActions,
                            ),
                            actions: null,
                        };
                    } else {
                        const nonOptimisticCreateAction = removedNonOptimisticActions.find(
                            (
                                pendingAction,
                            ): pendingAction is TaskClientStorePendingAction & {
                                action: TaskUpdateCollectionAction & {
                                    collectionAction: {type: "Create"};
                                };
                            } =>
                                pendingAction.action.type === "UpdateCollection" &&
                                pendingAction.action.collectionAction.type === "Create",
                        );

                        if (!nonOptimisticCreateAction) {
                            newOriginal = {
                                collection: null,
                                actions: [...newOriginal.actions, ...removedNonOptimisticActions],
                            };
                        } else {
                            newOriginal = {
                                collection: applyPendingTaskCollectionActions(
                                    applyPendingTaskCollectionActions(
                                        TaskCollectionModel.createFromAction(
                                            this.spaceId,
                                            nonOptimisticCreateAction.action.collectionId,
                                            nonOptimisticCreateAction.action.time,
                                            nonOptimisticCreateAction.action.collectionAction,
                                        ),
                                        newOriginal.actions,
                                    ),
                                    removedNonOptimisticActions,
                                ),
                                actions: null,
                            };
                        }
                    }

                    newCollectionEntryById.set(action.collectionId, {
                        ...oldCollectionEntry,
                        optimisticState: {
                            original: newOriginal,
                            actions: newOptimisticActions,
                        },
                    });
                    continue;
                }
                case "UpdateAccountName":
                case "UpdateNotepadPage": {
                    throw new InternalError(
                        quote`Can’t optimistically apply ${action.type} action`,
                    );
                }
                default:
                    throw exhaustive(action);
            }
        }

        this._batchUpdateStore(newTaskEntryById, newCollectionEntryById, emptyArray, noop);
    }

    private _revertOptimisticTaskActions(pendingActions: Iterable<TaskClientStorePendingAction>) {
        const newTaskEntryById = new Map<TaskId, TaskClientStoreTaskEntry>();
        const newCollectionEntryById = new Map<TaskCollectionId, TaskClientStoreCollectionEntry>();

        for (const {action} of pendingActions) {
            switch (action.type) {
                case "UpdateTask": {
                    const oldTaskEntry =
                        newTaskEntryById.get(action.taskId) ??
                        this._taskEntryStoreById.get(action.taskId)?.store.getSnapshot();

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
                    let removedNonOptimisticActions: Array<TaskClientStorePendingUpdateTaskAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions;
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions.slice(
                            0,
                            firstActuallyOptimisticActionIndex,
                        );
                        newOptimisticActions = newOptimisticActions.slice(
                            firstActuallyOptimisticActionIndex,
                        );
                    }

                    if (
                        oldTaskEntry.task !== null &&
                        oldTaskEntry.optimisticState.original.task !== null
                    ) {
                        const newOriginal = {
                            task: applyPendingTaskActions(
                                oldTaskEntry.optimisticState.original.task,
                                removedNonOptimisticActions,
                            ),
                            actions: null,
                        };

                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: applyPendingTaskActions(newOriginal.task, newOptimisticActions),
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
                        ): action is TaskClientStorePendingUpdateTaskAction & {
                            action: {
                                type: "UpdateTask";
                                taskAction: {type: "Create"};
                            };
                        } =>
                            action.action.type === "UpdateTask" &&
                            action.action.taskAction.type === "Create",
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
                            task: applyPendingTaskActions(
                                applyPendingTaskActions(
                                    TaskModel.createFromAction(
                                        this.spaceId,
                                        nonOptimisticCreateAction.action.taskId,
                                        nonOptimisticCreateAction.action.time,
                                        nonOptimisticCreateAction.action.taskAction,
                                        nonOptimisticCreateAction.getActionReferencedSortableAccount,
                                    ),
                                    oldTaskEntry.optimisticState.original.actions!,
                                ),
                                removedNonOptimisticActions,
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
                            task: applyPendingTaskActions(newOriginal.task, newOptimisticActions),
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
                            action,
                        ): action is TaskClientStorePendingUpdateTaskAction & {
                            isOptimistic: boolean;
                            action: {
                                type: "UpdateTask";
                                taskAction: {type: "Create"};
                            };
                        } =>
                            action.action.type === "UpdateTask" &&
                            action.action.taskAction.type === "Create",
                    );

                    if (!optimisticCreateAction) {
                        newTaskEntryById.set(action.taskId, {
                            ...oldTaskEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            task: null,
                            actions: [
                                ...newOriginal.actions,
                                ...newOptimisticActions.map(
                                    ({action, getActionReferencedSortableAccount}) => ({
                                        action,
                                        getActionReferencedSortableAccount,
                                    }),
                                ),
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
                            task: applyPendingTaskActions(
                                applyPendingTaskActions(
                                    TaskModel.createFromAction(
                                        this.spaceId,
                                        optimisticCreateAction.action.taskId,
                                        optimisticCreateAction.action.time,
                                        optimisticCreateAction.action.taskAction,
                                        optimisticCreateAction.getActionReferencedSortableAccount,
                                    ),
                                    newOptimisticActions,
                                ),
                                newOriginal.actions,
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
                            authorizationState:
                                oldTaskEntry.authorizationState ??
                                new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                        });
                    }
                    continue;
                }
                case "UpdateCollection": {
                    const oldCollectionEntry =
                        newCollectionEntryById.get(action.collectionId) ??
                        this._collectionEntryStoreById
                            .get(action.collectionId)
                            ?.store.getSnapshot();

                    // Entry has been garbage collected, ignore.
                    if (!oldCollectionEntry) {
                        continue;
                    }

                    // Entry has been recreated since we added our action to optimistic
                    // state, ignore.
                    if (!oldCollectionEntry.optimisticState) {
                        continue;
                    }

                    let newOptimisticActions = oldCollectionEntry.optimisticState.actions.filter(
                        optimisticAction => optimisticAction.action !== action,
                    );

                    // Optimistic action is not present in task entry's optimistic state. Maybe
                    // entry has been recreated, ignore.
                    if (
                        newOptimisticActions.length ===
                        oldCollectionEntry.optimisticState.actions.length
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
                    let removedNonOptimisticActions: Array<TaskClientStorePendingUpdateCollectionAction>;
                    if (firstActuallyOptimisticActionIndex === -1) {
                        removedNonOptimisticActions = newOptimisticActions;
                        newOptimisticActions = [];
                    } else {
                        removedNonOptimisticActions = newOptimisticActions.slice(
                            0,
                            firstActuallyOptimisticActionIndex,
                        );
                        newOptimisticActions = newOptimisticActions.slice(
                            firstActuallyOptimisticActionIndex,
                        );
                    }

                    if (
                        oldCollectionEntry.collection !== null &&
                        oldCollectionEntry.optimisticState.original.collection !== null
                    ) {
                        const newOriginal = {
                            collection: applyPendingTaskCollectionActions(
                                oldCollectionEntry.optimisticState.original.collection,
                                removedNonOptimisticActions,
                            ),
                            actions: null,
                        };

                        newCollectionEntryById.set(action.collectionId, {
                            ...oldCollectionEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            collection: applyPendingTaskCollectionActions(
                                newOriginal.collection,
                                newOptimisticActions,
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
                        ): action is TaskClientStorePendingUpdateCollectionAction & {
                            action: {
                                type: "UpdateCollection";
                                collectionAction: {type: "Create"};
                            };
                        } =>
                            action.action.type === "UpdateCollection" &&
                            action.action.collectionAction.type === "Create",
                    );

                    let newOriginal: TaskClientStoreCollectionEntryOptimisticState["original"];
                    if (!nonOptimisticCreateAction) {
                        newOriginal = {
                            collection: null,
                            actions: [
                                ...oldCollectionEntry.optimisticState.original.actions!,
                                ...removedNonOptimisticActions,
                            ],
                        };
                    } else {
                        newOriginal = {
                            collection: applyPendingTaskCollectionActions(
                                applyPendingTaskCollectionActions(
                                    TaskCollectionModel.createFromAction(
                                        this.spaceId,
                                        nonOptimisticCreateAction.action.collectionId,
                                        nonOptimisticCreateAction.action.time,
                                        nonOptimisticCreateAction.action.collectionAction,
                                    ),
                                    oldCollectionEntry.optimisticState.original.actions!,
                                ),
                                removedNonOptimisticActions,
                            ),
                            actions: null,
                        };
                    }

                    if (newOriginal.collection !== null) {
                        // If our new original task is non-null because there was a non-optimistic
                        // create action then the task entry as a whole should also have a
                        // non-null task.
                        assert(oldCollectionEntry.collection !== null);

                        newCollectionEntryById.set(action.collectionId, {
                            ...oldCollectionEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            collection: applyPendingTaskCollectionActions(
                                newOriginal.collection,
                                newOptimisticActions,
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
                            action,
                        ): action is TaskClientStorePendingUpdateCollectionAction & {
                            isOptimistic: boolean;
                            action: {
                                type: "UpdateCollection";
                                collectionAction: {type: "Create"};
                            };
                        } =>
                            action.action.type === "UpdateCollection" &&
                            action.action.collectionAction.type === "Create",
                    );

                    if (!optimisticCreateAction) {
                        newCollectionEntryById.set(action.collectionId, {
                            ...oldCollectionEntry,
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            collection: null,
                            actions: [
                                ...newOriginal.actions,
                                ...newOptimisticActions.map(({action}) => ({
                                    action,
                                })),
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
                        newCollectionEntryById.set(action.collectionId, {
                            // Reset `task` and `actions` in the task entry so it doesn't include the
                            // rejected action.
                            collection: applyPendingTaskCollectionActions(
                                applyPendingTaskCollectionActions(
                                    TaskCollectionModel.createFromAction(
                                        this.spaceId,
                                        optimisticCreateAction.action.collectionId,
                                        optimisticCreateAction.action.time,
                                        optimisticCreateAction.action.collectionAction,
                                    ),
                                    newOptimisticActions,
                                ),
                                newOriginal.actions,
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
                            authorizationState:
                                oldCollectionEntry.authorizationState ??
                                new TaskAuthorizationStateRegister(
                                    taskAuthorizedState,
                                    // Any authorization state change from the server should override us.
                                    zeroHybridLogicalTime,
                                ),
                        });
                    }
                    continue;
                }
                case "UpdateAccountName":
                case "UpdateNotepadPage": {
                    throw new InternalError(
                        quote`Can’t optimistically apply ${action.type} action`,
                    );
                }
                default:
                    throw exhaustive(action);
            }
        }

        this._batchUpdateStore(newTaskEntryById, newCollectionEntryById, emptyArray, noop);
    }

    private _batchUpdateStore<Value>(
        newTaskEntryById: ReadonlyMap<TaskId, TaskClientStoreTaskEntry>,
        newCollectionEntryById: ReadonlyMap<TaskCollectionId, TaskClientStoreCollectionEntry>,
        // If there were actions that contributed to this update then the actions are
        // provided here. Not all task or collection updates will have an associated
        // action.
        actions: ReadonlyArray<TaskActionMaybeModel>,
        // This action is called after our updates have been applied to the store and
        // before we clean up any new tasks/collections with zero references. It lets
        // you "save" tasks/collections that were about to be released.
        //
        // We use the `action` function format (instead of an event callback like
        // `onBatchUpdate`) to guarantee the action is called and its value is
        // returned.
        action: (batchUpdate: TaskClientStoreBatchUpdate) => Value,
    ): Value {
        // Apply all the updates to our store in one batch...
        return batchStoreUpdates(() => {
            const taskEntryUpdateById = new Map<
                TaskId,
                {
                    taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
                    oldTaskEntry: TaskClientStoreTaskEntry | null;
                    newTaskEntry: TaskClientStoreTaskEntry;
                }
            >();

            const collectionEntryUpdateById = new Map<
                TaskCollectionId,
                {
                    collectionEntryStore: ValueStore<TaskClientStoreCollectionEntry>;
                    oldCollectionEntry: TaskClientStoreCollectionEntry | null;
                    newCollectionEntry: TaskClientStoreCollectionEntry;
                }
            >();

            const newTaskEntryStoreIds = new Set<TaskId>();
            const newCollectionEntryStoreIds = new Set<TaskCollectionId>();

            const previousDelayReleaseTaskEntryStoreIds = this._delayReleaseTaskEntryStoreIds;
            const previousDelayReleaseCollectionEntryStoreIds =
                this._delayReleaseCollectionEntryStoreIds;

            const delayReleaseTaskEntryStoreIds = !previousDelayReleaseTaskEntryStoreIds
                ? new Set<TaskId>()
                : null;
            const delayReleaseCollectionEntryStoreIds = !previousDelayReleaseCollectionEntryStoreIds
                ? new Set<TaskCollectionId>()
                : null;

            this._delayReleaseTaskEntryStoreIds =
                delayReleaseTaskEntryStoreIds ?? previousDelayReleaseTaskEntryStoreIds;
            this._delayReleaseCollectionEntryStoreIds =
                delayReleaseCollectionEntryStoreIds ?? previousDelayReleaseCollectionEntryStoreIds;

            try {
                // Update all our task stores and create new ones when necessary. Listeners
                // will be called at the end of the batch.
                for (const [taskId, newTaskEntry] of newTaskEntryById) {
                    let taskEntryStore = this._taskEntryStoreById.get(taskId);
                    const oldTaskEntry = taskEntryStore?.store.getSnapshot() ?? null;

                    if (taskEntryStore === undefined) {
                        taskEntryStore = {
                            referenceCount: 0,
                            store: new ValueStore(newTaskEntry),
                        };
                        this._taskEntryStoreById.set(taskId, taskEntryStore);
                        this._taskEntryStoreByIdStores.get(taskId)?.set(taskEntryStore.store);

                        // If a reference isn't added to the task by the end of this function then we
                        // immediately garbage collect the new store.
                        newTaskEntryStoreIds.add(taskId);
                    } else {
                        assert(oldTaskEntry);

                        // Optimization: If the only thing that changed about a task is the `version`
                        // of its `authorizationState` register then we don't update our `ValueStore`
                        // (which causes all tasks to re-render) and instead sneakily mutate the old
                        // task entry with the new register.
                        //
                        // This works since no consumer of the task entry should really care about its
                        // authorization state version.
                        //
                        // This happens when we connect to realtime and backfill data from our initial
                        // load. We stop a re-render of all tasks on the page which is nice.
                        if (
                            oldTaskEntry.task === newTaskEntry.task &&
                            oldTaskEntry.actions === newTaskEntry.actions &&
                            oldTaskEntry.optimisticState === newTaskEntry.optimisticState &&
                            oldTaskEntry.authorizationState?.value ===
                                newTaskEntry.authorizationState?.value
                        ) {
                            if (
                                oldTaskEntry.authorizationState !== newTaskEntry.authorizationState
                            ) {
                                // @ts-expect-error
                                oldTaskEntry.authorizationState = newTaskEntry.authorizationState;
                            }

                            taskEntryUpdateById.set(taskId, {
                                taskEntryStore: taskEntryStore.store,
                                oldTaskEntry,
                                newTaskEntry: oldTaskEntry,
                            });
                            continue;
                        } else {
                            taskEntryStore.store.set(newTaskEntry);
                        }
                    }

                    taskEntryUpdateById.set(taskId, {
                        taskEntryStore: taskEntryStore.store,
                        oldTaskEntry,
                        newTaskEntry,
                    });

                    this._updateReferencedAccountStores(oldTaskEntry, newTaskEntry);
                }

                // Update all our collection stores and create new ones when necessary.
                // Listeners will be called at the end of the batch.
                for (const [collectionId, newCollectionEntry] of newCollectionEntryById) {
                    let collectionEntryStore = this._collectionEntryStoreById.get(collectionId);
                    const oldCollectionEntry = collectionEntryStore?.store.getSnapshot() ?? null;

                    if (collectionEntryStore === undefined) {
                        collectionEntryStore = {
                            referenceCount: 0,
                            store: new ValueStore(newCollectionEntry),
                        };

                        this._collectionEntryStoreById.set(collectionId, collectionEntryStore);
                        this._collectionEntryStoreByIdStores
                            .get(collectionId)
                            ?.set(collectionEntryStore.store);

                        // If a reference isn't added to the collection by the end of this function then
                        // we immediately garbage collect the new store.
                        newCollectionEntryStoreIds.add(collectionId);
                    } else {
                        assert(oldCollectionEntry);

                        // Optimization: If the only thing that changed about a collection is the
                        // `version` of its `authorizationState` register then we don't update our
                        // `ValueStore` (which causes all tasks to re-render) and instead sneakily
                        // mutate the old collection entry with the new register.
                        //
                        // This works since no consumer of the collection entry should really care
                        // about its authorization state version.
                        //
                        // This happens when we connect to realtime and backfill data from our initial
                        // load. We stop a re-render of all tasks on the page which is nice.
                        if (
                            oldCollectionEntry.collection === newCollectionEntry.collection &&
                            oldCollectionEntry.actions === newCollectionEntry.actions &&
                            oldCollectionEntry.optimisticState ===
                                newCollectionEntry.optimisticState &&
                            oldCollectionEntry.authorizationState?.value ===
                                newCollectionEntry.authorizationState?.value
                        ) {
                            if (
                                oldCollectionEntry.authorizationState !==
                                newCollectionEntry.authorizationState
                            ) {
                                // @ts-expect-error
                                oldCollectionEntry.authorizationState =
                                    newCollectionEntry.authorizationState;
                            }

                            collectionEntryUpdateById.set(collectionId, {
                                collectionEntryStore: collectionEntryStore.store,
                                oldCollectionEntry,
                                newCollectionEntry: oldCollectionEntry,
                            });
                            continue;
                        } else {
                            collectionEntryStore.store.set(newCollectionEntry);
                        }
                    }

                    collectionEntryUpdateById.set(collectionId, {
                        collectionEntryStore: collectionEntryStore.store,
                        oldCollectionEntry,
                        newCollectionEntry,
                    });
                }

                // Apply task updates to our subscriptions. This will also update stores within
                // the subscriptions which will call listeners at the end of the batch.
                const subscriptions = this._subscriptionsStore.getSnapshot();

                for (const query of subscriptions.queries.keys()) {
                    query._getInternal(this).onTasksUpdated(taskEntryUpdateById);
                }

                for (const taskSubscriptions of subscriptions.taskSubscriptionsById.values()) {
                    for (const taskSubscription of taskSubscriptions.keys()) {
                        taskSubscription._onTasksUpdated(this, taskEntryUpdateById);
                    }
                }

                const batchUpdate = {
                    taskEntryUpdateById,
                    collectionEntryUpdateById,
                    actions,
                };

                const actionValue = action(batchUpdate);

                this._batchUpdateEventEmitter.emit(batchUpdate);

                return actionValue;
            } finally {
                // We delay releasing tasks/collections until the end of our store update so
                // that if one query releases a task (setting its `referenceCount` to 0) and
                // another query wants to retain a task (setting its `referenceCount` back to
                // 1) we don't end up deleting the task from our store.
                {
                    this._delayReleaseTaskEntryStoreIds = previousDelayReleaseTaskEntryStoreIds;
                    this._delayReleaseCollectionEntryStoreIds =
                        previousDelayReleaseCollectionEntryStoreIds;

                    if (delayReleaseTaskEntryStoreIds) {
                        for (const taskId of delayReleaseTaskEntryStoreIds) {
                            const taskEntryStore = assertExists(
                                this._taskEntryStoreById.get(taskId),
                            );
                            assert(taskEntryStore.referenceCount === 0);

                            this._taskEntryStoreById.delete(taskId);
                            this._taskEntryStoreByIdStores.get(taskId)?.set(null);

                            this._updateReferencedAccountStores(
                                taskEntryStore.store.getSnapshot(),
                                null,
                            );
                        }
                    }

                    if (delayReleaseCollectionEntryStoreIds) {
                        for (const collectionId of delayReleaseCollectionEntryStoreIds) {
                            const collectionEntryStore = assertExists(
                                this._collectionEntryStoreById.get(collectionId),
                            );
                            assert(collectionEntryStore.referenceCount === 0);

                            this._collectionEntryStoreById.delete(collectionId);
                            this._collectionEntryStoreByIdStores.get(collectionId)?.set(null);
                        }
                    }
                }

                // Check that any tasks or collections we added with zero references got a
                // reference when updating our subscriptions. If they didn't get a reference
                // then the tasks/collections are immediately garbage and we clean them up.
                //
                // In a `finally` block so we still perform this cleanup even if something
                // throws.
                {
                    for (const taskId of newTaskEntryStoreIds) {
                        const taskEntryStore = this._taskEntryStoreById.get(taskId);
                        if (!taskEntryStore) continue;

                        if (taskEntryStore.referenceCount === 0) {
                            const taskEntry = taskEntryStore.store.getSnapshot();

                            // If we're releasing a task entry with some actions but no backing `task`,
                            // then we're receiving events out-of-order. Hold on to the actions for a
                            // bit while we wait for the task to be backfilled instead of immediately
                            // releasing.
                            if (taskEntry.task === null && taskEntry.actions.length > 0) {
                                this._temporarilyRetainTaskEntryStore(taskId);
                            } else {
                                this._taskEntryStoreById.delete(taskId);
                                this._taskEntryStoreByIdStores.get(taskId)?.set(null);
                                this._updateReferencedAccountStores(taskEntry, null);
                            }
                        }
                    }

                    for (const collectionId of newCollectionEntryStoreIds) {
                        const collectionEntryStore =
                            this._collectionEntryStoreById.get(collectionId);
                        if (!collectionEntryStore) continue;

                        if (collectionEntryStore.referenceCount === 0) {
                            const collectionEntry = collectionEntryStore.store.getSnapshot();

                            // If we're releasing a collection entry with some actions but no backing
                            // `collection`, then we're receiving events out-of-order. Hold on to the
                            // actions for a bit while we wait for the collection to be backfilled
                            // instead of immediately releasing.
                            if (
                                collectionEntry.collection === null &&
                                collectionEntry.actions.length > 0
                            ) {
                                this._temporarilyRetainCollectionEntryStore(collectionId);
                            } else {
                                this._collectionEntryStoreById.delete(collectionId);
                                this._collectionEntryStoreByIdStores.get(collectionId)?.set(null);
                            }
                        }
                    }
                }
            }
        });
    }

    private readonly _batchUpdateEventEmitter = new EventEmitter<TaskClientStoreBatchUpdate>();

    /**
     * Subscribes to all store task updates.
     *
     * Store task updates are made in batch in a `batchStoreUpdates()` call. This
     * listener is called within that `batchStoreUpdates()` context which means you
     * can make your own store updates that will fire listeners in the same batch.
     */
    public subscribeToBatchUpdate(listener: (update: TaskClientStoreBatchUpdate) => void) {
        return this._batchUpdateEventEmitter.subscribe(listener);
    }

    private _updateReferencedAccountStores(
        oldTaskEntry: TaskClientStoreTaskEntry | null,
        newTaskEntry: TaskClientStoreTaskEntry | null,
    ) {
        const oldReferencedAccountIds = new Set<AccountId>();
        if (oldTaskEntry?.task) {
            collectReferencedAccountIdsFromTaskModelData(
                oldReferencedAccountIds,
                oldTaskEntry.task.rawData,
            );
        }

        const newReferencedAccountIds = new Set<AccountId>();
        if (newTaskEntry?.task) {
            collectReferencedAccountIdsFromTaskModelData(
                newReferencedAccountIds,
                newTaskEntry.task.rawData,
            );
        }

        for (const oldReferencedAccountId of oldReferencedAccountIds) {
            if (newReferencedAccountIds.delete(oldReferencedAccountId)) continue;

            const referencedAccountStore = assertExists(
                this._referencedAccountStoreById.get(oldReferencedAccountId),
            );

            referencedAccountStore.referenceCount--;

            if (referencedAccountStore.referenceCount === 0) {
                this._referencedAccountStoreById.delete(oldReferencedAccountId);
            }
        }

        for (const newReferencedAccountId of newReferencedAccountIds) {
            const referencedAccountStore =
                this._referencedAccountStoreById.get(newReferencedAccountId);

            if (referencedAccountStore) {
                referencedAccountStore.referenceCount++;
            } else {
                const accountStore =
                    this.accountRegistry.weakGetAccountStoreByIdIfExists(newReferencedAccountId);

                // It's expected that when a `newTaskEntry` is introduced by the server, the
                // server has made referenced accounts available through `referencedAccounts`.
                // When `newTaskEntry` is introduced by the client (through an optimistic
                // update) it's expected that the account is available since it's rendered
                // somewhere in the UI.
                if (!accountStore) {
                    throw new InternalError(
                        "Couldn’t find `AccountId` referenced by `TaskModel` in `AccountRegistry`",
                    );
                }

                this._referencedAccountStoreById.set(newReferencedAccountId, {
                    referenceCount: 1,
                    store: accountStore,
                });
            }
        }
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
        actions: ReadonlyArray<TaskActionModel>,
    ): Array<TaskUpdateTaskActionModel> {
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
                const pendingActions: Array<TaskClientStorePendingUpdateTaskAction> = [];

                for (let j = 0; j < i; j++) {
                    const action = actions[j]!;
                    if (action.type !== "UpdateTask" || action.taskId !== taskId) continue;

                    const getActionReferencedSortableAccount =
                        createGetTaskActionReferencedSortableAccount(this.accountRegistry, action);

                    if (task !== null) {
                        task = task.applyAction(action, getActionReferencedSortableAccount);
                    } else {
                        if (action.taskAction.type !== "Create") {
                            pendingActions.push({action, getActionReferencedSortableAccount});
                        } else {
                            task = applyPendingTaskActions(
                                TaskModel.createFromAction(
                                    this.spaceId,
                                    taskId,
                                    action.time,
                                    action.taskAction,
                                    getActionReferencedSortableAccount,
                                ),
                                pendingActions,
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
                    taskEntryStore?.store.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const oldParentTaskId = task.rawData.parent.taskId.value;
                const newParentTaskId = task.rawData.parent.taskId.apply({
                    value: action.taskAction.parentTaskId,
                    version: action.time,
                }).value;
                if (oldParentTaskId === newParentTaskId) continue;

                if (oldParentTaskId) {
                    const oldParentTaskEntryStore = this._taskEntryStoreById.get(oldParentTaskId);
                    const oldParentTask = applyPreviousActions(
                        oldParentTaskId,
                        oldParentTaskEntryStore?.store.getSnapshot().task ?? null,
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
                        newParentTaskEntryStore?.store.getSnapshot().task ?? null,
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
                    taskEntryStore?.store.getSnapshot().task ?? null,
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
                    parentTaskEntryStore?.store.getSnapshot().task ?? null,
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
                    taskEntryStore?.store.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const parentTaskId = task.getParent()?.taskId;
                if (!parentTaskId) continue;

                const parentTaskEntryStore = this._taskEntryStoreById.get(parentTaskId);
                const parentTask = applyPreviousActions(
                    parentTaskId,
                    parentTaskEntryStore?.store.getSnapshot().task ?? null,
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
                    taskEntryStore?.store.getSnapshot().task ?? null,
                );
                if (!task) continue;

                const parentTaskId = task.getParent()?.taskId;
                if (!parentTaskId) continue;

                const parentTaskEntryStore = this._taskEntryStoreById.get(parentTaskId);
                const parentTask = applyPreviousActions(
                    parentTaskId,
                    parentTaskEntryStore?.store.getSnapshot().task ?? null,
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

        const extraActions: Array<TaskUpdateTaskActionModel> = [];

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
        limit,
        withoutReuse,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        limit: number;
        withoutReuse?: boolean;
    }): TaskClientQuery {
        return batchStoreUpdates(() => {
            // Detect if this is a child task query (filters for all child tasks, sorted by
            // parent position). If this is a child task query then:
            //
            // - If a child task query already exists, let's reuse it and avoid duplicate
            //   subscriptions.
            // - Otherwise we should set it in our child task query map.
            const parentTaskId = getParentTaskIdIfChildrenQuery({filters, sorts});
            if (!withoutReuse && parentTaskId) {
                const existingQuery =
                    this._taskChildrenQueryByParentTaskId.getSnapshot(parentTaskId);
                if (existingQuery) {
                    existingQuery.retain();
                    return existingQuery;
                }
            }

            const query = new TaskClientQueryInternal({
                store: this,
                filters,
                sorts,
                limit,
            });

            // If there was already a query for this `parentTaskId` then override it.
            if (parentTaskId) {
                this._taskChildrenQueryByParentTaskId.set(parentTaskId, query.external);
            }

            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Map(subscriptions.queries);
                newQueries.set(query.external, {isUnsubscribing: false});
                return {...subscriptions, queries: newQueries};
            });

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
            limit: number;
        }>,
    ): Array<TaskClientQuery> {
        return batchStoreUpdates(() => {
            const createdQueries = queries.map(({filters, sorts, limit}) => {
                // Detect if this is a child task query (filters for all child tasks, sorted by
                // parent position). If this is a child task query then:
                //
                // - If a child task query already exists, let's reuse it and avoid duplicate
                //   subscriptions.
                // - Otherwise we should set it in our child task query map.
                const parentTaskId = getParentTaskIdIfChildrenQuery({filters, sorts});
                if (parentTaskId) {
                    const existingQuery =
                        this._taskChildrenQueryByParentTaskId.getSnapshot(parentTaskId);
                    if (existingQuery) {
                        existingQuery.retain();
                        return existingQuery;
                    }
                }

                const query = new TaskClientQueryInternal({
                    store: this,
                    filters,
                    sorts,
                    limit,
                });

                if (parentTaskId) {
                    this._taskChildrenQueryByParentTaskId.set(parentTaskId, query.external);
                }

                return query.external;
            });

            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Map(subscriptions.queries);

                for (const query of createdQueries) {
                    // If we're reusing a child task query it should already have been added to our
                    // subscriptions.
                    if (newQueries.has(query)) continue;

                    newQueries.set(query, {isUnsubscribing: false});
                }

                return {...subscriptions, queries: newQueries};
            });

            return createdQueries;
        });
    }

    public onQueryFinallyReleased(query: TaskClientQueryInternal) {
        batchStoreUpdates(() => {
            this._subscriptionsStore.set(subscriptions => {
                const newQueries = new Map(subscriptions.queries);
                newQueries.set(query.external, {isUnsubscribing: true});
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
     * Once `TaskRealtimeClient` has finished unsubscribing from a query it must
     * call this method so we can cleanup the query from our store.
     */
    public onQueryUnsubscribed(query: TaskClientQuery) {
        batchStoreUpdates(() => {
            const oldSubscriptions = this._subscriptionsStore.getSnapshot();

            // Make sure our query was in the process of unsubscribing.
            assert(oldSubscriptions.queries.get(query)?.isUnsubscribing);

            const newQueries = new Map(oldSubscriptions.queries);
            newQueries.delete(query);

            this._subscriptionsStore.set({...oldSubscriptions, queries: newQueries});

            // Cleanup all the data in the query once it's been unsubscribed.
            query._getInternal(this).onUnsubscribed();
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
                const taskEntryStore = this._taskEntryStoreById.get(taskId)?.store;
                const taskEntry = taskEntryStore?.getSnapshot();

                // The server only includes tasks in `previouslyBackfilledTaskIds` that it has
                // previously backfilled in our client in the `backfillTasks`
                // property of a `TaskRealtimeUpdateEvent` event and is actively keeping the
                // task up-to-date in realtime. If the server sends a task the server hasn't
                // backfilled then the server is broken.
                //
                // Instead of trying to silently recover (which to the user is perceived as an
                // unexplainable glitch), loudly blow up.
                //
                // Even considering garbage collection, the task should be loaded in some other
                // query (or else the server would not be keeping the task up-to-date in
                // realtime) which means we've kept the reference to the task retained since it's
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
    public ensureAndRetainTaskChildrenQuery(
        taskId: TaskId,
        {limit}: {limit: number},
    ): TaskClientQuery {
        const existingChildrenQuery = this._taskChildrenQueryByParentTaskId.getSnapshot(taskId);
        if (existingChildrenQuery) {
            existingChildrenQuery.retain();

            const taskCount = existingChildrenQuery.taskOrderStore.getSnapshot().length;
            if (taskCount < limit) {
                existingChildrenQuery.loadMoreTasks(limit - taskCount);
            }

            return existingChildrenQuery;
        }

        const query = this.createAndRetainQuery({
            limit,
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
        let taskEntryStore = this._taskEntryStoreById.get(taskId);

        if (taskEntryStore === undefined) {
            const taskEntry: TaskClientStoreTaskEntry = {
                task: null,
                actions: [],
                optimisticState: null,
                authorizationState: null,
            };

            this._updateReferencedAccountStores(null, taskEntry);

            taskEntryStore = {
                referenceCount: 0,
                store: new ValueStore<TaskClientStoreTaskEntry>(taskEntry),
            };

            this._taskEntryStoreById.set(taskId, taskEntryStore);
            this._taskEntryStoreByIdStores.get(taskId)?.set(taskEntryStore.store);
        }

        const taskSubscription = new TaskClientTaskSubscription(this, taskId, taskEntryStore.store);

        this._subscriptionsStore.set(oldSubscriptions => {
            const taskSubscriptionsById = new Map(oldSubscriptions.taskSubscriptionsById);

            const oldTaskSubscriptions = taskSubscriptionsById.get(taskSubscription.taskId);
            if (!oldTaskSubscriptions) {
                taskSubscriptionsById.set(
                    taskSubscription.taskId,
                    new Map([[taskSubscription, {isUnsubscribing: false}]]),
                );
            } else {
                const taskSubscriptions = new Map(oldTaskSubscriptions);
                taskSubscriptions.set(taskSubscription, {isUnsubscribing: false});
                taskSubscriptionsById.set(taskSubscription.taskId, taskSubscriptions);
            }

            return {...oldSubscriptions, taskSubscriptionsById};
        });

        // Retain the new store.
        this.retainTaskEntryStore(taskId);

        return taskSubscription;
    }

    public onTaskSubscriptionFinallyReleased(taskSubscription: TaskClientTaskSubscription) {
        this._subscriptionsStore.set(oldSubscriptions => {
            const taskSubscriptionsById = new Map(oldSubscriptions.taskSubscriptionsById);

            const oldTaskSubscriptions = assertExists(
                taskSubscriptionsById.get(taskSubscription.taskId),
            );

            const taskSubscriptions = new Map(oldTaskSubscriptions);
            taskSubscriptions.set(taskSubscription, {isUnsubscribing: true});

            taskSubscriptionsById.set(taskSubscription.taskId, taskSubscriptions);

            return {...oldSubscriptions, taskSubscriptionsById};
        });
    }

    /**
     * Once `TaskRealtimeClient` has finished unsubscribing from a task it must
     * call this method so we can cleanup the task from our store.
     */
    public onTaskSubscriptionUnsubscribed(taskSubscription: TaskClientTaskSubscription) {
        batchStoreUpdates(() => {
            const oldSubscriptions = this._subscriptionsStore.getSnapshot();

            // Make sure our subscription was in the process of unsubscribing.
            assert(
                oldSubscriptions.taskSubscriptionsById
                    .get(taskSubscription.taskId)
                    ?.get(taskSubscription)?.isUnsubscribing,
            );

            const newTaskSubscriptionsById = new Map(oldSubscriptions.taskSubscriptionsById);
            const newTaskSubscriptions = new Map(
                assertExists(newTaskSubscriptionsById.get(taskSubscription.taskId)),
            );

            newTaskSubscriptions.delete(taskSubscription);

            if (newTaskSubscriptions.size === 0) {
                newTaskSubscriptionsById.delete(taskSubscription.taskId);
            } else {
                newTaskSubscriptionsById.set(taskSubscription.taskId, newTaskSubscriptions);
            }

            this._subscriptionsStore.set({
                ...oldSubscriptions,
                taskSubscriptionsById: newTaskSubscriptionsById,
            });

            // Cleanup all the data in the subscription once it's been unsubscribed.
            taskSubscription._onUnsubscribed(this);
            this.releaseTaskEntryStore(taskSubscription.taskId);
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
        let collectionEntryStore = this._collectionEntryStoreById.get(collectionId);

        if (collectionEntryStore === undefined) {
            collectionEntryStore = {
                referenceCount: 0,
                store: new ValueStore<TaskClientStoreCollectionEntry>({
                    collection: null,
                    actions: [],
                    optimisticState: null,
                    authorizationState: null,
                }),
            };

            this._collectionEntryStoreById.set(collectionId, collectionEntryStore);
            this._collectionEntryStoreByIdStores.get(collectionId)?.set(collectionEntryStore.store);
        }

        const collectionSubscription = new TaskClientCollectionSubscription(
            this,
            collectionId,
            collectionEntryStore.store,
        );

        this._subscriptionsStore.set(oldSubscriptions => {
            const collectionSubscriptionsById = new Map(
                oldSubscriptions.collectionSubscriptionsById,
            );

            const oldCollectionSubscriptions = collectionSubscriptionsById.get(
                collectionSubscription.collectionId,
            );
            if (!oldCollectionSubscriptions) {
                collectionSubscriptionsById.set(
                    collectionSubscription.collectionId,
                    new Map([[collectionSubscription, {isUnsubscribing: false}]]),
                );
            } else {
                const collectionSubscriptions = new Map(oldCollectionSubscriptions);
                collectionSubscriptions.set(collectionSubscription, {isUnsubscribing: false});
                collectionSubscriptionsById.set(
                    collectionSubscription.collectionId,
                    collectionSubscriptions,
                );
            }

            return {...oldSubscriptions, collectionSubscriptionsById};
        });

        // Retain the new store.
        this.retainCollectionEntryStore(collectionId);

        return collectionSubscription;
    }

    public onCollectionSubscriptionFinallyReleased(
        collectionSubscription: TaskClientCollectionSubscription,
    ) {
        this._subscriptionsStore.set(oldSubscriptions => {
            const collectionSubscriptionsById = new Map(
                oldSubscriptions.collectionSubscriptionsById,
            );

            const oldCollectionSubscriptions = assertExists(
                collectionSubscriptionsById.get(collectionSubscription.collectionId),
            );

            const collectionSubscriptions = new Map(oldCollectionSubscriptions);
            collectionSubscriptions.set(collectionSubscription, {isUnsubscribing: true});

            collectionSubscriptionsById.set(
                collectionSubscription.collectionId,
                collectionSubscriptions,
            );

            return {...oldSubscriptions, collectionSubscriptionsById};
        });
    }

    /**
     * Once `TaskRealtimeClient` has finished unsubscribing from a collection it
     * must call this method so we can cleanup the collection from our store.
     */
    public onCollectionSubscriptionUnsubscribed(
        collectionSubscription: TaskClientCollectionSubscription,
    ) {
        batchStoreUpdates(() => {
            const oldSubscriptions = this._subscriptionsStore.getSnapshot();

            // Make sure our subscription was in the process of unsubscribing.
            assert(
                oldSubscriptions.collectionSubscriptionsById
                    .get(collectionSubscription.collectionId)
                    ?.get(collectionSubscription)?.isUnsubscribing,
            );

            const newCollectionSubscriptionsById = new Map(
                oldSubscriptions.collectionSubscriptionsById,
            );
            const newCollectionSubscriptions = new Map(
                assertExists(
                    newCollectionSubscriptionsById.get(collectionSubscription.collectionId),
                ),
            );

            newCollectionSubscriptions.delete(collectionSubscription);

            if (newCollectionSubscriptions.size === 0) {
                newCollectionSubscriptionsById.delete(collectionSubscription.collectionId);
            } else {
                newCollectionSubscriptionsById.set(
                    collectionSubscription.collectionId,
                    newCollectionSubscriptions,
                );
            }

            this._subscriptionsStore.set({
                ...oldSubscriptions,
                collectionSubscriptionsById: newCollectionSubscriptionsById,
            });

            // Cleanup all the data in the subscription once it's been unsubscribed.
            this.releaseCollectionEntryStore(collectionSubscription.collectionId);
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

function applyPendingTaskActions(
    task: TaskModel,
    actions: ReadonlyArray<TaskClientStorePendingUpdateTaskAction>,
) {
    return actions.reduce((task, {action, getActionReferencedSortableAccount}) => {
        if (action.type === "UpdateTask") {
            return task.applyAction(action, getActionReferencedSortableAccount);
        } else {
            return task.applyUpdateAccountNameAction(action);
        }
    }, task);
}

function applyPendingTaskCollectionActions(
    collection: TaskCollectionModel,
    actions: ReadonlyArray<TaskClientStorePendingUpdateCollectionAction>,
) {
    return actions.reduce((collection, {action}) => {
        return collection.applyAction(action);
    }, collection);
}
