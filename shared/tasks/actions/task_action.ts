import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionActionSchema} from "~/shared/tasks/actions/task_collection_action.js";
import {TaskTaskActionSchema} from "~/shared/tasks/actions/task_task_action.js";
import {TaskActorSchema} from "~/shared/tasks/task_creator.js";

/**
 * All updates to the task database in a space are done through task actions. The
 * canonical representation of a task database are the list of all actions ever
 * applied to it. Any other view of the task database is a reduction (in the
 * [functional programming sense][1]) of the actions list.
 *
 * Actions are commutative and idempotent. That means actions can be applied in any
 * order, multiple times, and clients will converge to the same state. This
 * unlocks:
 *
 * - Optimistic updates: As a user is typing we apply their updates directly to our
 *   local state even before attempting to commit the update to the database.
 *
 * - Distributed system: We don't need a centralized service for determining event
 *   order. Actions have at-least-once semantics and no ordering guarantees.
 *
 * These are similar properties to what [CRDTs][2] provide and indeed we use CRDTs
 * throughout the task system (e.g. task titles are a CRDT). However, the task
 * database is not, conceptually, one big CRDT and neither are individual tasks.
 * The task database is only partially visible to clients. There are private tasks
 * you are not allowed to read or update. So an action that may have been valid at
 * time T may not be valid at time T + 2 if at time T + 1 the task's permissions
 * changed. When our backend receives an action it chooses whether to accept or
 * reject the action based on authorization rules. If the backend chooses to accept
 * an action then it must be applied by clients in any order, even before/after
 * actions that would have changed the authorization decision.
 *
 * ## Time
 *
 * Every action has a time represented as a `HybridLogicalTime` from a
 * `HybridLogicalClock`. This allows us to partially order actions while still
 * maintaining some notion of time. Notably, if action A2 depends on action A1 then
 * action A2 will always have a higher time than action A1.
 *
 * The `HybridLogicalTime` wants to be the synchronized system time (see
 * `synchronized_system_time.ts`) of the client who committed the action but
 * because of clock skew we can't make that guarantee.
 *
 * Two actions may have the same time. Ordering actions by `time` may also produce
 * a different order than if we were to order but action commit time in the
 * database.
 *
 * [1]: https://en.wikipedia.org/wiki/Fold_(higher-order_function)
 * [2]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export type TaskAction = SchemaType<typeof TaskActionSchema>;

/**
 * An action that updates a single task.
 */
export type TaskUpdateTaskAction = SchemaType<typeof TaskUpdateTaskActionSchema>;

export const TaskUpdateTaskActionSchema = Schema.object({
    type: Schema.value("UpdateTask"),
    time: HybridLogicalTimeSchema,
    // TODO: Backfill actors on historical task actions, then make `actor` required for
    // `UpdateTask` and `UpdateCollection` actions.
    actor: TaskActorSchema.optional(),
    taskId: Schema.id<TaskId>(),
    taskAction: TaskTaskActionSchema,
});

/**
 * An action that updates a single task collection.
 */
export type TaskUpdateCollectionAction = SchemaType<typeof TaskUpdateCollectionActionSchema>;

const TaskUpdateCollectionActionSchema = Schema.object({
    type: Schema.value("UpdateCollection"),
    time: HybridLogicalTimeSchema,
    // TODO: Backfill actors on historical task actions, then make `actor` required for
    // `UpdateTask` and `UpdateCollection` actions.
    actor: TaskActorSchema.optional(),
    collectionId: Schema.id<TaskCollectionId>(),
    collectionAction: TaskCollectionActionSchema,
});

/**
 * When a task references an account it needs to sort/group by it uses the
 * `TaskSortableAccount` object. This object inlines the account's name so that the
 * task system can consistently sort by account names alphabetically. We index our
 * task data in OpenSearch and we need the account name string in there to sort.
 *
 * So when an account changes their name, we commit an `UpdateAccountName` action
 * in all the spaces they are a member of. This action is applied to every task
 * that includes the account name at a version behind the version in this action.
 *
 * Two different names at the same version is an error. We'll throw an incompatible
 * action error. Only the server can commit this action and it must make sure to
 * never use the same account name version twice.
 */
export type TaskUpdateAccountNameAction = SchemaType<typeof TaskUpdateAccountNameActionSchema>;

const TaskUpdateAccountNameActionSchema = Schema.object({
    type: Schema.value("UpdateAccountName"),
    time: HybridLogicalTimeSchema,
    accountId: Schema.id<AccountId>(),
    accountName: LabelStringSchema,
    accountNameVersion: Schema.integer,
});

export const TaskActionSchema = Schema.union({
    UpdateTask: TaskUpdateTaskActionSchema,
    UpdateCollection: TaskUpdateCollectionActionSchema,
    UpdateAccountName: TaskUpdateAccountNameActionSchema,
    // NOTE(calebmer, 2025-03-18): Remnants of the task notepad feature. We ignore
    // these actions at this point but we need minimal handling for backwards
    // compatibility to avoid crashes since we have actions of these types saved in the
    // database.
    UpdateNotepadPage: Schema.object({
        type: Schema.value("UpdateNotepadPage"),
        time: HybridLogicalTimeSchema,
    }),
});

// Every action should have a `time` property with the logical time of the action.
// This allows us to establish an ordering between actions.
assertAssignableTypes<TaskAction, {readonly time: HybridLogicalTime}>();

/**
 * Get a low-cardinality label for the `TaskAction` we can use in instrumentation.
 */
export function getTaskActionLabel(action: TaskAction): string {
    switch (action.type) {
        case "UpdateTask":
            return `${action.type}_${action.taskAction.type}`;
        case "UpdateCollection":
            return `${action.type}_${action.collectionAction.type}`;
        case "UpdateAccountName":
            return action.type;
        case "UpdateNotepadPage":
            return action.type;
        default:
            throw exhaustive(action);
    }
}
