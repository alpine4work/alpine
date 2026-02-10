import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Status of a Notion import operation.
 *
 * Flow:
 * - User selects zip to upload
 * - Create item and return presigned upload URL  - UploadPending
 * - UI finishes the upload and queues validation - QueuedValidation
 * - Validation job is queued - Validating
 * - Validation complete - Validated
 * - User confirms import options - ProcessingQueued
 * - Import job is queued - Processing
 * - Import job is completed - Success
 * - Import job failed - Failed
 */
export const NotionImportStatusSchema = Schema.union({
    /** Waiting for client to upload the zip file. */
    UploadPending: Schema.object({type: Schema.value("UploadPending")}),
    /** File uploaded, validation job is processing. */
    ValidateQueued: Schema.object({type: Schema.value("ValidateQueued")}),
    /** File uploaded, validation job is processing. */
    Validating: Schema.object({type: Schema.value("Validating")}),
    /** Validation complete. Workspace name and teamspaces extracted. Ready to start import. */
    Validated: Schema.object({type: Schema.value("Validated")}),
    /** Import job queued and waiting to be processed. */
    ProcessQueued: Schema.object({type: Schema.value("ProcessQueued")}),
    /** Import job is actively processing. */
    Processing: Schema.object({type: Schema.value("Processing")}),
    /** Import completed successfully. */
    Success: Schema.object({type: Schema.value("Success")}),
    /** Import failed at some stage. */
    Failed: Schema.object({
        type: Schema.value("Failed"),
        error: Schema.string.optional(),
    }),
});

export const NotionImportTeamspaceOptionsSchema = Schema.array(
    Schema.object({
        teamspaceId: Schema.string,
        teamspaceName: Schema.string,
        option: Schema.union({
            Public: Schema.object({type: Schema.value("Public")}),
            Private: Schema.object({type: Schema.value("Private")}),
            DoNotImport: Schema.object({type: Schema.value("DoNotImport")}),
        }),
    }),
);

export type NotionImportTeamspaceOptions = SchemaType<typeof NotionImportTeamspaceOptionsSchema>;

export const NotionImportItemSchema = Schema.object({
    /**
     * The space this import belongs to.
     */
    spaceId: Schema.id<SpaceId>(),

    /**
     * The name of the workspace being imported.
     *
     * Only set after the zip has been uploaded and processed.
     */
    workspaceName: Schema.string.nullable().default(null),

    /**
     * S3 key for the uploaded zip file in the
     * `import-uploads` bucket.
     */
    importKey: Schema.string,

    /**
     * The account that started this import.
     */
    startedByAccountId: Schema.id<AccountId>(),

    /**
     * When the import was created.
     */
    createdTime: Schema.date,

    /**
     * When the import was last updated.
     */
    updatedTime: Schema.date,

    /**
     * For each detected teamspace ID, the user's choice
     * of how to import it.
     *
     * Only set after the zip has been uploaded and processed.
     */
    teamspaceImportOptions: NotionImportTeamspaceOptionsSchema.nullable().default(null),

    /**
     * Current status of the import operation.
     */
    status: NotionImportStatusSchema,

    /**
     * Number of entities successfully imported so far.
     */
    importedCount: Schema.integer.min(0).default(0),
});

export type NotionImportItem = SchemaType<typeof NotionImportItemSchema>;
