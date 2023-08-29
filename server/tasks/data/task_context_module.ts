import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskActionTransactionId} from "~/shared/id/types/id_types.js";
import {TaskAction, getTaskActionLabel} from "~/shared/tasks/actions/task_action.js";

/**
 * Helps perform work related to tasks that needs to interact with other
 * systems. Notably:
 *
 * - Escalating to system permission level when indexing a task action.
 * - Communicating with the task query realtime service.
 */
export class TaskContextModule extends ContextModuleBase<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    actor: DynamoActorContextModule;
}> {
    private readonly _dangerouslyEscalateToSystemContext: (
        context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<void>,
    ) => Promise<void>;

    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<void>,
        ) => Promise<void>;
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
        spaceId: SpaceId,
        actionTransactionId: TaskActionTransactionId,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        return this._dangerouslyEscalateToSystemContext(this._context, spaceId, context =>
            context.tracer.withSpan("indexTaskActionTransaction", async (context, span) => {
                span.addData({
                    tasks: {
                        actions: actions.map(getTaskActionLabel).join(","),
                        actionCount: actions.length,
                        actionTransactionId,
                    },
                });

                try {
                    await indexTaskActionTransactionAssumingItsCommitted(context, spaceId, actions);
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

export class TestTaskContextModule extends TaskContextModule {
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

    public override async indexActionTransactionAssumingItsCommitted(
        spaceId: SpaceId,
        actionTransactionId: TaskActionTransactionId,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        // In tests, if OpenSearch is disabled we allow you to construct a tasks
        // context module that skips task indexing.
        if (this._shouldSkipIndexing) return;

        return super.indexActionTransactionAssumingItsCommitted(
            spaceId,
            actionTransactionId,
            actions,
        );
    }
}
