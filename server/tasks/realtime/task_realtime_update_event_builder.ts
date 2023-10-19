import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    prepareTaskActionForClient,
    prepareTaskCollectionForClient,
    prepareTaskForClient,
} from "~/server/tasks/data/task_realtime_protocol_helpers.js";
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
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_account_ids_from_task_action.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {collectReferencedAccountIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_account_ids_from_task_model_data.js";
import {TaskRealtimeEvent, TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";

export interface TaskRealtimeUpdateEventConnection {
    readonly clock: HybridLogicalClock;
    readonly spaceId: SpaceId;
    readonly accountId: AccountId;
    sendEvent(context: ServerProcessContext, event: TaskRealtimeEvent): void;
}

type TaskRealtimeUpdateEventBackfillTask =
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

type TaskRealtimeUpdateEventBackfillCollection =
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
 */
export abstract class TaskRealtimeUpdateEventBuilderBase {
    protected readonly _spaceId: SpaceId;
    private _isFinished = false;
    private _isFinishing = false;
    private _promises: Array<PromiseLike<unknown>> = [];

    protected _originClientId: TaskRealtimeClientId | null = null;
    protected _actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel> | null = null;

    constructor(spaceId: SpaceId) {
        this._spaceId = spaceId;
    }

    protected abstract _getEvent(
        connection: TaskRealtimeUpdateEventConnection,
    ): TaskRealtimeWorkingUpdateEvent;

    /**
     * Wait for promises passed into `waitUntil()` to resolve but don't actually
     * send the event. This consumes the event builder so you won't be able to call
     * `send()` after.
     */
    protected async _finish() {
        assert(!this._isFinished);

        assert(!this._isFinishing);
        this._isFinishing = true;

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

        assert(!this._isFinished);
        this._isFinished = true;
        this._isFinishing = false;
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
        assert(!this._isFinished);
        this._promises.push(promise);

        // You must pass in a context where you create the promise so we can call
        // `waitUntil()` on the context as well to make sure it's not destroyed.
        context.process.waitUntil(promise instanceof Promise ? promise : Promise.resolve(promise));
    }

    /**
     * Get the default authorization register version.
     */
    public getDefaultAuthorizationStateVersion(
        connection: TaskRealtimeUpdateEventConnection,
    ): HybridLogicalTime {
        const event = this._getEvent(connection);
        return event.defaultAuthorizationStateVersion;
    }

    /**
     * Get a version after `previousVersion`. If our default authorization state
     * version is after `previousVersion` then we use that.
     */
    public tickAuthorizationStateVersion(
        connection: TaskRealtimeUpdateEventConnection,
        previousVersion: HybridLogicalTime,
    ): HybridLogicalTime {
        let version = this.getDefaultAuthorizationStateVersion(connection);
        if (!isHybridLogicalTimeLessThan(previousVersion, version)) {
            version = connection.clock.tickNow(previousVersion);
        }
        return version;
    }

    /**
     * Add some actions that clients will apply to the event.
     */
    public addActions(
        connection: TaskRealtimeUpdateEventConnection,
        actions: ReadonlyArray<TaskAction>,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

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
        connection: TaskRealtimeUpdateEventConnection,
        task: TaskIndexDoc,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

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
        connection: TaskRealtimeUpdateEventConnection,
        taskId: TaskId,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

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
        connection: TaskRealtimeUpdateEventConnection,
        collection: TaskCollectionIndexDoc,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

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
        connection: TaskRealtimeUpdateEventConnection,
        collectionId: TaskCollectionId,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

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
     * provided connection.
     */
    public getBackfillAuthorizedTaskIds(
        connection: TaskRealtimeUpdateEventConnection,
    ): ReadonlySet<TaskId> {
        // Can't get the backfilled `TaskId`s while we're building the event.
        assert(this._isFinished);

        const event = this._getEvent(connection);
        if (!event) return new Set();
        return event.backfillAuthorizedTaskIds;
    }

    protected async _buildEvent(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
        connection: TaskRealtimeUpdateEventConnection,
        event: TaskRealtimeWorkingUpdateEvent,
    ): Promise<TaskRealtimeUpdateEvent | null> {
        assert(this._isFinished);

        // If there were no changes in this event then noop.
        if (
            event.actions.size === 0 &&
            event.backfillTasks.length === 0 &&
            event.backfillCollections.length === 0
        ) {
            return null;
        }

        const accountIds = new Set<AccountId>();

        const actions = Array.from(
            filterMapIterable(event.actions, action =>
                prepareTaskActionForClient(connection.accountId, action),
            ),
        );

        for (const action of actions) {
            collectReferencedAccountIdsFromTaskAction(accountIds, action);
        }

        const backfillTasks = event.backfillTasks.map(backfillTask => {
            if (backfillTask.type === "Unauthorized") return backfillTask;

            const task = prepareTaskForClient(connection.accountId, backfillTask.task);

            collectReferencedAccountIdsFromTaskModelData(accountIds, task.rawData);

            return {
                type: "Authorized" as const,
                task,
                authorizationStateVersion: backfillTask.authorizationStateVersion,
            };
        });

        const backfillCollections = event.backfillCollections.map(backfillCollection => {
            if (backfillCollection.type === "Unauthorized") return backfillCollection;

            return {
                type: "Authorized" as const,
                collection: prepareTaskCollectionForClient(backfillCollection.collection),
                authorizationStateVersion: backfillCollection.authorizationStateVersion,
            };
        });

        // It's important that accounts referenced by `actions` are read with a
        // `Strong` read consistency so we don't read stale account data after the
        // `UpdateAccountName` action has been applied. If this event builder was
        // created when applying actions then `actionReferencedAccountById` will be set
        // with accounts read with `Strong` consistency.
        const referencedAccounts = await runAllPromises(
            Array.from(
                accountIds,
                accountId =>
                    this._actionReferencedAccountById?.get(accountId) ??
                    getAccount(context, this._spaceId, accountId),
            ),
        );

        return {
            type: "Update",
            actions,
            backfillTasks,
            backfillCollections,
            defaultAuthorizationStateVersion: event.defaultAuthorizationStateVersion,
            referencedAccounts,
            originClientId: this._originClientId,
        };
    }
}

/**
 * Action transaction event builders broadcast updates from an action to
 * multiple clients.
 *
 * Once we are done processing an update the `finishAndSendEvents()` method is
 * called which finalizes our update event and instructs
 * `TaskRealtimeConnection` to send it to the client.
 */
export class TaskRealtimeActionTransactionUpdateEventBuilder extends TaskRealtimeUpdateEventBuilderBase {
    private readonly _eventByConnection = new DefaultMap<
        TaskRealtimeUpdateEventConnection,
        TaskRealtimeWorkingUpdateEvent
    >(connection => {
        assert(connection.spaceId === this._spaceId);

        return {
            defaultAuthorizationStateVersion: connection.clock.now(),
            actions: new Set(),
            backfillTasks: [],
            backfillAuthorizedTaskIds: new Set(),
            backfillCollections: [],
        };
    });

    constructor({
        spaceId,
        originClientId,
        actionReferencedAccountById,
    }: {
        spaceId: SpaceId;
        originClientId: TaskRealtimeClientId | null;
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>;
    }) {
        super(spaceId);

        this._originClientId = originClientId;
        this._actionReferencedAccountById = actionReferencedAccountById;
    }

    protected override _getEvent(
        connection: TaskRealtimeUpdateEventConnection,
    ): TaskRealtimeWorkingUpdateEvent {
        return this._eventByConnection.getOrSetDefault(connection);
    }

    /**
     * Finalizes events built with this class and sends them to connected
     * clients through the `TaskRealtimeUpdateEventConnection` interface.
     *
     * Waits for any promises passed to `waitUntil()` to resolve before
     * finalizing events. Once all `waitUntil()` promises have resolved you may
     * not call any new methods on this class.
     */
    public async finishAndSendEvents(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
    ) {
        await taskRealtimeStoreBeforeSendEventTestCheckpoint.waitForTest(this._spaceId);

        await this._finish();

        await runAllPromises(
            Array.from(this._eventByConnection, async ([connection, event]) => {
                const finalEvent = await this._buildEvent(context, connection, event);
                if (finalEvent !== null) connection.sendEvent(context, finalEvent);
            }),
        );
    }
}

/**
 * Builds an event for a single connection. When you are done building the
 * event you're expected to send the event to the client yourself.
 */
export class TaskRealtimeConnectionUpdateEventBuilder extends TaskRealtimeUpdateEventBuilderBase {
    private readonly _connection: TaskRealtimeUpdateEventConnection;
    private readonly _event: TaskRealtimeWorkingUpdateEvent;

    constructor(connection: TaskRealtimeUpdateEventConnection) {
        super(connection.spaceId);

        this._connection = connection;

        this._event = {
            defaultAuthorizationStateVersion: this._connection.clock.now(),
            actions: new Set(),
            backfillTasks: [],
            backfillAuthorizedTaskIds: new Set(),
            backfillCollections: [],
        };
    }

    protected override _getEvent(
        connection: TaskRealtimeUpdateEventConnection,
    ): TaskRealtimeWorkingUpdateEvent {
        assert(connection === this._connection);
        return this._event;
    }

    /**
     * Finishes building our event and returns the final event. You are
     * responsible for sending this event to the client.
     */
    public async finishAndBuildEvent(
        context: Context<
            ServerProcessContextModules & {
                cache: CacheContextModule;
                actor: DynamoActorContextModule;
            }
        >,
    ): Promise<TaskRealtimeUpdateEvent | null> {
        await taskRealtimeStoreBeforeSendEventTestCheckpoint.waitForTest(this._spaceId);

        await this._finish();
        return this._buildEvent(context, this._connection, this._event);
    }
}

/**
 * Noop event builder for unsubscribing. When unsubscribing we remove
 * references to tasks but we don't have anything to tell the client. The
 * client has an identical implementation where it unsubscribes itself.
 */
export class TaskRealtimeUnsubscribeUpdateEventBuilder extends TaskRealtimeUpdateEventBuilderBase {
    private readonly _eventByConnection = new DefaultMap<
        TaskRealtimeUpdateEventConnection,
        TaskRealtimeWorkingUpdateEvent
    >(connection => {
        assert(connection.spaceId === this._spaceId);

        return {
            defaultAuthorizationStateVersion: connection.clock.now(),
            actions: new Set(),
            backfillTasks: [],
            backfillAuthorizedTaskIds: new Set(),
            backfillCollections: [],
        };
    });

    protected override _getEvent(
        connection: TaskRealtimeUpdateEventConnection,
    ): TaskRealtimeWorkingUpdateEvent {
        return this._eventByConnection.getOrSetDefault(connection);
    }

    public finishAndIgnoreEvents() {
        return this._finish();
    }
}
