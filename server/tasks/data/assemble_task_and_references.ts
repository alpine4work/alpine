import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {TaskCollectionIndexDocBase} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc, TaskIndexDocBase} from "~/server/tasks/data/task_index_doc.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

/**
 * Helper function for assembling a task and all of its references in the same
 * way `loadTaskRealtimeQueries()`. (Except we only load one task.)
 *
 * Does no work to determine whether you have access to the tasks or
 * collections being loaded, the loader functions you provide must do that.
 */
// NOTE(calebmer, 2023-12-30): You could use this to implement `getTask()`
// loading data from either `TaskRealtimeService` or directly from the
// OpenSearch task index. We used to need both but currently this function is
// only being used to load from the OpenSearch task index. Leaving this
// abstraction in place if it's ever needed again.
export async function assembleTaskAndReferences(
    taskId: TaskId,
    {
        getTaskIndexDoc,
        getCollectionIndexDoc,
    }: {
        getTaskIndexDoc: (taskId: TaskId) => Promise<TaskIndexDocBase & {id: TaskId}>;
        getCollectionIndexDoc: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionIndexDocBase & {id: TaskCollectionId}>;
    },
): Promise<{
    task: TaskModel;
    referencedTasks: ReadonlyArray<TaskModel>;
    referencedCollections: ReadonlyArray<TaskCollectionModel>;
}> {
    const task = await getTaskIndexDoc(taskId);

    // NOTE(calebmer): Passing in null will wipe all private data from the task.
    // Given this is a system context a better approach may be to include all
    // private data. Wiping is the safer option and nothing downstream needs the
    // data at the moment.
    const taskModel = prepareTaskForClient(null, task);

    let promises: Array<Promise<void>> = [];
    const loadingTaskIds = new Set<TaskId>();
    const loadingCollectionIds = new Set<TaskCollectionId>();

    const rootTaskId = taskId;
    const referencedTaskModels: Array<TaskModel> = [];
    const referencedCollectionModels: Array<TaskCollectionModel> = [];

    const trackTaskDependencies = (task: TaskIndexDoc) => {
        const parentTaskId = task.parent.taskId.value;
        if (parentTaskId && parentTaskId !== rootTaskId && !loadingTaskIds.has(parentTaskId)) {
            loadingTaskIds.add(parentTaskId);
            promises.push(
                getTaskIndexDoc(parentTaskId).then(parentTask => {
                    referencedTaskModels.push(
                        // NOTE(calebmer): Passing in null will wipe all private data from the task.
                        // Given this is a system context a better approach may be to include all
                        // private data. Wiping is the safer option and nothing downstream needs the
                        // data at the moment.
                        prepareTaskForClient(null, parentTask),
                    );
                    trackTaskDependencies(parentTask);
                }),
            );
        }

        for (const {collectionId} of task.collections.raw.collections.getArray()) {
            if (loadingCollectionIds.has(collectionId)) continue;

            loadingCollectionIds.add(collectionId);
            promises.push(
                getCollectionIndexDoc(collectionId).then(collection => {
                    referencedCollectionModels.push(prepareTaskCollectionForClient(collection));
                }),
            );
        }
    };

    trackTaskDependencies(task);

    // Wait for all the promises in the `promises` array. We may add new `promises`
    // while waiting so we need to loop until `promises` is empty.
    {
        let hasError = false;
        let error: unknown;

        // Wait for all discovered promises to resolve before returning.
        //
        // Even if there's an error. Only throw our error at the very end.
        while (promises.length > 0) {
            const currentPromises = promises;
            promises = [];

            try {
                await runAllPromises(currentPromises);
            } catch (newError) {
                if (!hasError) {
                    hasError = true;
                    error = newError;
                }
                // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
                // just the first one. Probably by using an `AggregateError`.
                else if (!isSystemError(error) && isSystemError(newError)) {
                    error = newError;
                }
            }
        }

        if (hasError) throw error;
    }

    return {
        task: taskModel,
        referencedTasks: referencedTaskModels,
        referencedCollections: referencedCollectionModels,
    };
}
