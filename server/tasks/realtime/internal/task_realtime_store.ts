import {mergeTaskIndexDocs} from "~/server/tasks/index/merge_task_index_docs.js";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/internal/task_realtime_action_history.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/internal/task_realtime_query.js";
import {TaskId} from "~/shared/id/types/id_types.js";

type TaskRealtimeStoreTaskEntry = {
    task: TaskIndexDoc;
    readonly visibleInQueries: Set<TaskRealtimeQuery>;
};

export class TaskRealtimeStore {
    private readonly _actionHistory: TaskRealtimeActionHistory;
    private readonly _taskEntryById = new Map<TaskId, TaskRealtimeStoreTaskEntry>();

    public addSearchedVisibleTasksForQuery(
        query: TaskRealtimeQuery,
        tasks: ReadonlyArray<{taskId: TaskId; task: TaskIndexDoc}>,
    ) {
        const freshTaskById = new Map<TaskId, TaskIndexDoc>();

        for (const {taskId, task: searchedTask} of tasks) {
            const taskEntry = this._taskEntryById.get(taskId);

            // If we haven't seen this task before it's "fresh". The task may be outdated
            // so we'll need to apply the actions from our action history to catch it up.
            if (taskEntry === undefined) {
                freshTaskById.set(taskId, searchedTask);

                this._taskEntryById.set(taskId, {
                    task: searchedTask,
                    visibleInQueries: new Set([query]),
                });
                continue;
            }

            const oldTask = taskEntry.task;
            const newTask = mergeTaskIndexDocs(oldTask, searchedTask);
            taskEntry.task = newTask;

            // If the task changed, notify queries where the task is visible. We may need
            // to remove the task from the query if it's no longer visible, we may need to
            // change the tasks's sort position, or we may need to notify subscribers about
            // the change.
            //
            // This should happen rarely but it's not impossible. It means OpenSearch is
            // ahead of the actions received by task realtime service. If OpenSearch just
            // refreshed and there's a delay in sending notifications to our service this
            // case could happen.
            if (oldTask !== newTask) {
                for (const otherQuery of taskEntry.visibleInQueries) {
                    const {isStillVisible} = otherQuery.onVisibleTaskUpdate(
                        taskId,
                        oldTask,
                        newTask,
                    );
                    if (!isStillVisible) {
                        taskEntry.visibleInQueries.delete(otherQuery);
                        if (taskEntry.visibleInQueries.size === 0) {
                            // NOCOMMIT: Evict the task after some time?
                        }
                    }
                }
            }

            const wasAlreadyVisibleInQuery = taskEntry.visibleInQueries.has(query);
            if (!wasAlreadyVisibleInQuery) taskEntry.visibleInQueries.add(query);

            // If the task is different from what we found in our search and the searched
            // task is currently stored in our query, then we need to tell the query which
            // made the search so it can update.
            //
            // If the task was already visible in our query then the query thinks the task
            // is `oldTask`. Otherwise the query thinks the task is `newTask`.
            //
            // We use `mergeTaskIndexDocs()` as an equality test. Since it returns the
            // first parameter back if the first parameter didn't change.
            if (
                !wasAlreadyVisibleInQuery &&
                mergeTaskIndexDocs(searchedTask, newTask) !== searchedTask
            ) {
                const {isStillVisible} = query.onVisibleTaskUpdate(taskId, searchedTask, newTask);
                if (!isStillVisible) {
                    taskEntry.visibleInQueries.delete(query);
                    if (taskEntry.visibleInQueries.size === 0) {
                        // NOCOMMIT: Evict the task after some time?
                    }
                }
            }
        }

        this._actionHistory.iterateActionTransactions(query.spaceId, actions => {
            for (const action of actions) {
                // NOCOMMIT: 1. Handle actions that change current visible tasks
                // NOCOMMIT: 2. Handle actions that might introduce new visible tasks
            }
        });
    }

    public applyActionTransaction() {}
}
