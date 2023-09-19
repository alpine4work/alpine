import {Store} from "~/client/helpers/store/store.js";
import {
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/tasks/task_client_store.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

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
    protected abstract _getStore(): TaskClientStoreInternal;

    protected readonly _referencedTaskEntryStoreById = new Map<
        TaskId,
        {referenceCount: number; taskEntryStore: Store<TaskClientStoreTaskEntry>}
    >();

    protected readonly _referencedCollectionEntryStoreById = new Map<
        TaskCollectionId,
        {referenceCount: number; taskEntryStore: Store<TaskClientStoreCollectionEntry>}
    >();

    private _onReferencedTaskAdd(newTaskEntry: TaskClientStoreTaskEntry) {
        this._trackTaskDependenciesFromAdd(newTaskEntry);
    }

    protected _onReferencedTaskUpdate(
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        this._trackTaskDependenciesFromUpdate(oldTaskEntry, newTaskEntry);
    }

    private _onReferencedTaskRemove(oldTaskEntry: TaskClientStoreTaskEntry) {
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
                // failed to send us some data or we didn't hold a reference to the task and it
                // was garbage collected.
                const collectionEntryStore = assertExists(
                    this._getStore().getCollectionEntryStoreIfExists(newCollectionId),
                );

                this._referencedCollectionEntryStoreById.set(newCollectionId, {
                    referenceCount: 1,
                    taskEntryStore: collectionEntryStore,
                });
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
                    // failed to send us some data or we didn't hold a reference to the task and it
                    // was garbage collected.
                    const collectionEntryStore = assertExists(
                        this._getStore().getCollectionEntryStoreIfExists(addedCollectionId),
                    );

                    this._referencedCollectionEntryStoreById.set(addedCollectionId, {
                        referenceCount: 1,
                        taskEntryStore: collectionEntryStore,
                    });
                }
            }

            for (const removedCollectionId of removedCollectionIds) {
                const referencedCollectionEntryStore = assertExists(
                    this._referencedCollectionEntryStoreById.get(removedCollectionId),
                );

                referencedCollectionEntryStore.referenceCount--;

                if (referencedCollectionEntryStore.referenceCount === 0) {
                    this._referencedCollectionEntryStoreById.delete(removedCollectionId);
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
            // us some data or we didn't hold a reference to the task and it was garbage
            // collected.
            const taskEntryStore = assertExists(
                this._getStore().getTaskEntryStoreIfExists(newParentTaskId),
            );

            this._referencedTaskEntryStoreById.set(newParentTaskId, {
                referenceCount: 1,
                taskEntryStore,
            });

            this._onReferencedTaskAdd(taskEntryStore.getSnapshot());
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
            this._onReferencedTaskRemove(referencedTaskEntryStore.taskEntryStore.getSnapshot());
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

                const taskEntry = currentReferencedTaskEntryStore.taskEntryStore.getSnapshot();
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
                        this._onReferencedTaskRemove(taskEntry);
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

function diffSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>(set1);

    for (const item of set2) {
        newSet.delete(item);
    }

    return newSet;
}
