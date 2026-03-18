import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const NotionImportTeamspaceStatistics = Schema.map(
    Schema.string,
    Schema.object({
        // TODO(#sites-notion-import): add sites here - maybe we also add the site IDs so
        // we can display them in the UI?
        documents: Schema.object({
            imported: Schema.integer.min(0),
            // This is a very rough count for documents. Without going through the entire
            // structure and doing our csv/md calculations (see the README), we don't know
            // exactly how many documents we're going to create. This is just a raw count of
            // .md files.
            expectedCount: Schema.integer.min(0),
        }),
        /** Per-mimetype file statistics (e.g. "image/png", "video/mp4"). */
        files: Schema.map(
            Schema.string,
            Schema.object({
                imported: Schema.integer.min(0),
                expectedCount: Schema.integer.min(0),
                size: Schema.integer.min(0),
            }),
        ),
    }),
);

const NotionImportProcessingOrDoneResultSchema = Schema.object({
    teamspaces: NotionImportTeamspaceStatistics,
}).default({
    teamspaces: new Map(),
});

export type NotionImportProcessingOrDoneResult = SchemaType<
    typeof NotionImportProcessingOrDoneResultSchema
>;

/**
 * Status of a Notion import operation.
 *
 * Flow:
 *
 * - User selects zip to upload
 * - Create item and return presigned upload URL - UploadPending
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
    /**
     * Validation complete. Workspace name and teamspaces extracted. Ready to start
     * import.
     */
    Validated: Schema.object({
        type: Schema.value("Validated"),
        result: NotionImportProcessingOrDoneResultSchema,
    }),
    /** Import job queued and waiting to be processed. */
    ProcessQueued: Schema.object({
        type: Schema.value("ProcessQueued"),
        result: NotionImportProcessingOrDoneResultSchema,
    }),
    /** Import job is actively processing. */
    Processing: Schema.object({
        type: Schema.value("Processing"),
        result: NotionImportProcessingOrDoneResultSchema,
    }),
    /** Import completed successfully. */
    Success: Schema.object({
        type: Schema.value("Success"),
        result: NotionImportProcessingOrDoneResultSchema,
    }),
    /** Import failed at some stage. */
    Failed: Schema.object({
        type: Schema.value("Failed"),
        error: Schema.string.optional(),
        result: NotionImportProcessingOrDoneResultSchema,
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
     * S3 key for the uploaded zip file in the `import-uploads` bucket.
     */
    importKey: Schema.string,

    /**
     * Size of the uploaded zip file in bytes.
     *
     * Used to provision appropriate ephemeral storage for the ECS task that processes
     * the import.
     *
     * Defaults to 0 for backwards compatibility with existing records (which will use
     * minimum storage).
     */
    importZipSize: Schema.integer.min(0).default(0),

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
     * When the import started processing.
     *
     * Only set after the import has been queued for processing.
     *
     * If the import is retried, this will be set to the new processing start time.
     */
    startedProcessingTime: Schema.date.nullable().default(null),

    /**
     * For each detected teamspace ID, the user's choice of how to import it.
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
