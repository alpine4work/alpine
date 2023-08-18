import {isAccountMemberOfSpace} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc, getTaskIndexDocIsDeleted} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeQueryStore,
    TaskRealtimeQueryStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicy,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";

// Keep track of the previous task object the viewer saw so we can check if
// we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousTaskIdByViewerForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQueryViewer, Map<TaskId, TaskIndexDoc>>()
        : null;

type TaskRealtimeQueryViewerAuthorizationDecision =
    | "Creator"
    | {
          readonly type: "Collection";
          readonly collectionId: TaskCollectionId;
      }
    | {
          readonly type: "Parent";
          readonly parentId: TaskId;
          readonly parentDecision: TaskRealtimeQueryViewerAuthorizationDecision;
      };

type TaskRealtimeQueryViewerTaskEntry = PromiseImmediate<
    TaskRealtimeQueryViewerAuthorizationDecision | "Unauthorized"
>;

export class TaskRealtimeQueryViewer {
    private readonly _store: TaskRealtimeQueryStore;
    private readonly _query: TaskRealtimeQuery;
    private readonly _accountId: AccountId;

    private readonly _taskEntryById = new Map<TaskId, TaskRealtimeQueryViewerTaskEntry>();

    public async getLoadedTasks(context: TaskRealtimeSystemActionContext, limit?: number) {
        const taskEntries = this._query.getLoadedTasks(limit);

        taskEntries.map(async taskEntry => {
            const hasAccess = await authorizeTaskRealtimeQueryStoreTaskEntry(
                context,
                this._accountId,
                taskEntry,
            );
        });
    }

    public onVisibleTaskAdd(task: TaskIndexDoc) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdByViewer = getOrSetDefaultMapValue(
                assertExists(previousTaskIdByViewerForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdByViewer.has(task.id),
                "Viewer can't add task that's already visible with `onVisibleTaskAdd()`",
            );

            previousTaskIdByViewer.set(task.id, task);
        }
    }

    public onVisibleTaskUpdate(taskId: TaskId, oldTask: TaskIndexDoc, newTask: TaskIndexDoc) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdByViewer = getOrSetDefaultMapValue(
                assertExists(previousTaskIdByViewerForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdByViewer.get(taskId) === oldTask,
                "Viewer must observe all updates to a visible task through `onVisibleTaskUpdate()`",
            );

            previousTaskIdByViewer.set(taskId, newTask);
        }
    }

    public onVisibleTaskRemove(taskId: TaskId) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdByViewer = getOrSetDefaultMapValue(
                assertExists(previousTaskIdByViewerForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdByViewer.has(taskId),
                "Viewer can't remove task that is not visible with `onVisibleTaskRemove()`",
            );

            previousTaskIdByViewer.delete(taskId);
        }
    }
}

// NOCOMMIT: Reference the same code in `tasks_table.ts`.
async function authorizeTaskRealtimeQueryStoreTaskEntry(
    context: TaskRealtimeSystemActionContext,
    actorAccountId: AccountId,
    taskEntry: TaskRealtimeQueryStoreTaskEntry,
): Promise<boolean> {
    const expectedAccessLevel: TaskCollectionAccessLevel = "View";

    // The task creator has an edit access level on their own task.
    if (
        actorAccountId === taskEntry.getTask().creator.accountId &&
        hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
    ) {
        return true;
    }

    const [parentTaskEntry, collectionEntries] = await runAllPromises([
        taskEntry.getParentTask(context),
        taskEntry.getCollections(context),
    ]);

    // An array of `TaskCollectionId`s that authorize access to the task or `null`
    // if no `TaskCollectionId`s authorize access to the task.
    const authorizingCollectionEntries = await runAllPromises(
        collectionEntries.map(async collectionEntry => {
            const hasAccess = await evaluateTaskCollectionIndexDocAccessPolicy(
                context,
                collectionEntry.getCollection(),
                actorAccountId,
                expectedAccessLevel,
            );

            return hasAccess ? collectionEntry : null;
        }),
    );

    // We evaluate the access policies for all collections on a task but we only
    // need one passing access policy.
    if (authorizingCollectionEntries.some(isNonNullable)) return true;

    if (parentTaskEntry) {
        // Parent tasks implicitly grant access to all of their child tasks. If we have
        // a parent task that is not deleted then check it before throwing a permission
        // denied error.
        if (!getTaskIndexDocIsDeleted(parentTaskEntry.getTask())) {
            return authorizeTaskRealtimeQueryStoreTaskEntry(
                context,
                actorAccountId,
                parentTaskEntry,
            );
        }
    }

    return false;
}

/**
 * Evaluates whether the `AccountId` has access to the task collection item at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
// NOCOMMIT: Handle deleted collections!
async function evaluateTaskCollectionIndexDocAccessPolicy(
    context: TaskRealtimeSystemActionContext,
    collection: TaskCollectionIndexDoc,
    accountId: AccountId,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    if (collection.accessPolicy.value.defaultGrant) {
        // If we ever add other default grant types then TypeScript will error here
        // forcing us to update this code.
        cast<"Space">(collection.accessPolicy.value.defaultGrant.type);

        if (
            (await isAccountMemberOfSpace(context, collection.spaceId, accountId)) &&
            hasTaskCollectionAccessLevel(
                collection.accessPolicy.value.defaultGrant.level,
                expectedAccessLevel,
            )
        ) {
            return true;
        }
    }

    const accountGrant = collection.accessPolicy.value.accountGrantById.get(accountId);
    if (accountGrant && hasTaskCollectionAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}
