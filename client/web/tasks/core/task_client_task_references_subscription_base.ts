import {
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {diffSets} from "~/shared/helpers/set/diff_sets.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {Store} from "~/shared/store/store.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

const previousReferencedTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<
              TaskClientTaskReferencesSubscriptionBase,
              Map<TaskId, TaskClientStoreTaskEntry>
          >()
        : null;

/**
 * Base class for `TaskClientQueryInternal` and `TaskClientTaskSubscription`. Both
 * of these classes maintain a subscription to some tasks. They also need to
 * maintain subscriptions to all data referenced by the tasks including parent
 * tasks (recursively) and collections.
 *
 * This base class shares the bookkeeping logic for maintaining task references in
 * realtime.
 */
export abstract class TaskClientTaskReferencesSubscriptionBase {
    protected _onBeforeReferencedTaskAddOrRemove: ((taskId: TaskId) => void) | null = null;

    protected abstract _getStore(): TaskClientStoreInternal;

    protected readonly _referencedTaskEntryStoreById = new Map<
        TaskId,
        {referenceCount: number; store: Store<TaskClientStoreTaskEntry>}
    >();

    protected readonly _referencedCollectionEntryStoreById = new Map<
        TaskCollectionId,
        {referenceCount: number; store: Store<TaskClientStoreCollectionEntry>}
    >();

    /**
     * Get the store associated with the provided `TaskId`.
     *
     * Throws an error if `TaskId` is not referenced by this class when you call this
     * function.
     *
     * The `task` in this store should be non-null when this function is called but if
     * you hold onto this reference for long enough you may see `task` become null
     * because the task becomes unauthorized.
     */
    public getReferencedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        const taskEntryStore = this._referencedTaskEntryStoreById.get(taskId);
        if (!taskEntryStore) throw new InternalError("Task is not referenced");
        return taskEntryStore.store;
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskId`. Prefer using
     * `getReferencedTaskEntryStore()` since it will give you changes to the task over
     * time.
     *
     * Throws an error if `TaskId` is not referenced by this class when you call this
     * function.
     */
    public getReferencedTaskSnapshot(taskId: TaskId): TaskModel {
        return assertExists(this.getReferencedTaskEntryStore(taskId).getSnapshot().task);
    }

    /**
     * Get the collection associated with the provided `TaskCollectionId`.
     *
     * Throws an error if `TaskCollectionId` is not referenced by this class when you
     * call this function.
     *
     * The `collection` in this store should be non-null when this function is called
     * but if you hold onto this reference for long enough you may see `collection`
     * become null because the task becomes unauthorized.
     */
    public getReferencedCollectionEntryStore(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry> {
        const collectionEntryStore = this._referencedCollectionEntryStoreById.get(collectionId);
        if (!collectionEntryStore) throw new InternalError("Collection is not referenced");
        return collectionEntryStore.store;
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskCollectionId`.
     * Prefer using `getReferencedCollectionEntryStore()` since it will give you
     * changes to the task over time.
     *
     * Throws an error if `TaskCollectionId` is not referenced by this class when you
     * call this function.
     */
    public getReferencedCollectionSnapshot(collectionId: TaskCollectionId): TaskCollectionModel {
        return assertExists(
            this.getReferencedCollectionEntryStore(collectionId).getSnapshot().collection,
        );
    }

    private _onReferencedTaskAdd(taskId: TaskId, newTaskEntry: TaskClientStoreTaskEntry) {
        // Makes sure we apply any updates to this task before adding it. See the comment
        // on our `onReferencedTaskRemove()` call below for more information.
        //
        // While it's ok for this class to see an add with an old task then an update with
        // the new task, our subscribed callbacks may be confused to see an old task from
        // this call when it's seen a new task from another subscription.
        this._onBeforeReferencedTaskAddOrRemove?.(taskId);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskById.has(taskId),
                "Subscription can\u2019t add task that\u2019s already referenced with `_onReferencedTaskAdd()`",
            );

            previousTaskById.set(taskId, newTaskEntry);
        }

        this._trackTaskDependenciesFromAdd(newTaskEntry);
    }

    protected _onReferencedTaskUpdate(
        taskId: TaskId,
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTaskEntry,
                "Subscription must observe all updates to a referenced task through `onReferencedTaskUpdate()`",
            );

            previousTaskById.set(taskId, newTaskEntry);
        }

        this._trackTaskDependenciesFromUpdate(oldTaskEntry, newTaskEntry);
    }

    private _onReferencedTaskRemove(taskId: TaskId, oldTaskEntry: TaskClientStoreTaskEntry) {
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
        // So while applying an action transaction, the class provides an implementation
        // for this function that if we're removing a task that has a pending update the
        // class can tell us about the update immediately before continuing with the
        // remove.
        this._onBeforeReferencedTaskAddOrRemove?.(taskId);

        // When testing, keep track of the tasks we've seen so we can guarantee we've seen
        // every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTaskEntry,
                "Subscription can\u2019t remove task that is not referenced with `_onReferencedTaskRemove()`",
            );

            previousTaskById.delete(taskId);
        }

        this._trackTaskDependenciesFromRemove(oldTaskEntry);
    }

    protected _trackTaskDependenciesFromAdd(newTaskEntry: TaskClientStoreTaskEntry) {
        // Get a reference to the parent tasks of loaded tasks
        const newTaskIds = new Set(collectTaskEntryTaskDependencies(newTaskEntry));
        for (const newTaskId of newTaskIds) {
            this._trackNewTaskDependency(newTaskId);
        }

        // Get a reference to the collections of loaded tasks
        const newCollectionIds = new Set(collectTaskEntryCollectionDependencies(newTaskEntry));
        for (const newCollectionId of newCollectionIds) {
            this._trackNewCollectionDependency(newCollectionId);
        }
    }

    protected _trackTaskDependenciesFromUpdate(
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        // If parent task updated then update our references
        if (didTaskEntryTaskDependenciesChange(oldTaskEntry, newTaskEntry)) {
            const newTaskIds = new Set(collectTaskEntryTaskDependencies(newTaskEntry));
            const oldTaskIds = new Set(collectTaskEntryTaskDependencies(oldTaskEntry));

            const addedTaskIds = diffSets(newTaskIds, oldTaskIds);
            const removedTaskIds = diffSets(oldTaskIds, newTaskIds);

            // Track references for the new parent first so if the old parent indirectly
            // references stuff in the new parent we don't remove those references and add them
            // immediately back.
            for (const taskId of addedTaskIds) {
                this._trackNewTaskDependency(taskId);
            }

            for (const taskId of removedTaskIds) {
                this._trackOldTaskDependency(taskId);
            }
        }

        // If collections updated then update our references
        if (didTaskEntryCollectionDependenciesChange(oldTaskEntry, newTaskEntry)) {
            const newCollectionIds = new Set(collectTaskEntryCollectionDependencies(newTaskEntry));
            const oldCollectionIds = new Set(collectTaskEntryCollectionDependencies(oldTaskEntry));

            const addedCollectionIds = diffSets(newCollectionIds, oldCollectionIds);
            const removedCollectionIds = diffSets(oldCollectionIds, newCollectionIds);

            for (const addedCollectionId of addedCollectionIds) {
                this._trackNewCollectionDependency(addedCollectionId);
            }

            for (const removedCollectionId of removedCollectionIds) {
                this._trackOldCollectionDependency(removedCollectionId);
            }
        }
    }

    protected _trackTaskDependenciesFromRemove(oldTaskEntry: TaskClientStoreTaskEntry) {
        // Remove the reference to the parent task of this loaded task
        const oldTaskIds = new Set(collectTaskEntryTaskDependencies(oldTaskEntry));
        for (const oldTaskId of oldTaskIds) {
            this._trackOldTaskDependency(oldTaskId);
        }

        // Remove the references to the collections of this loaded task
        const oldCollectionIds = new Set(collectTaskEntryCollectionDependencies(oldTaskEntry));
        for (const oldCollectionId of oldCollectionIds) {
            this._trackOldCollectionDependency(oldCollectionId);
        }
    }

    private _trackNewTaskDependency(newTaskId: TaskId) {
        const referencedTaskEntryStore = this._referencedTaskEntryStoreById.get(newTaskId);

        if (referencedTaskEntryStore !== undefined) {
            referencedTaskEntryStore.referenceCount++;
        } else {
            // The server makes sure all parent tasks are available so it's safe to assert. If
            // a parent task is not available that means the server has failed to send us some
            // data or we didn't retain a reference to the task and it was garbage collected.
            const taskEntryStore = assertExists(
                this._getStore()._getTaskEntryStoreIfExists(newTaskId),
                "Referenced task is not present in store",
            );

            this._referencedTaskEntryStoreById.set(newTaskId, {
                referenceCount: 1,
                store: taskEntryStore,
            });

            // While a task is referenced in our subscription class, it should also be
            // referenced in the store.
            this._getStore().retainTaskEntryStore(newTaskId);

            this._onReferencedTaskAdd(newTaskId, taskEntryStore.getSnapshot());
        }
    }

    private _trackOldTaskDependency(oldTaskId: TaskId) {
        // If we are removing a cycle then we should recursively visit this function but
        // the task has already been removed so we don't need to remove it again (we'll get
        // an assertion error if we try).
        if (removingCycleStartingWithTaskId === oldTaskId) return;

        const referencedTaskEntryStore = assertExists(
            this._referencedTaskEntryStoreById.get(oldTaskId),
        );

        referencedTaskEntryStore.referenceCount--;

        if (referencedTaskEntryStore.referenceCount === 0) {
            this._referencedTaskEntryStoreById.delete(oldTaskId);
            this._getStore().releaseTaskEntryStore(oldTaskId);
            this._onReferencedTaskRemove(oldTaskId, referencedTaskEntryStore.store.getSnapshot());
        }
        // If we have a cycle then a task entry's one remaining reference might be a
        // reference to itself! Loop through the task's parents to see if we have a cycle
        // and if we find a cycle remove the entire thing.
        else if (referencedTaskEntryStore.referenceCount === 1) {
            const seenTaskIds = new Set<TaskId>([]);
            let currentReferencedTaskEntryStore = referencedTaskEntryStore;
            while (true) {
                // If a parent has more than one reference the cycle isn't dead even if we have a
                // cycle.
                if (currentReferencedTaskEntryStore.referenceCount !== 1) break;

                const taskEntry = currentReferencedTaskEntryStore.store.getSnapshot();
                if (!taskEntry.task) break;
                const parentTaskId = taskEntry.task.getParent()?.taskId;
                if (!parentTaskId) break;

                // If we find a parent we've already seen before, this is a cycle! Remove the
                // entire cycle as dependencies. `_onReferencedTaskRemove` will recursively visit
                // the other cycle members.
                if (seenTaskIds.has(taskEntry.task.id)) {
                    const previousRemovingCycleFromInitialTaskId = removingCycleStartingWithTaskId;
                    removingCycleStartingWithTaskId = taskEntry.task.id;
                    try {
                        this._referencedTaskEntryStoreById.delete(taskEntry.task.id);
                        this._getStore().releaseTaskEntryStore(oldTaskId);
                        this._onReferencedTaskRemove(taskEntry.task.id, taskEntry);
                    } finally {
                        removingCycleStartingWithTaskId = previousRemovingCycleFromInitialTaskId;
                    }
                    break;
                }
                seenTaskIds.add(taskEntry.task.id);

                currentReferencedTaskEntryStore = assertExists(
                    this._referencedTaskEntryStoreById.get(parentTaskId),
                );
            }
        }
    }

    private _trackNewCollectionDependency(newCollectionId: TaskCollectionId) {
        const referencedCollectionEntryStore =
            this._referencedCollectionEntryStoreById.get(newCollectionId);

        if (referencedCollectionEntryStore !== undefined) {
            referencedCollectionEntryStore.referenceCount++;
        } else {
            // The server makes sure all referenced collections are available so it's safe to
            // assert. If a parent task is not available that means the server has failed to
            // send us some data or we didn't retain a reference to the collection and it was
            // garbage collected.
            const collectionEntryStore = assertExists(
                this._getStore()._getCollectionEntryStoreIfExists(newCollectionId),
                "Referenced collection is not present in store",
            );

            this._referencedCollectionEntryStoreById.set(newCollectionId, {
                referenceCount: 1,
                store: collectionEntryStore,
            });

            // While a collection is referenced in our subscription class, it should also be
            // referenced in the store.
            this._getStore().retainCollectionEntryStore(newCollectionId);
        }
    }

    private _trackOldCollectionDependency(oldCollectionId: TaskCollectionId) {
        const referencedCollectionEntryStore = assertExists(
            this._referencedCollectionEntryStoreById.get(oldCollectionId),
        );

        referencedCollectionEntryStore.referenceCount--;

        if (referencedCollectionEntryStore.referenceCount === 0) {
            this._referencedCollectionEntryStoreById.delete(oldCollectionId);
            this._getStore().releaseCollectionEntryStore(oldCollectionId);
        }
    }
}

let removingCycleStartingWithTaskId: TaskId | null = null;

/**
 * Did the task dependencies for this task change?
 *
 * Should be the same as
 * `!isDeepEqual(new Set(collectTaskEntryTaskDependencies(oldTaskEntry)), new Set(collectTaskEntryTaskDependencies(newTaskEntry)))`
 * but more efficient.
 */
function didTaskEntryTaskDependenciesChange(
    oldTaskEntry: TaskClientStoreTaskEntry,
    newTaskEntry: TaskClientStoreTaskEntry,
): boolean {
    return (
        oldTaskEntry.task?.getParent()?.taskId !== newTaskEntry.task?.getParent()?.taskId ||
        oldTaskEntry.optimisticState?.original.task?.getParent()?.taskId !==
            newTaskEntry.optimisticState?.original.task?.getParent()?.taskId
    );
}

/**
 * Collect all the task dependencies in a task entry. Both in the optimistic task
 * and the task without optimistic updates.
 */
function* collectTaskEntryTaskDependencies(taskEntry: TaskClientStoreTaskEntry): Iterable<TaskId> {
    if (taskEntry.task) yield* collectTaskModelTaskDependencies(taskEntry.task);
    if (taskEntry.optimisticState?.original.task)
        yield* collectTaskModelTaskDependencies(taskEntry.optimisticState.original.task);
}

function* collectTaskModelTaskDependencies(task: TaskModel): Iterable<TaskId> {
    const parent = task.getParent();
    if (parent) yield parent.taskId;
}

/**
 * Did the collection dependencies for this task change?
 *
 * Should be the same as
 * `!isDeepEqual(new Set(collectTaskEntryCollectionDependencies(oldTaskEntry)), new Set(collectTaskEntryCollectionDependencies(newTaskEntry)))`
 * but more efficient.
 */
function didTaskEntryCollectionDependenciesChange(
    oldTaskEntry: TaskClientStoreTaskEntry,
    newTaskEntry: TaskClientStoreTaskEntry,
): boolean {
    return (
        oldTaskEntry.task?.getCollections() !== newTaskEntry.task?.getCollections() ||
        oldTaskEntry.optimisticState?.original.task?.getCollections() !==
            newTaskEntry.optimisticState?.original.task?.getCollections()
    );
}

/**
 * Collect all the collection dependencies in a task entry. Both in the optimistic
 * task and the task without optimistic updates.
 */
function* collectTaskEntryCollectionDependencies(
    taskEntry: TaskClientStoreTaskEntry,
): Iterable<TaskCollectionId> {
    if (taskEntry.task) yield* collectTaskModelCollectionDependencies(taskEntry.task);
    if (taskEntry.optimisticState?.original.task)
        yield* collectTaskModelCollectionDependencies(taskEntry.optimisticState.original.task);
}

function* collectTaskModelCollectionDependencies(task: TaskModel): Iterable<TaskCollectionId> {
    for (const {collectionId} of task.getCollections().getArray()) {
        yield collectionId;
    }
}
