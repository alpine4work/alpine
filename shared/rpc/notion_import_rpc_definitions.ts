import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    NotionImportItemSchema,
    NotionImportTeamspaceOptionsSchema,
} from "~/shared/importer/notion/notion_import_item.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const createNotionImport = defineRpc({
    name: "createNotionImport",
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileName: Schema.string,
        contentType: Schema.string,
        contentLength: Schema.integer,
    },
    output: {
        notionImportId: Schema.id<NotionImportId>(),
        presignedUploadUrl: Schema.string,
        importKey: Schema.string,
    },
});

/**
 * Starts the actual import process. Should only be called after validation
 * completes (status is "Validated"). The client can customize teamspace import
 * options before calling this.
 */
export const startNotionImport = defineRpc({
    name: "startNotionImport",
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        notionImportId: Schema.id<NotionImportId>(),
        teamspaceImportOptions: NotionImportTeamspaceOptionsSchema,
    },
    output: {},
});

export const getNotionImport = defineRpc({
    name: "getNotionImport",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        notionImportId: Schema.id<NotionImportId>(),
    },
    output: {
        notionImport: NotionImportItemSchema.nullable(),
    },
});

export const getAllNotionImportsForSpace = defineRpc({
    name: "getAllNotionImportsForSpace",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        notionImports: Schema.array(NotionImportItemSchema),
    },
});

/**
 * Called by the client after the file upload to S3/local storage completes.
 *
 * This RPC triggers the validation job that extracts metadata from the uploaded
 * Notion export. Using an RPC instead of S3 event notifications (Lambda)
 * simplifies the flow:
 *
 * - Single code path for both development and production
 * - Easier to debug and trace (RPC is in the main request flow)
 * - No need for Lambda infrastructure or dev workarounds
 * - Client controls when validation starts (after upload truly completes)
 */
export const finishedNotionImportUpload = defineRpc({
    name: "finishedNotionImportUpload",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        notionImportId: Schema.id<NotionImportId>(),
    },
    output: {},
});

/**
 * Cancels a Notion import that hasn't started processing yet. Deletes the import
 * record and the uploaded zip file.
 */
export const cancelNotionImport = defineRpc({
    name: "cancelNotionImport",
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        notionImportId: Schema.id<NotionImportId>(),
    },
    output: {},
});

/**
 * Retries a failed Notion import by re-queueing it for processing.
 *
 * This can only be called on imports that:
 *
 * 1. Have status "Failed"
 * 2. Were created within the last 7 days (file retention period)
 *
 * The import will be transitioned back to "ProcessQueued" status and the import
 * job will be started again.
 */
export const retryNotionImport = defineRpc({
    name: "retryNotionImport",
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        notionImportId: Schema.id<NotionImportId>(),
    },
    output: {},
});
