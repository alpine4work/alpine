import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
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
import {DataLossError, UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {SpaceId, TaskActionTransactionId} from "~/shared/id/types/id_types.js";
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
    private async _applyActionTransactionInRealtimeService(actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
    }) {
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
            }),
        );

        return this._context.tracer.withSpan("Apply task action transaction", (context, span) => {
            span.addData({
                tasks: {
                    actions: actionTransaction.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransaction.actions.length,
                    actionTransactionId: actionTransaction.actionTransactionId,
                },
            });

            return runAllPromises(
                // Apply the action transaction in every host from our router since every host
                // needs to be kept up-to-date in realtime.
                hosts.map(async host => {
                    const response = await fetchWithTracer(
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
                    );

                    const responseBody = await response.json();

                    if (!response.ok) {
                        if ("error" in responseBody) {
                            throw ErrorSchema.deserialize(responseBody.error);
                        } else {
                            throw new UnknownError("Couldn't apply task action transaction");
                        }
                    }
                }),
            );
        });
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
        const [hosts, token] = await runAllPromises([
            this.router.getHosts(this._context, spaceId),
            this._tokenAgent.dangerouslySignShortLivedToken("TaskRealtimeService", {
                type: "Session",
                sessionId: this._context.actor.getSessionId(),
                accountId: this._context.actor.getAccountId(),
            }),
        ]);

        // Randomly select a host to load our queries from.
        //
        // NOCOMMIT: Use `SessionId` as random seed for routing.
        assert(hosts.length > 0);
        const host = hosts[randomInteger(hosts.length)]!;

        const response = await fetchWithTracer(
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
        );

        const responseBody: {ok: true} | {ok: false; error: SchemaSerializedValue} =
            await response.json();

        if (!responseBody.ok) {
            throw ErrorSchema.deserialize(responseBody.error);
        }

        return TaskRealtimeLoadQueriesOutputSchema.deserialize(responseBody);
    }
}

export class TestTaskContextModule extends TaskContextModuleBase {
    private readonly _shouldSkipIndexing: boolean;

    constructor({
        dangerouslyEscalateToSystemContext,
        shouldSkipIndexing,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
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
}
