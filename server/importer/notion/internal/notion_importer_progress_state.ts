import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";

export interface NotionImporterProgressStateConfig {
    notionImportId: NotionImportId;
    context: ImporterServiceSystemActionContext;
    /** How often to persist state to DynamoDB (ms). Default: 1000. */
    persistIntervalMs?: number;
    /** Expected statistics from the validation step. */
    initialResult: NotionImportProcessingOrDoneResult;
}

/**
 * Tracks import progress (documents processed, files uploaded by type) and
 * periodically persists to DynamoDB so users can see real-time progress in the UI.
 *
 * Use {@link NotionImporterProgressState.with} to manage the full lifecycle: it
 * starts the periodic persist loop, runs the action, and updates the import status
 * to Success or Failed when done.
 */
export class NotionImporterProgressState {
    private readonly notionImportId: NotionImportId;
    private readonly context: ImporterServiceSystemActionContext;
    private readonly persistIntervalMs: number;
    private readonly initialResult: NotionImportProcessingOrDoneResult;

    /** Per-teamspace counters for tracking progress. */
    readonly teamspaceCounters = new Map<string, {documents: number; files: Map<string, number>}>();

    /** Persistence loop interval handle. */
    private persistInterval: NodeJS.Timeout | null = null;

    constructor(config: NotionImporterProgressStateConfig) {
        this.notionImportId = config.notionImportId;
        this.context = config.context;
        this.persistIntervalMs = config.persistIntervalMs ?? 1000;
        this.initialResult = config.initialResult;

        for (const teamspaceId of config.initialResult.teamspaces.keys()) {
            this.teamspaceCounters.set(teamspaceId, {
                documents: 0,
                files: new Map(),
            });
        }
    }

    /**
     * Create a progress state, run the action with periodic persistence, and update
     * the import status to Success or Failed when done.
     */
    static async with<T>(
        config: NotionImporterProgressStateConfig,
        action: (state: NotionImporterProgressState) => Promise<T>,
    ): Promise<T> {
        const state = new NotionImporterProgressState(config);
        state.startPersistLoop();
        try {
            const result = await action(state);
            await state.finishUpload();
            return result;
        } catch (error) {
            await state.finishUploadWithError(error);
            throw error;
        }
    }

    /**
     * Increment the document counter for a teamspace.
     */
    incrementDocumentCounter(teamspaceId: string, count: number = 1): void {
        assertExists(this.teamspaceCounters.get(teamspaceId)).documents += count;
    }

    /**
     * Increment the file counter for a mimetype in a teamspace.
     */
    incrementFileCounter(
        teamspaceId: string,
        contentType: FileContentType,
        count: number = 1,
    ): void {
        const counters = assertExists(this.teamspaceCounters.get(teamspaceId));
        const current = counters.files.get(contentType) ?? 0;
        counters.files.set(contentType, current + count);
    }

    private startPersistLoop(): void {
        this.persistInterval = setInterval(() => {
            void this.persist();
        }, this.persistIntervalMs);
    }

    private stopPersistLoop(): void {
        if (this.persistInterval) {
            clearInterval(this.persistInterval);
            this.persistInterval = null;
        }
    }

    /**
     * Stop the persist loop and update the import status to Success.
     */
    private async finishUpload(): Promise<void> {
        this.stopPersistLoop();

        const result = this.buildResult();
        await NotionImporterTable.updateItem(
            this.context,
            {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId: this.notionImportId,
            },
            item => ({
                ...assertExists(item),
                status: {type: "Success" as const, result},
                updatedTime: new Date(),
            }),
        );
    }

    /**
     * Stop the persist loop and update the import status to Failed.
     */
    private async finishUploadWithError(error: unknown): Promise<void> {
        this.stopPersistLoop();

        const errorMessage = error instanceof Error ? error.message : "Unknown error during import";
        const result = this.buildResult();
        await NotionImporterTable.updateItem(
            this.context,
            {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId: this.notionImportId,
            },
            item => ({
                ...assertExists(item),
                status: {type: "Failed" as const, error: errorMessage, result},
                updatedTime: new Date(),
            }),
        );
    }

    /**
     * Build the result object by merging current counters with expected statistics
     * from the validation step.
     */
    private buildResult(): NotionImportProcessingOrDoneResult {
        const teamspaces = new Map<
            string,
            {
                documents: {imported: number; expectedCount: number};
                files: Map<string, {imported: number; expectedCount: number; size: number}>;
            }
        >();

        for (const [teamspaceId, expected] of this.initialResult.teamspaces) {
            const counters = assertExists(this.teamspaceCounters.get(teamspaceId));

            const files = new Map<
                string,
                {imported: number; expectedCount: number; size: number}
            >();

            for (const [contentType, expectedFile] of expected.files) {
                const importedCount = counters.files.get(contentType) ?? 0;
                files.set(contentType, {
                    imported: importedCount,
                    expectedCount: expectedFile.expectedCount,
                    size: expectedFile.size,
                });
            }

            teamspaces.set(teamspaceId, {
                documents: {
                    imported: counters.documents,
                    expectedCount: expected.documents.expectedCount,
                },
                files,
            });
        }

        return {teamspaces};
    }

    /**
     * Persist current state to database as Processing status. Swallows errors since
     * persistence is best-effort during processing.
     */
    private async persist(): Promise<void> {
        const result = this.buildResult();

        await this.context.tracer.withSpan(
            "Persist notion import state",
            async (_tracerContext, span) => {
                try {
                    await NotionImporterTable.updateItem(
                        this.context,
                        {
                            partitionType: "Import",
                            sortRangeType: "Attributes",
                            notionImportId: this.notionImportId,
                        },
                        item => {
                            const existingItem = assertExists(item);
                            if (existingItem.status.type !== "Processing") {
                                throw new FailedPreconditionError("Status is not Processing");
                            }
                            return {
                                ...existingItem,
                                status: {type: "Processing" as const, result},
                                updatedTime: new Date(),
                            };
                        },
                    );
                } catch (error) {
                    // Log and swallow error - persistence is best-effort during processing. The final
                    // status update will have the correct result.
                    span.addException(error);
                }
            },
        );
    }
}
