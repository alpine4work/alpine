import {AppSystemActionContext} from "~/server/dynamo/context/app_action_context.js";
import {backfillTaskActionTransactionHistory} from "~/server/dynamo/tasks_table.js";
import {queryTaskIndex} from "~/server/tasks/index/task_index.js";
import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/internal/task_realtime_action_history.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";

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

    private readonly _actionHistory = new TaskRealtimeActionHistory();
    private readonly _backfillActionHistoryPromiseBySpaceId = new Map<SpaceId, Promise<void>>();

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
    public start(discoveredPromise: Promise<void>) {
        assert(this._state === null);

        this._state = {
            discoveredPromise: discoveredPromise.then(() => ({
                discoveredTime: Date.now(),
            })),
        };

        this._actionHistory.start();
    }

    /**
     * Stops our server from running.
     */
    public stop() {
        assert(this._state !== null);
        this._state = null;
        this._actionHistory.stop();
    }

    public async query(
        context: AppSystemActionContext,
        {spaceId, filters}: {spaceId: SpaceId; filters: TaskQueryNormalizedFilters},
    ) {
        const [tasks] = await runAllPromises([
            queryTaskIndex(context, {spaceId, filters}),
            this._ensureFullActionHistory(context, spaceId),
        ]);
    }

    /**
     * Ensure that we have a full action history for the provided space. If our
     * server was recently discovered that means we haven't been receiving
     * `sendActionTransaction()` calls and we need to catch up.
     */
    public async _ensureFullActionHistory(context: AppSystemActionContext, spaceId: SpaceId) {
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

    public sendActionTransaction(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }) {
        this._actionHistory.addActionTransaction(actionTransaction);

        // NOCOMMIT: Apply to queries...
    }
}
