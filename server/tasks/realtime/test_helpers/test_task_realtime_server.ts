import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {DynamoActorContextModule} from "~/server/context/dynamo_actor_context_module.js";
import {
    ServerActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {TestTaskContextModule} from "~/server/context/task_context_module_base.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {waitForProcessTaskActionTransactionsForTest} from "~/server/tasks/data/task_context_module.js";
import {refreshTaskIndexForTest} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {afterCommitTaskActionTransactionEventEmitterForTest} from "~/server/tasks/data/task_table.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {SpaceId, TaskRealtimeClientId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {
    TaskRealtimeLoadQueriesInput,
    TaskRealtimeLoadQueriesOutput,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {testClock} from "~/shared/test_helpers/test_clock.js";

/**
 * Wait for OpenSearch to have indexed all our action transactions.
 */
export async function waitForIndexActionTransactionsWithoutClearingActionHistory(
    context: TestContext,
) {
    await waitForProcessTaskActionTransactionsForTest();
    await refreshTaskIndexForTest(context);
}

export class TestTaskRealtimeServer {
    public readonly context: TestContext;
    public readonly server: TaskRealtimeServer;
    private _applyActionTransactionPromises: Array<Promise<void>> = [];

    private _applyActionTransactionsPauseState:
        | {
              type: "Paused";
              actionTransactions: Array<{
                  spaceId: SpaceId;
                  committedTime: Date;
                  actions: ReadonlyArray<TaskAction>;
                  clientId: TaskRealtimeClientId | null;
              }>;
          }
        | {
              type: "Unpaused";
          } = {
        type: "Unpaused",
    };

    constructor(context: TestContext) {
        const [server, {start, stop}] = TaskRealtimeServer.new(context);

        start(Promise.resolve());
        afterTestEnds(stop);

        const unsubscribe = assertExists(
            afterCommitTaskActionTransactionEventEmitterForTest,
        ).subscribe(({spaceId, committedTime, actions, clientId}) => {
            if (this._applyActionTransactionsPauseState.type === "Paused") {
                this._applyActionTransactionsPauseState.actionTransactions.push({
                    spaceId,
                    committedTime,
                    actions,
                    clientId,
                });
            } else {
                this._applyActionTransactionPromises.push(
                    this.server.applyActionTransaction(context.systemAction(spaceId), {
                        spaceId,
                        committedTime,
                        actions,
                        clientId,
                    }),
                );
            }
        });
        afterTestEnds(() => this.waitForApplyActionTransactions());
        afterTestEnds(unsubscribe);

        // When our test is finished, evict everything and make sure the server was
        // truly emptied out.
        afterTestEnds(async () => {
            await ProcessContextModule.waitForTestTasks();
            this.server.evictAllForTest();
            this.server.assertEmptyForTest();
        });

        this.context = context;
        this.server = server;
    }

    public pauseApplyActionTransactions() {
        assert(this._applyActionTransactionsPauseState.type === "Unpaused");

        this._applyActionTransactionsPauseState = {type: "Paused", actionTransactions: []};
    }

    public unpauseApplyActionTransactions() {
        assert(this._applyActionTransactionsPauseState.type === "Paused");

        for (const {spaceId, committedTime, actions, clientId} of this
            ._applyActionTransactionsPauseState.actionTransactions) {
            this._applyActionTransactionPromises.push(
                this.server.applyActionTransaction(this.context.systemAction(spaceId), {
                    spaceId,
                    committedTime,
                    actions,
                    clientId,
                }),
            );
        }

        this._applyActionTransactionsPauseState = {type: "Unpaused"};
    }

    /**
     * Wait for all `applyActionTransaction()` calls made against our server.
     */
    public async waitForApplyActionTransactions() {
        const promises = this._applyActionTransactionPromises;
        this._applyActionTransactionPromises = [];

        await runAllPromises(promises);
    }

    /**
     * Call the `applyActionTransaction()` function on our server.
     */
    public applyActionTransaction({
        spaceId,
        committedTime,
        actions,
    }: {
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }) {
        return this.server.applyActionTransaction(this.context.systemAction(spaceId), {
            spaceId,
            committedTime,
            actions,
            clientId: null,
        });
    }

    /**
     * Wait for all `indexTaskActionTransaction()` calls to resolve and for the
     * task index to refresh. Then we also clear action history to act as if we're
     * at a time far away from when the actions were commit.
     */
    public async waitForIndexActionTransactions() {
        await waitForIndexActionTransactionsWithoutClearingActionHistory(this.context);
        this.server.clearActionHistoryForTest();
    }

    /**
     * Wait until all parallel processing tasks have settled to make sure
     * `loadQuery()` doesn't see stale data.
     */
    public async wait() {
        await runAllPromises([
            this.waitForIndexActionTransactions(),
            this.waitForApplyActionTransactions(),
        ]);
    }

    public async loadQuery(
        session: TestSpaceSession,
        options?: {
            filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
            sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
            limit?: number;
        },
    ): Promise<{
        hasMoreTasks: boolean;
        tasks: Array<TaskIndexDoc>;
    }> {
        const evaluationContext: TaskQueryEvaluationContext = {
            currentAccountId: session.account.id,
            currentDate: toCalendarDate(
                parseAbsolute(testClock.nowDate().toISOString(), defaultTimeZone),
            ),
        };

        const filters = options?.filters
            ? isReadonlyArray(options.filters)
                ? normalizeTaskQueryFilters(options.filters, evaluationContext)
                : ({type: "Possible", normalizedFilters: options.filters} as const)
            : normalizeTaskQueryFilters([], evaluationContext);

        if (filters.type === "Impossible") return {tasks: [], hasMoreTasks: false};

        const {loadedState, tasks} = await this.server.loadQuery(session.space.systemAction(), {
            spaceId: session.space.id,
            filters: filters.normalizedFilters,
            sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
            limit: options?.limit ?? 100,
        });

        return {
            hasMoreTasks: loadedState.type === "Partial",
            tasks,
        };
    }

    public evictAll() {
        this.server.evictAllForTest();
    }

    /**
     * Similar to `session.action()` except the `tasks` context module
     * supports methods that must call into `TaskRealtimeService` like
     * `context.tasks.loadQueries()`.
     */
    public action(session: TestSession) {
        return session.action().clone({
            tasks: new TestTaskContextModuleWithRealtimeServer({
                server: this,
                dangerouslyEscalateToSystemContext: session.context.escalateToSystemContext,
            }),
        });
    }
}

class TestTaskContextModuleWithRealtimeServer extends TestTaskContextModule {
    private readonly _server: TestTaskRealtimeServer;

    constructor({
        server,
        dangerouslyEscalateToSystemContext,
    }: {
        server: TestTaskRealtimeServer;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor?: DynamoActorContextModule;
                cache: CacheContextModule;
                batch: BatchContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
    }) {
        super({dangerouslyEscalateToSystemContext});
        this._server = server;
    }

    public override async loadQueries(
        this: TestTaskContextModuleWithRealtimeServer &
            ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        input: TaskRealtimeLoadQueriesInput,
    ): Promise<TaskRealtimeLoadQueriesOutput> {
        const {queries, extraQueries, updateEvent} = await loadTaskRealtimeQueries(this._context, {
            server: this._server.server,
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            spaceId,
            queries: input.queries,
            taskIds: input.taskIds,
            collectionIds: input.collectionIds,
        });

        return {ok: true, queries, extraQueries, updateEvent};
    }

    public override getTaskWithoutDependenciesIfPossible(): Promise<never> {
        throw new UnimplementedError(
            "`TestTaskContextModuleWithRealtimeServer.getTaskWithoutDependenciesIfPossible()` should be implementable but we haven’t implemented it yet",
        );
    }

    public override getTaskWithoutDependencies(): Promise<never> {
        throw new UnimplementedError(
            "`TestTaskContextModuleWithRealtimeServer.getTaskWithoutDependencies()` should be implementable but we haven’t implemented it yet",
        );
    }

    public override getCollectionIfPossible(): Promise<never> {
        throw new UnimplementedError(
            "`TestTaskContextModuleWithRealtimeServer.getCollectionIfPossible()` should be implementable but we haven’t implemented it yet",
        );
    }

    public override getCollection(): Promise<never> {
        throw new UnimplementedError(
            "`TestTaskContextModuleWithRealtimeServer.getCollection()` should be implementable but we haven’t implemented it yet",
        );
    }
}
