import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    authorizeTaskQueryAccess,
    backfillTaskActionTransactionHistory,
} from "~/server/tasks/data/task_table.js";
import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {TaskRealtimeQueryStore} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * The horizontally scalable task realtime server. We don't actually run the
 * HTTP server from this class (see `task_realtime_service.ts`). This class
 * manages all the logic and state associated with the server.
 *
 * Each space is routed to 1+ task realtime servers. These servers are
 * responsible for executing queries and managing realtime WebSocket
 * connections.
 */
export class TaskRealtimeServer {
    /**
     * If the server is currently running then our state is non-null. If the server
     * has stopped running then state is null.
     */
    private _state: {
        /**
         * Whether our server has been discovered yet. We consider our server
         * discovered when all other services in our system know about it.
         *
         * When our server is discovered, `sendActionTransaction()` will be called for
         * every action we need to care about across our system. Before this promise
         * resolves we don't have that guarantee.
         */
        readonly discoveredPromise: Promise<{readonly discoveredTime: number}>;
    } | null = null;

    private readonly _actionHistory: TaskRealtimeActionHistory;
    private readonly _startActionHistory: () => void;
    private readonly _stopActionHistory: () => void;
    private readonly _backfillActionHistoryPromiseBySpaceId = new Map<SpaceId, Promise<void>>();
    private _disableActionHistoryBackfillForTest?: boolean;

    private readonly _storeBySpaceId = new DefaultMap<SpaceId, TaskRealtimeQueryStore>(
        spaceId =>
            new TaskRealtimeQueryStore({
                spaceId,
                actionHistory: this._actionHistory,
                ensureFullActionHistory: context => this._ensureFullActionHistory(context, spaceId),
            }),
    );

    private constructor() {
        const [actionHistory, {start: startActionHistory, stop: stopActionHistory}] =
            TaskRealtimeActionHistory.new();

        this._actionHistory = actionHistory;
        this._startActionHistory = startActionHistory;
        this._stopActionHistory = stopActionHistory;
    }

    public static new(): [
        TaskRealtimeServer,
        {start: (discoveredPromise: Promise<void>) => void; stop: () => void},
    ] {
        const server = new TaskRealtimeServer();
        return [
            server,
            {
                start: discoveredPromise => server._start(discoveredPromise),
                stop: () => server._stop(),
            },
        ];
    }

    /**
     * Start running our server. We don't actually run the HTTP server from this
     * class, only all the logic and state.
     *
     * Must pass in a `discoveredPromise`. This promise should resolve when all
     * other services in our system have discovered this task realtime server.
     * Importantly, this means once the promise has resolved then
     * `sendActionTransaction()` should be called for every new action transaction
     * we need to care about. We may receive some calls to `query()` or
     * `sendActionTransaction()` before we've been fully discovered. However, some
     * server functionality must wait for the server to be discovered.
     */
    private _start(discoveredPromise: Promise<void>) {
        assert(this._state === null);

        this._state = {
            discoveredPromise: discoveredPromise.then(() => ({
                discoveredTime: Date.now(),
            })),
        };

        this._startActionHistory();
    }

    /**
     * Stops our server from running.
     */
    private _stop() {
        assert(this._state !== null);
        this._state = null;
        this._stopActionHistory();

        // In tests, backfill when the server starts again. Restarting the server
        // resets `clearActionHistoryForTest()`.
        if (this._disableActionHistoryBackfillForTest === true) {
            this._disableActionHistoryBackfillForTest = false;
        }
    }

    /**
     * Clear the action history in test environments. You should only do this if
     * you know the task index has incorporated all actions and refreshed!
     */
    public clearActionHistoryForTest() {
        assert(import.meta.jest);

        // Calling stop/start on action history clears it.
        if (this._state !== null) {
            this._stopActionHistory();
            this._startActionHistory();
        }

        // Don't backfill history. We want to pretend like time has moved past when the
        // history visible window starts.
        this._disableActionHistoryBackfillForTest = true;
    }

    /**
     * Ensure that we have a full action history for the provided space. If our
     * server was recently discovered that means we haven't been receiving
     * `sendActionTransaction()` calls and we need to catch up.
     */
    private async _ensureFullActionHistory(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
    ) {
        assert(this._state !== null);
        const {discoveredTime} = await this._state.discoveredPromise;
        const visibleStartTime = this._actionHistory.getVisibleStartTime();

        // If our history visibility window starts after we were discovered then we
        // have already received every relevant action.
        //
        // This also means we should never need to make a backfill request again for
        // the rest of our server's lifetime. So clear the backfill promise cache to
        // free up some memory.
        if (visibleStartTime >= discoveredTime) {
            this._backfillActionHistoryPromiseBySpaceId.clear();
            return;
        }

        if (this._disableActionHistoryBackfillForTest === true) {
            assert(import.meta.jest);
            return;
        }

        return getOrSetDefaultMapValue(
            this._backfillActionHistoryPromiseBySpaceId,
            spaceId,
            async () => {
                const actionTransactions = await backfillTaskActionTransactionHistory(
                    context,
                    spaceId,
                    new Date(visibleStartTime),
                );

                for (const actionTransaction of actionTransactions) {
                    // Add the action transaction to our history but don't send it to connected
                    // clients since the action happened in the past. If a client asks for a
                    // backfill we will serve them one using our action history class.
                    this._actionHistory.addActionTransaction(actionTransaction);
                }
            },
        );
    }

    public async loadQuery(
        context: TaskRealtimeSystemActionContext,
        options: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        },
    ): Promise<{
        tasks: Array<TaskIndexDoc>;
        hasMoreTasks: boolean;
    }> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the queried tasks. Permissions filtering is done at a
        // different level.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return store.loadQuery(context, options);
    }

    public async subscribeToQuery(
        context: TaskRealtimeSystemActionContext,
        options: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            callbacks: TaskRealtimeQuerySubscriptionCallbacks;
        },
    ): Promise<TaskRealtimeQuerySubscription> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the queried tasks. Permissions filtering is done at a
        // different level.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return store.subscribeToQuery(options);
    }

    public async applyActionTransaction(
        context: TaskRealtimeSystemActionContext,
        actionTransaction: {
            spaceId: SpaceId;
            committedTime: Date;
            actions: ReadonlyArray<TaskAction>;
        },
    ) {
        // Must be a system actor since the action transaction doesn't include
        // information about the actor which committed it.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, actionTransaction.spaceId);

        this._actionHistory.addActionTransaction(actionTransaction);

        const store = this._storeBySpaceId.get(actionTransaction.spaceId);
        await store?.applyActionTransaction(context, actionTransaction.actions);
    }

    /**
     * Get the provided task from our realtime store. If the task is in our store
     * we will return immediately. Otherwise we will load the task from OpenSearch
     * and catch it up so it's up-to-date in realtime.
     *
     * If the task does not exist we will throw an error. It may take a while to
     * throw a not found error since the task might not exist *yet*. You may know
     * about a task before it's indexed in OpenSearch. In that case we retry until
     * a timeout is reached.
     */
    public async getTask(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<TaskIndexDoc> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the task.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(spaceId);
        return store.getTask(context, taskId);
    }

    /**
     * Get the provided collection from our realtime store. If the collection is in
     * our store we will return immediately. Otherwise we will load the collection
     * from OpenSearch and catch it up so it's up-to-date in realtime.
     *
     * If the collection does not exist we will throw an error. It may take a while
     * to throw a not found error since the collection might not exist *yet*. You
     * may know about a collection before it's indexed in OpenSearch. In that case
     * we retry until a timeout is reached.
     */
    public async getCollection(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionIndexDoc> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the task.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(spaceId);
        return store.getCollection(context, collectionId);
    }

    /**
     * Authorizes that an account actor has access to a query. Throws an error if
     * we're unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load
     * from DynamoDB.
     */
    public authorizeQueryAccess(
        context: ServerSessionActionContext,
        {
            spaceId,
            filters,
            sorts,
        }: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        },
    ) {
        return runAllPromises([
            // Authorize space access in parallel...
            authorizeSpaceAccess(context, spaceId),

            authorizeTaskQueryAccess(
                context,
                {
                    filters,
                    sorts,
                },
                {
                    getTaskIndexDocIfExists: taskId =>
                        this._storeBySpaceId.get(spaceId)?.getTaskIfLoaded(taskId),
                    getCollectionIndexDocIfExists: collectionId =>
                        this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
                },
            ),
        ]);
    }
}
