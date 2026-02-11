import {strFromU8} from "fflate";

import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {visitAndProduceApiContent} from "~/server/api/content/visit_and_produce_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {createNotionImportCsvDatabaseDocument} from "~/server/importer/notion/internal/create_notion_import_csv_database_document.js";
import {createNotionImportTeamspaceRootDocument} from "~/server/importer/notion/internal/create_notion_import_teamspace_root_document.js";
import {findNotionImportUnzippedFileKey} from "~/server/importer/notion/internal/find_notion_import_unzipped_file_key.js";
import {generateDeterministicNotionDocumentIdSync} from "~/server/importer/notion/internal/generate_deterministic_notion_document_id.js";
import {notionImportCsvToApiContent} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";
import {NotionImportMappedReferencesResult} from "~/server/importer/notion/internal/unzip_notion_import_and_map_references.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DocumentId, NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {NotionImportItem} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Given the result of unzipNotionImportAndMapReferences, convert the extracted
 * Notion data to Alpine entities. For now, this is just documents.
 *
 * This function will:
 * - Loop through each teamspace
 * - Loop through each document in the teamspace
 * - Create an Alpine document for the document using a markdown parser
 *   - Use the correct accessPolicy based on the teamspace import option
 * - Update all references within this document to a link to the alpine document
 *   - use the format https://alpine.inc/s/{spaceId}/documents/{documentId}
 * - Notion exported documents will have their children under the title, above the first divider (---)
 *   - Check if all children and only the children exist between the # title and the first divider (---)
 *   - If this is the case, we need to remove the children and the divider from the document content.
 * - Add a "Parent document: <parent mention>" under the title
 * - At the end of the document, add a "### Children documents:\n- <child link document>\n- <child link document>\n- ..."
 * - Update all references of the markdown files to the new Alpine fileIds.
 * - Update the status of the import item as we go
 * - TODO: Upload all files of filesToUpload to the space
 *   - https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/9v5j2e2jrpm2xz419k1q11v02w
 * - TODO: Batch document creation
 *   - https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2t83weqmd65zqn9ap1t1hmhh5c
 * - TODO: Run teamspace uploaded in parrallel
 *   - https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/qytsx10ph8ba5z05gfdafya9r4
 *
 */
export async function convertExtractedNotionDataToEntities(
    context: ServerSystemActionContext,
    notionImportId: NotionImportId,
    importItem: NotionImportItem,
    mappedReferencesResult: NotionImportMappedReferencesResult,
): Promise<void> {
    const {spaceId, startedByAccountId, workspaceName} = importItem;
    const {
        notionWorkspaceId,
        teamspaces,
        unzippedFiles,
        inlineDatabaseChildren,
        rootLevelCsvDatabases,
        pathToDocumentId,
        documentIdToPath,
    } = mappedReferencesResult;

    // Generate teamspace root document IDs upfront so we can set parent links.
    // Also add them to documentIdToPath so child documents can resolve their parent title.
    // Use deterministic IDs based on space ID + workspace ID + teamspace ID for consistency.
    const teamspaceRootDocumentIds = new Map<string, DocumentId>();
    for (const teamspace of teamspaces) {
        const rootDocumentId = generateDeterministicNotionDocumentIdSync(
            spaceId,
            notionWorkspaceId,
            `teamspace-root:${teamspace.id}`,
        );
        teamspaceRootDocumentIds.set(teamspace.id, rootDocumentId);
        // Use a synthetic path that follows the Notion file name pattern for title extraction.
        // Use teamspace.id for uniqueness since teamspace names aren't guaranteed unique.
        const syntheticPath = `${teamspace.name} ${teamspace.id}.md`;
        documentIdToPath.set(rootDocumentId, syntheticPath);
    }

    // Create synthetic documents for root-level CSV-only databases.
    // These need document entries so their children can have proper parent links.
    // Use deterministic IDs based on space ID + workspace ID + CSV file's notion ID.
    const csvDatabaseDocuments = new Map<
        string,
        {id: DocumentId; teamspaceId: string; childPaths: Array<string>}
    >();
    for (const [csvPath, {childPaths, teamspaceId}] of rootLevelCsvDatabases) {
        const csvFileName = csvPath.split("/").pop() ?? "";
        const parsed = parseNotionImportFileName(csvFileName);
        const notionId = parsed?.notionId ?? csvPath; // Fallback to path if parsing fails
        const documentId = generateDeterministicNotionDocumentIdSync(
            spaceId,
            notionWorkspaceId,
            `csv-database:${notionId}`,
        );
        csvDatabaseDocuments.set(csvPath, {id: documentId, teamspaceId, childPaths});
        pathToDocumentId.set(csvPath, documentId);
        documentIdToPath.set(documentId, csvPath);
    }

    // TODO: Handle multiple pages at once
    //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2t83weqmd65zqn9ap1t1hmhh5c

    // Process each teamspace
    for (const teamspace of teamspaces) {
        const isPublic = teamspace.importOption.type === "Public";
        const teamspaceRootDocumentId = teamspaceRootDocumentIds.get(teamspace.id)!;

        // Update parent references for children of root-level CSV databases in this teamspace.
        for (const [csvPath, {id: csvDocumentId, childPaths}] of csvDatabaseDocuments) {
            for (const childPath of childPaths) {
                const childDocument = teamspace.documents[childPath];
                if (childDocument) {
                    childDocument.parent = {documentId: csvDocumentId, relativeFilePath: csvPath};
                }
            }
        }

        // Update parent for first-layer documents (those with no parent).
        // They should have the teamspace root document as their parent.
        // Note: relativeFilePath is empty because the teamspace root is a synthetic document.
        for (const [, documentInfo] of Object.entries(teamspace.documents)) {
            if (documentInfo.parent === null) {
                documentInfo.parent = {documentId: teamspaceRootDocumentId, relativeFilePath: ""};
            }
        }

        // Process each document in the teamspace
        for (const [filePath, documentInfo] of Object.entries(teamspace.documents)) {
            // Find the file content in the unzipped files
            const fileKey = findNotionImportUnzippedFileKey(unzippedFiles, filePath);
            if (!fileKey) continue;

            const fileContent = unzippedFiles[fileKey];
            if (!fileContent) continue;

            const rawContent = strFromU8(fileContent);

            // ============================================================
            // Preprocess markdown for database properties
            // ============================================================
            // Notion exports database row pages with property lines separated
            // by single newlines (e.g., "Status: Done\nPriority: High").
            // In markdown, single newlines don't create paragraph breaks - they
            // become spaces. We convert single newlines between property-like
            // lines to double newlines so the markdown parser creates separate
            // paragraphs, which we can then detect and format in API content.
            const preprocessedContent = preprocessNotionDatabaseProperties(rawContent);

            // ============================================================
            // Parse markdown to API content
            // ============================================================
            const rawApiContent = parseApiContentFromMarkdown(preprocessedContent, {spaceId});

            // ============================================================
            // Transform API content for Alpine's format
            // ============================================================
            const {title, content: finalApiContent} = reformatNotionApiContentIntoOurDesiredFormat(
                rawApiContent,
                {
                    spaceId,
                    pathToDocumentId,
                    documentIdToPath,
                    parentId: documentInfo.parent?.documentId ?? null,
                    childIds: documentInfo.children,
                    hasChildrenHeader: documentInfo.hasChildrenHeader,
                    filePath,
                    unzippedFiles,
                    inlineDatabaseChildren,
                },
            );

            // Convert API content to ProseMirror document
            const bodyContent = fromApiContent(DocumentContentProsemirrorSchema, finalApiContent);

            // Create access policy based on teamspace import option
            const accessPolicy: AccessPolicy = {
                accountGrantById: new Map([[startedByAccountId, {level: "Manage", generation: 0}]]),
                defaultGrant: isPublic ? {level: "Edit"} : null,
                urlGrant: null,
            };

            // Build the document content with title
            const titleNode = DocumentContentProsemirrorSchema.node("title", {}, [
                DocumentContentProsemirrorSchema.text(title),
            ]);

            // Get body nodes (skip the doc wrapper from fromApiContent)
            const bodyNodes = bodyContent.content.content;

            const documentContent = assertDocumentContent(
                DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
                    titleNode,
                    ...bodyNodes,
                ]),
            );

            // Create the document
            await createDocument(context, {
                id: documentInfo.id,
                spaceId,
                creatorId: startedByAccountId,
                content: documentContent,
                createFeedEntry: false,
                from: {type: "Importer", source: {type: "Notion"}},
            });

            // Increment the imported count
            // TODO: batch this:
            //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2t83weqmd65zqn9ap1t1hmhh5c
            await NotionImporterTable.updateItem(
                context,
                {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
                item => {
                    const existingItem = assertExists(item);

                    if (existingItem.status.type !== "Processing") {
                        throw new FailedPreconditionError(
                            "Status is not in the correct state for importing",
                        );
                    }

                    return {
                        ...existingItem,
                        importedCount: existingItem.importedCount + 1,
                        updatedTime: new Date(),
                    };
                },
            );
        }

        // Create documents for root-level CSV-only databases
        for (const [csvPath, csvDatabaseInfo] of csvDatabaseDocuments) {
            if (csvDatabaseInfo.teamspaceId !== teamspace.id) continue;

            // Create a document for this CSV database
            await createNotionImportCsvDatabaseDocument(context, {
                spaceId,
                creatorId: startedByAccountId,
                documentId: csvDatabaseInfo.id,
                parentId: teamspaceRootDocumentId,
                csvPath,
                unzippedFiles,
                isPublic,
                inlineDatabaseChildren,
            });

            // Increment the imported count
            // TODO: batch this:
            //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2t83weqmd65zqn9ap1t1hmhh5c
            await NotionImporterTable.updateItem(
                context,
                {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
                item => {
                    const existingItem = assertExists(item);

                    if (existingItem.status.type !== "Processing") {
                        throw new FailedPreconditionError(
                            "Status is not in the correct state for importing",
                        );
                    }

                    return {
                        ...existingItem,
                        importedCount: existingItem.importedCount + 1,
                        updatedTime: new Date(),
                    };
                },
            );
        }

        // Create a teamspace root document with list of first-layer children
        await createNotionImportTeamspaceRootDocument(context, {
            spaceId,
            workspaceName: assertExists(workspaceName),
            creatorId: startedByAccountId,
            teamspaceName: teamspace.name,
            isPublic,
            teamspaceRootDocumentId,
            teamspaceDocuments: teamspace.documents,
            csvDatabaseDocumentIds: new Map(
                [...csvDatabaseDocuments.entries()]
                    .filter(([, info]) => info.teamspaceId === teamspace.id)
                    .map(([csvPath, info]) => [csvPath, info.id]),
            ),
        });
    }
}

// ============================================================================
// MARKDOWN PREPROCESSING
// ============================================================================
// We do minimal preprocessing on raw markdown before parsing. The goal is to
// handle Notion export quirks that are difficult to detect in parsed content.
// ============================================================================

/**
 * Preprocess database property lines by adding paragraph breaks between them.
 *
 * ## Why this is necessary
 *
 * Notion exports database row pages with property lines at the top, formatted
 * as `Property Name: value` on separate lines with single newlines:
 *
 * ```
 * Status: Done
 * Priority: High
 * Due Date: 2025-01-15
 *
 * Task description here.
 * ```
 *
 * In markdown, single newlines don't create paragraph breaks - they become
 * spaces when parsed. So the above becomes a single paragraph:
 * "Status: Done Priority: High Due Date: 2025-01-15"
 *
 * By adding an extra newline between property lines, we get separate paragraphs
 * that we can detect and format as a bulleted list in API content.
 *
 * ## Why do this in markdown?
 *
 * Once parsed to API content, the property lines are concatenated into a single
 * Text node, making it impossible to reliably split them back apart (values can
 * contain spaces that look like property boundaries).
 *
 * @param markdown - Raw markdown content from Notion export
 * @returns Markdown with double newlines between property lines
 */
function preprocessNotionDatabaseProperties(markdown: string): string {
    const lines = markdown.split("\n");

    // Pattern to match property lines: "Property Name: value"
    // - One or more words (letters only) as the key
    // - Followed by colon
    // - Followed by the value
    const propertyLinePattern = /^[A-Za-z]+(?:\s[A-Za-z]+)*:\s*.+$/;

    // Find the title line (# Heading) - properties come after it
    let titleIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.trim().startsWith("# ")) {
            titleIndex = i;
            break;
        }
    }

    // If no title found, check from the start
    const startIndex = titleIndex === -1 ? 0 : titleIndex + 1;

    // Find consecutive property lines after the title
    let propertyStartIndex = -1;
    let propertyEndIndex = -1;

    for (let i = startIndex; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();

        // Skip empty lines before properties
        if (trimmed === "" && propertyStartIndex === -1) {
            continue;
        }

        if (propertyLinePattern.test(trimmed)) {
            if (propertyStartIndex === -1) {
                propertyStartIndex = i;
            }
            propertyEndIndex = i;
        } else {
            // Non-property line - stop looking
            break;
        }
    }

    // No property lines found, or only one line (no need to add breaks)
    if (propertyStartIndex === -1 || propertyStartIndex === propertyEndIndex) {
        return markdown;
    }

    // Add extra newlines between property lines
    const result: Array<string> = [];
    for (let i = 0; i < lines.length; i++) {
        result.push(lines[i]!);

        // Add extra newline after each property line (except the last one)
        if (i >= propertyStartIndex && i < propertyEndIndex) {
            const currentTrimmed = lines[i]!.trim();
            const nextTrimmed = lines[i + 1]?.trim() ?? "";

            if (propertyLinePattern.test(currentTrimmed) && propertyLinePattern.test(nextTrimmed)) {
                result.push(""); // Add extra newline
            }
        }
    }

    return result.join("\n");
}

// ============================================================================
// API CONTENT TRANSFORMATION
// ============================================================================

/**
 * Remove the child links section from API content.
 *
 * Notion exports child page links after the title heading, followed by a
 * horizontal rule (Divider). This function removes all elements up to and
 * including the first Divider.
 *
 * @param elements - Block elements to process
 * @returns Elements with child links section removed
 */
function removeChildLinksSectionFromApiContent(
    elements: Array<ApiContentBlockElement>,
): Array<ApiContentBlockElement> {
    const firstDividerIndex = elements.findIndex(element => element.type === "Divider");
    if (firstDividerIndex === -1) {
        // No divider found - return as-is
        return elements;
    }
    // Return everything after the divider
    return elements.slice(firstDividerIndex + 1);
}

/**
 * Format database page properties as a bulleted list with dividers.
 *
 * After preprocessing, database property lines appear as consecutive
 * Paragraph elements, each containing a single "Key: Value" text.
 * We detect this pattern and convert to: Divider, UnorderedList, Divider.
 *
 * @param elements - Block elements to process
 * @returns Elements with formatted properties
 */
function formatDatabasePropertiesInApiContent(
    elements: Array<ApiContentBlockElement>,
): Array<ApiContentBlockElement> {
    if (elements.length === 0) return elements;

    // Pattern to match property lines: "Property Name: value"
    const propertyPattern = /^[A-Za-z]+(?:\s[A-Za-z]+)*:\s*.+$/;

    // Check if a paragraph contains only a property line
    function isPropertyParagraph(element: ApiContentBlockElement): string | null {
        if (element.type !== "Paragraph") return null;
        if (element.elements.length !== 1) return null;

        const inline = element.elements[0]!;
        if (inline.type !== "Text") return null;

        const text = inline.text.trim();
        if (propertyPattern.test(text)) {
            return text;
        }
        return null;
    }

    // Collect consecutive property paragraphs from the start
    const propertyLines: Array<string> = [];
    let propertyEndIndex = 0;

    for (let i = 0; i < elements.length; i++) {
        const propertyText = isPropertyParagraph(elements[i]!);
        if (propertyText !== null) {
            propertyLines.push(propertyText);
            propertyEndIndex = i + 1;
        } else {
            break;
        }
    }

    // Need at least 1 property line to format
    if (propertyLines.length === 0) return elements;

    // Build the formatted output: Divider, UnorderedList, Divider
    const formattedElements: Array<ApiContentBlockElement> = [];

    formattedElements.push({type: "Divider"});
    formattedElements.push({
        type: "UnorderedList",
        items: propertyLines.map(line => ({
            elements: [{type: "Paragraph", elements: [{type: "Text", text: line}]}],
        })),
    });
    formattedElements.push({type: "Divider"});

    // Add the rest of the content (after the property paragraphs)
    formattedElements.push(...elements.slice(propertyEndIndex));

    return formattedElements;
}

// ============================================================================
// API CONTENT TRANSFORMATION
// ============================================================================
// These functions operate on parsed API content to transform it into Alpine's
// desired format. They handle structural changes like extracting titles,
// promoting headings, and converting links to mentions.
// ============================================================================

/**
 * Transform parsed API content from a Notion export into Alpine's format.
 *
 * This function handles transformations that work well on parsed API content:
 *
 * 1. **Extract title** - Find the first H1 heading, use its text as the
 *    document title, and remove it from the content.
 *
 * 2. **Promote headings** - Since we extracted H1 as the title, demote all
 *    other headings by one level (H2 → H1, H3 → H2, etc.) to maintain
 *    proper document hierarchy.
 *
 * 3. **Convert document links** - Replace links to `.md` files with Alpine
 *    document mentions that reference the imported documents.
 *
 * 4. **Convert database links** - Replace links to `.csv` files with actual
 *    table blocks containing the parsed CSV data.
 *
 * 5. **Add navigation** - Add "Parent document" mention at the top and
 *    "Child documents" section at the bottom for document hierarchy.
 *
 * @see README.md "Header Level Promotion" section for heading level changes.
 * @see README.md "Empty Parent Documents" section for child-mentions-only handling.
 * @see README.md "Inline vs Full-Page Databases" section for CSV link conversion.
 *
 * @param apiContent - Parsed API content from markdown
 * @param options - Configuration including document mappings and files
 * @returns Object with extracted title and transformed content
 */
function reformatNotionApiContentIntoOurDesiredFormat(
    apiContent: ApiContent,
    options: {
        spaceId: SpaceId;
        pathToDocumentId: Map<string, DocumentId>;
        documentIdToPath: Map<DocumentId, string>;
        parentId: DocumentId | null;
        childIds: Set<DocumentId>;
        hasChildrenHeader: boolean;
        filePath: string;
        unzippedFiles: Record<string, Uint8Array>;
        inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
    },
): {title: string; content: ApiContent} {
    const {
        pathToDocumentId,
        documentIdToPath,
        parentId,
        childIds,
        hasChildrenHeader,
        filePath,
        unzippedFiles,
        inlineDatabaseChildren,
    } = options;

    let elements = [...apiContent.elements];

    // ----------------------------------------------------------------
    // Extract title from first H1 heading
    // ----------------------------------------------------------------
    // Notion exports the page title as a `# Title` heading. We extract
    // this to use as the document's title field and remove it from the
    // body content.
    // ----------------------------------------------------------------
    let title = "Untitled";
    const firstHeading1Index = elements.findIndex(
        element => element.type === "Heading" && element.level === 1,
    );
    if (firstHeading1Index !== -1) {
        const headingElement = elements[firstHeading1Index]!;
        if (headingElement.type === "Heading") {
            title = extractTextFromInlineElements(headingElement.elements);
            elements.splice(firstHeading1Index, 1);
        }
    } else {
        // Fallback: extract title from the filename if no H1 found
        const fileName = filePath.split("/").pop() ?? "";
        const parsedFileName = parseNotionImportFileName(fileName);
        if (parsedFileName) {
            title = parsedFileName.title;
        }
    }

    // ----------------------------------------------------------------
    // Remove child links section if present
    // ----------------------------------------------------------------
    // Notion exports child page links after the title, followed by a
    // horizontal rule (---). We remove this section since we add our
    // own "Child documents" section at the end.
    // ----------------------------------------------------------------
    if (hasChildrenHeader) {
        elements = removeChildLinksSectionFromApiContent(elements);
    }

    // ----------------------------------------------------------------
    // Format database properties
    // ----------------------------------------------------------------
    // Notion exports database row pages with property lines at the top.
    // These appear as a paragraph with "Key: Value" text separated by
    // Break elements. We convert these to a bulleted list with dividers.
    // ----------------------------------------------------------------
    elements = formatDatabasePropertiesInApiContent(elements);

    // ----------------------------------------------------------------
    // Promote all headings by one level
    // ----------------------------------------------------------------
    // Since we extracted the H1 as the title, we need to promote all
    // remaining headings: H2 → H1, H3 → H2, etc. This maintains proper
    // document hierarchy.
    // ----------------------------------------------------------------
    elements = elements.map(element => {
        if (element.type === "Heading" && element.level > 1) {
            return {...element, level: element.level - 1};
        }
        return element;
    });

    // Get the directory of the current document for resolving relative paths
    const currentDir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";

    // Transform .csv links to tables (must happen before link transformation)
    elements = transformCsvLinksToTables(elements, {
        currentDir,
        unzippedFiles,
        inlineDatabaseChildren,
    });

    // Transform .md links to document mentions using visitor pattern
    const transformedContent = transformMdLinksToMentions(
        {elements},
        {pathToDocumentId, currentDir},
    );
    elements = [...transformedContent.elements];

    // Check if the content is ONLY child document mentions (no real content).
    // This happens when a Notion page has no content except links to child pages.
    // In this case, we skip the inline children since Alpine adds a "## Child documents" section.
    if (isApiContentOnlyChildMentions(elements, childIds)) {
        elements = [];
    }

    // Build the final content
    const finalElements: Array<ApiContentBlockElement> = [];

    // Add parent link if exists
    if (parentId && documentIdToPath.has(parentId)) {
        finalElements.push({
            type: "Paragraph",
            elements: [
                {type: "Text", text: "Parent document: "},
                {type: "Mention", target: {type: "Document", id: parentId}},
            ],
        });
    }

    // Add the processed content
    finalElements.push(...elements);

    // Add children section if there are children
    if (childIds.size > 0) {
        finalElements.push({
            type: "Heading",
            level: 2,
            elements: [{type: "Text", text: "Child documents"}],
        });

        const childListItems: Array<{
            elements: Array<{type: "Paragraph"; elements: Array<ApiContentInlineElement>}>;
        }> = [];
        for (const childId of childIds) {
            if (documentIdToPath.has(childId)) {
                childListItems.push({
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Mention", target: {type: "Document", id: childId}}],
                        },
                    ],
                });
            }
        }
        if (childListItems.length > 0) {
            finalElements.push({
                type: "UnorderedList",
                items: childListItems,
            });
        }
    }

    return {title, content: {elements: finalElements}};
}

/** Extract plain text from an array of inline elements. */
function extractTextFromInlineElements(elements: ReadonlyArray<ApiContentInlineElement>): string {
    return elements
        .map(element => {
            if (element.type === "Text") return element.text;
            if (element.type === "Mention") return "";
            return "";
        })
        .join("");
}

/**
 * Check if API content contains ONLY child document mentions (no real content).
 *
 * This detects Notion pages that have no content except links to child pages.
 * When true, we skip adding the inline children content since Alpine will add
 * a structured "Child documents" section at the end anyway.
 */
function isApiContentOnlyChildMentions(
    elements: Array<ApiContentBlockElement>,
    childIds: Set<DocumentId>,
): boolean {
    if (childIds.size === 0) return false;
    if (elements.length === 0) return false;

    for (const element of elements) {
        // Skip dividers - they don't count as "real content"
        if (element.type === "Divider") continue;

        if (element.type === "Paragraph") {
            // Check if paragraph contains only child mentions (and whitespace)
            for (const inline of element.elements) {
                if (inline.type === "Text" && inline.text.trim() !== "") {
                    return false;
                }
                if (inline.type === "Mention") {
                    if (inline.target.type !== "Document" || !childIds.has(inline.target.id)) {
                        return false;
                    }
                }
            }
        } else if (element.type === "UnorderedList" || element.type === "OrderedList") {
            // Check if list contains only child mentions
            for (const item of element.items) {
                for (const blockElement of item.elements) {
                    if (blockElement.type === "Paragraph") {
                        for (const inline of blockElement.elements) {
                            if (inline.type === "Text" && inline.text.trim() !== "") {
                                return false;
                            }
                            if (inline.type === "Mention") {
                                if (
                                    inline.target.type !== "Document" ||
                                    !childIds.has(inline.target.id)
                                ) {
                                    return false;
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Any other block type (Heading, Code, Table, etc.) means there's real content
            return false;
        }
    }

    return true;
}

/**
 * Transform CSV links to table blocks.
 *
 * Paragraphs containing a link to a .csv file are replaced with a Table
 * block containing the parsed CSV data.
 */
function transformCsvLinksToTables(
    elements: Array<ApiContentBlockElement>,
    options: {
        currentDir: string;
        unzippedFiles: Record<string, Uint8Array>;
        inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
    },
): Array<ApiContentBlockElement> {
    const {currentDir, unzippedFiles, inlineDatabaseChildren} = options;
    const result: Array<ApiContentBlockElement> = [];

    for (const element of elements) {
        if (element.type === "Paragraph") {
            // Check if this paragraph contains a CSV link
            let csvTable: ApiContentBlockElement | null = null;

            for (const inlineElement of element.elements) {
                if (inlineElement.type === "Text" && inlineElement.marks) {
                    const linkMark = inlineElement.marks.find(m => m.type === "Link");
                    if (linkMark && "url" in linkMark) {
                        const url = linkMark.url;
                        if (url.endsWith(".csv")) {
                            const decodedPath = decodeURIComponent(url);
                            const normalizedPath = decodedPath.startsWith("./")
                                ? decodedPath.slice(2)
                                : decodedPath;
                            const resolvedPath =
                                resolveNotionImportRelativePath(currentDir, normalizedPath) ??
                                normalizedPath;

                            const csvKey = findNotionImportUnzippedFileKey(
                                unzippedFiles,
                                resolvedPath,
                            );
                            if (csvKey && unzippedFiles[csvKey]) {
                                const csvContent = strFromU8(unzippedFiles[csvKey]);
                                const childTitleToDocumentId =
                                    inlineDatabaseChildren.get(resolvedPath) ?? new Map();
                                const tableContent = notionImportCsvToApiContent(
                                    csvContent,
                                    childTitleToDocumentId,
                                );
                                if (tableContent) {
                                    csvTable = tableContent;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (csvTable) {
                result.push(csvTable);
            } else {
                result.push(element);
            }
        } else if (element.type === "Quote") {
            // Recursively handle quotes (spread to convert readonly to mutable)
            result.push({
                ...element,
                elements: transformCsvLinksToTables([...element.elements], options) as Array<{
                    type: "Paragraph";
                    elements: ReadonlyArray<ApiContentInlineElement>;
                }>,
            });
        } else {
            result.push(element);
        }
    }

    return result;
}

/**
 * Transform .md links to document mentions using the visitor pattern.
 *
 * This uses `visitAndProduceApiContent` to traverse the entire content tree
 * and replace Text elements with Link marks pointing to .md files with
 * Mention elements.
 */
function transformMdLinksToMentions(
    content: ApiContent,
    options: {
        pathToDocumentId: Map<string, DocumentId>;
        currentDir: string;
    },
): ApiContent {
    const {pathToDocumentId, currentDir} = options;

    return visitAndProduceApiContent(content, {
        visitInlineElement: (element, context) => {
            if (element.type !== "Text" || !element.marks || element.marks.length === 0) return;

            const linkMark = element.marks.find(m => m.type === "Link");
            if (!linkMark || !("url" in linkMark)) return;

            const url = linkMark.url;
            if (!url.endsWith(".md")) return;

            // Convert .md link to document mention
            const decodedPath = decodeURIComponent(url);
            const normalizedPath = decodedPath.startsWith("./")
                ? decodedPath.slice(2)
                : decodedPath;

            let documentId = pathToDocumentId.get(normalizedPath);

            if (!documentId) {
                const resolvedPath = resolveNotionImportRelativePath(currentDir, normalizedPath);
                if (resolvedPath) {
                    documentId = pathToDocumentId.get(resolvedPath);
                }
            }

            // Search by filename if not found by full path.
            // This handles cases where the link path includes a parent
            // folder that may not match the actual file structure (e.g.,
            // nested vs flat exports).
            if (!documentId) {
                const linkFilename = normalizedPath.includes("/")
                    ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1)
                    : normalizedPath;
                for (const [path, id] of pathToDocumentId) {
                    const filename = path.includes("/")
                        ? path.slice(path.lastIndexOf("/") + 1)
                        : path;
                    if (filename === linkFilename) {
                        documentId = id;
                        break;
                    }
                }
            }

            if (documentId) {
                // Replace the element in the parent array using context
                (context.elements as Array<ApiContentInlineElement>)[context.index] = {
                    type: "Mention",
                    target: {type: "Document", id: documentId},
                };
            }
        },
    });
}
