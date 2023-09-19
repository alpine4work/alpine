import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

let number = 1;

export function generateTaskRealtimeUpdateEventNumber() {
    return number++;
}

export type TaskRealtimeUpdateEvent = {
    readonly number: number;
    readonly actions: ReadonlyArray<TaskAction>;
    readonly backfillAuthorizedTasks: ReadonlyArray<TaskIndexDoc>;
    readonly backfillUnauthorizedTaskIds: ReadonlyArray<TaskId>;
    readonly backfillAuthorizedCollections: ReadonlyArray<TaskCollectionIndexDoc>;
    readonly backfillUnauthorizedCollectionIds: ReadonlyArray<TaskCollectionId>;
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
    backfillAuthorizedCollections: Set<TaskCollectionIndexDoc>;
    backfillUnauthorizedCollectionIds: Set<TaskCollectionId>;
};

export const taskRealtimeStoreBeforeSendEventTestCheckpoint = new TestCheckpoint<SpaceId>();

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
 * So when `TaskRealtimeStore` sees a new action transaction, it uses our
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
    private readonly _number = generateTaskRealtimeUpdateEventNumber();
    private _isBuilding = true;
    private _isSending = false;
    private _promises: Array<PromiseLike<unknown>> = [];

    private readonly _eventBySender = new DefaultMap<
        TaskRealtimeUpdateEventSender,
        TaskRealtimeWorkingUpdateEvent
    >(() => ({
        actions: new Set(),
        backfillAuthorizedTasks: new Set(),
        backfillUnauthorizedTaskIds: new Set(),
        backfillAuthorizedCollections: new Set(),
        backfillUnauthorizedCollectionIds: new Set(),
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
        spaceId: SpaceId,
    ) {
        assert(this._isBuilding);

        assert(!this._isSending);
        this._isSending = true;

        await taskRealtimeStoreBeforeSendEventTestCheckpoint.waitForTest(spaceId);

        let hasError = false;
        let error: unknown;

        // Wait for all our `waitUntil()` promises to resolve before building the
        // final event.
        //
        // Even if there's an error. Only throw our error at the very end.
        while (this._promises.length > 0) {
            const promises = this._promises;
            this._promises = [];

            try {
                await runAllPromises(promises);
            } catch (newError) {
                if (!hasError) {
                    hasError = true;
                    error = newError;
                }
                // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
                // just the first one. Probably by using an `AggregateError`.
                else if (!isSystemError(error) && isSystemError(newError)) {
                    error = newError;
                }
            }
        }

        if (hasError) throw error;

        assert(this._isBuilding);
        this._isBuilding = false;

        await runAllPromises(
            Array.from(this._eventBySender, async ([sender, event]) => {
                const backfillAuthorizedTasks: Array<TaskIndexDoc> = [];
                const backfillAuthorizedCollections: Array<TaskCollectionIndexDoc> = [];

                for (const task of event.backfillAuthorizedTasks) {
                    if (event.backfillUnauthorizedTaskIds.has(task.id)) continue;
                    backfillAuthorizedTasks.push(task);
                }

                for (const collection of event.backfillAuthorizedCollections) {
                    if (event.backfillUnauthorizedCollectionIds.has(collection.id)) continue;
                    backfillAuthorizedCollections.push(collection);
                }

                await sender.send(context, {
                    number: this._number,
                    actions: Array.from(event.actions),
                    backfillAuthorizedTasks,
                    backfillUnauthorizedTaskIds: Array.from(event.backfillUnauthorizedTaskIds),
                    backfillAuthorizedCollections,
                    backfillUnauthorizedCollectionIds: Array.from(
                        event.backfillUnauthorizedCollectionIds,
                    ),
                });
            }),
        );
    }

    /**
     * Wait for promises passed into `waitUntil()` to resolve but don't actually
     * send the event. This consumes the event builder so you won't be able to call
     * `send()` after.
     */
    public async waitWithoutSending() {
        assert(this._isBuilding);

        assert(!this._isSending);
        this._isSending = true;

        let hasError = false;
        let error: unknown;

        // Wait for all our `waitUntil()` promises to resolve before building the
        // final event.
        //
        // Even if there's an error. Only throw our error at the very end.
        while (this._promises.length > 0) {
            const promises = this._promises;
            this._promises = [];

            try {
                await runAllPromises(promises);
            } catch (newError) {
                if (!hasError) {
                    hasError = true;
                    error = newError;
                }
                // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
                // just the first one. Probably by using an `AggregateError`.
                else if (!isSystemError(error) && isSystemError(newError)) {
                    error = newError;
                }
            }
        }

        if (hasError) throw error;

        assert(this._isBuilding);
        this._isBuilding = false;
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
    public waitUntil(promise: PromiseLike<unknown>) {
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
     */
    public addUnauthorizedTaskBackfill(sender: TaskRealtimeUpdateEventSender, taskId: TaskId) {
        assert(this._isBuilding);

        this._eventBySender.getOrSetDefault(sender).backfillUnauthorizedTaskIds.add(taskId);

        // Logically, this should remove a backfilled authorized task. However we don't
        // have a way to address authorized tasks by `TaskId` during the event building
        // phase. So we remove conflicting tasks in the event finalization phase.
    }

    /**
     * Add a full collection we'll send to the client. Do this if you haven't been
     * sending the client actions for a collection but the collection now needs to
     * be displayed (maybe the collection was hidden by filters but now is
     * visible).
     */
    public addAuthorizedCollectionBackfill(
        sender: TaskRealtimeUpdateEventSender,
        collection: TaskCollectionIndexDoc,
    ) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);
        event.backfillAuthorizedCollections.add(collection);
        event.backfillUnauthorizedCollectionIds.delete(collection.id);
    }

    /**
     * Mark a collection as unauthorized on the client. Clients should not expect
     * any realtime updates on this collection.
     */
    public addUnauthorizedCollectionBackfill(
        sender: TaskRealtimeUpdateEventSender,
        collectionId: TaskCollectionId,
    ) {
        assert(this._isBuilding);

        this._eventBySender
            .getOrSetDefault(sender)
            .backfillUnauthorizedCollectionIds.add(collectionId);

        // Logically, this should remove a backfilled authorized collection. However we
        // don't have a way to address authorized collections by `TaskCollectionId`
        // during the event building phase. So we remove conflicting tasks in the event
        // finalization phase.
    }

    /**
     * Get the `TaskId`s that are included in our backfill event for the
     * provided sender.
     */
    public getBackfillAuthorizedTaskIds(sender: TaskRealtimeUpdateEventSender): Set<TaskId> {
        // Can't get the backfilled `TaskId`s while we're building the event.
        assert(!this._isBuilding);

        const event = this._eventBySender.get(sender);
        if (!event) return new Set();

        const taskIds = new Set<TaskId>();

        for (const task of event.backfillAuthorizedTasks) {
            if (event.backfillUnauthorizedTaskIds.has(task.id)) continue;
            taskIds.add(task.id);
        }

        return taskIds;
    }
}
