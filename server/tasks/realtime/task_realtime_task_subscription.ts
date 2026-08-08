import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeStoreTaskEntry} from "~/server/tasks/realtime/task_realtime_store.js";
import {
    TaskRealtimeTaskReferencesSubscriptionBase,
    TaskRealtimeTaskReferencesSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_task_references_subscription_base.js";
import {
    TaskRealtimeUnsubscribeUpdateEventBuilder,
    TaskRealtimeUpdateEventBuilderBase,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.open_source.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export type TaskRealtimeTaskSubscriptionCallbacks =
    TaskRealtimeTaskReferencesSubscriptionCallbacks & {
        /**
         * An unexpected internal server error has occurred which has caused the
         * subscription to disconnect. The subscription will receive no more events after
         * this. Subscribers should present an error to users or attempt to reconnect.
         */
        onFatalError(context: TaskRealtimeProcessContext, error: InternalError): void;

        /**
         * When we first subscribe to a task, this function is called so the subscriber
         * gets the initial task.
         */
        onTaskSubscribe(
            context: TaskRealtimeSystemActionContext,
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
            newTask: TaskIndexDoc,
        ): void;

        /**
         * Called whenever the task we're subscribed to updates.
         */
        onTaskUpdate(
            context: TaskRealtimeSystemActionContext,
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
            taskId: TaskId,
            oldTask: TaskIndexDoc,
            newTask: TaskIndexDoc,
            actions: NonEmptyReadonlyArray<TaskAction>,
        ): void;

        /**
         * When we have unsubscribed from a task, this function is called so the subscriber
         * can cleanup any references to the task.
         */
        onTaskUnsubscribe(
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
            oldTask: TaskIndexDoc,
        ): void;
    };

/**
 * A subscription to a single task.
 */
export class TaskRealtimeTaskSubscription {
    private readonly _internal: TaskRealtimeTaskSubscriptionInternal;

    constructor(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskEntry: TaskRealtimeStoreTaskEntry,
        callbacks: TaskRealtimeTaskSubscriptionCallbacks,
    ) {
        this._internal = new TaskRealtimeTaskSubscriptionInternal(
            context,
            eventBuilder,
            taskEntry,
            callbacks,
        );
    }

    public getTaskId(): TaskId {
        return this._internal.taskEntry.task.id;
    }

    public unsubscribe(context: Context<{process: ProcessContextModule}>): Promise<void> {
        return this._internal.unsubscribe(context);
    }
}

export class TaskRealtimeTaskSubscriptionInternal extends TaskRealtimeTaskReferencesSubscriptionBase {
    public readonly taskEntry: TaskRealtimeStoreTaskEntry;
    protected readonly _callbacks: TaskRealtimeTaskSubscriptionCallbacks;
    protected _isSubscribed = true;

    constructor(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskEntry: TaskRealtimeStoreTaskEntry,
        callbacks: TaskRealtimeTaskSubscriptionCallbacks,
    ) {
        super();
        this.taskEntry = taskEntry;
        this._callbacks = callbacks;
        this.taskEntry.addTaskSubscriptionDependent(this);

        const newTask = this.taskEntry.task;
        this._trackTaskDependenciesFromAdd(context, eventBuilder, newTask);
        this._callbacks.onTaskSubscribe(context, eventBuilder, newTask);
    }

    protected override _getStore() {
        return this.taskEntry.store;
    }

    /**
     * Unsubscribe from the task. Will call the callbacks `onTaskUnsubscribe`,
     * `onReferencedTaskRemove`, and `onReferencedCollectionRemove` for all tasks and
     * collections that appeared in our query.
     */
    public unsubscribe(context: Context<{process: ProcessContextModule}>) {
        assert(this._isSubscribed);
        this._isSubscribed = false;
        this.taskEntry.removeTaskSubscriptionDependent(this);

        // We construct an event builder just so we can wait out `waitUntil()` promises.
        const eventBuilder = new TaskRealtimeUnsubscribeUpdateEventBuilder(
            this.taskEntry.store.spaceId,
        );

        const oldTask = this.taskEntry.task;
        this._trackTaskDependenciesFromRemove(context, eventBuilder, oldTask);
        this._callbacks.onTaskUnsubscribe(eventBuilder, oldTask);

        return eventBuilder.finishAndIgnoreEvents();
    }

    public onTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        this._trackTaskDependenciesFromUpdate(context, eventBuilder, taskId, oldTask, newTask);
        this._callbacks.onTaskUpdate(context, eventBuilder, taskId, oldTask, newTask, actions);
    }

    public onFatalError(context: TaskRealtimeProcessContext, error: InternalError) {
        try {
            this._callbacks.onFatalError(context, error);
        } catch (error) {
            // Treat errors from our error callback as uncaught exceptions.
            scheduleUncaughtError(error);
        }
    }
}
