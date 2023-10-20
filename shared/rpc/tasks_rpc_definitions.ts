import {AccountModel} from "~/shared/accounts/account_model.js";
import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {
    BrowserId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModelSearchResultSchema} from "~/shared/tasks/model/task_collection_model_search_result.js";
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

export const addTaskCollectionAffinityPoints = defineRpc({
    name: "addTaskCollectionAffinityPoints",
    input: {
        spaceId: Schema.id<SpaceId>(),
        collectionId: Schema.id<TaskCollectionId>(),
        points: Schema.float,
    },
    output: {},
});

export const getAffinitiveTaskCollections = defineRpc({
    name: "getAffinitiveTaskCollections",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        collectionResults: Schema.array(TaskCollectionModelSearchResultSchema),
    },
});

export const searchTaskCollections = defineRpc({
    name: "searchTaskCollections",
    input: {
        spaceId: Schema.id<SpaceId>(),
        nameQuery: Schema.string,
        limit: Schema.integer,
    },
    output: {
        collectionResults: Schema.array(TaskCollectionModelSearchResultSchema),
    },
});
