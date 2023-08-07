import {AppSystemActionContext} from "~/server/dynamo/context/app_action_context.js";
import {AppActorContextModule} from "~/server/dynamo/context/app_actor_context_module.js";
import {indexTaskSpaceActionTransactionAssumingItsCommitted} from "~/server/tasks/index/task_index.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskSpaceActionTransactionId} from "~/shared/id/types/id_types.js";
import {
    TaskSpaceAction,
    getTaskSpaceActionLabel,
} from "~/shared/tasks/actions/task_space_action.js";

/**
 * Helps perform work related to tasks that needs to interact with other
 * systems. Notably:
 *
 * - Escalating to system permission level when indexing a task action.
 * - Communicating with the task query realtime service.
 */
export class TasksContextModule extends ContextModuleBase<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    actor: AppActorContextModule;
}> {
    private readonly _dangerouslyEscalateToSystemContext: (
        context: Context<{tracer: TracerContextModule; actor: AppActorContextModule}>,
        spaceId: SpaceId,
        action: (context: AppSystemActionContext) => Promise<void>,
    ) => Promise<void>;

    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{tracer: TracerContextModule; actor: AppActorContextModule}>,
            spaceId: SpaceId,
            action: (context: AppSystemActionContext) => Promise<void>,
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
    public indexTaskSpaceActionTransactionAssumingItsCommitted(
        spaceId: SpaceId,
        actionTransactionId: TaskSpaceActionTransactionId,
        actions: ReadonlyArray<TaskSpaceAction>,
    ) {
        // Index the action transaction in the background.
        //
        // TODO(calebmer): We need some way to recover if indexing fails! Right now
        // maybe we can rely on a manual process where we look at Honeycomb for errors
        // and manually retry them. However, this won't catch cases where we fail to
        // log an indexing span at all! (Maybe the machine abruptly shuts down.) We
        // should really have an automated process that makes sure we index tasks
        // at-least-once.
        this._context.process.waitUntil(
            this._dangerouslyEscalateToSystemContext(this._context, spaceId, context =>
                context.tracer.withSpan("Index task action transaction", async (context, span) => {
                    span.addData({
                        tasks: {
                            actions: actions.map(getTaskSpaceActionLabel).join(","),
                            actionCount: actions.length,
                            actionTransactionId,
                        },
                    });

                    try {
                        await indexTaskSpaceActionTransactionAssumingItsCommitted(
                            context,
                            spaceId,
                            actions,
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
            ),
        );
    }
}

export class TestTasksContextModule extends TasksContextModule {
    private readonly _shouldSkipIndexing: boolean;

    constructor({
        dangerouslyEscalateToSystemContext,
        shouldSkipIndexing,
    }: {
        dangerouslyEscalateToSystemContext: (
            context: Context<{tracer: TracerContextModule; actor: AppActorContextModule}>,
            spaceId: SpaceId,
            action: (context: AppSystemActionContext) => Promise<void>,
        ) => Promise<void>;
        shouldSkipIndexing: boolean;
    }) {
        assert(process.env.NODE_ENV === "test");

        super({dangerouslyEscalateToSystemContext});
        this._shouldSkipIndexing = shouldSkipIndexing;
    }

    public override indexTaskSpaceActionTransactionAssumingItsCommitted(
        spaceId: SpaceId,
        actionTransactionId: TaskSpaceActionTransactionId,
        actions: ReadonlyArray<TaskSpaceAction>,
    ): void {
        // In tests, if OpenSearch is disabled we allow you to construct a tasks
        // context module that skips task indexing.
        if (this._shouldSkipIndexing) return;

        super.indexTaskSpaceActionTransactionAssumingItsCommitted(
            spaceId,
            actionTransactionId,
            actions,
        );
    }
}
