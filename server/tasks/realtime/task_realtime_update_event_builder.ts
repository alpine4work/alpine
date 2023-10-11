import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    isHybridLogicalTimeLessThan,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export type TaskRealtimeUpdateEventBackfillTask =
    | {
          readonly type: "Authorized";
          readonly task: TaskIndexDoc;
          readonly authorizationStateVersion: HybridLogicalTime | undefined;
      }
    | {
          readonly type: "Unauthorized";
          readonly taskId: TaskId;
          readonly authorizationStateVersion: HybridLogicalTime | undefined;
      };

export type TaskRealtimeUpdateEventBackfillCollection =
    | {
          readonly type: "Authorized";
          readonly collection: TaskCollectionIndexDoc;
          readonly authorizationStateVersion: HybridLogicalTime | undefined;
      }
    | {
          readonly type: "Unauthorized";
          readonly collectionId: TaskCollectionId;
          readonly authorizationStateVersion: HybridLogicalTime | undefined;
      };

export type TaskRealtimeUpdateEvent = {
    readonly actions: ReadonlyArray<TaskAction>;
    readonly backfillTasks: ReadonlyArray<TaskRealtimeUpdateEventBackfillTask>;
    readonly backfillCollections: ReadonlyArray<TaskRealtimeUpdateEventBackfillCollection>;
    readonly defaultAuthorizationStateVersion: HybridLogicalTime;
    readonly originClientId: TaskRealtimeClientId | null;
};

export interface TaskRealtimeUpdateEventSender {
    clock: HybridLogicalClock;

    send(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
        event: TaskRealtimeUpdateEvent,
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel> | null,
    ): Promise<void>;
}

type TaskRealtimeWorkingUpdateEvent = {
    defaultAuthorizationStateVersion: HybridLogicalTime;
    actions: Set<TaskAction>;
    backfillTasks: Array<TaskRealtimeUpdateEventBackfillTask>;
    backfillAuthorizedTaskIds: Set<TaskId>;
    backfillCollections: Array<TaskRealtimeUpdateEventBackfillCollection>;
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
    private readonly _originClientId: TaskRealtimeClientId | null;
    private _isBuilding = true;
    private _isSending = false;
    private _promises: Array<PromiseLike<unknown>> = [];

    private readonly _actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel> | null;

    constructor({
        originClientId,
        actionReferencedAccountById,
    }: {
        originClientId: TaskRealtimeClientId | null;
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel> | null;
    }) {
        this._originClientId = originClientId;
        this._actionReferencedAccountById = actionReferencedAccountById;
    }

    private readonly _eventBySender = new DefaultMap<
        TaskRealtimeUpdateEventSender,
        TaskRealtimeWorkingUpdateEvent
    >(sender => ({
        defaultAuthorizationStateVersion: sender.clock.now(),
        actions: new Set(),
        backfillTasks: [],
        backfillAuthorizedTaskIds: new Set(),
        backfillCollections: [],
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
                // If there were no changes in this event then don't send.
                if (
                    event.actions.size === 0 &&
                    event.backfillTasks.length === 0 &&
                    event.backfillCollections.length === 0
                ) {
                    return;
                }

                await sender.send(
                    context,
                    {
                        actions: Array.from(event.actions),
                        backfillTasks: event.backfillTasks,
                        backfillCollections: event.backfillCollections,
                        defaultAuthorizationStateVersion: event.defaultAuthorizationStateVersion,
                        originClientId: this._originClientId,
                    },
                    this._actionReferencedAccountById,
                );
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
    public waitUntil(
        context: Context<{process: ProcessContextModule}>,
        promise: PromiseLike<unknown>,
    ) {
        assert(this._isBuilding);
        this._promises.push(promise);

        // You must pass in a context where you create the promise so we can call
        // `waitUntil()` on the context as well to make sure it's not destroyed.
        context.process.waitUntil(promise instanceof Promise ? promise : Promise.resolve(promise));
    }

    /**
     * Get the default authorization register version.
     */
    public getDefaultAuthorizationStateVersion(
        sender: TaskRealtimeUpdateEventSender,
    ): HybridLogicalTime {
        const event = this._eventBySender.getOrSetDefault(sender);
        return event.defaultAuthorizationStateVersion;
    }

    /**
     * Get a version after `previousVersion`. If our default authorization state
     * version is after `previousVersion` then we use that.
     */
    public tickAuthorizationStateVersion(
        sender: TaskRealtimeUpdateEventSender,
        previousVersion: HybridLogicalTime,
    ): HybridLogicalTime {
        let version = this.getDefaultAuthorizationStateVersion(sender);
        if (!isHybridLogicalTimeLessThan(previousVersion, version)) {
            version = sender.clock.tickNow(previousVersion);
        }
        return version;
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
    public addAuthorizedTaskBackfill(
        sender: TaskRealtimeUpdateEventSender,
        task: TaskIndexDoc,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);

        event.backfillTasks.push({
            type: "Authorized",
            task,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
        });

        event.backfillAuthorizedTaskIds.add(task.id);
    }

    /**
     * Mark a task as unauthorized on the client. Clients should not expect any
     * realtime updates on this task.
     */
    public addUnauthorizedTaskBackfill(
        sender: TaskRealtimeUpdateEventSender,
        taskId: TaskId,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);

        event.backfillTasks.push({
            type: "Unauthorized",
            taskId,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
        });
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
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);

        event.backfillCollections.push({
            type: "Authorized",
            collection,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
        });
    }

    /**
     * Mark a collection as unauthorized on the client. Clients should not expect
     * any realtime updates on this collection.
     */
    public addUnauthorizedCollectionBackfill(
        sender: TaskRealtimeUpdateEventSender,
        collectionId: TaskCollectionId,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(this._isBuilding);

        const event = this._eventBySender.getOrSetDefault(sender);

        event.backfillCollections.push({
            type: "Unauthorized",
            collectionId,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
        });
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
        return event.backfillAuthorizedTaskIds;
    }
}
