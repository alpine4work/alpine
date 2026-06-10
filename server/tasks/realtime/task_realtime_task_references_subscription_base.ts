import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {
    TaskRealtimeStoreCollectionEntry,
    TaskRealtimeStoreInternal,
    TaskRealtimeStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_store.js";
import {TaskRealtimeUpdateEventBuilderBase} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createPromiseImmediateResolver} from "~/shared/helpers/async/promise_immediate_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {diffSets} from "~/shared/helpers/set/diff_sets.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

const previousReferencedTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeTaskReferencesSubscriptionBase, Map<TaskId, TaskIndexDoc>>()
        : null;

const previousReferencedCollectionByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<
              TaskRealtimeTaskReferencesSubscriptionBase,
              Map<TaskCollectionId, TaskCollectionIndexDoc>
          >()
        : null;

export type TaskRealtimeTaskReferencesSubscriptionCallbacks = {
    /**
     * A new task is referenced by a loaded task in the query directly or indirectly.
     * All parent tasks of our loaded tasks are considered referenced and all parent
     * tasks of parent tasks recursively are considered referenced.
     *
     * May happen when:
     *
     * 1. Loading more tasks into the query
     * 2. A loaded task's parent is updated
     * 3. A loaded task's parent's parent is updated (recursively)
     *
     * You are expected to send a backfill message to clients with a preview of the
     * referenced task. The client may not have seen relevant actions leading up to
     * this event.
     */
    onReferencedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ): void;

    /**
     * A task referenced directly or indirectly by a loaded task was updated.
     *
     * There will always be some associated `TaskAction`s with this change. Clients
     * should apply these task actions.
     */
    onReferencedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * A task that was referenced directly or indirectly by a loaded task is no longer
     * referenced.
     *
     * We don't need to apply any new `TaskAction`s to this task since it should
     * disappear in the UI. If the task is referenced again then you will get an add
     * event.
     */
    onReferencedTaskRemove(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
    ): void;

    /**
     * A new collection is referenced by a loaded task in the query directly or
     * indirectly. May be referenced indirectly by any parent task of a loaded task.
     *
     * You are expected to send a backfill message to clients with the referenced
     * collection. The client may not have seen relevant actions leading up to this
     * event.
     */
    onReferencedCollectionAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newCollection: TaskCollectionIndexDoc,
    ): void;

    /**
     * A collection referenced directly or indirectly by a loaded collection was
     * updated.
     *
     * There will always be some associated `TaskAction`s with this change. Clients
     * should apply these actions.
     */
    onReferencedCollectionUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionId: TaskCollectionId,
        oldCollection: TaskCollectionIndexDoc,
        newCollection: TaskCollectionIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * A collection that was referenced directly or indirectly by a loaded task is no
     * longer referenced.
     *
     * We don't need to apply any new `TaskAction`s to this collection since it should
     * disappear in the UI. If the task is referenced again then you will get an add
     * event.
     */
    onReferencedCollectionRemove(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldCollection: TaskCollectionIndexDoc,
    ): void;
};

/**
 * Base class for `TaskRealtimeQuerySubscriptionInternal` and
 * `TaskRealtimeTaskSubscriptionInternal`. Both of these classes maintain a
 * subscription to some tasks. They also need to maintain subscriptions to all data
 * referenced by the tasks including parent tasks (recursively) and collections.
 *
 * This base class shares the bookkeeping logic for maintaining task references in
 * realtime.
 */
export abstract class TaskRealtimeTaskReferencesSubscriptionBase {
    protected abstract _isSubscribed: boolean;
    protected abstract readonly _callbacks: TaskRealtimeTaskReferencesSubscriptionCallbacks;

    protected readonly _referencedTaskEntryById = new Map<
        TaskId,
        {referenceCount: number; promise: PromiseImmediate<TaskRealtimeStoreTaskEntry>}
    >();

    protected readonly _referencedCollectionEntryById = new Map<
        TaskCollectionId,
        {referenceCount: number; promise: PromiseImmediate<TaskRealtimeStoreCollectionEntry>}
    >();

    protected abstract _getStore(): TaskRealtimeStoreInternal;

    private _onReferencedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ) {
        // Makes sure we apply any updates to this task before adding it. See the comment
        // on our `onReferencedTaskRemove()` call below for more information.
        //
        // While it's ok for this class to see an add with an old task then an update with
        // the new task, our subscribed callbacks may be confused to see an old task from
        // this call when it's seen a new task from another subscription.
        this._getStore().onReferencedTaskAddOrRemove(newTask.id);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskById.has(newTask.id),
                "Subscription can\u2019t add task that\u2019s already referenced with `_onReferencedTaskAdd()`",
            );

            previousTaskById.set(newTask.id, newTask);
        }

        this._trackTaskDependenciesFromAdd(context, eventBuilder, newTask);

        this._callbacks.onReferencedTaskAdd(context, eventBuilder, newTask);
    }

    public onReferencedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTask,
                "Subscription must observe all updates to a referenced task through `onReferencedTaskUpdate()`",
            );

            previousTaskById.set(taskId, newTask);
        }

        this._trackTaskDependenciesFromUpdate(context, eventBuilder, taskId, oldTask, newTask);

        this._callbacks.onReferencedTaskUpdate(
            context,
            eventBuilder,
            taskId,
            oldTask,
            newTask,
            actions,
        );
    }

    private _onReferencedTaskRemove(
        context: Context<{process: ProcessContextModule}>,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
    ) {
        // When we apply an action transaction, there are potentially many updates to many
        // tasks that we apply all at once. Let's say a query references a parent task and
        // we both need to update the parent task and remove it from the query in the same
        // action transaction.
        //
        // This happens when deleting a task and all its children if you're subscribed to
        // the children query, for instance. The parent task of the children is referenced
        // and its children counts update (since the children are all deleted).
        //
        // So in this case we need to see the update to the referenced task BEFORE we can
        // remove it. We assert that EVERY update to a task must be witnessed by this class
        // in order. Otherwise our tracked references might be left in a bad state.
        //
        // So while applying an action transaction, our store provides an implementation
        // for this function that if we're removing a task that has a pending update the
        // store can tell us about the update immediately before continuing with the
        // remove.
        this._getStore().onReferencedTaskAddOrRemove(oldTask.id);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(oldTask.id) === oldTask,
                "Subscription can\u2019t remove task that is not referenced with `_onReferencedTaskRemove()`",
            );

            previousTaskById.delete(oldTask.id);
        }

        this._trackTaskDependenciesFromRemove(context, eventBuilder, oldTask);

        this._callbacks.onReferencedTaskRemove(eventBuilder, oldTask);
    }

    protected _trackTaskDependenciesFromAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ) {
        // Get a reference to the parent tasks of loaded tasks
        const newParentTaskId = newTask.parent.taskId.value;
        if (newParentTaskId) {
            this._trackNewParentTaskDependency(context, eventBuilder, newParentTaskId);
        }

        // Get a reference to the collections of loaded tasks
        const newCollectionIds = new Set(
            newTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const newCollectionId of newCollectionIds) {
            const referencedCollectionEntry = getOrSetDefaultMapValue(
                this._referencedCollectionEntryById,
                newCollectionId,
                () => {
                    const collectionEntryPromise = this._getStore()
                        .loadCollectionEntry(context, newCollectionId)
                        .then(collectionEntry => {
                            collectionEntry.addTaskReferencesSubscriptionDependent(this);
                            this._onReferencedCollectionAdd(
                                context,
                                eventBuilder,
                                collectionEntry.collection,
                            );
                            return collectionEntry;
                        });

                    eventBuilder.waitUntil(context, collectionEntryPromise);

                    return {
                        referenceCount: 0,
                        promise: collectionEntryPromise,
                    };
                },
            );

            referencedCollectionEntry.referenceCount++;
        }
    }

    protected _trackTaskDependenciesFromUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
    ) {
        // If parent task updated then update our references
        const oldParentTaskId = oldTask.parent.taskId.value;
        const newParentTaskId = newTask.parent.taskId.value;

        if (oldParentTaskId !== newParentTaskId) {
            // Track references for the new parent first so if the old parent indirectly
            // references stuff in the new parent we don't remove those references and add them
            // immediately back.
            if (newParentTaskId) {
                this._trackNewParentTaskDependency(context, eventBuilder, newParentTaskId);
            }

            if (oldParentTaskId) {
                this._trackOldParentTaskDependency(context, eventBuilder, oldParentTaskId);
            }
        }

        // If collections updated then update our references
        if (oldTask.collections.raw.collections !== newTask.collections.raw.collections) {
            const newCollectionIds = new Set(
                newTask.collections.raw.collections
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );
            const oldCollectionIds = new Set(
                oldTask.collections.raw.collections
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );

            const addedCollectionIds = diffSets(newCollectionIds, oldCollectionIds);
            const removedCollectionIds = diffSets(oldCollectionIds, newCollectionIds);

            for (const addedCollectionId of addedCollectionIds) {
                const referencedCollectionEntry = getOrSetDefaultMapValue(
                    this._referencedCollectionEntryById,
                    addedCollectionId,
                    () => {
                        const collectionEntryPromise = this._getStore()
                            .loadCollectionEntry(context, addedCollectionId)
                            .then(collectionEntry => {
                                collectionEntry.addTaskReferencesSubscriptionDependent(this);
                                this._onReferencedCollectionAdd(
                                    context,
                                    eventBuilder,
                                    collectionEntry.collection,
                                );
                                return collectionEntry;
                            });

                        eventBuilder.waitUntil(context, collectionEntryPromise);

                        return {
                            referenceCount: 0,
                            promise: collectionEntryPromise,
                        };
                    },
                );

                referencedCollectionEntry.referenceCount++;
            }

            for (const removedCollectionId of removedCollectionIds) {
                const referencedCollectionEntry = assertExists(
                    this._referencedCollectionEntryById.get(removedCollectionId),
                );

                referencedCollectionEntry.referenceCount--;

                if (referencedCollectionEntry.referenceCount === 0) {
                    eventBuilder.waitUntil(
                        context,
                        referencedCollectionEntry.promise.then(collectionEntry => {
                            collectionEntry.removeTaskReferencesSubscriptionDependent(this);
                            this._onReferencedCollectionRemove(
                                eventBuilder,
                                collectionEntry.collection,
                            );
                        }),
                    );
                    this._referencedCollectionEntryById.delete(removedCollectionId);
                }
            }
        }
    }

    protected _trackTaskDependenciesFromRemove(
        context: Context<{process: ProcessContextModule}>,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
    ) {
        // Remove the reference to the parent task of this loaded task
        const oldParentTaskId = oldTask.parent.taskId.value;
        if (oldParentTaskId) {
            this._trackOldParentTaskDependency(context, eventBuilder, oldParentTaskId);
        }

        // Remove the references to the collections of this loaded task
        const oldCollectionIds = new Set(
            oldTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const oldCollectionId of oldCollectionIds) {
            const referencedCollectionEntry = assertExists(
                this._referencedCollectionEntryById.get(oldCollectionId),
            );

            referencedCollectionEntry.referenceCount--;

            if (referencedCollectionEntry.referenceCount === 0) {
                eventBuilder.waitUntil(
                    context,
                    referencedCollectionEntry.promise.then(collectionEntry => {
                        collectionEntry.removeTaskReferencesSubscriptionDependent(this);
                        this._onReferencedCollectionRemove(
                            eventBuilder,
                            collectionEntry.collection,
                        );
                    }),
                );
                this._referencedCollectionEntryById.delete(oldCollectionId);
            }
        }
    }

    private _trackNewParentTaskDependency(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newParentTaskId: TaskId,
    ) {
        const referencedTaskEntry = this._referencedTaskEntryById.get(newParentTaskId);

        if (referencedTaskEntry !== undefined) {
            referencedTaskEntry.referenceCount++;
        } else {
            const taskEntryPromiseResolver =
                createPromiseImmediateResolver<TaskRealtimeStoreTaskEntry>();

            // Use a promise resolver for `taskEntry` since we want to update
            // `_referencedTaskEntryById` immediately before calling `_onReferencedTaskAdd`
            // which may recurse back into this function if there's a cycle.
            const newReferencedTaskEntry = {
                referenceCount: 1,
                promise: taskEntryPromiseResolver.promise,
            };
            this._referencedTaskEntryById.set(newParentTaskId, newReferencedTaskEntry);

            eventBuilder.waitUntil(
                context,
                this._getStore()
                    .loadTaskEntry(context, newParentTaskId)
                    .then(taskEntry => {
                        // If, due to a race condition, we are adding this task and while the task is
                        // loading the task is removed but the task was part of a cycle then we need to
                        // detect we're in that case since we can't call `_onReferencedTaskAdd` twice.
                        //
                        // If the task is being removed then we have a remove callback running right after
                        // us at all times which will finish cleaning the task up.
                        if (detectCycleWhenAddingRemovedTaskId === taskEntry.task.id) {
                            return taskEntry;
                        }

                        if (newReferencedTaskEntry.referenceCount > 0) {
                            taskEntry.addTaskReferencesSubscriptionDependent(this);
                            this._onReferencedTaskAdd(context, eventBuilder, taskEntry.task);
                        } else {
                            const previousDetectCycleWhenAddingRemovedTaskId =
                                detectCycleWhenAddingRemovedTaskId;
                            detectCycleWhenAddingRemovedTaskId = taskEntry.task.id;
                            try {
                                taskEntry.addTaskReferencesSubscriptionDependent(this);
                                this._onReferencedTaskAdd(context, eventBuilder, taskEntry.task);
                            } finally {
                                detectCycleWhenAddingRemovedTaskId =
                                    previousDetectCycleWhenAddingRemovedTaskId;
                            }
                        }

                        return taskEntry;
                    })
                    .then(taskEntryPromiseResolver.resolve, taskEntryPromiseResolver.reject),
            );
        }
    }

    private _trackOldParentTaskDependency(
        context: Context<{process: ProcessContextModule}>,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldParentTaskId: TaskId,
    ) {
        // If we are removing a cycle then we should recursively visit this function but
        // the task has already been removed so we don't need to remove it again (we'll get
        // an assertion error if we try).
        if (removingCycleStartingWithTaskId === oldParentTaskId) return;

        const referencedTaskEntry = assertExists(
            this._referencedTaskEntryById.get(oldParentTaskId),
        );

        referencedTaskEntry.referenceCount--;

        if (referencedTaskEntry.referenceCount === 0) {
            // Make sure to delete before calling `_onReferencedTaskRemove` which may
            // recursively call this function if there's a cycle.
            this._referencedTaskEntryById.delete(oldParentTaskId);

            eventBuilder.waitUntil(
                context,
                referencedTaskEntry.promise.then(taskEntry => {
                    // If we've already synchronously removed this task then stop. We don't need to
                    // remove it again. This may happen when removing a cycle from an asynchronously
                    // resolved `taskEntry`.
                    if (detectCycleWhenRemovingTaskId === taskEntry.task.id) return;

                    const previousDetectCycleWhenRemovingTaskId = detectCycleWhenRemovingTaskId;
                    detectCycleWhenRemovingTaskId ??= taskEntry.task.id;
                    try {
                        taskEntry.removeTaskReferencesSubscriptionDependent(this);
                        this._onReferencedTaskRemove(context, eventBuilder, taskEntry.task);
                    } finally {
                        detectCycleWhenRemovingTaskId = previousDetectCycleWhenRemovingTaskId;
                    }
                }),
            );
        }
        // If we have a cycle then a task entry's one remaining reference might be a
        // reference to itself! Loop through the task's parents to see if we have a cycle
        // and if we find a cycle remove the entire thing.
        else if (referencedTaskEntry.referenceCount === 1) {
            const seenTaskIds = new Set<TaskId>([]);
            let currentReferencedTaskEntry = referencedTaskEntry;
            while (true) {
                // If a parent has more than one reference the cycle isn't dead even if we have a
                // cycle.
                if (currentReferencedTaskEntry.referenceCount !== 1) break;

                const currentReferencedTaskEntryPromiseState =
                    currentReferencedTaskEntry.promise.getStateWithoutListening();
                if (currentReferencedTaskEntryPromiseState.status !== "fulfilled") break;

                const taskEntry = currentReferencedTaskEntryPromiseState.value;
                const parentTaskId = taskEntry.task.parent.taskId.value;
                if (!parentTaskId) break;

                // If we find a parent we've already seen before, this is a cycle! Remove the
                // entire cycle as dependencies. `_onReferencedTaskRemove` will recursively visit
                // the other cycle members.
                if (seenTaskIds.has(taskEntry.task.id)) {
                    const previousRemovingCycleFromInitialTaskId = removingCycleStartingWithTaskId;
                    removingCycleStartingWithTaskId = taskEntry.task.id;
                    try {
                        this._referencedTaskEntryById.delete(taskEntry.task.id);
                        taskEntry.removeTaskReferencesSubscriptionDependent(this);
                        this._onReferencedTaskRemove(context, eventBuilder, taskEntry.task);
                    } finally {
                        removingCycleStartingWithTaskId = previousRemovingCycleFromInitialTaskId;
                    }
                    break;
                }
                seenTaskIds.add(taskEntry.task.id);

                currentReferencedTaskEntry = assertExists(
                    this._referencedTaskEntryById.get(parentTaskId),
                );
            }
        }
    }

    private _onReferencedCollectionAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newCollection: TaskCollectionIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousCollectionById = getOrSetDefaultMapValue(
                assertExists(previousReferencedCollectionByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousCollectionById.has(newCollection.id),
                "Subscription can\u2019t add task that\u2019s already referenced with `_onReferencedCollectionAdd()`",
            );

            previousCollectionById.set(newCollection.id, newCollection);
        }

        this._callbacks.onReferencedCollectionAdd(context, eventBuilder, newCollection);
    }

    public onReferencedCollectionUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionId: TaskCollectionId,
        oldCollection: TaskCollectionIndexDoc,
        newCollection: TaskCollectionIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousCollectionById = getOrSetDefaultMapValue(
                assertExists(previousReferencedCollectionByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousCollectionById.get(collectionId) === oldCollection,
                "Subscription must observe all updates to a referenced task through `onReferencedCollectionUpdate()`",
            );

            previousCollectionById.set(collectionId, newCollection);
        }

        this._callbacks.onReferencedCollectionUpdate(
            context,
            eventBuilder,
            collectionId,
            oldCollection,
            newCollection,
            actions,
        );
    }

    private _onReferencedCollectionRemove(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldCollection: TaskCollectionIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousCollectionById = getOrSetDefaultMapValue(
                assertExists(previousReferencedCollectionByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousCollectionById.get(oldCollection.id) === oldCollection,
                "Subscription can\u2019t remove collection that is not referenced with `_onReferencedCollectionRemove()`",
            );

            previousCollectionById.delete(oldCollection.id);
        }

        this._callbacks.onReferencedCollectionRemove(eventBuilder, oldCollection);
    }
}

let removingCycleStartingWithTaskId: TaskId | null = null;
let detectCycleWhenAddingRemovedTaskId: TaskId | null = null;
let detectCycleWhenRemovingTaskId: TaskId | null = null;
