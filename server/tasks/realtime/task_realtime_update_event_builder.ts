import {getSitePreviewIfPossible} from "~/server/sites/data/get_site_preview.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {prepareTaskActionForClient} from "~/server/tasks/data/prepare_task_action_for_client.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActorInterface} from "~/server/tasks/data/task_realtime_actor_interface.js";
import {
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {ErrorCode} from "~/shared/error/error_code.open_source.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    isHybridLogicalTimeLessThan,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {TaskRealtimeClientId} from "~/shared/id/types/id_types.js";
import {
    AccountId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {collectReferencedIdsFromTaskCollectionModelData} from "~/shared/tasks/model/collect_referenced_ids_from_task_collection_model_data.js";
import {collectReferencedIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_ids_from_task_model_data.js";
import {TaskRealtimeEvent, TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";

export interface TaskRealtimeUpdateEventConnection {
    readonly clock: HybridLogicalClock;
    readonly spaceId: SpaceId;
    readonly accountId: AccountId;
    readonly actor: TaskRealtimeActorInterface;
    sendEvent(
        context: TaskRealtimeProcessContext,
        event: TaskRealtimeEvent,
    ): SafeFloatingPromise<void>;
    isReferencedCollectionAccessAuthorized(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<boolean>;
    isSiteAccessAuthorized(
        context: TaskRealtimeSystemActionContext,
        siteId: SiteId,
    ): Promise<boolean>;
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
          readonly errorCode: ErrorCode;
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
          readonly errorCode: ErrorCode;
          readonly authorizationStateVersion: HybridLogicalTime | undefined;
          readonly wasPreviouslyAuthorized: boolean;
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
 * - A `TaskRealtimeConnection` should only see actions from an action transaction
 *   that update data it's subscribed to
 * - A `TaskRealtimeConnection` may have multiple subscriptions but should only
 *   send one update event per action transaction
 * - We implement task loading from `TaskRealtimeQuerySubscription` with events to
 *   share code paths with realtime updates so we need to support that too which is
 *   usually sending events to a single client
 *
 * So when `TaskRealtimeStore` sees a new action transaction, it uses our
 * subscription machinery to figure out which dependents may need to see the
 * action. Eventually we call the `TaskRealtimeConnection`'s query subscription
 * callbacks. These callbacks "accept" actions on tasks by calling methods on event
 * builder. We may call these callbacks many times over the course of a transaction
 * which will accumulate more and more updates.
 */
export abstract class TaskRealtimeUpdateEventBuilderBase {
    protected readonly _spaceId: SpaceId;
    private _isFinished = false;
    private _isFinishing = false;
    private _promiseWaiter = new PromiseWaiter();

    protected _originClientId: TaskRealtimeClientId | null = null;
    protected _actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel> | null = null;

    constructor(spaceId: SpaceId) {
        this._spaceId = spaceId;
    }

    protected abstract _getEvent(
        connection: TaskRealtimeUpdateEventConnection,
    ): TaskRealtimeWorkingUpdateEvent;

    /**
     * Wait for promises passed into `waitUntil()` to resolve but don't actually send
     * the event. This consumes the event builder so you won't be able to call `send()`
     * after.
     */
    protected async _finish() {
        assert(!this._isFinished);

        assert(!this._isFinishing);
        this._isFinishing = true;

        await this._promiseWaiter.wait();

        assert(!this._isFinished);
        this._isFinished = true;
        this._isFinishing = false;
    }

    /**
     * Once the event builder has finalized you can't call any of its methods (like
     * `addAuthorizedTaskBackfill`) without getting an error. This function delays
     * event builder finalization until the promise resolves allowing you to load data
     * and add it to the event.
     *
     * We will wait until all promises passed into this function resolve before sending
     * out events to clients.
     */
    public waitUntil(
        context: Context<{process: ProcessContextModule}>,
        promise: PromiseLike<unknown>,
    ) {
        assert(!this._isFinished);
        this._promiseWaiter.waitUntil(promise);

        // You must pass in a context where you create the promise so we can call
        // `waitUntil()` on the context as well to make sure it's not destroyed.
        //
        // NOTE(calebmer, 2024-10-03): Is this really necessary?
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
     * Add a full task we'll send to the client. Do this if you haven't been sending
     * the client actions for a task but the task now needs to be displayed (maybe the
     * task was hidden by filters but now is visible).
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
        errorCode: ErrorCode,
        authorizationStateVersion: HybridLogicalTime,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

        event.backfillTasks.push({
            type: "Unauthorized",
            taskId,
            errorCode,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
        });
    }

    /**
     * Add a full collection we'll send to the client. Do this if you haven't been
     * sending the client actions for a collection but the collection now needs to be
     * displayed (maybe the collection was hidden by filters but now is visible).
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
     * Mark a collection as unauthorized on the client. Clients should not expect any
     * realtime updates on this collection.
     */
    public addUnauthorizedCollectionBackfill(
        connection: TaskRealtimeUpdateEventConnection,
        collectionId: TaskCollectionId,
        errorCode: ErrorCode,
        authorizationStateVersion: HybridLogicalTime,
        wasPreviouslyAuthorized: boolean,
    ) {
        assert(!this._isFinished);

        const event = this._getEvent(connection);

        event.backfillCollections.push({
            type: "Unauthorized",
            collectionId,
            errorCode,
            authorizationStateVersion:
                event.defaultAuthorizationStateVersion !== authorizationStateVersion
                    ? authorizationStateVersion
                    : undefined,
            wasPreviouslyAuthorized,
        });
    }

    /**
     * Get the `TaskId`s that are included in our backfill event for the provided
     * connection.
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
        context: TaskRealtimeSystemActionContext,
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
        const siteIds = new Set<SiteId>();

        const prepareContext = {
            actor: connection.actor,
            // You may only connect to `TaskRealtimeConnection` if you have space access. If we
            // allow anonymous accounts or session accounts without space access to connect
            // then we'll need to update this.
            isSpaceAccessAuthorized: true,
            isCollectionAccessAuthorized: (collectionId: TaskCollectionId) =>
                connection.isReferencedCollectionAccessAuthorized(context, collectionId),
            isSiteAccessAuthorized: (siteId: SiteId) =>
                connection.isSiteAccessAuthorized(context, siteId),
        };

        const [unfilteredActions, backfillTasks] = await runAllPromises([
            runAllPromises(
                mapIterable(event.actions, async unpreparedAction => {
                    const action = await prepareTaskActionForClient(
                        unpreparedAction,
                        prepareContext,
                    );
                    if (action === null) return;

                    collectReferencedIdsFromTaskAction(accountIds, siteIds, action);

                    return action;
                }),
            ),
            runAllPromises(
                mapIterable(event.backfillTasks, async unpreparedTask => {
                    if (unpreparedTask.type === "Unauthorized") return unpreparedTask;

                    const task = await prepareTaskForClient(unpreparedTask.task, prepareContext);

                    collectReferencedIdsFromTaskModelData(accountIds, siteIds, task.rawData);

                    return {
                        type: "Authorized" as const,
                        task,
                        authorizationStateVersion: unpreparedTask.authorizationStateVersion,
                    };
                }),
            ),
        ]);

        const actions = unfilteredActions.filter(isNonNullable);

        const backfillCollections = filterMapArray(
            event.backfillCollections,
            unpreparedCollection => {
                if (unpreparedCollection.type === "Unauthorized") {
                    // If the collection was never authorized in the first place then don't backfill
                    // the unauthorized collection. We should have completely filtered out the
                    // unauthorized collection from `actions` and `backfillTasks` via
                    // `prepareTaskActionForClient()` and `prepareTaskForClient()`. So let's not share
                    // the existence of a potentially referenced unauthorized collection as well.
                    //
                    // If the collection was previously authorized and became unauthorized then we'll
                    // need to share that with the client so the client can update the collection in
                    // their local state.
                    //
                    // TODO(calebmer, #task-correctness): There's a correctness bug here.
                    // `wasPreviouslyAuthorized` only tells us if the collection was previously
                    // authorized in the current connection. If the client received the collection in a
                    // previous connection, went offline, the collection becomes authorized, then the
                    // client reconnects the client will permanently think the collection is authorized
                    // since `TaskRealtimeService` won't send an update telling the client the
                    // collection is now unauthorized. If we always sent the unauthorized backfill
                    // message that would fix our correctness bug but introduce a security bug!
                    //
                    // The security bug is an attacker could determine, by loading a query with one
                    // task at a time, the unauthorized `TaskCollectionId`s referenced by a task. This
                    // information could be used maliciously be an attacker (e.g. an attacker might be
                    // able to intuit a manager is collecting evidence for firing someone in a private
                    // collection based on seeing the `TaskCollectionId` on certain tasks). Right now
                    // we're trading a correctness bug for a security bug. In the future, we should
                    // find a way to fix the correctness bug without opening a security hole.
                    //
                    // My current idea to fix this is when the client starts a realtime connection for
                    // it to send a procedure in the background with all visible `TaskCollectionId`s
                    // and then the server will respond with which are authorized/unauthorized. This
                    // fixes the correctness issue without introducing a security flaw. The client
                    // already knows the `TaskCollectionId`s so we're not sharing any new information
                    // with the client.
                    if (!unpreparedCollection.wasPreviouslyAuthorized) return;

                    return {
                        type: "Unauthorized" as const,
                        collectionId: unpreparedCollection.collectionId,
                        errorCode: unpreparedCollection.errorCode,
                        authorizationStateVersion: unpreparedCollection.authorizationStateVersion,
                    };
                }

                const collection = prepareTaskCollectionForClient(unpreparedCollection.collection);

                collectReferencedIdsFromTaskCollectionModelData(siteIds, collection.rawData);

                return {
                    type: "Authorized" as const,
                    collection,
                    authorizationStateVersion: unpreparedCollection.authorizationStateVersion,
                };
            },
        );

        // We may remove some unauthorized `actions` or `backfillCollections` so check
        // again if the event is empty.
        if (
            actions.length === 0 &&
            backfillTasks.length === 0 &&
            backfillCollections.length === 0
        ) {
            return null;
        }

        const [referencedAccounts, referencedSites] = await runAllPromises([
            // It's important that accounts referenced by `actions` are read with a `Strong`
            // read consistency so we don't read stale account data after the
            // `UpdateAccountName` action has been applied. If this event builder was created
            // when applying actions then `actionReferencedAccountById` will be set with
            // accounts read with `Strong` consistency.
            runAllPromises(
                Array.from(
                    accountIds,
                    accountId =>
                        this._actionReferencedAccountById?.get(accountId) ??
                        getAccount(context, this._spaceId, accountId),
                ),
            ),
            // Site previews must be authorized against the _connecting_ account, not the
            // system actor that this event builder runs under. Without this hop, an assignee
            // whose task lives in a private site would receive the full `SitePreviewModel`
            // (name, access policy, etc.) for that site even though they don't have View
            // access on it. We collapse "no access" into `null` so the existing
            // `filter(isNonNullable)` below also strips unauthorized entries — keeping
            // `{ok: false}` would leak the site's existence to the client, which is the same
            // kind of disclosure the impersonation hop is meant to prevent. Mirrors how
            // `TaskRealtimeConnection.isReferencedCollectionAccessAuthorized` impersonates the
            // connection's account before authorizing collections.
            runAllPromises(
                Array.from(siteIds, siteId =>
                    impersonateAccountAsSystemContext(
                        context,
                        connection.accountId,
                        async actorContext => {
                            const result = await getSitePreviewIfPossible(actorContext, siteId);
                            return result?.ok
                                ? ({isPrivate: false, site: result.value} as const)
                                : ({isPrivate: true} as const);
                        },
                    ),
                ),
            ),
        ]);

        return {
            type: "Update",
            actions: actions.filter((action): action is TaskAction => action !== undefined),
            backfillTasks,
            backfillCollections,
            defaultAuthorizationStateVersion: event.defaultAuthorizationStateVersion,
            referencedAccounts,
            referencedSites,
            originClientId: this._originClientId,
        };
    }
}

/**
 * Action transaction event builders broadcast updates from an action to multiple
 * clients.
 *
 * Once we are done processing an update the `finishAndSendEvents()` method is
 * called which finalizes our update event and instructs `TaskRealtimeConnection`
 * to send it to the client.
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
     * Finalizes events built with this class and sends them to connected clients
     * through the `TaskRealtimeUpdateEventConnection` interface.
     *
     * Waits for any promises passed to `waitUntil()` to resolve before finalizing
     * events. Once all `waitUntil()` promises have resolved you may not call any new
     * methods on this class.
     */
    public async finishAndSendEvents(context: TaskRealtimeSystemActionContext) {
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
 * Builds an event for a single connection. When you are done building the event
 * you're expected to send the event to the client yourself.
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
     * Finishes building our event and returns the final event. You are responsible for
     * sending this event to the client.
     */
    public async finishAndBuildEvent(
        context: TaskRealtimeSystemActionContext,
    ): Promise<TaskRealtimeUpdateEvent | null> {
        await taskRealtimeStoreBeforeSendEventTestCheckpoint.waitForTest(this._spaceId);

        await this._finish();
        return await this._buildEvent(context, this._connection, this._event);
    }
}

/**
 * Noop event builder for unsubscribing. When unsubscribing we remove references to
 * tasks but we don't have anything to tell the client. The client has an identical
 * implementation where it unsubscribes itself.
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
