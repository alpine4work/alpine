import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {TaskSystemActionContext} from "~/server/tasks/data/task_action_context.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {afterCommitTaskActionTransactionEventEmitterForTest} from "~/server/tasks/data/task_table.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
    TaskRealtimeGetTaskWithoutDependenciesOutputSchema,
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/server/tasks/router/task_realtime_service_procedure_schemas.js";
import {TaskRealtimeServiceRouterBase} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {CancelledError, DataLossError, UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";
import {TaskAction, getTaskActionLabel} from "~/shared/tasks/actions/task_action.js";
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
        action: (context: TaskSystemActionContext) => Promise<void>,
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
            action: (context: TaskSystemActionContext) => Promise<void>,
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
        actorId: AccountId | null;
    }): Promise<void>;

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
        actorId: AccountId | null;
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
                            actionTransaction.actorId,
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
    private readonly _tokenAgent: TokenAgent;
    public readonly router: TaskRealtimeServiceRouterBase;

    constructor({
        tokenAgent,
        router,
        dangerouslyEscalateToSystemContext,
    }: {
        tokenAgent: TokenAgent;
        router: TaskRealtimeServiceRouterBase;
        dangerouslyEscalateToSystemContext: (
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: TaskSystemActionContext) => Promise<void>,
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
        actorId: AccountId | null;
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
                    this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "TaskRealtimeService",
                        {type: "System", spaceId: actionTransaction.spaceId},
                    ),
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
                                        serviceName: "TaskRealtimeService",
                                        route: `/:spaceId/applyActionTransaction`,
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
            this._tokenAgent.privateSide.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "Session",
                sessionId: this._context.actor.getSessionId(),
                accountId: this._context.actor.getAccountId(),
            }),
        ]);

        return fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/loadQueries`,
            {
                serviceName: "TaskRealtimeService",
                route: "/:spaceId/loadQueries",
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
     * Get a task without any dependencies (doesn't load parent tasks, task
     * collections, or accounts referenced by the task). If you want to load a task
     * with its dependencies you may call `loadQueries()` and only pass a single
     * `TaskId`.
     *
     * We execute our queries in a running `TaskRealtimeService` instance for the
     * space. Since `TaskRealtimeService` keeps query data up-to-date in realtime
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms
     * up `TaskRealtimeService` so when our client connects via WebSocket the data
     * it needs is already loaded.
     */
    public async getTaskWithoutDependencies(
        this: TaskContextModule &
            ContextModuleBase<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                actor: DynamoSessionActorContextModule;
            }>,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<SchemaType<typeof TaskRealtimeGetTaskWithoutDependenciesOutputSchema>> {
        const [host, token] = await runAllPromises([
            this.router.getStickySessionHost(
                this._context,
                spaceId,
                this._context.actor.getSessionId(),
            ),
            this._tokenAgent.privateSide.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "Session",
                sessionId: this._context.actor.getSessionId(),
                accountId: this._context.actor.getAccountId(),
            }),
        ]);

        return fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/getTaskWithoutDependencies/${taskId}`,
            {
                serviceName: "TaskRealtimeService",
                route: "/:spaceId/getTaskWithoutDependencies/:taskId",
                method: "GET",
                headers: {authorization: `bearer ${token}`},
            },
            async response => {
                const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                    await response.json();

                if (!body.ok) {
                    throw ErrorSchema.deserialize(body.error);
                }

                return TaskRealtimeGetTaskWithoutDependenciesOutputSchema.deserialize(body);
            },
        );
    }
}

const processTaskActionTransactionPromisesForTest =
    afterCommitTaskActionTransactionEventEmitterForTest ? new Set<Promise<void>>() : null;

afterCommitTaskActionTransactionEventEmitterForTest?.subscribe(({processPromise}) => {
    assert(processTaskActionTransactionPromisesForTest);

    processTaskActionTransactionPromisesForTest.add(processPromise);
    void processPromise.finally(() => {
        processTaskActionTransactionPromisesForTest.delete(processPromise);
    });
});

/**
 * Wait for any task action processing promises to resolve. Useful if you don't
 * want to wait for all `ProcessContextModule` `waitUntil()` tasks to resolve.
 */
export async function waitForProcessTaskActionTransactionsForTest() {
    assert(processTaskActionTransactionPromisesForTest);

    let hasError = false;
    let error: unknown;

    // Wait for all promises to resolve. If there's an error, don't throw it until
    // all promises have resolved.
    while (processTaskActionTransactionPromisesForTest.size > 0) {
        try {
            await runAllPromises(processTaskActionTransactionPromisesForTest);
        } catch (newError) {
            if (!hasError) {
                hasError = true;
                error = newError;
            }
            // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
            // just the first one. Probably by using an `AggregateError`.
            else if (
                (!isSystemError(error) && isSystemError(newError)) ||
                (error instanceof CancelledError && !(newError instanceof CancelledError))
            ) {
                error = newError;
            }
        }
    }

    if (hasError) throw error;
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
            action: (context: TaskSystemActionContext) => Promise<void>,
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
        actorId: AccountId | null;
    }): Promise<void> {
        // In tests, if OpenSearch is disabled we allow you to construct a tasks
        // context module that skips task indexing.
        if (!this._shouldSkipIndexing) {
            await this._indexActionTransactionAssumingItsCommitted(actionTransaction);
        }
    }
}
