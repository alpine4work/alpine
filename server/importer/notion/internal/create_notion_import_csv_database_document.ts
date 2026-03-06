import {strFromU8} from "fflate";

import {ApiContentBlockElementWithFileRow} from "~/server/api/content/api_content_block_element_with_file_row.js";
import {ApiContentExtended, fromApiContent} from "~/server/api/content/from_api_content.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {notionImportCsvToApiContent} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
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
    const elements: Array<ApiContentBlockElementWithFileRow> = [];

    // Add parent document link as a paragraph with mention
    elements.push({
        type: "Paragraph",
        elements: [
            {type: "Text", text: "Parent document: "},
            {type: "Mention", target: {type: "Document", id: parentId}},
        ],
    });

    // Convert CSV to API table with cell mentions The table may contain FileRowTable
    // elements for file paths
    const childTitleToDocumentId =
        inlineDatabaseChildren.get(csvPath) ?? new Map<string, DocumentId>();
    const tableContent = notionImportCsvToApiContent(csvContent, childTitleToDocumentId, {
        filesToUpload,
        csvDir,
    });
    if (tableContent) {
        // Cast the extended table to the base block element type fromApiContent handles
        // the extended types during conversion
        elements.push(tableContent as unknown as ApiContentBlockElementWithFileRow);
    }

    // Note: We don't add a "Child documents" section for databases. The children are
    // database rows and they already appear as cell mentions in the table.

    const apiContent: ApiContentExtended = {elements};

    // Convert API content to ProseMirror document
    const bodyContent = fromApiContent(DocumentContentProsemirrorSchema, apiContent);

    // Create access policy
    const accessPolicy: AccessPolicy = {
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
    await createDocument(context, {
        id: documentId,
        spaceId,
        creatorId,
        content: documentContent,
        createFeedEntry: false,
        from: {type: "Importer", source: {type: "Notion"}},
    });
}
