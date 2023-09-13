import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    collectReferencedAccountIdsFromTaskAction,
    collectReferencedAccountIdsFromTaskModelData,
    prepareTaskActionForClient,
    prepareTaskCollectionForClient,
    prepareTaskForClient,
} from "~/server/tasks/data/task_realtime_protocol_helpers.js";
import {
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {
    TaskRealtimeUpdateEventBuilder,
    TaskRealtimeUpdateEventSender,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeQuerySubscriptionId,
} from "~/shared/id/types/id_types.js";
import {TaskRealtimeEvent, TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Manages a client's WebSocket connection with `TaskRealtimeService`. A client
 * may be connected to any number of resources (queries, tasks, collections)
 * and it expects to get updates for those resources over time.
 */
export class TaskRealtimeConnection {
    private readonly _server: TaskRealtimeServer;
    private readonly _spaceId: SpaceId;
    private readonly _accountId: AccountId;

    private readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;
    private readonly _sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;
    private readonly _closeWithError: (context: ServerProcessContext, error: unknown) => void;

    private readonly _querySubscriptionById = new Map<
        TaskRealtimeQuerySubscriptionId,
        TaskRealtimeQuerySubscription
    >();

    constructor({
        server,
        spaceId,
        accountId,
        dangerouslyEscalateToSystemContext,
        sendEvent,
        closeWithError,
    }: {
        server: TaskRealtimeServer;
        spaceId: SpaceId;
        accountId: AccountId;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;
        closeWithError: (context: ServerProcessContext, error: unknown) => void;
    }) {
        this._server = server;
        this._spaceId = spaceId;
        this._accountId = accountId;
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
        this._sendEvent = sendEvent;
        this._closeWithError = closeWithError;
    }

    public async handleClose() {
        await runAllPromises(
            Array.from(this._querySubscriptionById.values(), querySubscription =>
                querySubscription.unsubscribe(),
            ),
        );
    }

    public async authorize(context: ServerSessionActionContext) {
        await runAllPromises([
            // 1. Authorize that we still have access to the space:
            authorizeSpaceAccess(context, this._spaceId),

            // 2. Authorize that we still have access to each query subscription:
            runAllPromises(
                Array.from(this._querySubscriptionById.values(), querySubscription =>
                    this._server.authorizeQueryAccess(context, {
                        spaceId: this._spaceId,
                        filters: querySubscription.getFilters(),
                        sorts: querySubscription.getSorts(),
                    }),
                ),
            ),

            // 3. Reauthorize the referenced tasks within a query subscription:
            this._dangerouslyEscalateToSystemContext(context, this._spaceId, context =>
                this._authorizeReferencedTasksAndCollections(context),
            ),
        ]);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        ServerSessionActionContextModules,
        typeof TaskRealtimeProtocol
    > = {
        subscribeToQuery: async (context, input) => {
            await this._server.authorizeQueryAccess(context, {
                spaceId: this._spaceId,
                filters: input.filters,
                sorts: input.sorts,
            });

            // It's safe to escalate because we authorize the query is valid above.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    const querySubscription = await this._server.subscribeToQuery(context, {
                        spaceId: this._spaceId,
                        filters: input.filters,
                        sorts: input.sorts,
                        callbacks: this._createQuerySubscriptionCallbacks(),
                    });

                    const querySubscriptionId = generateId<TaskRealtimeQuerySubscriptionId>();

                    assert(!this._querySubscriptionById.has(querySubscriptionId));
                    this._querySubscriptionById.set(querySubscriptionId, querySubscription);

                    try {
                        const eventBuilder = new TaskRealtimeUpdateEventBuilder();

                        const {loadedState, tasks} = await querySubscription.loadMoreTasks(
                            context,
                            eventBuilder,
                            input.limit,
                        );

                        await eventBuilder.send(context, this._spaceId);

                        // All the tasks we loaded that weren't backfilled we send in a
                        // `previouslyBackfilledTaskIds` array so the client can add them to its local
                        // query model.
                        const backfillAuthorizedTaskIds = eventBuilder.getBackfillAuthorizedTaskIds(
                            this._sender,
                        );
                        const previouslyBackfilledTaskIds: Array<TaskId> = [];

                        for (const task of tasks) {
                            if (backfillAuthorizedTaskIds.has(task.id)) continue;
                            previouslyBackfilledTaskIds.push(task.id);
                        }

                        return {
                            querySubscriptionId,
                            loadedState,
                            previouslyBackfilledTaskIds,
                        };
                    } catch (error) {
                        // If there's an error, unsubscribe so we don't have a dangling subscription.
                        this._querySubscriptionById.delete(querySubscriptionId);

                        await querySubscription.unsubscribe();

                        throw error;
                    }
                },
            );
        },
        subscribeToQueries: async (context, input) => {
            await wait(2000);
            await runAllPromises(
                input.queries.map(inputQuery =>
                    this._server.authorizeQueryAccess(context, {
                        spaceId: this._spaceId,
                        filters: inputQuery.filters,
                        sorts: inputQuery.sorts,
                    }),
                ),
            );

            // It's safe to escalate because we authorize the query is valid above.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    const eventBuilder = new TaskRealtimeUpdateEventBuilder();

                    const querySubscriptions = await runAllPromises(
                        input.queries.map(async inputQuery => {
                            const querySubscription = await this._server.subscribeToQuery(context, {
                                spaceId: this._spaceId,
                                filters: inputQuery.filters,
                                sorts: inputQuery.sorts,
                                callbacks: this._createQuerySubscriptionCallbacks(),
                            });

                            const querySubscriptionId =
                                generateId<TaskRealtimeQuerySubscriptionId>();

                            assert(!this._querySubscriptionById.has(querySubscriptionId));
                            this._querySubscriptionById.set(querySubscriptionId, querySubscription);

                            try {
                                const {loadedState, tasks} = await querySubscription.loadMoreTasks(
                                    context,
                                    eventBuilder,
                                    inputQuery.limit,
                                );

                                return {
                                    querySubscription,
                                    querySubscriptionId,
                                    loadedState,
                                    tasks,
                                };
                            } catch (error) {
                                // If there's an error, unsubscribe so we don't have a dangling subscription.
                                this._querySubscriptionById.delete(querySubscriptionId);

                                await querySubscription.unsubscribe();

                                throw error;
                            }
                        }),
                    );

                    try {
                        // Send the combined event to our clients...
                        await eventBuilder.send(context, this._spaceId);

                        return {
                            queries: querySubscriptions.map(
                                ({querySubscriptionId, loadedState, tasks}) => {
                                    // All the tasks we loaded that weren't backfilled we send in a
                                    // `previouslyBackfilledTaskIds` array so the client can add them to its local
                                    // query model.
                                    const backfillAuthorizedTaskIds =
                                        eventBuilder.getBackfillAuthorizedTaskIds(this._sender);
                                    const previouslyBackfilledTaskIds: Array<TaskId> = [];

                                    for (const task of tasks) {
                                        if (backfillAuthorizedTaskIds.has(task.id)) continue;
                                        previouslyBackfilledTaskIds.push(task.id);
                                    }

                                    return {
                                        querySubscriptionId,
                                        loadedState,
                                        previouslyBackfilledTaskIds,
                                    };
                                },
                            ),
                        };
                    } catch (error) {
                        await runAllPromises(
                            querySubscriptions.map(
                                async ({querySubscription, querySubscriptionId}) => {
                                    // If there's an error, unsubscribe so we don't have a dangling subscription.
                                    this._querySubscriptionById.delete(querySubscriptionId);

                                    await querySubscription.unsubscribe();
                                },
                            ),
                        );

                        throw error;
                    }
                },
            );
        },
        unsubscribeFromQuery: async (context, {querySubscriptionId}) => {
            const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            this._querySubscriptionById.delete(querySubscriptionId);

            await querySubscription.unsubscribe();

            return {};
        },
        unsubscribeFromQueries: async (context, {querySubscriptionIds}) => {
            await runAllPromises(
                querySubscriptionIds.map(async querySubscriptionId => {
                    const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
                    if (!querySubscription) throw new NotFoundError("Query subscription not found");

                    this._querySubscriptionById.delete(querySubscriptionId);

                    await querySubscription.unsubscribe();
                }),
            );

            return {};
        },
        loadMoreQueryTasks: (context, {querySubscriptionId, limit}) => {
            const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            // It's safe to escalate because in order to create a subscription we authorize
            // the query and we continually reauthorize the subscription through the
            // connection's `authorize()` method which is called every three minutes.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    const eventBuilder = new TaskRealtimeUpdateEventBuilder();

                    const {loadedState, tasks} = await querySubscription.loadMoreTasks(
                        context,
                        eventBuilder,
                        limit,
                    );

                    await eventBuilder.send(context, this._spaceId);

                    // All the tasks we loaded that weren't backfilled we send in a
                    // `previouslyBackfilledTaskIds` array so the client can add them to its local
                    // query model.
                    const backfillAuthorizedTaskIds = eventBuilder.getBackfillAuthorizedTaskIds(
                        this._sender,
                    );
                    const previouslyBackfilledTaskIds: Array<TaskId> = [];

                    for (const task of tasks) {
                        if (backfillAuthorizedTaskIds.has(task.id)) continue;
                        previouslyBackfilledTaskIds.push(task.id);
                    }

                    return {loadedState, previouslyBackfilledTaskIds};
                },
            );
        },
    };

    public readonly _sender: TaskRealtimeUpdateEventSender = {
        // Before we actually send an update event to the client we need to clean up
        // our actions and tasks, removing any last private data. We also need to load
        // the `AccountModel`s for any referenced accounts so we can render them on the
        // client.
        //
        // Finally, once all that is done we can send the event to the client!
        send: async (context, event) => {
            const actions = filterMapArray(event.actions, action =>
                prepareTaskActionForClient(this._accountId, action),
            );

            const backfillAuthorizedTasks = event.backfillAuthorizedTasks.map(task =>
                prepareTaskForClient(this._accountId, task),
            );
            const backfillUnauthorizedTaskIds = event.backfillUnauthorizedTaskIds;

            const backfillAuthorizedCollections = event.backfillAuthorizedCollections.map(
                collection => prepareTaskCollectionForClient(collection),
            );
            const backfillUnauthorizedCollectionIds = event.backfillUnauthorizedCollectionIds;

            const accountIds = new Set<AccountId>();

            for (const task of backfillAuthorizedTasks) {
                collectReferencedAccountIdsFromTaskModelData(accountIds, task.rawData);
            }

            for (const action of actions) {
                collectReferencedAccountIdsFromTaskAction(accountIds, action);
            }

            const referencedAccounts = await runAllPromises(
                Array.from(accountIds, accountId => getAccount(context, this._spaceId, accountId)),
            );

            this._sendEvent(context, {
                type: "Update",
                number: event.number,
                actions,
                backfillAuthorizedTasks,
                backfillUnauthorizedTaskIds,
                backfillAuthorizedCollections,
                backfillUnauthorizedCollectionIds,
                referencedAccounts,
            });
        },
    };

    /**
     * All tasks loaded by a query in our connection with a reference count
     * specifying how many subscriptions have loaded the task. The reference count
     * is always a non-zero positive integer. If a task is in this map that implies
     * it has a non-zero positive reference count.
     */
    private readonly _loadedTaskReferenceCountById = new Map<TaskId, number>();

    private readonly _referencedTaskStateById = new Map<
        TaskId,
        {
            referenceCount: number;
            task: TaskIndexDoc;
            isAccessAuthorizedPromise: Promise<boolean>;
            // We keep track of the previous task object our subscription saw while testing
            // so we can check if we've missed any updates. We run this validation in
            // `development` and `test` since maintaining task update state correctly is a
            // little tricky to get right but critical to the operation of this class.
            previousTaskForTest: TaskIndexDoc | null;
        }
    >();

    private readonly _referencedCollectionStateById = new Map<
        TaskCollectionId,
        {
            referenceCount: number;
            collection: TaskCollectionIndexDoc;
            isAccessAuthorizedPromise: Promise<boolean>;
            // We keep track of the previous collection object our subscription saw while
            // testing so we can check if we've missed any updates. We run this validation
            // in `development` and `test` since maintaining collection update state
            // correctly is a little tricky to get right but critical to the operation of
            // this class.
            previousCollectionForTest: TaskCollectionIndexDoc | null;
        }
    >();

    private _createQuerySubscriptionCallbacks(): TaskRealtimeQuerySubscriptionCallbacks {
        return {
            // If there was an error with our subscription, close the connection. The
            // client can reconnect if necessary.
            onFatalError: (context, error) => {
                this._closeWithError(context, error);
            },
            onLoadedTaskAdd: (context, eventBuilder, newTask) => {
                const loadedTaskReferenceCount = this._loadedTaskReferenceCountById.get(newTask.id);
                const referencedTaskState = this._referencedTaskStateById.get(newTask.id);

                if (loadedTaskReferenceCount !== undefined) {
                    this._loadedTaskReferenceCountById.set(
                        newTask.id,
                        loadedTaskReferenceCount + 1,
                    );
                } else {
                    // This is the first time our connection has seen the task, backfill it.
                    if (referencedTaskState === undefined) {
                        eventBuilder.addAuthorizedTaskBackfill(this._sender, newTask);
                        this._loadedTaskReferenceCountById.set(newTask.id, 1);
                    }
                    // Loaded tasks are always authorized because we authorized the query the task
                    // is in. If the task is referenced but was not loaded then mark the task as
                    // authorized.
                    //
                    // If the task was previously unauthorized then we need to backfill it.
                    else {
                        const promise = referencedTaskState.isAccessAuthorizedPromise.then(
                            isAccessAuthorized => {
                                if (isAccessAuthorized) return isAccessAuthorized;

                                eventBuilder.addAuthorizedTaskBackfill(this._sender, newTask);
                                return true;
                            },
                        );

                        eventBuilder.waitUntil(promise);

                        referencedTaskState.isAccessAuthorizedPromise = promise;
                        this._loadedTaskReferenceCountById.set(newTask.id, 1);
                    }
                }
            },
            onLoadedTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
                // Since the query is authorized, all loaded tasks are also authorized.
                // Clients should see all actions on loaded tasks.
                eventBuilder.addActions(this._sender, actions);
            },
            onLoadedTaskRemove: (eventBuilder, oldTask, actions) => {
                const loadedTaskReferenceCount = this._loadedTaskReferenceCountById.get(oldTask.id);
                assert(loadedTaskReferenceCount !== undefined);

                if (loadedTaskReferenceCount > 1) {
                    this._loadedTaskReferenceCountById.set(
                        oldTask.id,
                        loadedTaskReferenceCount - 1,
                    );
                } else {
                    this._loadedTaskReferenceCountById.delete(oldTask.id);

                    // If a loaded task is removed from our connection that means the client may
                    // have lost authorization access as well. When we reauthorize referenced tasks
                    // we'll check this. Access is maintained until reauthorization.
                }

                // Since the query is authorized, all loaded tasks are also authorized.
                // Clients should see all actions that remove a task from a query. That way the
                // client can apply the actions locally and remove the task from its own local
                // query representation.
                eventBuilder.addActions(this._sender, actions);
            },
            onReferencedTaskAdd: (context, eventBuilder, newTask) => {
                const loadedTaskReferenceCount = this._loadedTaskReferenceCountById.get(newTask.id);
                const referencedTaskState = this._referencedTaskStateById.get(newTask.id);

                if (referencedTaskState !== undefined) {
                    referencedTaskState.referenceCount++;

                    // If this task is already referenced then we should have seen `newTask` before.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedTaskState.task === newTask,
                            "Connection must observe all updates to a referenced task through `onReferencedTaskAdd()`",
                        );
                    }

                    referencedTaskState.task = newTask;
                } else {
                    // If the task is loaded then it is also automatically authorized since the
                    // query the task is in is authorized.
                    if (loadedTaskReferenceCount !== undefined) {
                        this._referencedTaskStateById.set(newTask.id, {
                            referenceCount: 1,
                            task: newTask,
                            isAccessAuthorizedPromise: Promise.resolve(true),
                            previousTaskForTest: null,
                        });
                    } else {
                        const promise = isTaskIndexDocAccessAuthorized(
                            context,
                            this._accountId,
                            newTask,
                            "View",
                            {
                                getTaskIndexDoc: taskId =>
                                    this._server.getTask(context, this._spaceId, taskId),
                                getCollectionIndexDoc: collectionId =>
                                    this._server.getCollection(
                                        context,
                                        this._spaceId,
                                        collectionId,
                                    ),
                            },
                        ).then(isAccessAuthorized => {
                            if (!isAccessAuthorized) {
                                eventBuilder.addUnauthorizedTaskBackfill(this._sender, newTask.id);
                            } else {
                                eventBuilder.addAuthorizedTaskBackfill(this._sender, newTask);
                            }

                            return isAccessAuthorized;
                        });

                        eventBuilder.waitUntil(promise);

                        this._referencedTaskStateById.set(newTask.id, {
                            referenceCount: 1,
                            task: newTask,
                            isAccessAuthorizedPromise: promise,
                            previousTaskForTest: null,
                        });
                    }
                }
            },
            onReferencedTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
                const referencedTaskState = this._referencedTaskStateById.get(newTask.id);
                assert(referencedTaskState !== undefined);

                if (referencedTaskState.task === newTask && oldTask !== newTask) {
                    // If we've already seen this update then our previous task should be `oldTask`.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedTaskState.previousTaskForTest === oldTask,
                            "Connection must observe all updates to a referenced task through `onReferencedTaskUpdate()`",
                        );
                    }
                } else {
                    // If we have not seen this update before then our referenced task object should
                    // be `oldTask`.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedTaskState.task === oldTask,
                            "Connection must observe all updates to a referenced task through `onReferencedTaskUpdate()`",
                        );
                        referencedTaskState.previousTaskForTest = oldTask;
                    }

                    referencedTaskState.task = newTask;
                }

                // Only add update actions for this referenced task if the referenced task
                // is authorized.
                eventBuilder.waitUntil(
                    referencedTaskState.isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) return;
                        eventBuilder.addActions(this._sender, actions);
                    }),
                );
            },
            onReferencedTaskRemove: (eventBuilder, oldTask) => {
                const referencedTaskState = this._referencedTaskStateById.get(oldTask.id);
                assert(referencedTaskState !== undefined);

                // If we are removing a referenced task we should have seen it before and it
                // should be our old task object.
                if (process.env.NODE_ENV !== "production") {
                    assert(
                        referencedTaskState.task === oldTask,
                        "Connection must observe all updates to a referenced task through `onReferencedTaskRemove()`",
                    );
                }

                if (referencedTaskState.referenceCount > 1) {
                    referencedTaskState.referenceCount--;
                } else {
                    this._referencedTaskStateById.delete(oldTask.id);
                }
            },
            onReferencedCollectionAdd: (context, eventBuilder, newCollection) => {
                const referencedCollectionState = this._referencedCollectionStateById.get(
                    newCollection.id,
                );

                if (referencedCollectionState !== undefined) {
                    referencedCollectionState.referenceCount++;

                    // If this task is already referenced then we should have seen `newCollection`
                    // before.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedCollectionState.collection === newCollection,
                            "Connection must observe all updates to a referenced collection through `onReferencedCollectionAdd()`",
                        );
                    }

                    referencedCollectionState.collection = newCollection;
                } else {
                    const promise = isTaskCollectionIndexDocAccessAuthorized(
                        context,
                        this._accountId,
                        newCollection,
                        "View",
                    ).then(isAccessAuthorized => {
                        if (!isAccessAuthorized) {
                            eventBuilder.addUnauthorizedCollectionBackfill(
                                this._sender,
                                newCollection.id,
                            );
                        } else {
                            eventBuilder.addAuthorizedCollectionBackfill(
                                this._sender,
                                newCollection,
                            );
                        }

                        return isAccessAuthorized;
                    });

                    eventBuilder.waitUntil(promise);

                    this._referencedCollectionStateById.set(newCollection.id, {
                        referenceCount: 1,
                        collection: newCollection,
                        isAccessAuthorizedPromise: promise,
                        previousCollectionForTest: null,
                    });
                }
            },
            onReferencedCollectionUpdate: (
                context,
                eventBuilder,
                collectionId,
                oldCollection,
                newCollection,
                actions,
            ) => {
                const referencedCollectionState = this._referencedCollectionStateById.get(
                    newCollection.id,
                );
                assert(referencedCollectionState !== undefined);

                if (referencedCollectionState.collection === newCollection) {
                    // If we've already seen this update then our previous collection should be
                    // `oldCollection`.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedCollectionState.previousCollectionForTest === oldCollection,
                            "Connection must observe all updates to a referenced collection through `onReferencedCollectionUpdate()`",
                        );
                    }
                } else {
                    // If we have not seen this update before then our referenced collection object
                    // should be `oldCollection`.
                    if (process.env.NODE_ENV !== "production") {
                        assert(
                            referencedCollectionState.collection === oldCollection,
                            "Connection must observe all updates to a referenced collection through `onReferencedCollectionUpdate()`",
                        );
                        referencedCollectionState.previousCollectionForTest = oldCollection;
                    }

                    referencedCollectionState.collection = newCollection;
                }

                // Only add update actions for this referenced collection if the referenced
                // collection is authorized.
                eventBuilder.waitUntil(
                    referencedCollectionState.isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) return;
                        eventBuilder.addActions(this._sender, actions);
                    }),
                );
            },
            onReferencedCollectionRemove: (eventBuilder, oldCollection) => {
                const referencedCollectionState = this._referencedCollectionStateById.get(
                    oldCollection.id,
                );
                assert(referencedCollectionState !== undefined);

                // If we are removing a referenced collection we should have seen it before and
                // it should be our old task object.
                if (process.env.NODE_ENV !== "production") {
                    assert(
                        referencedCollectionState.collection === oldCollection,
                        "Connection must observe all updates to a referenced collection through `onReferencedCollectionRemove()`",
                    );
                }

                if (referencedCollectionState.referenceCount > 1) {
                    referencedCollectionState.referenceCount--;
                } else {
                    this._referencedCollectionStateById.delete(oldCollection.id);
                }
            },
        };
    }

    private async _authorizeReferencedTasksAndCollections(
        context: TaskRealtimeSystemActionContext,
    ) {
        const eventBuilder = new TaskRealtimeUpdateEventBuilder();

        // Create a snapshot of `referencedTaskStateById` while we're reauthorizing.
        // Tasks may become unreferenced/referenced while we're authorizing and we
        // don't want that to affect us.
        const reauthorizingReferencedTaskById = Array.from(this._referencedTaskStateById.values());
        const reauthorizingReferencedCollectionById = Array.from(
            this._referencedCollectionStateById.values(),
        );

        await runAllPromises(
            concatIterables(
                mapIterable(reauthorizingReferencedTaskById, async referencedTask => {
                    // It is important we capture a synchronous reference to `task` here at
                    // the start since `task` may update concurrently.
                    const {task} = referencedTask;

                    const newIsAccessAuthorizedPromise = isTaskIndexDocAccessAuthorized(
                        context,
                        this._accountId,
                        task,
                        "View",
                        {
                            getTaskIndexDoc: taskId =>
                                this._server.getTask(context, this._spaceId, taskId),
                            getCollectionIndexDoc: collectionId =>
                                this._server.getCollection(context, this._spaceId, collectionId),
                        },
                    );

                    const oldIsAccessAuthorizedPromise = referencedTask.isAccessAuthorizedPromise;

                    referencedTask.isAccessAuthorizedPromise = newIsAccessAuthorizedPromise;

                    const [oldIsAccessAuthorized, newIsAccessAuthorized] = await runAllPromises([
                        oldIsAccessAuthorizedPromise,
                        newIsAccessAuthorizedPromise,
                    ]);

                    if (oldIsAccessAuthorized !== newIsAccessAuthorized) {
                        if (!newIsAccessAuthorized) {
                            eventBuilder.addUnauthorizedTaskBackfill(this._sender, task.id);
                        } else {
                            eventBuilder.addAuthorizedTaskBackfill(this._sender, task);
                        }
                    }
                }),
                mapIterable(reauthorizingReferencedCollectionById, async referencedCollection => {
                    // It is important we capture a synchronous reference to `collection` here at
                    // the start since `collection` may update concurrently.
                    const {collection} = referencedCollection;

                    const newIsAccessAuthorizedPromise = isTaskCollectionIndexDocAccessAuthorized(
                        context,
                        this._accountId,
                        collection,
                        "View",
                    );

                    const oldAuthorizationStatePromise =
                        referencedCollection.isAccessAuthorizedPromise;

                    referencedCollection.isAccessAuthorizedPromise = newIsAccessAuthorizedPromise;

                    const [oldIsAccessAuthorized, newIsAccessAuthorized] = await runAllPromises([
                        oldAuthorizationStatePromise,
                        newIsAccessAuthorizedPromise,
                    ]);

                    if (oldIsAccessAuthorized !== newIsAccessAuthorized) {
                        if (!newIsAccessAuthorized) {
                            eventBuilder.addUnauthorizedCollectionBackfill(
                                this._sender,
                                collection.id,
                            );
                        } else {
                            eventBuilder.addAuthorizedCollectionBackfill(this._sender, collection);
                        }
                    }
                }),
            ),
        );

        // If authorization changed then we'll have a realtime event to send.
        await eventBuilder.send(context, this._spaceId);
    }
}
