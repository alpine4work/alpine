import {TaskActivityEntryChange} from "~/server/tasks/data/internal/task_activity_table.js";
import {
    TaskIndexDocBase,
    getTaskIndexDocDisplayStatus,
    isTaskIndexDocDeleted,
} from "~/server/tasks/data/task_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {getTaskTitleText} from "~/shared/tasks/title/task_title.js";

/**
 * An effective title text update headed for the title's activity window chunks.
 * Unlike discrete changes, title updates batch into write-time windows (see
 * `applyTaskActivityWindowUpdate()`), so they never persist as discrete task
 * activity entry changes.
 */
export type TaskActivityTitleWindowUpdate = {
    readonly type: "TitleWindow";
    /**
     * The doc-carried title version of the update (see `titleIndexVersion` on the task
     * index doc). The counter only advances on the winning write of an effective
     * change, so the classifier returns the payload without it and the capture site
     * stamps the bumped version right after bumping the doc (see
     * `applyTaskActionAndCaptureActivity()`).
     */
    readonly version: number;
    readonly beforeTitleText: string;
    readonly afterTitleText: string;
    readonly actionTime: HybridLogicalTime;
};

/**
 * One emit-ready activity payload captured from a task action's index doc diff: a
 * discrete change bound for an activity entry, or a title update bound for the
 * title's window chunks.
 */
export type TaskActivityUpdate = TaskActivityEntryChange | TaskActivityTitleWindowUpdate;

/**
 * What one task action means for activity, decided from the index doc diff around
 * its application: an emit-ready payload, or null when nothing should reach the
 * feed. `oldTask` is null only for a fresh create, whose fields all start empty.
 *
 * ## Where activity comes from — and the tradeoffs (keep documenting them!)
 *
 * Action activity is captured while the transaction is **indexed into the
 * OpenSearch task index** and emitted after the winning doc write (see
 * `TaskActionTransactionIndexState`). Notes activity comes from the versioned
 * notes job (`processTaskNotesActivityJob`).
 *
 * This is the second era of this design. Originally activity was captured at
 * commit time from transactionally locked DynamoDB items, because before values
 * were **correctness-critical**: write-time reversal detection deleted entries
 * based on them, so a wrong or lost before value silently destroyed feed data, and
 * the at-least-once, two-database indexing pipeline could produce exactly that (a
 * retry re-applies actions to a doc that already absorbed them, reads an empty
 * diff, and drops the activity).
 *
 * The read-time aggregation pivot (2026-07-17 decision log) demoted before values
 * to **display-quality**: entries always persist and rendering-time rules decide
 * what collapses. That made index-time capture viable — it means the due date,
 * priority, and title folds DynamoDB would otherwise need exist only in the index
 * doc — under three disciplines:
 *
 * 1. **Emit only from the winning OCC attempt** of the doc write, so observed
 *    diffs are correct against the index's serialization.
 * 2. **Prefer intent over false precision**: see the noop policy below.
 * 3. **Deduplicate retries at the sink**: discrete source markers and window
 *    version coverage absorb ordinary sweeper replays.
 *
 * Accepted residuals: the feed lags indexing (explicitly accepted), activity
 * reflects the index's serialization of same-instant races rather than the commit
 * order, and a crashed processing window can leave entries without before values.
 *
 * ## The noop policy
 *
 * An action whose application leaves its field's doc value unchanged (a total
 * noop) is ambiguous: it either lost out to another action (its effects never
 * reached the task), or it's a crash-recovery replay of an action whose effects
 * were absorbed by an earlier indexing attempt that died before emitting. We can't
 * tell these apart, so we deliberately fail open and emit the action's intended
 * value rather than risk dropping real activity, with these caveats:
 *
 * 1. The initial value is omitted: we normally read it off the doc before the
 *    action applies, which is impossible for an action that didn't change the doc.
 * 2. Title update noops return null: the action carries only Yjs state changes, so
 *    we can't figure out what the user updated the text to — and without the
 *    initial title text we couldn't apply those state changes even if we wanted
 *    to.
 * 3. Status noops usually return null: display status combines the status,
 *    assignee, and assignee-status registers, so the intended display value can't
 *    be derived from the action alone — and an `UpdateAssigneeStatus` noop on a
 *    closed task is the My Tasks section-move gesture, personal bookkeeping that
 *    must never leak an entry. The exception is an `UpdateStatus` that CLOSED the
 *    task: a Closed status register alone determines a Closed display status, so
 *    its intent is derivable and it emits.
 * 4. Every other field emits the action's intended value.
 *
 * In practice, read-time aggregation collapses most emitted noops into the run of
 * the action that actually won; if they prove noisy we can filter them on the
 * client later.
 */
export function getTaskActivityUpdateFromTaskIndexDocs(
    action: TaskUpdateTaskAction,
    oldTask: TaskIndexDocBase | null,
    newTask: TaskIndexDocBase,
): TaskActivityEntryChange | Omit<TaskActivityTitleWindowUpdate, "version"> | null {
    const actionTime = action.time;

    switch (action.taskAction.type) {
        // Creates carry their values on the action itself, so they emit without diffing (a
        // replayed create is deduplicated by its idempotency marker).
        case "Create":
            return {type: "TaskCreated", actionTime};
        case "Delete":
        case "Undelete": {
            const from = oldTask !== null && isTaskIndexDocDeleted(oldTask);
            const to = isTaskIndexDocDeleted(newTask);
            if (from === to) {
                return {
                    type: "TaskDeletionUpdated",
                    actionTime,
                    isDeleted: action.taskAction.type === "Delete",
                };
            }
            return {
                type: "TaskDeletionUpdated",
                actionTime,
                previousIsDeleted: from,
                isDeleted: to,
            };
        }
        case "UpdateStatus":
        case "UpdateAssigneeStatus": {
            const from = oldTask !== null ? getTaskIndexDocDisplayStatus(oldTask) : "OpenInactive";
            const to = getTaskIndexDocDisplayStatus(newTask);
            if (from === to) {
                // Noop policy caveat 3: a close's intended display value is derivable from the
                // action alone, everything else is ambiguous.
                if (
                    action.taskAction.type === "UpdateStatus" &&
                    action.taskAction.status.type === "Closed"
                ) {
                    return {type: "TaskStatusUpdated", actionTime, statusType: "Closed"};
                }
                return null;
            }
            return {
                type: "TaskStatusUpdated",
                actionTime,
                previousStatusType: from,
                statusType: to,
            };
        }
        case "UpdateAssignee": {
            const from = oldTask?.assignee.value?.assignee.accountId ?? null;
            const to = newTask.assignee.value?.assignee.accountId ?? null;
            if (from === to) {
                return {
                    type: "TaskAssigneeUpdated",
                    actionTime,
                    assigneeId: action.taskAction.assignee?.assigneeId ?? null,
                };
            }
            return {
                type: "TaskAssigneeUpdated",
                actionTime,
                previousAssigneeId: from,
                assigneeId: to,
            };
        }
        case "UpdateTitle": {
            const from = oldTask !== null ? getTaskTitleText(oldTask.title.raw) : "";
            const to = getTaskTitleText(newTask.title.raw);
            // Noop policy caveat 2: a title noop's intended text is unknowable.
            if (from === to) return null;
            return {
                type: "TitleWindow",
                beforeTitleText: from,
                afterTitleText: to,
                actionTime,
            };
        }
        case "UpdateDueDate": {
            const from = oldTask?.dueDate.value ?? null;
            const to = newTask.dueDate.value;
            const isUnchanged = from === null || to === null ? from === to : from.compare(to) === 0;
            if (isUnchanged) {
                return {
                    type: "TaskDueDateUpdated",
                    actionTime,
                    dueDate: action.taskAction.dueDate,
                };
            }
            return {type: "TaskDueDateUpdated", actionTime, previousDueDate: from, dueDate: to};
        }
        case "UpdatePriority": {
            const from = oldTask?.priority.value ?? null;
            const to = newTask.priority.value;
            if (from === to) {
                return {
                    type: "TaskPriorityUpdated",
                    actionTime,
                    priority: action.taskAction.priority,
                };
            }
            return {type: "TaskPriorityUpdated", actionTime, previousPriority: from, priority: to};
        }
        case "UpdateParentTaskId": {
            const from = oldTask?.parent.taskId.value ?? null;
            const to = newTask.parent.taskId.value;
            if (from === to) {
                return {
                    type: "TaskParentUpdated",
                    actionTime,
                    parentTaskId: action.taskAction.parentTaskId,
                };
            }
            return {
                type: "TaskParentUpdated",
                actionTime,
                previousParentTaskId: from,
                parentTaskId: to,
            };
        }
        case "AddCollection":
        case "RemoveCollection": {
            const collectionId = action.taskAction.collectionId;
            const from = oldTask?.collections.raw.collections.has(collectionId) ?? false;
            const to = newTask.collections.raw.collections.has(collectionId);
            if (from === to) {
                return {
                    type: "TaskCollectionMembershipUpdated",
                    actionTime,
                    collectionId,
                    isMember: action.taskAction.type === "AddCollection",
                };
            }
            return {
                type: "TaskCollectionMembershipUpdated",
                actionTime,
                collectionId,
                previousIsMember: from,
                isMember: to,
            };
        }
        case "UpdateLayout": {
            const from = oldTask?.layout?.value ?? null;
            const to = newTask.layout?.value ?? null;
            if (from === to) {
                return {type: "TaskLayoutUpdated", actionTime, layout: action.taskAction.layout};
            }
            return {type: "TaskLayoutUpdated", actionTime, previousLayout: from, layout: to};
        }
        // Access policy changes produce no activity on purpose: emitting them would leak
        // the existence of permission changes to viewers who can't see the policy. The
        // rest is position bookkeeping.
        case "UpdateAccessPolicy":
        case "UpdateParentPosition":
        case "UpdateChildrenCounts":
        case "UpdateCollectionPosition":
        case "UpdateAssigneePosition":
        case "UpdateNotepadPagePosition":
        case "UpdateAssigneeActivePosition":
            return null;
        default:
            throw exhaustive(action.taskAction);
    }
}
