import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {TaskSystemActionContext} from "~/server/tasks/data/task_action_context.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    getTaskGridViewExpansionState,
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {getTaskGridViewExpansionStateChildrenQueries} from "~/server/tasks/realtime/get_task_grid_view_expansion_state_children_queries.js";
import {
    TaskRealtimeCollectionSubscription,
    TaskRealtimeCollectionSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_collection_subscription.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {
    TaskRealtimeTaskSubscription,
    TaskRealtimeTaskSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_task_subscription.js";
import {
    TaskRealtimeConnectionUpdateEventBuilder,
    TaskRealtimeUpdateEventBuilderBase,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BrowserId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeCollectionSubscriptionId,
    TaskRealtimeQuerySubscriptionId,
    TaskRealtimeTaskSubscriptionId,
} from "~/shared/id/types/id_types.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskAuthorizationState,
    TaskRealtimeEvent,
    TaskRealtimeProtocol,
    TaskRealtimeQueryLoadedState,
} from "~/shared/tasks/task_realtime_protocol.js";

export const taskRealtimeConnectionAfterSubscribeToQueryTestCheckpoint =
    new TestCheckpoint<SpaceId>();

/**
 * Manages a client's WebSocket connection with `TaskRealtimeService`. A client
 * may be connected to any number of resources (queries, tasks, collections)
 * and it expects to get updates for those resources over time.
 */
export class TaskRealtimeConnection {
    private readonly _server: TaskRealtimeServer;
    public readonly spaceId: SpaceId;
    public readonly accountId: AccountId;

    public readonly clock = new HybridLogicalClock(unsynchronizedSystemClock);

    private readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: TaskSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;
    public readonly sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;
    private readonly _closeWithError: (context: ServerProcessContext, error: unknown) => void;
    private readonly _resetAuthorizationTimer: (context: ServerProcessContext) => void;

    private readonly _querySubscriptionById = new Map<
        TaskRealtimeQuerySubscriptionId,
        TaskRealtimeQuerySubscription
    >();

    private readonly _taskSubscriptionById = new Map<
        TaskRealtimeTaskSubscriptionId,
        TaskRealtimeTaskSubscription
    >();

    private readonly _collectionSubscriptionById = new Map<
        TaskRealtimeCollectionSubscriptionId,
        TaskRealtimeCollectionSubscription
    >();

    constructor({
        server,
        spaceId,
        accountId,
        dangerouslyEscalateToSystemContext,
        sendEvent,
        closeWithError,
        resetAuthorizationTimer,
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
            action: (context: TaskSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;
        closeWithError: (context: ServerProcessContext, error: unknown) => void;
        resetAuthorizationTimer: (context: ServerProcessContext) => void;
    }) {
        this._server = server;
        this.spaceId = spaceId;
        this.accountId = accountId;
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
        this.sendEvent = sendEvent;
        this._closeWithError = closeWithError;
        this._resetAuthorizationTimer = resetAuthorizationTimer;
    }

    public async handleClose(context: ServerProcessContext) {
        await runAllPromises(
            mapIterable(
                concatIterables<{unsubscribe: (context: ServerProcessContext) => Promise<void>}>(
                    this._querySubscriptionById.values(),
                    this._taskSubscriptionById.values(),
                    this._collectionSubscriptionById.values(),
                ),
                subscription => subscription.unsubscribe(context),
            ),
        );
    }

    public async authorize(context: ServerSessionActionContext) {
        const [eventBuilder] = await runAllPromises([
            // 1. Reauthorize the referenced tasks within a query subscription:
            this._dangerouslyEscalateToSystemContext(context, this.spaceId, context =>
                this._authorizeReferencedTasksAndCollections(context),
            ),

            // 2. Authorize that we still have access to the space:
            authorizeSpaceAccess(context, this.spaceId),

            // 3. Authorize that we still have access to each query subscription:
            runAllPromises(
                Array.from(this._querySubscriptionById.values(), querySubscription =>
                    this._server.authorizeQueryAccess(context, {
                        spaceId: this.spaceId,
                        filters: querySubscription.getFilters(),
                        sorts: querySubscription.getSorts(),
                    }),
                ),
            ),

            // 4. Authorize that we still have access to each task subscription:
            runAllPromises(
                Array.from(this._taskSubscriptionById.values(), taskSubscription =>
                    this._server.authorizeTaskAccess(
                        context,
                        this.spaceId,
                        taskSubscription.getTaskId(),
                        "View",
                    ),
                ),
            ),

            // 5. Authorize that we still have access to each collection subscription:
            runAllPromises(
                Array.from(this._collectionSubscriptionById.values(), collectionSubscription =>
                    this._server.authorizeCollectionAccess(
                        context,
                        this.spaceId,
                        collectionSubscription.getCollectionId(),
                        "View",
                    ),
                ),
            ),
        ]);

        // If authorization changed then we'll have a realtime event to send.
        const event = await eventBuilder.finishAndBuildEvent(context);
        if (event !== null) this.sendEvent(context, event);
    }

    private _subscribeToQuery(
        sessionContext: ServerSessionActionContext,
        systemContext: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        input: {
            limit: number;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
        },
    ) {
        return systemContext.tracer.withSpan("Subscribe to task query", (systemContext, span) => {
            sessionContext = sessionContext.clone({tracer: new TracerContextModule(span)});

            return this._actuallySubscribeToQuery(
                sessionContext,
                systemContext,
                eventBuilder,
                input,
            );
        });
    }

    private async _actuallySubscribeToQuery(
        sessionContext: ServerSessionActionContext,
        systemContext: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        {
            limit,
            filters,
            sorts,
            shouldLoadGridViewExpandedChildTasksForBrowserId,
        }: {
            limit: number;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
        },
    ): Promise<{
        querySubscriptionId: TaskRealtimeQuerySubscriptionId;
        loadedState: TaskRealtimeQueryLoadedState;
        getPreviouslyBackfilledTaskIds: () => ReadonlyArray<TaskId>;
        gridViewExpansionState: TaskGridViewExpansionState | null;
        extraQueries: ReadonlyArray<{
            querySubscriptionId: TaskRealtimeQuerySubscriptionId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            loadedState: TaskRealtimeQueryLoadedState;
            getPreviouslyBackfilledTaskIds: () => ReadonlyArray<TaskId>;
        }>;
    }> {
        const gridViewExpansionStatePromise = shouldLoadGridViewExpandedChildTasksForBrowserId
            ? getTaskGridViewExpansionState(sessionContext, {
                  spaceId: this.spaceId,
                  browserId: shouldLoadGridViewExpandedChildTasksForBrowserId,
                  filters,
                  sorts,
              })
            : null;

        const promise = (async () => {
            // Must authorize before using system context.
            await this._server.authorizeQueryAccess(sessionContext, {
                spaceId: this.spaceId,
                filters,
                sorts,
            });

            const querySubscription = await this._server.subscribeToQuery(systemContext, {
                spaceId: this.spaceId,
                filters,
                sorts,
                callbacks: this._subscriptionCallbacks,
            });

            const querySubscriptionId = generateId<TaskRealtimeQuerySubscriptionId>();

            assert(!this._querySubscriptionById.has(querySubscriptionId));
            this._querySubscriptionById.set(querySubscriptionId, querySubscription);

            const childrenQuerySubscriptionById = new Map<
                TaskRealtimeQuerySubscriptionId,
                TaskRealtimeQuerySubscription
            >();

            try {
                const {loadedState, tasks} = await querySubscription.loadMoreTasks(
                    systemContext,
                    eventBuilder,
                    limit,
                );

                const gridViewExpansionState = await gridViewExpansionStatePromise;

                const childrenQueryPromises = getTaskGridViewExpansionStateChildrenQueries(
                    systemContext,
                    {
                        server: this._server,
                        spaceId: this.spaceId,
                        accountId: this.accountId,
                        limit,
                        tasks,
                        gridViewExpansionState,
                        loadQuery: async ({
                            filters: childrenFilters,
                            sorts: childrenSorts,
                            limit: childrenLimit,
                        }) => {
                            await this._server.authorizeQueryAccess(sessionContext, {
                                spaceId: this.spaceId,
                                filters: childrenFilters,
                                sorts: childrenSorts,
                            });

                            const childrenQuerySubscription = await this._server.subscribeToQuery(
                                systemContext,
                                {
                                    spaceId: this.spaceId,
                                    filters: childrenFilters,
                                    sorts: childrenSorts,
                                    callbacks: this._subscriptionCallbacks,
                                },
                            );

                            const childrenQuerySubscriptionId =
                                generateId<TaskRealtimeQuerySubscriptionId>();

                            assert(!this._querySubscriptionById.has(childrenQuerySubscriptionId));
                            this._querySubscriptionById.set(
                                childrenQuerySubscriptionId,
                                childrenQuerySubscription,
                            );

                            // Immediately keep track of the new subscription. If there's an error we want
                            // to unsubscribe.
                            childrenQuerySubscriptionById.set(
                                childrenQuerySubscriptionId,
                                childrenQuerySubscription,
                            );

                            const {loadedState: childrenLoadedState} =
                                await childrenQuerySubscription.loadMoreTasks(
                                    systemContext,
                                    eventBuilder,
                                    childrenLimit,
                                );

                            return {
                                querySubscriptionId: childrenQuerySubscriptionId,
                                filters: childrenFilters,
                                sorts: childrenSorts,
                                limit: childrenLimit,
                                loadedState: childrenLoadedState,
                                // This property can only be computed right before we send our procedure
                                // response which is why it's in a function. Otherwise we may miss
                                // realtime updates.
                                getPreviouslyBackfilledTaskIds: () => {
                                    // All the tasks we loaded that weren't backfilled we send in a
                                    // `previouslyBackfilledTaskIds` array so the client can add them to its local
                                    // query model.
                                    const backfillAuthorizedTaskIds =
                                        eventBuilder.getBackfillAuthorizedTaskIds(this);
                                    const previouslyBackfilledTaskIds: Array<TaskId> = [];

                                    for (const task of childrenQuerySubscription.getLoadedTasks()
                                        .tasks) {
                                        if (backfillAuthorizedTaskIds.has(task.id)) continue;
                                        previouslyBackfilledTaskIds.push(task.id);
                                    }

                                    return previouslyBackfilledTaskIds;
                                },
                            };
                        },
                    },
                );

                const extraQueries = await runAllPromises(childrenQueryPromises);

                await taskRealtimeConnectionAfterSubscribeToQueryTestCheckpoint.waitForTest(
                    this.spaceId,
                );

                return {
                    querySubscriptionId,
                    loadedState,
                    // This property can only be computed after `eventBuilder.send()` which is why
                    // it's in a function.
                    getPreviouslyBackfilledTaskIds: () => {
                        // All the tasks we loaded that weren't backfilled we send in a
                        // `previouslyBackfilledTaskIds` array so the client can add them to its local
                        // query model.
                        const backfillAuthorizedTaskIds =
                            eventBuilder.getBackfillAuthorizedTaskIds(this);
                        const previouslyBackfilledTaskIds: Array<TaskId> = [];

                        for (const task of tasks) {
                            if (backfillAuthorizedTaskIds.has(task.id)) continue;
                            previouslyBackfilledTaskIds.push(task.id);
                        }

                        return previouslyBackfilledTaskIds;
                    },
                    gridViewExpansionState,
                    extraQueries: extraQueries.filter(isNonNullable),
                };
            } catch (error) {
                // If we erred before we could return our subscription IDs to the client then
                // we need to unsubscribe from all our subscriptions here so we don't have a
                // memory leak.
                await runAllPromises(
                    mapIterable(
                        concatIterables(
                            [[querySubscriptionId, querySubscription] as const],
                            childrenQuerySubscriptionById,
                        ),
                        async ([querySubscriptionId, querySubscription]) => {
                            this._querySubscriptionById.delete(querySubscriptionId);
                            await querySubscription.unsubscribe(systemContext);
                        },
                    ),
                );

                throw error;
            }
        })();

        const [, result] = await runAllPromises([gridViewExpansionStatePromise, promise]);

        return result;
    }

    private async _unsubscribeFromQuery(
        context: Context<{process: ProcessContextModule}>,
        querySubscriptionId: TaskRealtimeQuerySubscriptionId,
    ) {
        const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
        if (!querySubscription) throw new NotFoundError("Query subscription not found");

        this._querySubscriptionById.delete(querySubscriptionId);

        await querySubscription.unsubscribe(context);
    }

    private _subscribeToTask(
        sessionContext: ServerSessionActionContext,
        systemContext: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
    ): Promise<{
        taskSubscriptionId: TaskRealtimeTaskSubscriptionId;
    }> {
        return systemContext.tracer.withSpan("Subscribe to task", async (systemContext, span) => {
            sessionContext = sessionContext.clone({tracer: new TracerContextModule(span)});

            // Must authorize before using system context.
            await this._server.authorizeTaskAccess(sessionContext, this.spaceId, taskId, "View");

            const taskSubscription = await this._server.subscribeToTask(
                systemContext,
                eventBuilder,
                {
                    spaceId: this.spaceId,
                    taskId,
                    callbacks: this._subscriptionCallbacks,
                },
            );

            const taskSubscriptionId = generateId<TaskRealtimeTaskSubscriptionId>();

            assert(!this._taskSubscriptionById.has(taskSubscriptionId));
            this._taskSubscriptionById.set(taskSubscriptionId, taskSubscription);

            return {
                taskSubscriptionId,
            };
        });
    }

    private async _unsubscribeFromTask(
        context: Context<{process: ProcessContextModule}>,
        taskSubscriptionId: TaskRealtimeTaskSubscriptionId,
    ) {
        const taskSubscription = this._taskSubscriptionById.get(taskSubscriptionId);
        if (!taskSubscription) throw new NotFoundError("Task subscription not found");

        this._taskSubscriptionById.delete(taskSubscriptionId);

        await taskSubscription.unsubscribe(context);
    }

    private _subscribeToCollection(
        sessionContext: ServerSessionActionContext,
        systemContext: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionId: TaskCollectionId,
    ): Promise<{
        collectionSubscriptionId: TaskRealtimeCollectionSubscriptionId;
    }> {
        return systemContext.tracer.withSpan(
            "Subscribe to task collection",
            async (systemContext, span) => {
                sessionContext = sessionContext.clone({tracer: new TracerContextModule(span)});

                // Must authorize before using system context.
                await this._server.authorizeCollectionAccess(
                    sessionContext,
                    this.spaceId,
                    collectionId,
                    "View",
                );

                const collectionSubscription = await this._server.subscribeToCollection(
                    systemContext,
                    eventBuilder,
                    {
                        spaceId: this.spaceId,
                        collectionId,
                        callbacks: this._subscriptionCallbacks,
                    },
                );

                const collectionSubscriptionId = generateId<TaskRealtimeCollectionSubscriptionId>();

                assert(!this._collectionSubscriptionById.has(collectionSubscriptionId));
                this._collectionSubscriptionById.set(
                    collectionSubscriptionId,
                    collectionSubscription,
                );

                return {
                    collectionSubscriptionId,
                };
            },
        );
    }

    private async _unsubscribeFromCollection(
        collectionSubscriptionId: TaskRealtimeCollectionSubscriptionId,
    ) {
        const collectionSubscription =
            this._collectionSubscriptionById.get(collectionSubscriptionId);
        if (!collectionSubscription) throw new NotFoundError("Collection subscription not found");

        this._collectionSubscriptionById.delete(collectionSubscriptionId);

        await collectionSubscription.unsubscribe();
    }

    public readonly procedures: WebSocketConnectionProcedures<
        ServerSessionActionContextModules,
        typeof TaskRealtimeProtocol
    > = {
        subscribeToQuery: (sessionContext, input) => {
            return this._dangerouslyEscalateToSystemContext(
                sessionContext,
                this.spaceId,
                async systemContext => {
                    // Make sure our clock is ahead of the client's clock.
                    this.clock.tick(input.clientTime);

                    const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

                    const {
                        querySubscriptionId,
                        loadedState,
                        getPreviouslyBackfilledTaskIds,
                        gridViewExpansionState,
                        extraQueries,
                    } = await this._subscribeToQuery(
                        sessionContext,
                        systemContext,
                        eventBuilder,
                        input,
                    );

                    try {
                        const updateEvent = await eventBuilder.finishAndBuildEvent(systemContext);

                        return {
                            querySubscriptionId,
                            loadedState,
                            previouslyBackfilledTaskIds: getPreviouslyBackfilledTaskIds(),
                            gridViewExpansionState,
                            extraQueries: extraQueries.map(
                                ({getPreviouslyBackfilledTaskIds, ...extraQuery}) => ({
                                    ...extraQuery,
                                    previouslyBackfilledTaskIds: getPreviouslyBackfilledTaskIds(),
                                }),
                            ),
                            updateEvent,
                        };
                    } catch (error) {
                        await this._unsubscribeFromQuery(systemContext, querySubscriptionId);
                        throw error;
                    }
                },
            );
        },
        unsubscribeFromQuery: async (context, {querySubscriptionId}) => {
            await this._unsubscribeFromQuery(context, querySubscriptionId);
            return {};
        },
        loadMoreQueryTasks: (context, input) => {
            // Make sure our clock is ahead of the client's clock.
            this.clock.tick(input.clientTime);

            const querySubscription = this._querySubscriptionById.get(input.querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            // It's safe to escalate because in order to create a subscription we authorize
            // the query and we continually reauthorize the subscription through the
            // connection's `authorize()` method which is called every three minutes.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this.spaceId,
                async context => {
                    const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

                    const {loadedState, tasks} = await querySubscription.loadMoreTasks(
                        context,
                        eventBuilder,
                        input.limit,
                    );

                    const updateEvent = await eventBuilder.finishAndBuildEvent(context);

                    // All the tasks we loaded that weren't backfilled we send in a
                    // `previouslyBackfilledTaskIds` array so the client can add them to its local
                    // query model.
                    const backfillAuthorizedTaskIds =
                        eventBuilder.getBackfillAuthorizedTaskIds(this);
                    const previouslyBackfilledTaskIds: Array<TaskId> = [];

                    for (const task of tasks) {
                        if (backfillAuthorizedTaskIds.has(task.id)) continue;
                        previouslyBackfilledTaskIds.push(task.id);
                    }

                    return {
                        loadedState,
                        previouslyBackfilledTaskIds,
                        updateEvent,
                    };
                },
            );
        },
        subscribeToTask: (sessionContext, input) => {
            return this._dangerouslyEscalateToSystemContext(
                sessionContext,
                this.spaceId,
                async systemContext => {
                    // Make sure our clock is ahead of the client's clock.
                    this.clock.tick(input.clientTime);

                    const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

                    const {taskSubscriptionId} = await this._subscribeToTask(
                        sessionContext,
                        systemContext,
                        eventBuilder,
                        input.taskId,
                    );

                    try {
                        const updateEvent = await eventBuilder.finishAndBuildEvent(systemContext);

                        return {
                            taskSubscriptionId,
                            updateEvent,
                        };
                    } catch (error) {
                        await this._unsubscribeFromTask(systemContext, taskSubscriptionId);
                        throw error;
                    }
                },
            );
        },
        unsubscribeFromTask: async (context, {taskSubscriptionId}) => {
            await this._unsubscribeFromTask(context, taskSubscriptionId);
            return {};
        },
        subscribeToCollection: (sessionContext, input) => {
            return this._dangerouslyEscalateToSystemContext(
                sessionContext,
                this.spaceId,
                async systemContext => {
                    // Make sure our clock is ahead of the client's clock.
                    this.clock.tick(input.clientTime);

                    const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

                    const {collectionSubscriptionId} = await this._subscribeToCollection(
                        sessionContext,
                        systemContext,
                        eventBuilder,
                        input.collectionId,
                    );

                    try {
                        const updateEvent = await eventBuilder.finishAndBuildEvent(systemContext);

                        return {
                            collectionSubscriptionId,
                            updateEvent,
                        };
                    } catch (error) {
                        await this._unsubscribeFromCollection(collectionSubscriptionId);
                        throw error;
                    }
                },
            );
        },
        unsubscribeFromCollection: async (context, {collectionSubscriptionId}) => {
            await this._unsubscribeFromCollection(collectionSubscriptionId);
            return {};
        },
        subscribe: (sessionContext, input) => {
            return this._dangerouslyEscalateToSystemContext(
                sessionContext,
                this.spaceId,
                async systemContext => {
                    // Make sure our clock is ahead of the client's clock.
                    this.clock.tick(input.clientTime);

                    const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

                    const [
                        querySubscriptionResults,
                        taskSubscriptionResults,
                        collectionSubscriptionResults,
                    ] = await runAllPromises([
                        Promise.allSettled(
                            input.queries.map(input =>
                                this._subscribeToQuery(
                                    sessionContext,
                                    systemContext,
                                    eventBuilder,
                                    input,
                                ),
                            ),
                        ),
                        Promise.allSettled(
                            input.taskIds.map(taskId =>
                                this._subscribeToTask(
                                    sessionContext,
                                    systemContext,
                                    eventBuilder,
                                    taskId,
                                ),
                            ),
                        ),
                        Promise.allSettled(
                            input.collectionIds.map(collectionId =>
                                this._subscribeToCollection(
                                    sessionContext,
                                    systemContext,
                                    eventBuilder,
                                    collectionId,
                                ),
                            ),
                        ),
                    ]);

                    try {
                        // Send the combined event to our clients...
                        const updateEvent = await eventBuilder.finishAndBuildEvent(systemContext);

                        return {
                            querySubscriptionResults: querySubscriptionResults.map(result => {
                                if (result.status === "rejected") {
                                    return {ok: false, error: result.reason};
                                } else {
                                    return {
                                        ok: true,
                                        querySubscriptionId: result.value.querySubscriptionId,
                                        loadedState: result.value.loadedState,
                                        previouslyBackfilledTaskIds:
                                            result.value.getPreviouslyBackfilledTaskIds(),
                                        gridViewExpansionState: result.value.gridViewExpansionState,
                                        extraQueries: result.value.extraQueries.map(
                                            ({getPreviouslyBackfilledTaskIds, ...extraQuery}) => ({
                                                ...extraQuery,
                                                previouslyBackfilledTaskIds:
                                                    getPreviouslyBackfilledTaskIds(),
                                            }),
                                        ),
                                    };
                                }
                            }),
                            taskSubscriptionResults: taskSubscriptionResults.map(result => {
                                if (result.status === "rejected") {
                                    return {ok: false, error: result.reason};
                                } else {
                                    return {
                                        ok: true,
                                        taskSubscriptionId: result.value.taskSubscriptionId,
                                    };
                                }
                            }),
                            collectionSubscriptionResults: collectionSubscriptionResults.map(
                                result => {
                                    if (result.status === "rejected") {
                                        return {
                                            ok: false,
                                            error: result.reason,
                                        };
                                    } else {
                                        return {
                                            ok: true,
                                            collectionSubscriptionId:
                                                result.value.collectionSubscriptionId,
                                        };
                                    }
                                },
                            ),
                            updateEvent,
                        };
                    } catch (error) {
                        // If we failed to send our subscription ids to the client, then
                        // unsubscribe from all our queries so we don't have a memory leak.
                        await runAllPromises([
                            runAllPromises(
                                querySubscriptionResults.map(async queryResult => {
                                    if (queryResult.status === "fulfilled") {
                                        await runAllPromises(
                                            mapIterable(
                                                concatIterables(
                                                    [queryResult.value.querySubscriptionId],
                                                    queryResult.value.extraQueries.map(
                                                        extraQuery =>
                                                            extraQuery.querySubscriptionId,
                                                    ),
                                                ),
                                                querySubscriptionId =>
                                                    this._unsubscribeFromQuery(
                                                        systemContext,
                                                        querySubscriptionId,
                                                    ),
                                            ),
                                        );
                                    }
                                }),
                            ),
                            runAllPromises(
                                taskSubscriptionResults.map(async taskSubscriptionResult => {
                                    if (taskSubscriptionResult.status === "fulfilled") {
                                        await this._unsubscribeFromTask(
                                            systemContext,
                                            taskSubscriptionResult.value.taskSubscriptionId,
                                        );
                                    }
                                }),
                            ),
                            runAllPromises(
                                collectionSubscriptionResults.map(
                                    async collectionSubscriptionResult => {
                                        if (collectionSubscriptionResult.status === "fulfilled") {
                                            await this._unsubscribeFromCollection(
                                                collectionSubscriptionResult.value
                                                    .collectionSubscriptionId,
                                            );
                                        }
                                    },
                                ),
                            ),
                        ]);

                        throw error;
                    }
                },
            );
        },
        unsubscribe: async (
            context,
            {querySubscriptionIds, taskSubscriptionIds, collectionSubscriptionIds},
        ) => {
            await runAllPromises(
                concatIterables(
                    querySubscriptionIds.map(querySubscriptionId =>
                        this._unsubscribeFromQuery(context, querySubscriptionId),
                    ),
                    taskSubscriptionIds.map(taskSubscriptionId =>
                        this._unsubscribeFromTask(context, taskSubscriptionId),
                    ),
                    collectionSubscriptionIds.map(collectionSubscriptionId =>
                        this._unsubscribeFromCollection(collectionSubscriptionId),
                    ),
                ),
            );

            return {};
        },
    };

    /**
     * All tasks loaded by a query subscription or a task subscription in our
     * connection. If a task is loaded by a query or task subscription then it is
     * considered authorized.
     *
     * Also has a reference count for the number of query subscriptions or task
     * subscriptions reference this task. The reference count is always a non-zero
     * positive integer. If a task is in this map that implies it has a non-zero
     * positive reference count.
     */
    private readonly _directlySubscribedTaskById = new Map<
        TaskId,
        {referenceCount: number; authorizationStateVersion: HybridLogicalTime}
    >();

    /**
     * All collections loaded by a collection subscription in our connection. If a
     * task is directly loaded by a collection subscription then it is considered
     * authorized.
     *
     * Also has a reference count for the number of collection subscriptions
     * reference this task. The reference count is always a non-zero positive
     * integer. If a task is in this map that implies it has a non-zero positive
     * reference count.
     */
    private readonly _directlySubscribedCollectionById = new Map<
        TaskCollectionId,
        {referenceCount: number; authorizationStateVersion: HybridLogicalTime}
    >();

    private readonly _referencedTaskStateById = new Map<
        TaskId,
        {
            referenceCount: number;
            task: TaskIndexDoc;
            authorizationStateVersion: HybridLogicalTime;
            authorizationStatePromise: Promise<TaskAuthorizationState>;
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
            authorizationStateVersion: HybridLogicalTime;
            authorizationStatePromise: Promise<TaskAuthorizationState>;
            // We keep track of the previous collection object our subscription saw while
            // testing so we can check if we've missed any updates. We run this validation
            // in `development` and `test` since maintaining collection update state
            // correctly is a little tricky to get right but critical to the operation of
            // this class.
            previousCollectionForTest: TaskCollectionIndexDoc | null;
        }
    >();

    private _onDirectlySubscribedTaskAdd(
        context: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ) {
        const directlySubscribedTask = this._directlySubscribedTaskById.get(newTask.id);
        const referencedTaskState = this._referencedTaskStateById.get(newTask.id);

        if (directlySubscribedTask !== undefined) {
            directlySubscribedTask.referenceCount++;
        } else {
            // This is the first time our connection has seen the task, backfill it.
            if (referencedTaskState === undefined) {
                const authorizationStateVersion =
                    eventBuilder.getDefaultAuthorizationStateVersion(this);

                eventBuilder.addAuthorizedTaskBackfill(this, newTask, authorizationStateVersion);

                this._directlySubscribedTaskById.set(newTask.id, {
                    referenceCount: 1,
                    authorizationStateVersion,
                });
            }
            // Query subscription and task subscription tasks are always authorized because
            // we authorized the subscription. If the task is referenced but was not
            // directly subscribed then mark the task as authorized.
            //
            // If the task was previously unauthorized then we need to backfill it.
            else {
                const authorizationStateVersion = eventBuilder.tickAuthorizationStateVersion(
                    this,
                    referencedTaskState.authorizationStateVersion,
                );

                // While we know the task is definitely authorized at this point, we may not
                // know the task's previous authorization state. Only backfill the task if it
                // was previously unauthorized.
                const promise = referencedTaskState.authorizationStatePromise.then(
                    authorizationState => {
                        // If the task continues to be authorized, we don't send the new
                        // `authorizationStateVersion` to the client. This should be fine since future
                        // authorization state versions will be after `authorizationStateVersion`
                        // because our clock was ticked past `authorizationStateVersion`.
                        if (authorizationState === "Authorized") return authorizationState;

                        eventBuilder.addAuthorizedTaskBackfill(
                            this,
                            newTask,
                            authorizationStateVersion,
                        );
                        return "Authorized";
                    },
                );

                eventBuilder.waitUntil(context, promise);

                referencedTaskState.authorizationStateVersion = authorizationStateVersion;
                referencedTaskState.authorizationStatePromise = promise;

                this._directlySubscribedTaskById.set(newTask.id, {
                    referenceCount: 1,
                    authorizationStateVersion,
                });
            }
        }
    }

    private _onDirectlySubscribedTaskRemove(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
    ) {
        const directlySubscribedTask = this._directlySubscribedTaskById.get(oldTask.id);
        assert(directlySubscribedTask !== undefined);

        if (directlySubscribedTask.referenceCount > 1) {
            directlySubscribedTask.referenceCount--;
        } else {
            this._directlySubscribedTaskById.delete(oldTask.id);

            // If a loaded task is removed from our connection that means the client may
            // have lost authorization access as well. When we reauthorize referenced tasks
            // we'll check this. Access is maintained until reauthorization.
        }
    }

    private _onDirectlySubscribedCollectionAdd(
        context: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newCollection: TaskCollectionIndexDoc,
    ) {
        const directlySubscribedCollection = this._directlySubscribedCollectionById.get(
            newCollection.id,
        );
        const referencedCollectionState = this._referencedCollectionStateById.get(newCollection.id);

        if (directlySubscribedCollection !== undefined) {
            directlySubscribedCollection.referenceCount++;
        } else {
            // This is the first time our connection has seen the collection, backfill it.
            if (referencedCollectionState === undefined) {
                const authorizationStateVersion =
                    eventBuilder.getDefaultAuthorizationStateVersion(this);

                eventBuilder.addAuthorizedCollectionBackfill(
                    this,
                    newCollection,
                    authorizationStateVersion,
                );

                this._directlySubscribedCollectionById.set(newCollection.id, {
                    referenceCount: 1,
                    authorizationStateVersion,
                });
            }
            // Collections from subscriptions are always authorized because we authorized
            // the subscription. If the collection is referenced but was not directly
            // subscribed then mark the collection as authorized.
            //
            // If the collection was previously unauthorized then we need to backfill it.
            else {
                const authorizationStateVersion = eventBuilder.tickAuthorizationStateVersion(
                    this,
                    referencedCollectionState.authorizationStateVersion,
                );

                // While we know the collection is definitely authorized at this point, we may
                // not know the collection's previous authorization state. Only backfill the
                // collection if it was previously unauthorized.
                const promise = referencedCollectionState.authorizationStatePromise.then(
                    authorizationState => {
                        // If the collection continues to be authorized, we don't send the new
                        // `authorizationStateVersion` to the client. This should be fine since future
                        // authorization state versions will be after `authorizationStateVersion`
                        // because our clock was ticked past `authorizationStateVersion`.
                        if (authorizationState === "Authorized") return authorizationState;

                        eventBuilder.addAuthorizedCollectionBackfill(
                            this,
                            newCollection,
                            authorizationStateVersion,
                        );
                        return "Authorized";
                    },
                );

                eventBuilder.waitUntil(context, promise);

                referencedCollectionState.authorizationStateVersion = authorizationStateVersion;
                referencedCollectionState.authorizationStatePromise = promise;

                this._directlySubscribedCollectionById.set(newCollection.id, {
                    referenceCount: 1,
                    authorizationStateVersion,
                });
            }
        }
    }

    private _onDirectlySubscribedCollectionRemove(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldCollection: TaskCollectionIndexDoc,
    ) {
        const directlySubscribedCollection = this._directlySubscribedCollectionById.get(
            oldCollection.id,
        );
        assert(directlySubscribedCollection !== undefined);

        if (directlySubscribedCollection.referenceCount > 1) {
            directlySubscribedCollection.referenceCount--;
        } else {
            this._directlySubscribedCollectionById.delete(oldCollection.id);

            // If a loaded collection is removed from our connection that means the client
            // may have lost authorization access as well. When we reauthorize referenced
            // collections we'll check this. Access is maintained until reauthorization.
        }
    }

    private readonly _subscriptionCallbacks: TaskRealtimeQuerySubscriptionCallbacks &
        TaskRealtimeTaskSubscriptionCallbacks &
        TaskRealtimeCollectionSubscriptionCallbacks = {
        // If there was an error with our subscription, close the connection. The
        // client can reconnect if necessary.
        onFatalError: (context, error) => {
            this._closeWithError(context, error);
        },
        onTaskSubscribe: (context, eventBuilder, newTask) => {
            this._onDirectlySubscribedTaskAdd(context, eventBuilder, newTask);
        },
        onTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
            // Task subscriptions are authorized when executed and periodically
            // reauthorized so its safe to send the actions for this task to the client.
            eventBuilder.addActions(this, actions);
        },
        onTaskUnsubscribe: (eventBuilder, oldTask) => {
            this._onDirectlySubscribedTaskRemove(eventBuilder, oldTask);
        },
        onCollectionSubscribe: (context, eventBuilder, newCollection) => {
            this._onDirectlySubscribedCollectionAdd(context, eventBuilder, newCollection);
        },
        onCollectionUpdate: (
            context,
            eventBuilder,
            collectionId,
            oldCollection,
            newCollection,
            actions,
        ) => {
            // Collection subscriptions are authorized when executed and periodically
            // reauthorized so its safe to send the actions for this collection to the
            // client.
            eventBuilder.addActions(this, actions);
        },
        onCollectionUnsubscribe: (eventBuilder, oldCollection) => {
            this._onDirectlySubscribedCollectionRemove(eventBuilder, oldCollection);
        },
        onLoadedTaskAdd: (context, eventBuilder, newTask) => {
            this._onDirectlySubscribedTaskAdd(context, eventBuilder, newTask);
        },
        onLoadedTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
            // Since the query is authorized, all loaded tasks are also authorized.
            // Clients should see all actions on loaded tasks.
            eventBuilder.addActions(this, actions);
        },
        onLoadedTaskRemove: (eventBuilder, oldTask, actions) => {
            this._onDirectlySubscribedTaskRemove(eventBuilder, oldTask);

            // Since the query is authorized, all loaded tasks are also authorized.
            // Clients should see all actions that remove a task from a query. That way the
            // client can apply the actions locally and remove the task from its own local
            // query representation.
            eventBuilder.addActions(this, actions);
        },
        onReferencedTaskAdd: (context, eventBuilder, newTask) => {
            const directlySubscribedTask = this._directlySubscribedTaskById.get(newTask.id);
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
                // If the task is directly subscribed then it is also automatically authorized
                // since the subscription the task is in is authorized.
                if (directlySubscribedTask !== undefined) {
                    this._referencedTaskStateById.set(newTask.id, {
                        referenceCount: 1,
                        task: newTask,
                        authorizationStateVersion: directlySubscribedTask.authorizationStateVersion,
                        authorizationStatePromise: Promise.resolve("Authorized"),
                        previousTaskForTest: null,
                    });
                } else {
                    const authorizationStateVersion =
                        eventBuilder.getDefaultAuthorizationStateVersion(this);

                    const promise = isTaskIndexDocAccessAuthorized(
                        context,
                        this.accountId,
                        newTask,
                        "View",
                        {
                            getTaskIndexDoc: taskId =>
                                this._server.getTask(context, this.spaceId, taskId),
                            getCollectionIndexDoc: collectionId =>
                                this._server.getCollection(context, this.spaceId, collectionId),
                        },
                    ).then(isAuthorized => {
                        if (!isAuthorized) {
                            eventBuilder.addUnauthorizedTaskBackfill(
                                this,
                                newTask.id,
                                authorizationStateVersion,
                            );
                        } else {
                            eventBuilder.addAuthorizedTaskBackfill(
                                this,
                                newTask,
                                authorizationStateVersion,
                            );
                        }

                        return isAuthorized ? "Authorized" : "Unauthorized";
                    });

                    eventBuilder.waitUntil(context, promise);

                    this._referencedTaskStateById.set(newTask.id, {
                        referenceCount: 1,
                        task: newTask,
                        authorizationStateVersion,
                        authorizationStatePromise: promise,
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
                context,
                referencedTaskState.authorizationStatePromise.then(authorizationState => {
                    if (authorizationState !== "Authorized") return;
                    eventBuilder.addActions(this, actions);
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
            const directlySubscribedCollection = this._directlySubscribedCollectionById.get(
                newCollection.id,
            );
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
                // If the collection is directly subscribed then it is also automatically
                // authorized since the subscription the collection is in is authorized.
                if (directlySubscribedCollection !== undefined) {
                    this._referencedCollectionStateById.set(newCollection.id, {
                        referenceCount: 1,
                        collection: newCollection,
                        authorizationStateVersion:
                            directlySubscribedCollection.authorizationStateVersion,
                        authorizationStatePromise: Promise.resolve("Authorized"),
                        previousCollectionForTest: null,
                    });
                } else {
                    const authorizationStateVersion =
                        eventBuilder.getDefaultAuthorizationStateVersion(this);

                    const promise = isTaskCollectionIndexDocAccessAuthorized(
                        context,
                        this.accountId,
                        newCollection,
                        "View",
                    ).then(isAuthorized => {
                        if (!isAuthorized) {
                            eventBuilder.addUnauthorizedCollectionBackfill(
                                this,
                                newCollection.id,
                                authorizationStateVersion,
                            );
                        } else {
                            eventBuilder.addAuthorizedCollectionBackfill(
                                this,
                                newCollection,
                                authorizationStateVersion,
                            );
                        }

                        return isAuthorized ? "Authorized" : "Unauthorized";
                    });

                    eventBuilder.waitUntil(context, promise);

                    this._referencedCollectionStateById.set(newCollection.id, {
                        referenceCount: 1,
                        collection: newCollection,
                        authorizationStateVersion,
                        authorizationStatePromise: promise,
                        previousCollectionForTest: null,
                    });
                }
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
                context,
                referencedCollectionState.authorizationStatePromise.then(authorizationState => {
                    if (authorizationState !== "Authorized") return;
                    eventBuilder.addActions(this, actions);
                }),
            );

            // If the access policy of a referenced collection was updated then immediately
            // re-run authorization. This authorization run will not effect the current
            // event we're building but the authorization process will send an event
            // backfilling data the user now has access to.
            //
            // We don't call `authorize()` directly since we want to reset our
            // authorization timer as well. The next authorization should be in 3 minutes
            // (or whatever the authorization time interval is currently configured as).
            if (
                actions.some(
                    action =>
                        action.type === "UpdateCollection" &&
                        action.collectionAction.type === "UpdateAccessPolicy",
                )
            ) {
                this._resetAuthorizationTimer(context);
            }
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

    private async _authorizeReferencedTasksAndCollections(context: TaskSystemActionContext) {
        const eventBuilder = new TaskRealtimeConnectionUpdateEventBuilder(this);

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

                    // If the task is directly referenced then it's considered authorized. This
                    // should have already been handled when we added/removed the direct reference.
                    if (this._directlySubscribedTaskById.has(task.id)) return;

                    const newAuthorizationStatePromise = isTaskIndexDocAccessAuthorized(
                        context,
                        this.accountId,
                        task,
                        "View",
                        {
                            getTaskIndexDoc: taskId =>
                                this._server.getTask(context, this.spaceId, taskId),
                            getCollectionIndexDoc: collectionId =>
                                this._server.getCollection(context, this.spaceId, collectionId),
                        },
                    ).then(isAuthorized => (isAuthorized ? "Authorized" : "Unauthorized"));

                    const oldAuthorizationStatePromise = referencedTask.authorizationStatePromise;

                    const authorizationStateVersion = eventBuilder.tickAuthorizationStateVersion(
                        this,
                        referencedTask.authorizationStateVersion,
                    );

                    referencedTask.authorizationStateVersion = authorizationStateVersion;
                    referencedTask.authorizationStatePromise = newAuthorizationStatePromise;

                    const [oldAuthorizationState, newAuthorizationState] = await runAllPromises([
                        oldAuthorizationStatePromise,
                        newAuthorizationStatePromise,
                    ]);

                    if (oldAuthorizationState !== newAuthorizationState) {
                        if (newAuthorizationState === "Unauthorized") {
                            eventBuilder.addUnauthorizedTaskBackfill(
                                this,
                                task.id,
                                authorizationStateVersion,
                            );
                        } else {
                            eventBuilder.addAuthorizedTaskBackfill(
                                this,
                                task,
                                authorizationStateVersion,
                            );

                            // If our task is transitioning from unauthorized to authorized then we need to
                            // backfill all references of the task. While we should have backfilled these
                            // tasks and collections before, the client doesn't hold on to them since it
                            // doesn't see a reference on the unauthorized task.
                            //
                            // It is a slight security leak (and mismatch between client/server) that while
                            // the server thinks the reference of an unauthorized task is retained, the
                            // client does not retain the references of unauthorized tasks.
                            const addReferencedTaskBackfills = (task: TaskIndexDoc) => {
                                if (task.parent.taskId.value) {
                                    const referencedTaskState = this._referencedTaskStateById.get(
                                        task.parent.taskId.value,
                                    );
                                    if (referencedTaskState) {
                                        const referencedTask = referencedTaskState.task;

                                        eventBuilder.waitUntil(
                                            context,
                                            referencedTaskState.authorizationStatePromise.then(
                                                authorizationState => {
                                                    if (authorizationState === "Authorized") {
                                                        eventBuilder.addAuthorizedTaskBackfill(
                                                            this,
                                                            referencedTask,
                                                            authorizationStateVersion,
                                                        );
                                                    } else {
                                                        eventBuilder.addUnauthorizedTaskBackfill(
                                                            this,
                                                            referencedTask.id,
                                                            authorizationStateVersion,
                                                        );
                                                    }
                                                },
                                            ),
                                        );

                                        addReferencedTaskBackfills(referencedTask);
                                    }
                                }

                                for (const {
                                    collectionId,
                                } of task.collections.raw.collections.getArray()) {
                                    const referencedCollectionState =
                                        this._referencedCollectionStateById.get(collectionId);
                                    if (referencedCollectionState) {
                                        const referencedCollection =
                                            referencedCollectionState.collection;

                                        eventBuilder.waitUntil(
                                            context,
                                            referencedCollectionState.authorizationStatePromise.then(
                                                authorizationState => {
                                                    if (authorizationState === "Authorized") {
                                                        eventBuilder.addAuthorizedCollectionBackfill(
                                                            this,
                                                            referencedCollection,
                                                            authorizationStateVersion,
                                                        );
                                                    } else {
                                                        eventBuilder.addUnauthorizedCollectionBackfill(
                                                            this,
                                                            referencedCollection.id,
                                                            authorizationStateVersion,
                                                        );
                                                    }
                                                },
                                            ),
                                        );
                                    }
                                }
                            };

                            addReferencedTaskBackfills(task);
                        }
                    }
                }),
                mapIterable(reauthorizingReferencedCollectionById, async referencedCollection => {
                    // It is important we capture a synchronous reference to `collection` here at
                    // the start since `collection` may update concurrently.
                    const {collection} = referencedCollection;

                    // If the collection is directly referenced then it's considered authorized.
                    // This should have already been handled when we added/removed the direct
                    // reference.
                    if (this._directlySubscribedCollectionById.has(collection.id)) return;

                    const newAuthorizationStatePromise = isTaskCollectionIndexDocAccessAuthorized(
                        context,
                        this.accountId,
                        collection,
                        "View",
                    ).then(isAuthorized => (isAuthorized ? "Authorized" : "Unauthorized"));

                    const oldAuthorizationStatePromise =
                        referencedCollection.authorizationStatePromise;

                    const authorizationStateVersion = eventBuilder.tickAuthorizationStateVersion(
                        this,
                        referencedCollection.authorizationStateVersion,
                    );

                    referencedCollection.authorizationStateVersion = authorizationStateVersion;
                    referencedCollection.authorizationStatePromise = newAuthorizationStatePromise;

                    const [oldAuthorizationState, newAuthorizationState] = await runAllPromises([
                        oldAuthorizationStatePromise,
                        newAuthorizationStatePromise,
                    ]);

                    if (oldAuthorizationState !== newAuthorizationState) {
                        if (newAuthorizationState === "Unauthorized") {
                            eventBuilder.addUnauthorizedCollectionBackfill(
                                this,
                                collection.id,
                                authorizationStateVersion,
                            );
                        } else {
                            eventBuilder.addAuthorizedCollectionBackfill(
                                this,
                                collection,
                                authorizationStateVersion,
                            );
                        }
                    }
                }),
            ),
        );

        return eventBuilder;
    }
}
