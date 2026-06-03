import {strFromU8} from "fflate";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {attachFileToDocumentAsSystem} from "~/server/files/data/files_actions.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {notionImportCsvToApiContent} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {
    ApiContent,
    ApiContentBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

export interface CreateNotionImportCsvDatabaseDocumentOptions {
    spaceId: SpaceId;
    creatorId: AccountId;
    documentId: DocumentId;
    parentId: DocumentId;
    csvPath: string;
    diskPathToUnzippedFiles: string;
    isPublic: boolean;
    inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
    filesToUpload: Record<string, {id: FileId}>;
}

/**
 * Create a document for a root-level CSV-only database. This creates a synthetic
 * document that contains:
 *
 * - Parent link to the teamspace root document
 * - The CSV content as a table
 * - Links to child documents
 *
 * @see README.md "Teamspace Root Documents" section for root-level CSV databases
 * that need synthetic documents. @see README.md "Database Children and Cell
 * Linking" section for how cell content is converted to links.
 */
export async function createNotionImportCsvDatabaseDocument(
    context: ImporterServiceSystemActionContext,
    options: CreateNotionImportCsvDatabaseDocumentOptions,
): Promise<void> {
    const {
        spaceId,
        creatorId,
        documentId,
        parentId,
        csvPath,
        diskPathToUnzippedFiles,
        isPublic,
        inlineDatabaseChildren,
        filesToUpload,
    } = options;

    // Read the CSV file from disk
    const fileContent = await context.importerService.readUnzippedFile({
        diskPathToUnzippedFiles,
        relativeFilePath: csvPath,
    });
    if (!fileContent) return;

    const csvContent = strFromU8(fileContent);

    // Extract title from CSV path
    const title = parseNotionImportFileName(csvPath.split("/").pop() ?? "")?.title ?? "Untitled";

    // Get the directory of the CSV file for resolving relative paths
    const csvDir = csvPath.includes("/") ? csvPath.slice(0, csvPath.lastIndexOf("/")) : "";

    // Build API content directly
    const elements: Array<ApiContentBlockElement> = [];

    // Add parent document link as a paragraph with mention
    elements.push({
        type: "Paragraph",
        elements: [
            {type: "Text", text: "Parent document: "},
            {type: "Mention", reference: {type: "Document", id: parentId}},
        ],
    });

    // Convert CSV to API table with cell mentions. The table may contain File elements
    // for file paths.
    const childTitleToDocumentId =
        inlineDatabaseChildren.get(csvPath) ?? new Map<string, DocumentId>();
    const tableContent = notionImportCsvToApiContent(csvContent, childTitleToDocumentId, {
        filesToUpload,
        csvDir,
    });
    if (tableContent) {
        elements.push(tableContent);
    }

    // Note: We don't add a "Child documents" section for databases. The children are
    // database rows and they already appear as cell mentions in the table.

    const apiContent: ApiContent = {elements};

    // Convert API content to ProseMirror document
    const bodyContent = fromApiContent(DocumentContentProsemirrorSchema, apiContent);

    // Create access policy
    const accessPolicy: AccessPolicy = {
        // TODO(ifitzsimmons, #notion-import-site-integration): This might be a site access
        // policy depending on the import options.
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: isPublic ? {level: "Edit"} : null,
        urlGrant: null,
    };

    // Build the document content with title
    const titleNode = DocumentContentProsemirrorSchema.node("title", {}, [
        DocumentContentProsemirrorSchema.text(title),
    ]);

    const bodyNodes = bodyContent.content.content;

    const documentContent = assertDocumentContent(
        DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [titleNode, ...bodyNodes]),
    );

    // Create the document
    await impersonateAccountAsSystemContext(context, creatorId, context =>
        createDocument(context, {
            id: documentId,
            spaceId,
            creatorId,
            content: documentContent,
            createFeedEntry: false,
            skipAffinityPointAssignment: true,
            from: {type: "Importer", source: {type: "Notion"}},
        }),
    );

    // Attach files to the document so they can be accessed via the document. Files in
    // CSV tables need attachment records.
    const fileIds = extractFileIdsFromApiContent(apiContent);
    await runAllPromises(
        [...fileIds].map(fileId => attachFileToDocumentAsSystem(context, fileId, documentId)),
    );
}
