import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {ObjectSchema, Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    TaskSortableAccountSchema,
    mergeTaskSortableAccounts,
} from "~/shared/tasks/task_sortable_account.js";

/**
 * The task status represents whether a task is open or closed. Additionally when a
 * task is closed we carry data like the account who closed it and the time at
 * which it closed.
 */
export type TaskStatus = SchemaType<typeof TaskStatusSchema>;

export const TaskStatusSchema = Schema.union({
    Open: Schema.object({
        type: Schema.value("Open"),
    }),
    Closed: Schema.object({
        type: Schema.value("Closed"),
        closerId: Schema.id<AccountId>(),
        closedTime: TaskFilterableTime.schema,
    }),
});

export type TaskStatusRegister = CrdtRegister<TaskStatus>;

export const TaskStatusRegister = createCrdtRegister(TaskStatusSchema, {
    merge: (status1, status2): TaskStatus => {
        if (status1.type === "Open" && status2.type === "Open") return status1;
        if (status1.type === "Open") return status1;
        if (status2.type === "Open") return status2;

        const comparison = compareHybridLogicalTimes(
            status1.closedTime.absoluteTime,
            status2.closedTime.absoluteTime,
        );
        if (comparison < 0) return status1;
        if (comparison > 0) return status2;

        const closerId = status1.closerId < status2.closerId ? status1.closerId : status2.closerId;
        const closedTime = status1.closedTime.merge(status2.closedTime);

        // Optimization: If nothing changed we can return `status1` as-is.
        if (closerId === status1.closerId && closedTime === status1.closedTime) return status1;

        return {
            type: "Closed",
            closerId,
            closedTime,
        };
    },
});

/**
 * `TaskStatus` but with `TaskSortableAccount` wherever we have an account
 * reference.
 */
export type TaskStatusWithSortableAccount = SchemaType<typeof TaskStatusWithSortableAccountSchema>;

export const TaskStatusWithSortableAccountSchema = Schema.union({
    Open: cast<ObjectSchema<{readonly type: "Open"; readonly closer?: undefined}>>(
        Schema.object({
            type: Schema.value("Open"),
        }),
    ),
    Closed: Schema.object({
        type: Schema.value("Closed"),
        closer: TaskSortableAccountSchema,
        closedTime: TaskFilterableTime.schema,
    }),
});

export type TaskStatusWithSortableAccountRegister = CrdtRegister<TaskStatusWithSortableAccount>;

export const TaskStatusWithSortableAccountRegister = createCrdtRegister(
    TaskStatusWithSortableAccountSchema,
    {
        merge: (status1, status2): TaskStatusWithSortableAccount => {
            if (status1.type === "Open" && status2.type === "Open") return status1;
            if (status1.type === "Open") return status1;
            if (status2.type === "Open") return status2;

            const comparison = compareHybridLogicalTimes(
                status1.closedTime.absoluteTime,
                status2.closedTime.absoluteTime,
            );
            if (comparison < 0) return status1;
            if (comparison > 0) return status2;

            const closer = mergeTaskSortableAccounts(status1.closer, status2.closer);
            const closedTime = status1.closedTime.merge(status2.closedTime);

            // Optimization: If nothing changed we can return `status1` as-is.
            if (closer === status1.closer && closedTime === status1.closedTime) return status1;

            return {
                type: "Closed",
                closer,
                closedTime,
            };
        },
    },
);

/**
 * Cast `TaskStatusWithSortableAccount` to `TaskStatus`.
 */
export function upcastTaskStatusWithSortableAccount(
    status: TaskStatusWithSortableAccount,
): TaskStatus {
    if (status.type === "Open") {
        return status;
    } else {
        return {
            type: "Closed",
            closerId: status.closer.accountId,
            closedTime: status.closedTime,
        };
    }
}
