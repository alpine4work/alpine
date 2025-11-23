import {
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {diffSets} from "~/shared/helpers/set/diff_sets.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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
 * Base class for `TaskClientQueryInternal` and `TaskClientTaskSubscription`.
 * Both of these classes maintain a subscription to some tasks. They also need
 * to maintain subscriptions to all data referenced by the tasks including
 * parent tasks (recursively) and collections.
 *
 * This base class shares the bookkeeping logic for maintaining task
 * references in realtime.
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
     * Throws an error if `TaskId` is not referenced by this class when you call
     * this function.
     *
     * The `task` in this store should be non-null when this function is called but
     * if you hold onto this reference for long enough you may see `task` become
     * null because the task becomes unauthorized.
     */
    public getReferencedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        const taskEntryStore = this._referencedTaskEntryStoreById.get(taskId);
        if (!taskEntryStore) throw new InternalError("Task is not referenced");
        return taskEntryStore.store;
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskId`. Prefer
     * using `getReferencedTaskEntryStore()` since it will give you changes to the
     * task over time.
     *
     * Throws an error if `TaskId` is not referenced by this class when you call
     * this function.
     */
    public getReferencedTaskSnapshot(taskId: TaskId): TaskModel {
        return assertExists(this.getReferencedTaskEntryStore(taskId).getSnapshot().task);
    }

    /**
     * Get the collection associated with the provided `TaskCollectionId`.
     *
     * Throws an error if `TaskCollectionId` is not referenced by this class
     * when you call this function.
     *
     * The `collection` in this store should be non-null when this function is
     * called but if you hold onto this reference for long enough you may see
     * `collection` become null because the task becomes unauthorized.
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
     * Throws an error if `TaskCollectionId` is not referenced by this class when
     * you call this function.
     */
    public getReferencedCollectionSnapshot(collectionId: TaskCollectionId): TaskCollectionModel {
        return assertExists(
            this.getReferencedCollectionEntryStore(collectionId).getSnapshot().collection,
        );
    }

    private _onReferencedTaskAdd(taskId: TaskId, newTaskEntry: TaskClientStoreTaskEntry) {
        // Makes sure we apply any updates to this task before adding it. See the
        // comment on our `onReferencedTaskRemove()` call below for more information.
        //
        // While it's ok for this class to see an add with an old task then an update
        // with the new task, our subscribed callbacks may be confused to see an old
        // task from this call when it's seen a new task from another subscription.
        this._onBeforeReferencedTaskAddOrRemove?.(taskId);

        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskById.has(taskId),
                "Subscription can’t add task that’s already referenced with `_onReferencedTaskAdd()`",
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
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
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
        // When we apply an action transaction, there are potentially many updates to
        // many tasks that we apply all at once. Let's say a query references a parent
        // task and we both need to update the parent task and remove it from the query
        // in the same action transaction.
        //
        // This happens when deleting a task and all its children if you're subscribed
        // to the children query, for instance. The parent task of the children is
        // referenced and its children counts update (since the children are all
        // deleted).
        //
        // So in this case we need to see the update to the referenced task BEFORE we
        // can remove it. We assert that EVERY update to a task must be witnessed by
        // this class in order. Otherwise our tracked references might be left in a
        // bad state.
        //
        // So while applying an action transaction, the class provides an
        // implementation for this function that if we're removing a task that has a
        // pending update the class can tell us about the update immediately before
        // continuing with the remove.
        this._onBeforeReferencedTaskAddOrRemove?.(taskId);

        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTaskEntry,
                "Subscription can’t remove task that is not referenced with `_onReferencedTaskRemove()`",
            );

            previousTaskById.delete(taskId);
        }

        this._trackTaskDependenciesFromRemove(oldTaskEntry);
    }

    protected _trackTaskDependenciesFromAdd(newTaskEntry: TaskClientStoreTaskEntry) {
        // Get a reference to the parent tasks of loaded tasks
        const newParentTaskId = newTaskEntry.task?.getParent()?.taskId;
        if (newParentTaskId) {
            this._trackNewParentTaskDependency(newParentTaskId);
        }

        // Get a reference to the collections of loaded tasks
        const newCollectionIds = new Set(
            newTaskEntry.task
                ?.getCollections()
                .getArray()
                .map(({collectionId}) => collectionId),
        );
        for (const newCollectionId of newCollectionIds) {
            const referencedCollectionEntryStore =
                this._referencedCollectionEntryStoreById.get(newCollectionId);

            if (referencedCollectionEntryStore !== undefined) {
                referencedCollectionEntryStore.referenceCount++;
            } else {
                // The server makes sure all referenced collections are available so it's safe
                // to assert. If a parent task is not available that means the server has
                // failed to send us some data or we didn't retain a reference to the collection
                // and it was garbage collected.
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
    }

    protected _trackTaskDependenciesFromUpdate(
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        // If parent task updated then update our references
        const oldParentTaskId = oldTaskEntry.task?.getParent()?.taskId;
        const newParentTaskId = newTaskEntry.task?.getParent()?.taskId;

        if (oldParentTaskId !== newParentTaskId) {
            // Track references for the new parent first so if the old parent indirectly
            // references stuff in the new parent we don't remove those references and add
            // them immediately back.
            if (newParentTaskId) {
                this._trackNewParentTaskDependency(newParentTaskId);
            }

            if (oldParentTaskId) {
                this._trackOldParentTaskDependency(oldParentTaskId);
            }
        }

        // If collections updated then update our references
        if (oldTaskEntry.task?.getCollections() !== newTaskEntry.task?.getCollections()) {
            const newCollectionIds = new Set(
                newTaskEntry.task
                    ?.getCollections()
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );
            const oldCollectionIds = new Set(
                oldTaskEntry.task
                    ?.getCollections()
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );

            const addedCollectionIds = diffSets(newCollectionIds, oldCollectionIds);
            const removedCollectionIds = diffSets(oldCollectionIds, newCollectionIds);

            for (const addedCollectionId of addedCollectionIds) {
                const referencedCollectionEntryStore =
                    this._referencedCollectionEntryStoreById.get(addedCollectionId);

                if (referencedCollectionEntryStore !== undefined) {
                    referencedCollectionEntryStore.referenceCount++;
                } else {
                    // The server makes sure all referenced collections are available so it's safe
                    // to assert. If a parent task is not available that means the server has
                    // failed to send us some data or we didn't retain a reference to the collection
                    // and it was garbage collected.
                    const collectionEntryStore = assertExists(
                        this._getStore()._getCollectionEntryStoreIfExists(addedCollectionId),
                        "Referenced collection is not present in store",
                    );

                    this._referencedCollectionEntryStoreById.set(addedCollectionId, {
                        referenceCount: 1,
                        store: collectionEntryStore,
                    });

                    // While a collection is referenced in our subscription class, it should also be
                    // referenced in the store.
                    this._getStore().retainCollectionEntryStore(addedCollectionId);
                }
            }

            for (const removedCollectionId of removedCollectionIds) {
                const referencedCollectionEntryStore = assertExists(
                    this._referencedCollectionEntryStoreById.get(removedCollectionId),
                );

                referencedCollectionEntryStore.referenceCount--;

                if (referencedCollectionEntryStore.referenceCount === 0) {
                    this._referencedCollectionEntryStoreById.delete(removedCollectionId);
                    this._getStore().releaseCollectionEntryStore(removedCollectionId);
                }
            }
        }
    }

    protected _trackTaskDependenciesFromRemove(oldTaskEntry: TaskClientStoreTaskEntry) {
        // Remove the reference to the parent task of this loaded task
        const oldParentTaskId = oldTaskEntry.task?.getParent()?.taskId;
        if (oldParentTaskId) {
            this._trackOldParentTaskDependency(oldParentTaskId);
        }

        // Remove the references to the collections of this loaded task
        const oldCollectionIds = new Set(
            oldTaskEntry.task
                ?.getCollections()
                .getArray()
                .map(({collectionId}) => collectionId),
        );
        for (const oldCollectionId of oldCollectionIds) {
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

    private _trackNewParentTaskDependency(newParentTaskId: TaskId) {
        const referencedTaskEntryStore = this._referencedTaskEntryStoreById.get(newParentTaskId);

        if (referencedTaskEntryStore !== undefined) {
            referencedTaskEntryStore.referenceCount++;
        } else {
            // The server makes sure all parent tasks are available so it's safe to assert.
            // If a parent task is not available that means the server has failed to send
            // us some data or we didn't retain a reference to the task and it was garbage
            // collected.
            const taskEntryStore = assertExists(
                this._getStore()._getTaskEntryStoreIfExists(newParentTaskId),
                "Referenced task is not present in store",
            );

            this._referencedTaskEntryStoreById.set(newParentTaskId, {
                referenceCount: 1,
                store: taskEntryStore,
            });

            // While a task is referenced in our subscription class, it should also be
            // referenced in the store.
            this._getStore().retainTaskEntryStore(newParentTaskId);

            this._onReferencedTaskAdd(newParentTaskId, taskEntryStore.getSnapshot());
        }
    }

    private _trackOldParentTaskDependency(oldParentTaskId: TaskId) {
        // If we are removing a cycle then we should recursively visit this function
        // but the task has already been removed so we don't need to remove it again
        // (we'll get an assertion error if we try).
        if (removingCycleStartingWithTaskId === oldParentTaskId) return;

        const referencedTaskEntryStore = assertExists(
            this._referencedTaskEntryStoreById.get(oldParentTaskId),
        );

        referencedTaskEntryStore.referenceCount--;

        if (referencedTaskEntryStore.referenceCount === 0) {
            this._referencedTaskEntryStoreById.delete(oldParentTaskId);
            this._getStore().releaseTaskEntryStore(oldParentTaskId);
            this._onReferencedTaskRemove(
                oldParentTaskId,
                referencedTaskEntryStore.store.getSnapshot(),
            );
        }
        // If we have a cycle then a task entry's one remaining reference might be a
        // reference to itself! Loop through the task's parents to see if we have a
        // cycle and if we find a cycle remove the entire thing.
        else if (referencedTaskEntryStore.referenceCount === 1) {
            const seenTaskIds = new Set<TaskId>([]);
            let currentReferencedTaskEntryStore = referencedTaskEntryStore;
            while (true) {
                // If a parent has more than one reference the cycle isn't dead even if we have
                // a cycle.
                if (currentReferencedTaskEntryStore.referenceCount !== 1) break;

                const taskEntry = currentReferencedTaskEntryStore.store.getSnapshot();
                if (!taskEntry.task) break;
                const parentTaskId = taskEntry.task.getParent()?.taskId;
                if (!parentTaskId) break;

                // If we find a parent we've already seen before, this is a cycle! Remove the
                // entire cycle as dependencies. `_onReferencedTaskRemove` will recursively
                // visit the other cycle members.
                if (seenTaskIds.has(taskEntry.task.id)) {
                    const previousRemovingCycleFromInitialTaskId = removingCycleStartingWithTaskId;
                    removingCycleStartingWithTaskId = taskEntry.task.id;
                    try {
                        this._referencedTaskEntryStoreById.delete(taskEntry.task.id);
                        this._getStore().releaseTaskEntryStore(oldParentTaskId);
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
}

let removingCycleStartingWithTaskId: TaskId | null = null;
