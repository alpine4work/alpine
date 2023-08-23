import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export type TaskRealtimeUpdateEvent = {
    readonly actions: ReadonlyArray<TaskAction>;
    readonly backfillAuthorizedTasks: ReadonlyArray<TaskIndexDoc>;
    readonly backfillUnauthorizedTaskIds: ReadonlyArray<TaskId>;
};

export interface TaskRealtimeUpdateEventSender {
    send(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
        event: TaskRealtimeUpdateEvent,
    ): Promise<void>;
}

type TaskRealtimeWorkingUpdateEvent = {
    actions: Set<TaskAction>;
    backfillAuthorizedTasks: Set<TaskIndexDoc>;
    backfillUnauthorizedTaskIds: Set<TaskId>;
};

/**
 * Builds an update event for the client.
 *
 * - A `TaskRealtimeConnection` should only see actions from an action
 *   transaction that update data it's subscribed to
 * - A `TaskRealtimeConnection` may have multiple subscriptions but should only
 *   send one update event per action transaction
 * - We implement task loading from `TaskRealtimeQuerySubscription` with events
 *   to share code paths with realtime updates so we need to support that too
 *   which is usually sending events to a single client
 *
 * So when `TaskRealtimeQueryStore` sees a new action transaction, it uses our
 * subscription machinery to figure out which dependents may need to see the
 * action. Eventually we call the `TaskRealtimeConnection`'s query subscription
 * callbacks. These callbacks "accept" actions on tasks by calling methods on
 * event builder. We may call these callbacks many times over the course of a
 * transaction which will accumulate more and more updates.
 *
 * Once we are done processing an update the `send()` method is called which
 * finalizes our update event and instructs `TaskRealtimeConnection` to send it
 * to the client.
 */
export class TaskRealtimeUpdateEventBuilder {
    private _isBuilding = true;
    private _isSending = false;
    private _promises: Array<Promise<unknown>> = [];

    private readonly _eventBySender = new DefaultMap<
        TaskRealtimeUpdateEventSender,
        TaskRealtimeWorkingUpdateEvent
    >(() => ({
        actions: new Set(),
        backfillAuthorizedTasks: new Set(),
        backfillUnauthorizedTaskIds: new Set(),
    }));

    /**
     * Finalizes events built with this class and sends them to connected
     * clients through the `TaskRealtimeUpdateEventSender` interface.
     *
     * Waits for any promises passed to `waitUntil()` to resolve before
     * finalizing events. Once all `waitUntil()` promises have resolved you may
     * not call any new methods on this class.
     */
    public async send(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
    ) {
        assert(this._isBuilding);

        assert(!this._isSending);
        this._isSending = true;

        // Wait for all our `waitUntil()` promises to resolve before building the
        // final event.
        while (this._promises.length > 0) {
            const promises = this._promises;
            this._promises = [];
            await runAllPromises(promises);
        }

        assert(this._isBuilding);
        this._isBuilding = false;

        await runAllPromises(
            Array.from(this._eventBySender, async ([sender, event]) => {
                const backfillAuthorizedTasks: Array<TaskIndexDoc> = [];

                for (const task of event.backfillAuthorizedTasks) {
                    if (event.backfillUnauthorizedTaskIds.has(task.id)) continue;
                    backfillAuthorizedTasks.push(task);
                }

                await sender.send(context, {
                    actions: Array.from(event.actions),
                    backfillAuthorizedTasks,
                    backfillUnauthorizedTaskIds: Array.from(event.backfillUnauthorizedTaskIds),
                });
            }),
        );
    }

    /**
     * Once the event builder has finalized you can't call any of its methods (like
     * `addAuthorizedTaskBackfill`) without getting an error. This function delays
     * event builder finalization until the promise resolves allowing you to load
     * data and add it to the event.
     *
     * We will wait until all promises passed into this function resolve before
     * sending out events to clients.
     */
    public waitUntil(promise: Promise<unknown>) {
        assert(this._isBuilding);
        this._promises.push(promise);
    }

    /**
     * Add some actions that clients will apply to the event.
     */
    public addActions(sender: TaskRealtimeUpdateEventSender, actions: ReadonlyArray<TaskAction>) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);

        for (const action of actions) {
            event.actions.add(action);
        }
    }

    /**
     * Add a full task we'll send to the client. Do this if you haven't been
     * sending the client actions for a task but the task now needs to be displayed
     * (maybe the task was hidden by filters but now is visible).
     */
    public addAuthorizedTaskBackfill(sender: TaskRealtimeUpdateEventSender, task: TaskIndexDoc) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);
        event.backfillAuthorizedTasks.add(task);
        event.backfillUnauthorizedTaskIds.delete(task.id);
    }

    /**
     * Mark a task as unauthorized on the client. Clients should not expect any
     * realtime updates on this task.
     *
     * Toggling between authorized/unauthorized state is not done in a CRDT way
     * with a "last write wins" version comparison. Instead
     * `TaskRealtimeConnection` guarantees sending actions that toggle the
     * authorization state in order. So when you receive an unauthorized task
     * backfill the task is now...unauthorized. When you receive an authorized task
     * backfill the task is available.
     */
    public addUnauthorizedTaskBackfill(sender: TaskRealtimeUpdateEventSender, taskId: TaskId) {
        assert(this._isBuilding);

        this._eventBySender.getOrSetDefault(sender).backfillUnauthorizedTaskIds.add(taskId);

        // Logically, this should remove a backfilled authorized task. However we don't
        // have a way to address authorized tasks by `TaskId` during the event building
        // phase. So we remove conflicting tasks in the event finalization phase.
    }
}
