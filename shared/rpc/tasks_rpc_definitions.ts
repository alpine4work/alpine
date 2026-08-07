import {AccessLevelSchema} from "~/shared/access/access_policy.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ContentDuplicationVariableValuesSchema} from "~/shared/content/content_duplication_variable_schema.js";
import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    BrowserId,
    ContentEditorClientId,
    SpaceId,
    TaskActionTransactionLeaseId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {
    MessageContentPayloadParentSchema,
    MessageExperimentalApprovalSchema,
} from "~/shared/messaging/message_schema.js";
import {createMessageUpdatesBackfillResultSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {PutMessageApprovalDecisionsPayloadSchema} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {RynamoSiteEventSchema} from "~/shared/sites/site_realtime_protocol.js";
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
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const commitTaskActionTransaction = defineRpc({
    name: "commitTaskActionTransaction",
    // TODO(calebmer): This should be idempotent thanks to CRDTs! But I think
    // `updateAccessPolicyShareNotification` might make this RPC non-idempotent since
    // we'll send share notifications twice.
    //
    // Make sure this RPC is idempotent!
    isIdempotent: false,
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
        referencedSites: Schema.array(
            Schema.booleanUnion(
                "isPrivate",
                Schema.object({isPrivate: Schema.value(true)}),
                Schema.object({isPrivate: Schema.value(false), site: SitePreviewModel.schema}),
            ),
        ),
        eventsForSite: Schema.array(RynamoSiteEventSchema).optional(),
    },
});

export const deleteTaskAndAllChildren = defineRpc({
    name: "deleteTaskAndAllChildren",
    // TODO(calebmer): This should be able to be idempotent but I haven't tested.
    isIdempotent: false,
    input: {
        clientId: Schema.id<TaskRealtimeClientId>(),
        taskId: Schema.id<TaskId>(),
        actionTime: HybridLogicalTimeSchema,
    },
    output: {
        actions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema),
        referencedSites: Schema.array(
            Schema.booleanUnion(
                "isPrivate",
                Schema.object({isPrivate: Schema.value(true)}),
                Schema.object({isPrivate: Schema.value(false), site: SitePreviewModel.schema}),
            ),
        ),
    },
});

export const duplicateTaskAndAllChildren = defineRpc({
    name: "duplicateTaskAndAllChildren",
    // Duplicates the task twice if called twice.
    isIdempotent: false,
    input: {
        sourceTaskId: Schema.id<TaskId>(),
        actionTime: HybridLogicalTimeSchema,
        timeZone: TimeZoneSchema,
        variableValues: ContentDuplicationVariableValuesSchema.optional(),
    },
    output: {
        actions: Schema.array(TaskActionSchema),
        referencedAccounts: Schema.array(AccountModel.schema),
        referencedSites: Schema.array(
            Schema.booleanUnion(
                "isPrivate",
                Schema.object({isPrivate: Schema.value(true)}),
                Schema.object({isPrivate: Schema.value(false), site: SitePreviewModel.schema}),
            ),
        ),
        taskId: Schema.id<TaskId>(),
    },
});

export const updateTaskGridViewExpansionState = defineRpc({
    name: "updateTaskGridViewExpansionState",
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        version: Schema.integer,
        steps: Schema.array(TaskNotesContentStepSchema),
        clientId: Schema.id<ContentEditorClientId>(),
    },
    output: {
        // The version after the steps were applied. If the provided `version` was behind
        // the current version the steps are rebased, so this may be greater than
        // `version + steps.length`.
        newVersion: Schema.integer,
    },
});

export const getTaskNotesContentSteps = defineRpc({
    name: "getTaskNotesContentSteps",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        startVersion: Schema.integer,
        endVersion: Schema.integer,
    },
    output: {
        steps: Schema.array(
            Schema.object({
                step: TaskNotesContentStepSchema,
                invertedStep: TaskNotesContentStepSchema,
                clientId: Schema.id<ContentEditorClientId>(),
            }),
        ),
    },
});

export const getTaskNotesContentReferences = defineRpc({
    name: "getTaskNotesContentReferences",
    isIdempotent: true,
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
 * Authorizes whether you have view access to a task. Throws an error if you don't
 * have view access. Also authorizes whether you have edit access to a task.
 * Returns an `editResult` with an error if you have view access to a task but not
 * edit access.
 */
export const authorizeTaskAccess = defineRpc({
    name: "authorizeTaskAccess",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        expectedAccessLevel: AccessLevelSchema,
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const getTaskCommentsFromStart = defineRpc({
    name: "getTaskCommentsFromStart",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentCount: Schema.integer,
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
    },
});

export const getTaskCommentsFromEnd = defineRpc({
    name: "getTaskCommentsFromEnd",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentCount: Schema.integer,
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
    },
});

export const createTaskComment = defineRpc({
    name: "createTaskComment",
    // Creates two comments if called twice.
    isIdempotent: false,
    input: {
        taskId: Schema.id<TaskId>(),
        parent: MessageContentPayloadParentSchema.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
        createdTimeZone: TimeZoneSchema,
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updateTaskCommentContent = defineRpc({
    name: "updateTaskCommentContent",
    // Fails if `contentVersion` isn't the current version.
    isIdempotent: false,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteTaskComment = defineRpc({
    name: "deleteTaskComment",
    // Fails if the comment is already deleted.
    isIdempotent: false,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
    },
    output: {
        version: Schema.integer,
    },
});

export const setTaskCommentReaction = defineRpc({
    name: "setTaskCommentReaction",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
        reaction: ReactionOrGenericLikeSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteTaskCommentReaction = defineRpc({
    name: "deleteTaskCommentReaction",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const putTaskCommentMessageApprovalDecisions = defineRpc({
    name: "putTaskCommentMessageApprovalDecisions",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer.min(0),
        payload: PutMessageApprovalDecisionsPayloadSchema,
    },
    output: {
        approvals: Schema.array(MessageExperimentalApprovalSchema),
        partIndex: Schema.integer.min(0),
        version: Schema.integer.min(0),
        createdTime: Schema.date,
        completedTime: Schema.date.nullable().default(null),
    },
});

export const backfillTaskComments = defineRpc({
    name: "backfillTaskComments",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
        clientCommentCount: Schema.integer,
        newCommentLimit: Schema.integer,
    },
    output: {
        commentCount: Schema.integer,
        newComments: Schema.array(TaskCommentModel.schema()),
        newOtherReferencedComments: Schema.array(TaskCommentModel.schema()),
        commentUpdatesResult: createMessageUpdatesBackfillResultSchema(TaskCommentModel.schema()),
    },
});

export const getTaskCommentAtVersion = defineRpc({
    name: "getTaskCommentAtVersion",
    isIdempotent: true,
    input: {
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
        version: Schema.integer,
    },
    output: {
        comment: TaskCommentModel.schema(),
    },
});

export const getTaskCommentReferences = defineRpc({
    name: "getTaskCommentReferences",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});
