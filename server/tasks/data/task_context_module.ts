import {
    ServerActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {
    TaskContextModuleActionTransaction,
    TaskContextModuleBase,
} from "~/server/context/task_context_module_base.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {afterCommitTaskActionTransactionEventEmitterForTest} from "~/server/tasks/data/after_commit_task_action_transaction_event_emitter_for_test.js";
import {TaskRealtimeServiceRouterBase} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {getTaskActionLabel} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
    TaskRealtimeGetCollectionOutputSchema,
    TaskRealtimeGetTaskWithoutDependenciesOutputSchema,
    TaskRealtimeLoadQueriesInput,
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutput,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

/**
 * Helps perform work related to tasks that needs to interact with other systems.
 * Notably:
 *
 * - Escalating to system permission level when indexing a task action
 * - Communicating with the task realtime service
 */
export class TaskContextModule extends TaskContextModuleBase {
    private readonly _tokenAgent: MaybeThunk<TokenAgent>;
    public readonly router: TaskRealtimeServiceRouterBase;

    constructor({
        tokenAgent,
        router,
        dangerouslyEscalateToSystemContext,
    }: {
        tokenAgent: MaybeThunk<TokenAgent>;
        router: TaskRealtimeServiceRouterBase;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor?: ActorContextModule;
                cache: CacheContextModule;
                batch: BatchContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
    }) {
        super({dangerouslyEscalateToSystemContext});
        this._tokenAgent = tokenAgent;
        this.router = router;
    }

    /**
     * Apply an action transaction in all the `TaskRealtimeService` servers that
     * provide realtime task data for `SpaceId`. `TaskRealtimeService` then sends the
     * action to connected WebSockets as well.
     */
    public override applyActionTransactionInRealtimeService(
        this: TaskContextModule & ContextModuleBase<Omit<ServerActionContextModules, "actor">>,
        actionTransaction: TaskContextModuleActionTransaction,
    ) {
        const tokenAgent =
            typeof this._tokenAgent === "function" ? this._tokenAgent() : this._tokenAgent;

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
                    tokenAgent.privateSide.dangerouslySignShortLivedToken("TaskRealtimeService", {
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

                await runAllPromises(
                    // Apply the action transaction in every host from our router since every host
                    // needs to be kept up-to-date in realtime.
                    //
                    // We apply the action whether or not the host is healthy! The host will be in an
                    // unhealthy state for a couple minutes after it starts up. That way all processes
                    // can discover the host and start sending it action transactions (through this
                    // very call). That way when a host is healthy we know it's already been receiving
                    // all new committed action transactions.
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
                                                    "Couldn\u2019t apply task action transaction",
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
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms up
     * `TaskRealtimeService` so when our client connects via WebSocket the data it
     * needs is already loaded.
     */
    public override async loadQueries(
        this: TaskContextModule & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        input: TaskRealtimeLoadQueriesInput,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
    ): Promise<TaskRealtimeLoadQueriesOutput> {
        const tokenAgent =
            typeof this._tokenAgent === "function" ? this._tokenAgent() : this._tokenAgent;

        const [host, token] = await runAllPromises([
            this._context.actor.type !== "Anonymous" && this._context.actor.type !== "System"
                ? this.router.getStickyAccountHost(
                      this._context,
                      spaceId,
                      this._context.actor.getPossiblyBotAccountId(),
                  )
                : // TODO(calebmer): Probably better to send anonymous actors to a sticky host as
                  // well based on `BrowserId`. Maybe we should always use `BrowserId` actually to
                  // simplify code.
                  this.router.getRandomHost(this._context, spaceId),
            tokenAgent.privateSide.dangerouslySignShortLivedToken(
                "TaskRealtimeService",
                this._context.actor.getTokenPayload(),
            ),
        ]);

        const url = new URL(`http://${host}/${spaceId}/loadQueries`);
        if (consistency !== "Eventual") url.searchParams.set("consistency", consistency);

        return await fetchWithTracer(
            this._context.tracer.getTracer(),
            url.toString(),
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

    public override async getTaskWithoutDependenciesIfPossible(
        this: TaskContextModule & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        taskId: TaskId,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
    ): Promise<Result<TaskModel> | null> {
        const tokenAgent =
            typeof this._tokenAgent === "function" ? this._tokenAgent() : this._tokenAgent;

        const [host, token] = await runAllPromises([
            this._context.actor.type !== "Anonymous" && this._context.actor.type !== "System"
                ? this.router.getStickyAccountHost(
                      this._context,
                      spaceId,
                      this._context.actor.getPossiblyBotAccountId(),
                  )
                : // TODO(calebmer): Probably better to send anonymous actors to a sticky host as
                  // well based on `BrowserId`. Maybe we should always use `BrowserId` actually to
                  // simplify code.
                  this.router.getRandomHost(this._context, spaceId),
            tokenAgent.privateSide.dangerouslySignShortLivedToken(
                "TaskRealtimeService",
                this._context.actor.getTokenPayload(),
            ),
        ]);

        const {taskResult} = await fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/getTaskWithoutDependencies/${taskId}${
                consistency !== "Eventual" ? `?consistency=${consistency}` : ""
            }`,
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

        return taskResult;
    }

    public override async getCollectionIfPossible(
        this: TaskContextModule & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
    ): Promise<Result<TaskCollectionModel> | null> {
        const tokenAgent =
            typeof this._tokenAgent === "function" ? this._tokenAgent() : this._tokenAgent;

        const [host, token] = await runAllPromises([
            this._context.actor.type !== "Anonymous" && this._context.actor.type !== "System"
                ? this.router.getStickyAccountHost(
                      this._context,
                      spaceId,
                      this._context.actor.getPossiblyBotAccountId(),
                  )
                : // TODO(calebmer): Probably better to send anonymous actors to a sticky host as
                  // well based on `BrowserId`. Maybe we should always use `BrowserId` actually to
                  // simplify code.
                  this.router.getRandomHost(this._context, spaceId),
            tokenAgent.privateSide.dangerouslySignShortLivedToken(
                "TaskRealtimeService",
                this._context.actor.getTokenPayload(),
            ),
        ]);

        const {collectionResult} = await fetchWithTracer(
            this._context.tracer.getTracer(),
            `http://${host}/${spaceId}/getCollection/${collectionId}${
                consistency !== "Eventual" ? `?consistency=${consistency}` : ""
            }`,
            {
                serviceName: "TaskRealtimeService",
                route: "/:spaceId/getCollection/:collectionId",
                method: "GET",
                headers: {authorization: `bearer ${token}`},
            },
            async response => {
                const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                    await response.json();

                if (!body.ok) {
                    throw ErrorSchema.deserialize(body.error);
                }

                return TaskRealtimeGetCollectionOutputSchema.deserialize(body);
            },
        );

        return collectionResult;
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

    const errors: Array<unknown> = [];

    // Wait for all promises to resolve. If there's an error, don't throw it until all
    // promises have resolved.
    while (processTaskActionTransactionPromisesForTest.size > 0) {
        try {
            await runAllPromises(processTaskActionTransactionPromisesForTest);
        } catch (error) {
            errors.push(error);
        }
    }

    if (errors.length > 0) {
        throw createAggregateError(errors);
    }
}
