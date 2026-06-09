import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {
    ServerAccountActionContextModules,
    ServerActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {TestTaskContextModule} from "~/server/context/task_context_module_base.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {afterCommitTaskActionTransactionEventEmitterForTest} from "~/server/tasks/data/after_commit_task_action_transaction_event_emitter_for_test.js";
import {waitForProcessTaskActionTransactionsForTest} from "~/server/tasks/data/task_context_module.js";
import {refreshTaskIndexForTest} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {getTaskCollectionForRealtime} from "~/server/tasks/realtime/get_task_collection_for_realtime.js";
import {getTaskWithoutDependenciesForRealtime} from "~/server/tasks/realtime/get_task_without_dependencies_for_realtime.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Result} from "~/shared/helpers/control/result.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
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

        // When our test is finished, evict everything and make sure the server was truly
        // emptied out.
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
     * Wait for all `indexTaskActionTransaction()` calls to resolve and for the task
     * index to refresh. Then we also clear action history to act as if we're at a time
     * far away from when the actions were commit.
     */
    public async waitForIndexActionTransactions() {
        await waitForIndexActionTransactionsWithoutClearingActionHistory(this.context);
        this.server.clearActionHistoryForTest();
    }

    /**
     * Wait until all parallel processing tasks have settled to make sure `loadQuery()`
     * doesn't see stale data.
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
                parseAbsolute(new Date(testTaskClock.now()[0]).toISOString(), defaultTimeZone),
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
     * Similar to `session.action()` except the `tasks` context module supports methods
     * that must call into `TaskRealtimeService` like `context.tasks.loadQueries()`.
     */
    public action(session: TestSession) {
        return session.action().clone({
            tasks: new TestTaskContextModuleWithRealtimeServer({
                server: this,
                dangerouslyEscalateToSystemContext: session.context.escalateToSystemContext,
            }),
        });
    }

    /**
     * Modify `TestContext` so `context.tasks` references a `TestTaskRealtimeServer`.
     */
    public static with(context: TestActualContext): TestActualContext & {
        getTaskRealtimeServer(): TestTaskRealtimeServer;
    } {
        let server: TestTaskRealtimeServer | undefined;

        beforeEach(() => {
            server = new TestTaskRealtimeServer(context);
        });

        afterEach(() => {
            server = undefined;
        });

        const getServer = () => {
            if (!server) {
                throw new InternalError(
                    "Can\u2019t get `TestTaskRealtimeServer` when no test is running",
                );
            }
            return server;
        };

        return Object.assign(
            context.cloneWithHelpers({
                tasks: new TestTaskContextModuleWithRealtimeServer({
                    server: getServer,
                    dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                }),
            }),
            {
                getTaskRealtimeServer: getServer,
            },
        );
    }
}

class TestTaskContextModuleWithRealtimeServer extends TestTaskContextModule {
    private readonly _server: TestTaskRealtimeServer | (() => TestTaskRealtimeServer);

    constructor({
        server,
        dangerouslyEscalateToSystemContext,
    }: {
        server: TestTaskRealtimeServer | (() => TestTaskRealtimeServer);
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
        this._server = server;
    }

    private _getServer() {
        return typeof this._server === "function" ? this._server() : this._server;
    }

    public override async loadQueries(
        this: TestTaskContextModuleWithRealtimeServer &
            ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        input: TaskRealtimeLoadQueriesInput,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
    ): Promise<TaskRealtimeLoadQueriesOutput> {
        const {queries, extraQueries, updateEvent} = await loadTaskRealtimeQueries(this._context, {
            server: this._getServer().server,
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            spaceId,
            queries: input.queries,
            taskIds: input.taskIds,
            collectionIds: input.collectionIds,
            consistency,
        });

        return {ok: true, queries, extraQueries, updateEvent};
    }

    public override async getTaskWithoutDependenciesIfPossible(
        this: TestTaskContextModuleWithRealtimeServer &
            ContextModuleBase<ServerAccountActionContextModules>,
        spaceId: SpaceId,
        taskId: TaskId,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
    ): Promise<Result<TaskModel> | null> {
        const {taskResult} = await getTaskWithoutDependenciesForRealtime(this._context, {
            server: this._getServer().server,
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            spaceId,
            taskId,
            consistency,
        });

        return taskResult;
    }

    public override async getCollectionIfPossible(
        this: TestTaskContextModuleWithRealtimeServer &
            ContextModuleBase<ServerAccountActionContextModules>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
    ): Promise<Result<TaskCollectionModel> | null> {
        const {collectionResult} = await getTaskCollectionForRealtime(this._context, {
            server: this._getServer().server,
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            spaceId,
            collectionId,
            consistency,
        });

        return collectionResult;
    }
}
