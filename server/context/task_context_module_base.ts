import {
    ServerAccountActionContextModules,
    ServerActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    createTaskCollectionNotFoundError,
    createTaskNotFoundError,
} from "~/shared/tasks/task_error_messages.js";
import {
    TaskRealtimeLoadQueriesInput,
    TaskRealtimeLoadQueriesOutput,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

export type TaskContextModuleActionTransaction = {
    readonly spaceId: SpaceId;
    readonly committedTime: Date;
    readonly actionTransactionId: TaskActionTransactionId;
    readonly actions: ReadonlyArray<TaskAction>;
    readonly actorId: AccountId | null;
    readonly clientId: TaskRealtimeClientId | null;
};

/**
 * Helps perform work related to tasks that needs to interact with other
 * systems. Notably:
 *
 * - Escalating to system permission level when indexing a task action
 * - Communicating with the task realtime service
 */
export abstract class TaskContextModuleBase extends ContextModuleBase {
    protected readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;

    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
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
        super();
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
    }

    /**
     * Index an action transaction after its been committed. This function must be
     * called at-least-once for every committed action transaction. It is ok to
     * call this function multiple times, though.
     */
    public indexActionTransactionAssumingItsCommitted(
        this: TaskContextModuleBase &
            ContextModuleBase<PartialBy<ServerActionContextModules, "actor">>,
        actionTransaction: TaskContextModuleActionTransaction,
    ): Promise<void> {
        return this._dangerouslyEscalateToSystemContext(
            this._context,
            actionTransaction.spaceId,
            context =>
                context.tasksInjection.indexTaskActionTransactionAssumingItsCommitted(
                    actionTransaction,
                ),
        );
    }

    /**
     * Apply an action transaction in all the `TaskRealtimeService` servers that
     * provide realtime task data for `SpaceId`. `TaskRealtimeService` then sends
     * the action to connected WebSockets as well.
     */
    public abstract applyActionTransactionInRealtimeService(
        this: TaskContextModuleBase & ContextModuleBase<Omit<ServerActionContextModules, "actor">>,
        actionTransaction: TaskContextModuleActionTransaction,
    ): Promise<void>;

    /**
     * Execute some queries.
     *
     * We execute our queries in a running `TaskRealtimeService` instance for the
     * space. Since `TaskRealtimeService` keeps query data up-to-date in realtime
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms
     * up `TaskRealtimeService` so when our client connects via WebSocket the data
     * it needs is already loaded.
     */
    public abstract loadQueries(
        this: TaskContextModuleBase & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        input: TaskRealtimeLoadQueriesInput,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<TaskRealtimeLoadQueriesOutput>;

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
    public abstract getTaskWithoutDependenciesIfPossible(
        this: TaskContextModuleBase & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        taskId: TaskId,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<TaskModel> | null>;

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
        this: TaskContextModuleBase & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        taskId: TaskId,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<TaskModel> {
        const taskResult = await this.getTaskWithoutDependenciesIfPossible(
            spaceId,
            taskId,
            options,
        );
        if (!taskResult) throw createTaskNotFoundError(taskId);
        if (!taskResult.ok) throw taskResult.error;
        return taskResult.value;
    }

    /**
     * Get a collection.
     *
     * We execute our queries in a running `TaskRealtimeService` instance for the
     * space. Since `TaskRealtimeService` keeps query data up-to-date in realtime
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms
     * up `TaskRealtimeService` so when our client connects via WebSocket the data
     * it needs is already loaded.
     */
    public abstract getCollectionIfPossible(
        this: TaskContextModuleBase & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<TaskCollectionModel> | null>;

    /**
     * Get a collection.
     *
     * We execute our queries in a running `TaskRealtimeService` instance for the
     * space. Since `TaskRealtimeService` keeps query data up-to-date in realtime
     * (unlike OpenSearch which is behind by at least 30 seconds). This also warms
     * up `TaskRealtimeService` so when our client connects via WebSocket the data
     * it needs is already loaded.
     */
    public async getCollection(
        this: TaskContextModuleBase & ContextModuleBase<ServerActionContextModules>,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<TaskCollectionModel> {
        const collectionResult = await this.getCollectionIfPossible(spaceId, collectionId, options);
        if (!collectionResult) throw createTaskCollectionNotFoundError(collectionId);
        if (!collectionResult.ok) throw collectionResult.error;
        return collectionResult.value;
    }
}

export class TestTaskContextModule
    extends TaskContextModuleBase
    implements ForkableContextModuleBase
{
    private readonly _alwaysNotFound: boolean;

    constructor({
        dangerouslyEscalateToSystemContext,
        alwaysNotFound = false,
    }: {
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
        alwaysNotFound?: boolean;
    }) {
        assert(isTestNodeEnvOrAdminScenariosScript);

        super({dangerouslyEscalateToSystemContext});
        this._alwaysNotFound = alwaysNotFound;
    }

    public override async applyActionTransactionInRealtimeService(): Promise<void> {
        // Noop in tests...
    }

    public override loadQueries(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        spaceId: SpaceId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        input: TaskRealtimeLoadQueriesInput,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<TaskRealtimeLoadQueriesOutput> {
        throw new UnimplementedError(
            "`TestTaskContextModule.loadQueries()` can\u2019t be implemented in unit tests because we don\u2019t run `TaskRealtimeService` in unit tests",
        );
    }

    public override async getTaskWithoutDependenciesIfPossible(
        this: TestTaskContextModule & ContextModuleBase<ServerAccountActionContextModules>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        spaceId: SpaceId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        taskId: TaskId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<TaskModel> | null> {
        if (this._alwaysNotFound) return Promise.resolve(null);

        throw new UnimplementedError(
            "`TestTaskContextModule.getTaskWithoutDependenciesIfPossible()` can\u2019t be implemented in unit tests because we don\u2019t run `TaskRealtimeService` in unit tests",
        );
    }

    public override getCollectionIfPossible(
        this: TestTaskContextModule & ContextModuleBase<ServerAccountActionContextModules>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        spaceId: SpaceId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        collectionId: TaskCollectionId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<TaskCollectionModel> | null> {
        if (this._alwaysNotFound) return Promise.resolve(null);

        throw new UnimplementedError(
            "`TestTaskContextModule.getCollectionIfPossible()` can\u2019t be implemented in unit tests because we don\u2019t run `TaskRealtimeService` in unit tests",
        );
    }

    public fork() {
        return new TestTaskContextModule({
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            alwaysNotFound: this._alwaysNotFound,
        });
    }
}
