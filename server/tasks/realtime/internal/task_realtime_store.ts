import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/index/apply_task_action_to_task_index_doc.js";
import {mergeTaskIndexDocs} from "~/server/tasks/index/merge_task_index_docs.js";
import {getTaskIndexDocsIfExist} from "~/server/tasks/index/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/realtime/internal/task_realtime_action_context.js";
import {ReadonlyTaskRealtimeActionHistory} from "~/server/tasks/realtime/internal/task_realtime_action_history.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/internal/task_realtime_query.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

type TaskRealtimeStoreTaskEntry = {
    task: TaskIndexDoc;
    readonly visibleInQueries: Set<TaskRealtimeQuery>;
};

export class TaskRealtimeStore {
    public readonly spaceId: SpaceId;
    private readonly _actionHistory: ReadonlyTaskRealtimeActionHistory;

    private readonly _queries = new Set<TaskRealtimeQuery>();

    private readonly _taskEntryById = new Map<TaskId, TaskRealtimeStoreTaskEntry>();
    private readonly _loadingTaskPromiseById = new Map<
        TaskId,
        Promise<TaskRealtimeStoreTaskEntry | null>
    >();
    private _scheduledTaskLoadBatch: Array<{
        readonly taskId: TaskId;
        readonly promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
    }> | null = null;

    /**
     * Called after we execute a query in OpenSearch with the tasks returned by
     * OpenSearch. This function:
     *
     * - Adds tasks into to our store (or updates tasks already in the store).
     * - For tasks newly added to the store (we call these "fresh" tasks) iterate
     *   through our action history to catch them up.
     * - While iterating through our action history, if we see a task that might be
     *   visible in the query but was not in the stale search result then load the
     *   task (if it's not already loaded) and test it against the query's filters.
     * - Remove any tasks from the search result that are no longer visible.
     */
    public addSearchedVisibleTasksForQuery(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        tasks: ReadonlyArray<{taskId: TaskId; task: TaskIndexDoc}>,
    ): Promise<void> {
        const maybeAddVisibleTaskIdsToLoad = this._addSearchedVisibleTasksForQuerySync(
            context,
            query,
            tasks,
        );
        return this._addSearchedVisibleTasksForQueryAsync(
            context,
            query,
            maybeAddVisibleTaskIdsToLoad,
        );
    }

    // The synchronous part of `addSearchedVisibleTasksForQuery()`. Carefully
    // updates our data structures while assuming no concurrent code is running
    // which would observe a partial state.
    private _addSearchedVisibleTasksForQuerySync(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        tasks: ReadonlyArray<{taskId: TaskId; task: TaskIndexDoc}>,
    ) {
        const freshTaskIds = new Set<TaskId>();

        for (const {taskId, task: searchedTask} of tasks) {
            const taskEntry = this._taskEntryById.get(taskId);

            // If we haven't seen this task before it's "fresh". The task may be outdated
            // so we'll need to apply the actions from our action history to catch it up.
            if (taskEntry === undefined) {
                freshTaskIds.add(taskId);

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
            // is `newTask` (thanks to the loop updating queries this task is visible in
            // above). Otherwise the query thinks the task is `searchedTask`.
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

        const visibleTaskUpdateById = new Map<
            TaskId,
            {taskEntry: TaskRealtimeStoreTaskEntry; oldTask: TaskIndexDoc}
        >();

        const maybeAddVisibleTaskIds = new Set<TaskId>();

        this._actionHistory.iterateActions(context.tracer.getTracer(), this.spaceId, action => {
            switch (action.type) {
                case "UpdateTask": {
                    const taskEntry = this._taskEntryById.get(action.taskId);

                    // If an action in our history window updated a fresh task in our query then
                    // apply that update to the fresh task to catch it up.
                    if (freshTaskIds.has(action.taskId)) {
                        assert(taskEntry);

                        const oldTask = taskEntry.task;
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.task = newTask;

                        // We will call `query.onVisibleTaskUpdate()` once per task after our history
                        // iteration instead of once for each time a task is changed.
                        if (oldTask !== newTask && !visibleTaskUpdateById.has(action.taskId)) {
                            visibleTaskUpdateById.set(action.taskId, {taskEntry, oldTask});
                        }
                    }
                    // If an action in our history window might expose a task in our query that we
                    // haven't seen yet then we need to load the task so we can evaluate the query
                    // filter against it and if the task passes add the task to our query.
                    else if (
                        (!taskEntry || !taskEntry.visibleInQueries.has(query)) &&
                        query.mightActionAddVisibleTask(action.time, action.taskAction)
                    ) {
                        maybeAddVisibleTaskIds.add(action.taskId);
                    }
                    break;
                }
                case "UpdateCollection": {
                    switch (action.collectionAction.type) {
                        case "Create":
                        case "Delete":
                        case "Undelete":
                        case "UpdateName":
                        case "UpdateAccessPolicy": {
                            // Doesn't affect query
                            break;
                        }
                        default:
                            throw exhaustive(action.collectionAction);
                    }
                    break;
                }
                case "UpdateNotepadPage": {
                    cast<"Create">(action.notepadPageAction.type);
                    // Doesn't affect query
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        });

        for (const [taskId, {taskEntry, oldTask}] of visibleTaskUpdateById) {
            const {isStillVisible} = query.onVisibleTaskUpdate(taskId, oldTask, taskEntry.task);
            if (!isStillVisible) {
                taskEntry.visibleInQueries.delete(query);
                if (taskEntry.visibleInQueries.size === 0) {
                    // NOCOMMIT: Evict the task after some time?
                }
            }
        }

        const maybeAddVisibleTaskIdsToLoad: Array<TaskId> = [];

        for (const taskId of maybeAddVisibleTaskIds) {
            const taskEntry = this._taskEntryById.get(taskId);
            // If we haven't loaded this task into our store yet, we need to first load it
            // and then we can try adding it to the query.
            if (taskEntry === undefined) {
                maybeAddVisibleTaskIdsToLoad.push(taskId);
                continue;
            }

            const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
            if (isVisible) {
                taskEntry.visibleInQueries.add(query);
            }
        }

        return maybeAddVisibleTaskIdsToLoad;
    }

    private async _addSearchedVisibleTasksForQueryAsync(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        maybeAddVisibleTaskIdsToLoad: Array<TaskId>,
    ) {
        await runAllPromises(
            maybeAddVisibleTaskIdsToLoad.map(taskId =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadTaskIfExists(context, taskId);

                    if (!taskEntry) {
                        throw retry(
                            new InternalError(
                                "Task not found in index, we saw an update action which means the task should eventually exist",
                            ),
                        );
                    }

                    // If the task is still not visible in this query (some concurrent process may
                    // have made it visible) then attempt to add the task to the query given the
                    // task passes the query's filters.
                    if (!taskEntry.visibleInQueries.has(query)) {
                        const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                        if (isVisible) {
                            taskEntry.visibleInQueries.add(query);
                        }
                    }
                }),
            ),
        );
    }

    /**
     * Apply a committed action transaction to our store after we've added the
     * transaction to our action history. Does the following:
     *
     * - Reports any updates to subscribed queries
     * - If the transaction hides a task in a query then we remove the task from
     *   the query
     * - We iterate through all queries to see if an updated task that was hidden
     *   in the query will now be visible
     * - If the transaction updates a task that's not in our store then we ignore
     *   it unless we suspect the updated task will be visible in a query, then we
     *   load the task from OpenSearch and check
     */
    public applyActionTransaction(
        context: TaskRealtimeActionContext,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        const queriesByMaybeAddVisibleTaskIdToLoad = this._applyActionTransactionSync(actions);
        return this._applyActionTransactionAsync(context, queriesByMaybeAddVisibleTaskIdToLoad);
    }

    // The synchronous part of `applyActionTransaction()`. Carefully updates our
    // data structures while assuming no concurrent code is running which would
    // observe a partial state.
    private _applyActionTransactionSync(actions: ReadonlyArray<TaskAction>) {
        const updatedTaskEntriesById = new Map<
            TaskId,
            {taskEntry: TaskRealtimeStoreTaskEntry; oldTask: TaskIndexDoc}
        >();

        const queriesByMaybeAddVisibleTaskIdToLoad = new Map<TaskId, Set<TaskRealtimeQuery>>();

        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const taskEntry = this._taskEntryById.get(action.taskId);

                    if (taskEntry !== undefined) {
                        const oldTask = taskEntry.task;
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.task = newTask;

                        // We will call `query.onVisibleTaskUpdate()` once per task after our history
                        // iteration instead of once for each time a task is changed.
                        //
                        // We will also call `query.maybeAddVisibleTask()` on all our other queries in
                        // case this task should appear there.
                        if (oldTask !== newTask && !updatedTaskEntriesById.has(action.taskId)) {
                            updatedTaskEntriesById.set(action.taskId, {taskEntry, oldTask});
                        }
                    }
                    // If we do not have an entry for this task, then check with all our queries to
                    // see if this action might result in a new visible task. We need to load these
                    // tasks to fully compare them against the query's filters.
                    else {
                        for (const query of this._queries) {
                            if (query.mightActionAddVisibleTask(action.time, action.taskAction)) {
                                getOrSetDefaultMapValue(
                                    queriesByMaybeAddVisibleTaskIdToLoad,
                                    action.taskId,
                                    () => new Set(),
                                ).add(query);
                            }
                        }
                    }
                    break;
                }
                case "UpdateCollection": {
                    switch (action.collectionAction.type) {
                        case "Create":
                        case "Delete":
                        case "Undelete":
                        case "UpdateName":
                        case "UpdateAccessPolicy": {
                            // Doesn't affect query
                            break;
                        }
                        default:
                            throw exhaustive(action.collectionAction);
                    }
                    break;
                }
                case "UpdateNotepadPage": {
                    cast<"Create">(action.notepadPageAction.type);
                    // Doesn't affect query
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        for (const [taskId, {taskEntry, oldTask}] of updatedTaskEntriesById) {
            const newlyVisibleInQueries = new Set();

            // For queries this task is not currently visible in, see if it is now visible.
            for (const query of this._queries) {
                if (taskEntry.visibleInQueries.has(query)) continue;

                const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                if (isVisible) {
                    newlyVisibleInQueries.add(query);
                    taskEntry.visibleInQueries.add(query);
                }
            }

            // For queries this task is currently visible in, update the query and see if
            // the task is now hidden from the query.
            for (const query of taskEntry.visibleInQueries) {
                if (newlyVisibleInQueries.has(query)) continue;

                const {isStillVisible} = query.onVisibleTaskUpdate(taskId, oldTask, taskEntry.task);
                if (!isStillVisible) {
                    taskEntry.visibleInQueries.delete(query);
                    if (taskEntry.visibleInQueries.size === 0) {
                        // NOCOMMIT: Evict the task after some time?
                    }
                }
            }
        }

        return queriesByMaybeAddVisibleTaskIdToLoad;
    }

    private async _applyActionTransactionAsync(
        context: TaskRealtimeActionContext,
        queriesByMaybeAddVisibleTaskIdToLoad: Map<TaskId, Set<TaskRealtimeQuery>>,
    ) {
        await runAllPromises(
            Array.from(queriesByMaybeAddVisibleTaskIdToLoad, ([taskId, queries]) =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadTaskIfExists(context, taskId);

                    if (!taskEntry) {
                        throw retry(
                            new InternalError(
                                "Task not found in index, we saw an update action which means the task should eventually exist",
                            ),
                        );
                    }

                    for (const query of queries) {
                        // If the task is still not visible in this query (some concurrent process may
                        // have made it visible) then attempt to add the task to the query given the
                        // task passes the query's filters.
                        if (!taskEntry.visibleInQueries.has(query)) {
                            const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                            if (isVisible) {
                                taskEntry.visibleInQueries.add(query);
                            }
                        }
                    }
                }),
            ),
        );
    }

    /**
     * Load an entry for a task from OpenSearch and put it in `taskEntryById`.
     *
     * Batches and dedupes load requests behind the scenes.
     */
    private _loadTaskIfExists(
        context: TaskRealtimeActionContext,
        taskId: TaskId,
    ): Promise<TaskRealtimeStoreTaskEntry | null> {
        const taskEntry = this._taskEntryById.get(taskId);

        // If we've already loaded the task, great! No need to load it now.
        if (taskEntry !== undefined) return Promise.resolve(taskEntry);

        return getOrSetDefaultMapValue(this._loadingTaskPromiseById, taskId, () => {
            if (!this._scheduledTaskLoadBatch) {
                this._scheduledTaskLoadBatch = [];

                scheduleMicrotask(() => {
                    assert(this._scheduledTaskLoadBatch);
                    const taskLoadBatch = this._scheduledTaskLoadBatch;
                    this._scheduledTaskLoadBatch = null;

                    this._executeLoadTaskBatch(context, taskLoadBatch).catch(error => {
                        for (const {promiseResolver} of taskLoadBatch) {
                            promiseResolver.reject(error);
                        }
                    });
                });
            }

            const promiseResolver = createPromiseResolver<TaskRealtimeStoreTaskEntry | null>();
            this._scheduledTaskLoadBatch.push({taskId, promiseResolver});

            // Once the promise has settled, delete it from `loadingTaskPromiseById`. You
            // can now get the task from `taskEntryById`.
            //
            // If the task entry is evicted then we should create a new loading promise.
            promiseResolver.promise.finally(() => {
                this._loadingTaskPromiseById.delete(taskId);
            });

            return promiseResolver.promise;
        });
    }

    private async _executeLoadTaskBatch(
        context: TaskRealtimeActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
        }>,
    ): Promise<void> {
        const tasks = await getTaskIndexDocsIfExist(
            context,
            this.spaceId,
            taskLoadBatch.map(({taskId}) => taskId),
        );

        this._executeLoadTaskBatchSync(context, taskLoadBatch, tasks);
    }

    // The synchronous part of `_loadTaskBatch()` to be run after the network
    // request. It's useful to make this synchronous since we'll be updating our
    // internal store state and we don't want to think about concurrent
    // readers/writers.
    private _executeLoadTaskBatchSync(
        context: TaskRealtimeActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
        }>,
        tasks: Array<TaskIndexDoc | null>,
    ): void {
        const freshTaskById = new Map<
            TaskId,
            {
                freshTask: TaskIndexDoc;
                promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
            }
        >();

        // Check if any of the tasks were loaded concurrently while we were waiting on
        // our network request. We can immediately resolve any that were.
        for (let i = 0; i < taskLoadBatch.length; i++) {
            const {taskId, promiseResolver} = taskLoadBatch[i]!;
            const taskEntry = this._taskEntryById.get(taskId);

            if (taskEntry !== undefined) {
                promiseResolver.resolve(taskEntry);
            } else {
                const task = tasks[i];
                if (!task) {
                    promiseResolver.resolve(null);
                } else {
                    freshTaskById.set(taskId, {freshTask: task, promiseResolver});
                }
            }
        }

        // Catch up our tasks are freshly loaded from OpenSearch with any actions
        // in our history so they're up-to-date in realtime.
        for (const [taskId, {freshTask, promiseResolver}] of freshTaskById) {
            let task = freshTask;

            this._actionHistory.iterateTaskActions(
                context.tracer.getTracer(),
                this.spaceId,
                taskId,
                (actionTime, action) => {
                    task = applyTaskActionToTaskIndexDoc(task, actionTime, action);
                },
            );

            const taskEntry: TaskRealtimeStoreTaskEntry = {
                task,
                // NOCOMMIT: Evict if we don't get a query
                visibleInQueries: new Set([]),
            };

            this._taskEntryById.set(taskId, taskEntry);

            promiseResolver.resolve(taskEntry);
        }
    }
}
