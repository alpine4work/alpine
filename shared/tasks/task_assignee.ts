import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    TaskSortableAccountSchema,
    mergeTaskSortableAccounts,
} from "~/shared/tasks/task_sortable_account.js";

/**
 * The account assigned to a task. Includes not just the task assignee, but also
 * who assigned the task and when. Useful when filtering to see updates on tasks
 * you care about.
 */
export type TaskAssignee = SchemaType<typeof TaskAssigneeSchema>;

export const TaskAssigneeSchema = Schema.object({
    assigneeId: Schema.id<AccountId>(),
    assignerId: Schema.id<AccountId>(),
    assignedTime: TaskFilterableTime.schema,
});

export type TaskAssigneeRegister = CrdtRegister<TaskAssignee | null>;

export const TaskAssigneeRegister = createCrdtRegister(TaskAssigneeSchema.nullable(), {
    merge: (assignee1, assignee2) => {
        if (assignee1 === null && assignee2 === null) return assignee1;
        if (assignee1 === null) return assignee1;
        if (assignee2 === null) return assignee2;

        const comparison = compareHybridLogicalTimes(
            assignee1.assignedTime.absoluteTime,
            assignee2.assignedTime.absoluteTime,
        );
        if (comparison < 0) return assignee1;
        if (comparison > 0) return assignee2;

        const assigneeId =
            assignee1.assigneeId < assignee2.assigneeId
                ? assignee1.assigneeId
                : assignee2.assigneeId;

        const assignerId =
            assignee1.assignerId < assignee2.assignerId
                ? assignee1.assignerId
                : assignee2.assignerId;

        const assignedTime = assignee1.assignedTime.merge(assignee2.assignedTime);

        // Optimization: If nothing changed we can return `assignee1` as-is.
        if (
            assigneeId === assignee1.assigneeId &&
            assignerId === assignee1.assignerId &&
            assignedTime === assignee1.assignedTime
        ) {
            return assignee1;
        }

        return {
            assigneeId,
            assignerId,
            assignedTime,
        };
    },
});

/**
 * `TaskAssignee` but with `TaskSortableAccount` wherever we have an account
 * reference.
 */
export type TaskAssigneeWithSortableAccount = SchemaType<
    typeof TaskAssigneeWithSortableAccountSchema
>;

export const TaskAssigneeWithSortableAccountSchema = Schema.object({
    assignee: TaskSortableAccountSchema,
    assigner: TaskSortableAccountSchema,
    assignedTime: TaskFilterableTime.schema,
});

export type TaskAssigneeWithSortableAccountRegister =
    CrdtRegister<TaskAssigneeWithSortableAccount | null>;

export const TaskAssigneeWithSortableAccountRegister = createCrdtRegister(
    TaskAssigneeWithSortableAccountSchema.nullable(),
    {
        merge: (assignee1, assignee2) => {
            if (assignee1 === null && assignee2 === null) return assignee1;
            if (assignee1 === null) return assignee1;
            if (assignee2 === null) return assignee2;

            const comparison = compareHybridLogicalTimes(
                assignee1.assignedTime.absoluteTime,
                assignee2.assignedTime.absoluteTime,
            );
            if (comparison < 0) return assignee1;
            if (comparison > 0) return assignee2;

            const assignee = mergeTaskSortableAccounts(assignee1.assignee, assignee2.assignee);
            const assigner = mergeTaskSortableAccounts(assignee1.assigner, assignee2.assigner);

            const assignedTime = assignee1.assignedTime.merge(assignee2.assignedTime);

            // Optimization: If nothing changed we can return `assignee1` as-is.
            if (
                assignee === assignee1.assignee &&
                assigner === assignee1.assigner &&
                assignedTime === assignee1.assignedTime
            ) {
                return assignee1;
            }

            return {
                assignee,
                assigner,
                assignedTime,
            };
        },
    },
);

/**
 * Cast `TaskAssigneeWithSortableAccount` to `TaskAssignee`.
 */
export function upcastTaskAssigneeWithSortableAccount(
    assignee: TaskAssigneeWithSortableAccount,
): TaskAssignee {
    return {
        assigneeId: assignee.assignee.accountId,
        assignerId: assignee.assigner.accountId,
        assignedTime: assignee.assignedTime,
    };
}
