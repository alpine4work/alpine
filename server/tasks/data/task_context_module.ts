import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
    TaskRealtimeGetCollectionSchema,
    TaskRealtimeGetTaskSchema,
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/server/tasks/router/task_realtime_service_procedure_schemas.js";
import {TaskRealtimeServiceRouterBase} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgentBase} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError, UnimplementedError, UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";
import {TaskAction, getTaskActionLabel} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export abstract class TaskContextModuleBase extends ContextModuleBase<{
    process: ProcessContextModule;
    cache: CacheContextModule;
    tracer: TracerContextModule;
    actor: DynamoActorContextModule;
}> {
    private readonly _dangerouslyEscalateToSystemContext: (
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<void>,
    ) => Promise<void>;

    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<void>,
        ) => Promise<void>;
    }) {
        super();
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
    }

    public abstract processActionTransactionAfterCommit(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
    }): Promise<void>;

    public abstract getTask(
        this: TaskContextModuleBase &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<{
        task: TaskModel;
        referencedTasks: ReadonlyArray<TaskModel>;
        referencedCollections: ReadonlyArray<TaskCollectionModel>;
    }>;

    public abstract getCollection(
        this: TaskContextModuleBase &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
    ): Promise<{
        collection: TaskCollectionModel;
    }>;

    /**
     * Index an action transaction after its been committed. This function must be
     * called at-least-once for every committed action transaction. It is ok to
     * call this function multiple times, though.
     */
    protected _indexActionTransactionAssumingItsCommitted(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
    }): Promise<void> {
        return this._dangerouslyEscalateToSystemContext(
            this._context,
            actionTransaction.spaceId,
            context =>
                context.tracer.withSpan("Index task action transaction", async (context, span) => {
                    span.addData({
                        tasks: {
                            actions: actionTransaction.actions.map(getTaskActionLabel).join(","),
                            actionCount: actionTransaction.actions.length,
                            actionTransactionId: actionTransaction.actionTransactionId,
                        },
                    });

                    try {
                        await indexTaskActionTransactionAssumingItsCommitted(
                            context,
                            actionTransaction.spaceId,
                            actionTransaction.actions,
                        );
                    } catch (error) {
                        // Escalate task indexing errors to `DataLossError` since it means we
                        // failed to index tasks but the user doesn't know.
                        //
                        // It would be very bad for the process to shutdown midway through indexing
                        // such that we don't see this error! We need some backup monitoring/retry
                        // method.
                        throw DataLossError.from(error);
                    }
                }),
        );
    }
}

/**
 * Helps perform work related to tasks that needs to interact with other
 * systems. Notably:
 *
 * - Escalating to system permission level when indexing a task action
 * - Communicating with the task realtime service
 */
export class TaskContextModule extends TaskContextModuleBase {
    private readonly _tokenAgent: TokenAgentBase;
    public readonly router: TaskRealtimeServiceRouterBase;

    constructor({
        tokenAgent,
        router,
        dangerouslyEscalateToSystemContext,
    }: {
        tokenAgent: TokenAgentBase;
        router: TaskRealtimeServiceRouterBase;
        dangerouslyEscalateToSystemContext: (
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<void>,
        ) => Promise<void>;
    }) {
        super({dangerouslyEscalateToSystemContext});
        this._tokenAgent = tokenAgent;
        this.router = router;
    }

    public async processActionTransactionAfterCommit(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
        clientId: TaskRealtimeClientId | null;
    }) {
        await runAllPromises([
            this._indexActionTransactionAssumingItsCommitted(actionTransaction),
            this._applyActionTransactionInRealtimeService(actionTransaction),
        ]);
    }

    /**
     * Apply an action transaction in all the `TaskRealtimeService` servers that
     * provide realtime task data for `SpaceId`. This will send the action to all
     * connected WebSocket clients as well.
     */
    private _applyActionTransactionInRealtimeService(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
        clientId: TaskRealtimeClientId | null;
    }) {
        return this._context.tracer.withSpan(
            "Apply task action transaction",
            async (context, span) => {
                span.addData({
                    tasks: {
                        actions: actionTransaction.actions.map(getTaskActionLabel).join(","),
                        actionCount: actionTransaction.actions.length,
                        actionTransactionId: actionTransaction.actionTransactionId,
                    },
                });

                const [hosts, token] = await runAllPromises([
                    this.router.getHosts(this._context, actionTransaction.spaceId),
                    this._tokenAgent.dangerouslySignShortLivedToken("TaskRealtimeService", {
                        type: "System",
                        spaceId: actionTransaction.spaceId,
                    }),
                ]);

                const requestBody = JSON.stringify(
                    TaskRealtimeApplyActionTransactionInputSchema.serialize({
                        committedTime: actionTransaction.committedTime,
                        actions: actionTransaction.actions,
                        clientId: actionTransaction.clientId,
                    }),
                );

                return runAllPromises(
                    // Apply the action transaction in every host from our router since every host
                    // needs to be kept up-to-date in realtime.
                    //
                    // We apply the action whether or not the host is healthy! The host will be in
                    // an unhealthy state for a couple minutes after it starts up. That way all
                    // processes can discover the host and start sending it action transactions
                    // (through this very call). That way when a host is healthy we know it's
                    // already been receiving all new committed action transactions.
                    hosts.map(async ({host}) => {
                        await retryWithExponentialBackoff(async retry => {
                            try {
                                await fetchWithTracer(
                                    context.tracer.getTracer(),
                                    `http://${host}/${actionTransaction.spaceId}/applyActionTransaction`,
                                    {
                                        spanRoute: `/:spaceId/applyActionTransaction`,
                                        method: "POST",
                                        headers: {
                                            authorization: `bearer ${token}`,
                                            "content-type": "application/json",
                                        },
                                        body: requestBody,
                                    },
                                    async response => {
                                        const body = await response.json();

                                        if (!response.ok) {
                                            if ("error" in body) {
                                                throw ErrorSchema.deserialize(body.error);
                                            } else {
                                                throw new UnknownError(
                                                    "Couldn't apply task action transaction",
                                                );
                                            }
                                        }
                                    },
                                );
                            } catch (error) {
                                // Retry system errors (like `ECONNREFUSED` errors) since the service might be
                                // starting up or may be temporarily unavailable. Non-system errors (like
                                // `PermissionDeniedError` or `InvalidArgumentError`) we don't retry.
                                if (isSystemError(error)) {
                                    retry(error);
                                }

                                throw error;
                            }
                        });
                    }),
                );
            },
        );
    }

    /**
     * Execute some queries.
     *
     * We execute our queries in a running `TaskRealtimeService` instance for the
     * space. Since `TaskRealtimeService` keeps query data up-to-date in realtime
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms
     * up `TaskRealtimeService` so when our client connects via WebSocket the data
     * it needs is already loaded.
     */
    public async loadQueries(
        this: TaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSessionActorContextModule;
            }>,
        spaceId: SpaceId,
        input: SchemaType<typeof TaskRealtimeLoadQueriesInputSchema>,
    ): Promise<SchemaType<typeof TaskRealtimeLoadQueriesOutputSchema>> {
        const [host, token] = await runAllPromises([
            this.router.getStickySessionHost(
                this._context,
                spaceId,
                this._context.actor.getSessionId(),
            ),
            this._tokenAgent.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "Session",
                sessionId: this._context.actor.getSessionId(),
                accountId: this._context.actor.getAccountId(),
            }),
        ]);

        return fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/loadQueries`,
            {
                spanRoute: `/:spaceId/loadQueries`,
                method: "POST",
                headers: {
                    authorization: `bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(TaskRealtimeLoadQueriesInputSchema.serialize(input)),
            },
            async response => {
                const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                    await response.json();

                if (!body.ok) {
                    throw ErrorSchema.deserialize(body.error);
                }

                return TaskRealtimeLoadQueriesOutputSchema.deserialize(body);
            },
        );
    }

    /**
     * Gets a single task its parent tasks and collections (recursively).
     *
     * We need to read the task from `TaskRealtimeService` which keeps query data
     * up-to-date in realtime. (Unlike OpenSearch which is behind by at least 30
     * seconds.) If the task is available in the `TaskRealtimeService` cache it's
     * returned immediately without a network request to the database. Otherwise,
     * the task is loaded from OpenSearch and `TaskRealtimeService` applies its
     * realtime action history window to make sure the task is up-to-date.
     */
    public async getTask(
        this: TaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<{
        task: TaskModel;
        referencedTasks: ReadonlyArray<TaskModel>;
        referencedCollections: ReadonlyArray<TaskCollectionModel>;
    }> {
        const [host, token] = await runAllPromises([
            // NOTE(calebmer, 2023-11-27): If this function ever supports session actors
            // (and not just system actors) then we should use `getStickySessionHost()`
            // when there's a session actor and `getRandomHost()` when there's a system
            // actor.
            this.router.getRandomHost(this._context, spaceId),
            this._tokenAgent.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "System",
                spaceId: this._context.actor.getSpaceId(),
            }),
        ]);

        return fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/getTask/${taskId}`,
            {
                spanRoute: `/:spaceId/getTask/:taskId`,
                method: "GET",
                headers: {
                    authorization: `bearer ${token}`,
                    "content-type": "application/json",
                },
            },
            async response => {
                const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                    await response.json();

                if (!body.ok) {
                    throw ErrorSchema.deserialize(body.error);
                }

                return TaskRealtimeGetTaskSchema.deserialize(body);
            },
        );
    }

    /**
     * Gets a single task collection.
     *
     * We need to read the task from `TaskRealtimeService` which keeps query data
     * up-to-date in realtime. (Unlike OpenSearch which is behind by at least 30
     * seconds.) If the task is available in the `TaskRealtimeService` cache it's
     * returned immediately without a network request to the database. Otherwise,
     * the task is loaded from OpenSearch and `TaskRealtimeService` applies its
     * realtime action history window to make sure the task is up-to-date.
     */
    public async getCollection(
        this: TaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
    ): Promise<{
        collection: TaskCollectionModel;
    }> {
        const [host, token] = await runAllPromises([
            // NOTE(calebmer, 2023-11-27): If this function ever supports session actors
            // (and not just system actors) then we should use `getStickySessionHost()`
            // when there's a session actor and `getRandomHost()` when there's a system
            // actor.
            this.router.getRandomHost(this._context, spaceId),
            this._tokenAgent.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "System",
                spaceId: this._context.actor.getSpaceId(),
            }),
        ]);

        return fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/getCollection/${collectionId}`,
            {
                spanRoute: `/:spaceId/getCollection/:collectionId`,
                method: "GET",
                headers: {
                    authorization: `bearer ${token}`,
                    "content-type": "application/json",
                },
            },
            async response => {
                const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                    await response.json();

                if (!body.ok) {
                    throw ErrorSchema.deserialize(body.error);
                }

                return TaskRealtimeGetCollectionSchema.deserialize(body);
            },
        );
    }
}

export class TestTaskContextModule extends TaskContextModuleBase {
    private readonly _shouldSkipIndexing: boolean;

    constructor({
        dangerouslyEscalateToSystemContext,
        shouldSkipIndexing,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<void>,
        ) => Promise<void>;
        shouldSkipIndexing: boolean;
    }) {
        assert(process.env.NODE_ENV === "test");

        super({dangerouslyEscalateToSystemContext});
        this._shouldSkipIndexing = shouldSkipIndexing;
    }

    public override async processActionTransactionAfterCommit(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
    }): Promise<void> {
        // In tests, if OpenSearch is disabled we allow you to construct a tasks
        // context module that skips task indexing.
        if (!this._shouldSkipIndexing) {
            await this._indexActionTransactionAssumingItsCommitted(actionTransaction);
        }
    }

    public getTask(
        this: TestTaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<{
        task: TaskModel;
        referencedTasks: ReadonlyArray<TaskModel>;
        referencedCollections: ReadonlyArray<TaskCollectionModel>;
    }> {
        // TODO(calebmer): How you could implement this is:
        //
        // 1. Wait for all committed actions to be indexed
        // 2. Read directly from `TaskIndex`
        throw new UnimplementedError("Getting tasks is not implemented for tests");
    }

    public getCollection(
        this: TestTaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSystemActorContextModule;
            }>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
    ): Promise<{
        collection: TaskCollectionModel;
    }> {
        // TODO(calebmer): How you could implement this is:
        //
        // 1. Wait for all committed actions to be indexed
        // 2. Read directly from `TaskIndex`
        throw new UnimplementedError("Getting task collections is not implemented for tests");
    }
}
