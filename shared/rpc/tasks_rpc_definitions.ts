import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    BrowserId,
    SpaceId,
    TaskActionTransactionLeaseId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskActionSchema, TaskUpdateTaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotesContentSchema,
    TaskNotesContentStepSchema,
} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";

export const commitTaskActionTransaction = defineRpc({
    name: "commitTaskActionTransaction",
    input: {
        clientId: Schema.id<TaskRealtimeClientId>().nullable(),
        spaceId: Schema.id<SpaceId>(),
        actions: Schema.array(TaskActionSchema),
        leaseId: Schema.id<TaskActionTransactionLeaseId>().optional(),
        createLeaseIfLostAccess: Schema.object({
            id: Schema.id<TaskActionTransactionLeaseId>(),
            actions: Schema.array(TaskUpdateTaskActionSchema),
        }).optional(),
        updateAccessPolicyShareNotification: ShareNotificationSchema.optional(),
    },
    output: {
        extraActions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema),
    },
});

export const deleteTaskAndAllChildren = defineRpc({
    name: "deleteTaskAndAllChildren",
    input: {
        clientId: Schema.id<TaskRealtimeClientId>(),
        taskId: Schema.id<TaskId>(),
        actionTime: HybridLogicalTimeSchema,
    },
    output: {
        actions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema),
    },
});

export const duplicateTaskAndAllChildren = defineRpc({
    name: "duplicateTaskAndAllChildren",
    input: {
        taskId: Schema.id<TaskId>(),
        actionTime: HybridLogicalTimeSchema,
        timeZone: TimeZoneSchema,
    },
    output: {
        actions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema),
        taskId: Schema.id<TaskId>(),
    },
});

export const updateTaskGridViewExpansionState = defineRpc({
    name: "updateTaskGridViewExpansionState",
    input: {
        spaceId: Schema.id<SpaceId>(),
        browserId: Schema.id<BrowserId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        state: TaskGridViewExpansionStateSchema,
    },
    output: {},
});

export const getTaskNotesContent = defineRpc({
    name: "getTaskNotesContent",
    input: {
        taskId: Schema.id<TaskId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        version: Schema.integer,
        content: TaskNotesContentSchema,
    },
});

export const updateTaskNotesContent = defineRpc({
    name: "updateTaskNotesContent",
    input: {
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        version: Schema.integer,
        steps: Schema.array(TaskNotesContentStepSchema),
    },
    output: {},
});

export const getTaskNotesContentReferences = defineRpc({
    name: "getTaskNotesContentReferences",
    input: {
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        referenceIds: ContentReferencedIdsSchema,
    },
    output: {
        references: ContentReferencesSchema,
    },
});

/**
 * Authorizes whether you have view access to a task. Throws an error if you
 * don't have view access. Also authorizes whether you have edit access to a
 * task. Returns an `editResult` with an error if you have view access to a
 * task but not edit access.
 */
export const authorizeTaskAccess = defineRpc({
    name: "authorizeTaskAccess",
    input: {
        taskId: Schema.id<TaskId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        editResult: Schema.result(
            Schema.object({ok: Schema.value(true)}),
            Schema.object({ok: Schema.value(false), error: ErrorSchema}),
        ),
    },
});

export const getTaskCommentsFromStart = defineRpc({
    name: "getTaskCommentsFromStart",
    input: {
        taskId: Schema.id<TaskId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});

export const getTaskCommentsFromEnd = defineRpc({
    name: "getTaskCommentsFromEnd",
    input: {
        taskId: Schema.id<TaskId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});

export const createTaskComment = defineRpc({
    name: "createTaskComment",
    input: {
        taskId: Schema.id<TaskId>(),
        parentCommentIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    },
    output: {
        comment: TaskCommentModel.schema(),
    },
});

export const updateTaskCommentContent = defineRpc({
    name: "updateTaskCommentContent",
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
    },
    output: {
        contentUpdatedTime: Schema.date,
    },
});

export const deleteTaskComment = defineRpc({
    name: "deleteTaskComment",
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
    },
    output: {
        deletedTime: Schema.date,
    },
});

export const backfillTaskComments = defineRpc({
    name: "backfillTaskComments",
    input: {
        taskId: Schema.id<TaskId>(),
        clientCommentCount: Schema.integer,
        clientLastCommentChangeTime: Schema.date.nullable(),
        newCommentLimit: Schema.integer,
    },
    output: {
        commentCount: Schema.integer,
        lastCommentChangeTime: Schema.date.nullable(),
        newComments: Schema.array(TaskCommentModel.schema()),
        newOtherReferencedComments: Schema.array(TaskCommentModel.schema()),
        commentChangesResult: Schema.union({
            Available: Schema.object({
                type: Schema.value("Available"),
                changes: Schema.array(MessageChangeSchema),
            }),
            Unavailable: Schema.object({
                type: Schema.value("Unavailable"),
            }),
        }),
    },
});

export const getTaskCommentReferences = defineRpc({
    name: "getTaskCommentReferences",
    input: {
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});
