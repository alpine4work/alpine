import {strFromU8} from "fflate";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {attachFileToDocumentAsSystem} from "~/server/files/data/files_actions.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {buildSiteFileSpanData} from "~/server/importer/notion/internal/build_site_file_span_data.js";
import {createNotionImportCsvDatabaseDocument} from "~/server/importer/notion/internal/create_notion_import_csv_database_document.js";
import {createNotionImportTeamspaceRootDocument} from "~/server/importer/notion/internal/create_notion_import_teamspace_root_document.js";
import {generateDeterministicNotionIdSync} from "~/server/importer/notion/internal/generate_deterministic_notion_id.js";
import {notionImportCsvToApiContent} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {NotionImportMappedReferencesResult} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {
    decodeNotionImportRelativePathUrl,
    resolveNotionImportFileLinkPath,
} from "~/server/importer/notion/internal/resolve_notion_import_file_link_path.js";
import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentQuoteBlockElement,
    ApiContentTableBlockElementCellBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DocumentId, FileId, NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {NotionImportItem} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Given the result of unzipNotionImportAndMapReferences, convert the extracted
 * Notion data to Alpine entities. For now, this is just documents.
 *
 * This function will:
 *
 * - Loop through each teamspace
 * - Loop through each document in the teamspace
 * - Create an Alpine document for the document using a markdown parser
 *     - Use the correct accessPolicy based on the teamspace import option
 * - Update all references within this document to a link to the alpine document
 *     - use the format https://alpine.inc/doc/{documentId}
 * - Notion exported documents will have their children under the title, above the
 *   first divider (---)
 *     - Check if all children and only the children exist between the # title and
 *       the first divider (---)
 *     - If this is the case, we need to remove the children and the divider from
 *       the document content.
 * - Add a "Parent document: <parent mention>" under the title
 * - At the end of the document, add a "### Children documents:\n-
 *   <child link document>\n- <child link document>\n- ..."
 * - Update all references of the markdown files to the new Alpine fileIds.
 * - Update the status of the import item as we go
 * - TODO: Run teamspace uploaded in parrallel
 *     - https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/qytsx10ph8ba5z05gfdafya9r4
 */
export async function convertExtractedNotionDataToEntities(
    context: ImporterServiceSystemActionContext,
    notionImportId: NotionImportId,
    importItem: NotionImportItem,
    mappedReferencesResult: NotionImportMappedReferencesResult,
    progressState: NotionImporterProgressState,
): Promise<void> {
    await context.tracer.withSpan(
        "Convert notion import to entities",
        async (_tracerContext, span) => {
            const {spaceId, startedByAccountId, workspaceName} = importItem;
            const {
                notionWorkspaceId,
                teamspaces,
                filesToUpload,
                diskPathToUnzippedFiles,
                inlineDatabaseChildren,
                rootLevelCsvDatabases,
                csvDatabasesRequiringDocuments,
                pathToDocumentId,
                documentIdToPath,
            } = mappedReferencesResult;

            /**
             * Helper to read a file from the unzipped import.
             */
            async function readUnzippedFile(relativeFilePath: string): Promise<Uint8Array | null> {
                return await context.importerService.readUnzippedFile({
                    diskPathToUnzippedFiles,
                    relativeFilePath,
                });
            }

            // Generate teamspace root document IDs upfront so we can set parent links. Also
            // add them to documentIdToPath so child documents can resolve their parent title.
            // Use deterministic IDs based on space ID + workspace ID + teamspace ID for
            // consistency.
            const teamspaceRootDocumentIds = new Map<string, DocumentId>();
            for (const teamspace of teamspaces) {
                const rootDocumentId = generateDeterministicNotionIdSync<DocumentId>(
                    spaceId,
                    notionWorkspaceId,
                    `teamspace-root:${teamspace.id}`,
                );
                teamspaceRootDocumentIds.set(teamspace.id, rootDocumentId);
                // Use a synthetic path that follows the Notion file name pattern for title
                // extraction. Use teamspace.id for uniqueness since teamspace names aren't
                // guaranteed unique.
                const syntheticPath = `${teamspace.name} ${teamspace.id}.md`;
                documentIdToPath.set(rootDocumentId, syntheticPath);
            }

            // Create synthetic documents for CSV-only databases that need their own document.
            // This covers both root-level databases and databases under pages. Use
            // deterministic IDs based on space ID + workspace ID + CSV file's notion ID.
            const csvDatabaseDocuments = new Map<
                string,
                {
                    id: DocumentId;
                    teamspaceId: string;
                    childPaths: Array<string>;
                    parentPath: string | null;
                }
            >();

            for (const [csvPath, {childPaths, teamspaceId}] of rootLevelCsvDatabases) {
                const csvFileName = csvPath.split("/").pop() ?? "";
                const parsed = parseNotionImportFileName(csvFileName);
                const notionId = parsed?.notionId ?? csvPath; // Fallback to path if parsing fails
                const documentId = generateDeterministicNotionIdSync<DocumentId>(
                    spaceId,
                    notionWorkspaceId,
                    `csv-database:${notionId}`,
                );
                csvDatabaseDocuments.set(csvPath, {
                    id: documentId,
                    teamspaceId,
                    childPaths,
                    parentPath: null,
                });
                pathToDocumentId.set(csvPath, documentId);
                documentIdToPath.set(documentId, csvPath);
            }

            for (const [
                csvPath,
                {childPaths, teamspaceId, parentPath},
            ] of csvDatabasesRequiringDocuments) {
                const csvFileName = csvPath.split("/").pop() ?? "";
                const parsed = parseNotionImportFileName(csvFileName);
                const notionId = parsed?.notionId ?? csvPath;
                const documentId = generateDeterministicNotionIdSync<DocumentId>(
                    spaceId,
                    notionWorkspaceId,
                    `csv-database:${notionId}`,
                );
                csvDatabaseDocuments.set(csvPath, {
                    id: documentId,
                    teamspaceId,
                    childPaths,
                    parentPath,
                });
                pathToDocumentId.set(csvPath, documentId);
                documentIdToPath.set(documentId, csvPath);

                // Add this database to the parent page's children set so it appears in the
                // parent's "Child documents" section.
                for (const teamspace of teamspaces) {
                    const parentDoc = teamspace.documents[parentPath];
                    if (parentDoc) {
                        parentDoc.children.add(documentId);
                        break;
                    }
                }
            }

            let totalDocumentCount = 0;
            for (const ts of teamspaces) {
                totalDocumentCount += Object.keys(ts.documents).length;
            }
            span.addData({common: {count: totalDocumentCount}});

            // Process each teamspace
            for (const teamspace of teamspaces) {
                const isPublic = teamspace.importOption.type === "Public";
                const teamspaceRootDocumentId = teamspaceRootDocumentIds.get(teamspace.id)!;

                // Update parent references for children of root-level CSV databases in this
                // teamspace.
                for (const [csvPath, {id: csvDocumentId, childPaths}] of csvDatabaseDocuments) {
                    for (const childPath of childPaths) {
                        const childDocument = teamspace.documents[childPath];
                        if (childDocument) {
                            childDocument.parent = {
                                documentId: csvDocumentId,
                                relativeFilePath: csvPath,
                            };
                        }
                    }
                }

                // Update parent for first-layer documents (those with no parent). They should have
                // the teamspace root document as their parent. Note: relativeFilePath is empty
                // because the teamspace root is a synthetic document.
                for (const [, documentInfo] of Object.entries(teamspace.documents)) {
                    if (documentInfo.parent === null) {
                        documentInfo.parent = {
                            documentId: teamspaceRootDocumentId,
                            relativeFilePath: "",
                        };
                    }
                }

                async function createDocumentFromNotionDocument(
                    filePath: string,
                    documentInfo: (typeof teamspace.documents)[string],
                ) {
                    // Read the file content using the context module
                    const fileContent = assertExists(await readUnzippedFile(filePath));
                    const rawContent = strFromU8(fileContent);
                    // ============================================================ \
                    // Preprocess markdown for database properties \
                    // ============================================================ \
                    // Notion exports database row pages with property lines separated by single
                    // newlines (e.g., "Status: Done\nPriority: High"). In markdown, single newlines
                    // don't create paragraph breaks - they become spaces. We convert single newlines
                    // between property-like lines to double newlines so the markdown parser creates
                    // separate paragraphs, which we can then detect and format in API content.
                    const currentDir = filePath.includes("/")
                        ? filePath.slice(0, filePath.lastIndexOf("/"))
                        : "";
                    const preprocessedContent = preprocessNotionDatabaseProperties(
                        rawContent,
                        currentDir,
                        filesToUpload,
                    );

                    // ============================================================ \
                    // Parse markdown to API content \
                    // ============================================================ \
                    // Our markdown parser doesn't support inline images/videos/files directly. It only
                    // recognizes files via URLs matching our alpine.inc format. Notion exports use
                    // local relative paths (`![name](path.png)`) which the parser drops. Convert image
                    // syntax to link syntax so the URLs are preserved as Text elements with Link
                    // marks, allowing `convertParagraphToFileRowsIfNeeded` to resolve them as files.
                    const markdownWithImagesAsLinks = preprocessedContent.replaceAll("![", "[");
                    const rawApiContent = parseApiContentFromMarkdown(markdownWithImagesAsLinks);

                    // ============================================================ \
                    // Transform API content for Alpine's format \
                    // ============================================================
                    const {title, content: finalApiContent} =
                        await reformatNotionApiContentIntoOurDesiredFormat(context, rawApiContent, {
                            spaceId,
                            pathToDocumentId,
                            documentIdToPath,
                            parentId: documentInfo.parent?.documentId ?? null,
                            childIds: documentInfo.children,
                            hasChildrenHeader: documentInfo.hasChildrenHeader,
                            filePath,
                            diskPathToUnzippedFiles,
                            inlineDatabaseChildren,
                            filesToUpload,
                        });

                    // Convert API content to ProseMirror document
                    const bodyContent = fromApiContent(
                        DocumentContentProsemirrorSchema,
                        finalApiContent,
                    );

                    // Create access policy based on teamspace import option
                    const accessPolicy: AccessPolicy = {
                        // TODO(ifitzsimmons, #notion-import-site-integration): This might be a site access
                        // policy depending on the import options.
                        type: "Local",
                        accountGrantById: new Map([
                            [startedByAccountId, {level: "Manage", generation: 0}],
                        ]),
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

                    try {
                        // Create the document
                        await impersonateAccountAsSystemContext(
                            context,
                            startedByAccountId,
                            context =>
                                createDocument(context, {
                                    id: documentInfo.id,
                                    spaceId,
                                    creatorId: startedByAccountId,
                                    content: documentContent,
                                    createFeedEntry: false,
                                    skipAffinityPointAssignment: true,
                                    from: {type: "Importer", source: {type: "Notion"}},
                                }),
                        );
                    } catch (error) {
                        if (isDynamoConditionCheckError(error)) {
                            // DynamoDB throws a condition check error if the document already exists. Noop if
                            // the doc exists. Deterministic IDs mean re-importing the same Notion workspace
                            // produces the same document IDs.
                            return;
                        }

                        throw error;
                    }

                    // Attach files to the document so they can be accessed via the document. Files are
                    // uploaded separately, but they need attachment records to be viewable when the
                    // document is loaded. We extract file IDs from the final content because
                    // additional files may have been added during content transformation (e.g., from
                    // CSV tables).
                    const fileIdsInContent = extractFileIdsFromApiContent(finalApiContent);
                    await runAllPromises(
                        [...fileIdsInContent].map(fileId =>
                            attachFileToDocumentAsSystem(context, fileId, documentInfo.id),
                        ),
                    );

                    // Increment document counter via state manager (periodically persisted)
                    progressState.incrementDocumentCounter(teamspace.id);
                }

                async function createDocumentFromNotionDatabase(
                    csvPath: string,
                    csvDatabaseInfo: {
                        id: DocumentId;
                        teamspaceId: string;
                        childPaths: Array<string>;
                        parentPath: string | null;
                    },
                ) {
                    if (csvDatabaseInfo.teamspaceId !== teamspace.id) return;

                    // Create a document for this CSV database. Use the parent page's document ID when
                    // the database is under a page, otherwise use the teamspace root.
                    const csvParentId = csvDatabaseInfo.parentPath
                        ? (pathToDocumentId.get(csvDatabaseInfo.parentPath) ??
                          teamspaceRootDocumentId)
                        : teamspaceRootDocumentId;

                    try {
                        await createNotionImportCsvDatabaseDocument(context, {
                            spaceId,
                            creatorId: startedByAccountId,
                            documentId: csvDatabaseInfo.id,
                            parentId: csvParentId,
                            csvPath,
                            diskPathToUnzippedFiles,
                            isPublic,
                            inlineDatabaseChildren,
                            filesToUpload,
                        });
                    } catch (error) {
                        if (isDynamoConditionCheckError(error)) {
                            // DynamoDB throws a condition check error if the document already exists. Noop if
                            // the doc exists. Deterministic IDs mean re-importing the same Notion workspace
                            // produces the same document IDs.
                            return;
                        }

                        throw error;
                    }

                    // Increment document counter via state manager (periodically persisted)
                    progressState.incrementDocumentCounter(teamspace.id);
                }

                // Create documents in batches of 100 rather than all at once.
                //
                // Large teamspaces can have a ton of documents. Previously we fired all of them
                // concurrently via `runAllPromises`, which caused DynamoDB `GetItemBatcher`
                // timeouts (`DeadlineExceededError: DynamoDB request timed out`). Each document
                // creation does multiple DynamoDB reads (authorization, space access) and writes
                // (transaction with 2 items + file attachments). With thousands of concurrent
                // promises, the batched reads overwhelm DynamoDB's 2-second per-request timeout,
                // causing the entire import to fail without ever creating a single document.
                //
                // Batching to 100 keeps DynamoDB pressure manageable while still parallelizing
                // within each batch.
                const documentEntries: Array<() => Promise<void>> = [
                    ...Object.entries(teamspace.documents).map(
                        ([filePath, documentInfo]) =>
                            () =>
                                createDocumentFromNotionDocument(filePath, documentInfo),
                    ),
                    ...[...csvDatabaseDocuments.entries()].map(
                        ([csvPath, csvDatabaseInfo]) =>
                            () =>
                                createDocumentFromNotionDatabase(csvPath, csvDatabaseInfo),
                    ),
                ];

                const batchSize = 100;
                for (let i = 0; i < documentEntries.length; i += batchSize) {
                    const batch = documentEntries.slice(i, i + batchSize);
                    await runAllPromises(batch.map(fn => fn()));
                }

                // Create a teamspace root document with list of first-layer children
                try {
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
                                .filter(
                                    ([, info]) =>
                                        info.teamspaceId === teamspace.id &&
                                        info.parentPath === null,
                                )
                                .map(([csvPath, info]) => [csvPath, info.id]),
                        ),
                    });
                } catch (error) {
                    if (isDynamoConditionCheckError(error)) {
                        // DynamoDB throws a condition check error if the document already exists. Noop if
                        // the doc exists. Deterministic IDs mean re-importing the same Notion workspace
                        // produces the same document IDs.

                        // no op
                    } else {
                        throw error;
                    }
                }

                // Increment document counter for teamspace root
                progressState.incrementDocumentCounter(teamspace.id);

                // Emit per-teamspace conversion span with final site metrics.
                const counters = progressState.teamspaceCounters.get(teamspace.id);
                const expectedStats = progressState.initialResult.teamspaces.get(teamspace.id);
                if (counters && expectedStats) {
                    context.tracer.withSpanSync(
                        "Convert notion import site",
                        (_tracerContext, span) => {
                            span.addData({
                                importer: {
                                    site: {notionId: teamspace.id},
                                    created: {documents: counters.documents},
                                    uploaded: buildSiteFileSpanData(expectedStats.files),
                                },
                            });
                        },
                    );
                }
            }
        },
    );
}

// ============================================================================
// MARKDOWN PREPROCESSING
// ============================================================================ We
// do minimal preprocessing on raw markdown before parsing. The goal is to handle
// Notion export quirks that are difficult to detect in parsed content.
// ============================================================================

/**
 * Preprocess database property lines by adding paragraph breaks between them.
 *
 * ## Why this is necessary
 *
 * Notion exports database row pages with property lines at the top, formatted as
 * `Property Name: value` on separate lines with single newlines:
 *
 * ```
 * Status: Done
 * Priority: High
 * Due Date: 2025-01-15
 *
 * Task description here.
 * ```
 *
 * In markdown, single newlines don't create paragraph breaks - they become spaces
 * when parsed. So the above becomes a single paragraph: "Status: Done Priority:
 * High Due Date: 2025-01-15"
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
 * @param markdown - Raw markdown content from Notion export @returns Markdown with
 * double newlines between property lines
 */
function preprocessNotionDatabaseProperties(
    markdown: string,
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): string {
    const lines = markdown.split("\n");

    // Pattern to match property lines: "Property Name: value"
    //
    // - One or more words (any non-whitespace, non-colon chars) as the key
    // - Followed by colon
    // - Followed by the value
    const propertyLinePattern = /^[^\s:]+(?:\s[^\s:]+)*:\s*.+$/;

    // Pattern to capture the property name and value from a property line. Used to
    // check any property's value for file paths.
    const propertyPartsPattern = /^([^\s:]+(?:\s[^\s:]+)*):\s*(.+)$/;

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

    // Add extra newlines between property lines and convert file paths
    const result: Array<string> = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]!;

        // Check all property lines for file paths and convert them to markdown image
        // syntax. Each file is placed on its own line so it becomes a separate paragraph,
        // which can then be converted to a FileRow element.
        if (i >= propertyStartIndex && i <= propertyEndIndex) {
            const trimmed = line.trim();
            const propertyMatch = propertyPartsPattern.exec(trimmed);
            if (propertyMatch) {
                const propertyName = propertyMatch[1]!;
                const valueStr = propertyMatch[2]!;
                const linkLines = convertFilePathsToMarkdownLinkLines(
                    valueStr,
                    currentDir,
                    filesToUpload,
                );
                if (linkLines.length > 0) {
                    line = `${propertyName}:\n\n${linkLines.join("\n\n")}`;
                }
            }
        }

        result.push(line);

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

/**
 * Convert file paths in a property value to markdown link lines. Uses link syntax
 * (not image syntax) because our markdown parser doesn't support inline
 * images/videos/files directly, it only recognizes files via URLs matching our
 * alpine.inc format.
 *
 * Input: `../IMG_7190%201.jpg, ../video.mp4` Output:
 * [`[IMG_7190 1.jpg](../IMG_7190%201.jpg)`, `[video.mp4](../video.mp4)`]
 *
 * Each file path is converted to its own markdown link line, so they become
 * separate paragraphs that can be converted to FileRow elements. Only paths that
 * resolve to actual files in `filesToUpload` are converted. Returns an empty array
 * if no parts resolve to files.
 */
function convertFilePathsToMarkdownLinkLines(
    pathsStr: string,
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): Array<string> {
    // Split by comma (files can be comma-separated)
    const parts = pathsStr.split(",").map(p => p.trim());

    return parts
        .map(part => {
            // Only convert if this path resolves to an actual file
            if (!resolveFileLinkPath(part, currentDir, filesToUpload)) {
                return null;
            }

            // Extract filename from path
            const fileName = decodeNotionImportRelativePathUrl(part.split("/").pop() ?? part);

            // Convert to markdown link syntax: [filename](path)
            return `[${fileName}](${part})`;
        })
        .filter((line): line is string => line !== null);
}

// ============================================================================ API
// CONTENT TRANSFORMATION
// ============================================================================

/**
 * Remove the child links section from API content.
 *
 * Notion exports child page links after the title heading, followed by a
 * horizontal rule (Divider). This function removes all elements up to and
 * including the first Divider.
 *
 * @param elements - Block elements to process @returns Elements with child links
 * section removed
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
 * After preprocessing, database property lines appear as consecutive Paragraph
 * elements, each containing a single "Key: Value" text. We detect this pattern and
 * convert to: Divider, UnorderedList, Divider.
 *
 * @param elements - Block elements to process @returns Elements with formatted
 * properties
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

// ============================================================================ API
// CONTENT TRANSFORMATION
// ============================================================================
// These functions operate on parsed API content to transform it into Alpine's
// desired format. They handle structural changes like extracting titles, promoting
// headings, and converting links to mentions.
// ============================================================================

/**
 * Transform parsed API content from a Notion export into Alpine's format.
 *
 * This function handles transformations that work well on parsed API content:
 *
 * 1. **Extract title** - Find the first H1 heading, use its text as the document
 *    title, and remove it from the content.
 *
 * 2. **Promote headings** - Since we extracted H1 as the title, demote all other
 *    headings by one level (H2 → H1, H3 → H2, etc.) to maintain proper document
 *    hierarchy.
 *
 * 3. **Convert document links** - Replace links to `.md` files with Alpine
 *    document mentions that reference the imported documents.
 *
 * 4. **Convert database links** - Replace links to `.csv` files with actual table
 *    blocks containing the parsed CSV data.
 *
 * 5. **Add navigation** - Add "Parent document" mention at the top and "Child
 *    documents" section at the bottom for document hierarchy.
 *
 * @see README.md "Header Level Promotion" section for heading level changes. @see
 * README.md "Empty Parent Documents" section for child-mentions-only handling.
 * @see README.md "Inline vs Full-Page Databases" section for CSV link conversion.
 *
 * @param apiContent - Parsed API content from markdown @param options -
 * Configuration including document mappings and files @returns Object with
 * extracted title and transformed content
 */
async function reformatNotionApiContentIntoOurDesiredFormat(
    context: {importerService: ImporterServiceContextModuleBase},
    apiContent: ApiContent,
    options: {
        spaceId: SpaceId;
        pathToDocumentId: Map<string, DocumentId>;
        documentIdToPath: Map<DocumentId, string>;
        parentId: DocumentId | null;
        childIds: Set<DocumentId>;
        hasChildrenHeader: boolean;
        filePath: string;
        diskPathToUnzippedFiles: string;
        inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
        filesToUpload: NotionImportMappedReferencesResult["filesToUpload"];
    },
): Promise<{title: string; content: ApiContent}> {
    const {
        pathToDocumentId,
        documentIdToPath,
        parentId,
        childIds,
        hasChildrenHeader,
        filePath,
        diskPathToUnzippedFiles,
        inlineDatabaseChildren,
        filesToUpload,
    } = options;

    let elements: Array<ApiContentBlockElement> = [...apiContent.elements];

    // ----------------------------------------------------------------
    // Extract title from first H1 heading
    // ---
    //
    // ---
    //
    // Notion exports the page title as a `# Title` heading. We extract this to use as
    // the document's title field and remove it from the body content.
    //
    // ---
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
    // ---
    //
    // ---
    //
    // Notion exports child page links after the title, followed by a horizontal rule
    // (---). We remove this section since we add our own "Child documents" section at
    // the end.
    //
    // ---
    if (hasChildrenHeader) {
        elements = removeChildLinksSectionFromApiContent(elements);
    }

    // ----------------------------------------------------------------
    // Format database properties
    // ---
    //
    // ---
    //
    // Notion exports database row pages with property lines at the top. These appear
    // as a paragraph with "Key: Value" text separated by Break elements. We convert
    // these to a bulleted list with dividers.
    //
    // ---
    elements = formatDatabasePropertiesInApiContent(elements);

    // ----------------------------------------------------------------
    // Promote all headings by one level
    // ---
    //
    // ---
    //
    // Since we extracted the H1 as the title, we need to promote all remaining
    // headings: H2 → H1, H3 → H2, etc. This maintains proper document hierarchy.
    //
    // ---
    elements = elements.map(element => {
        if (element.type === "Heading" && element.level > 1) {
            return {...element, level: element.level - 1};
        }
        return element;
    });

    // Get the directory of the current document for resolving relative paths
    const currentDir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";

    // Transform .csv links to tables (must happen before link transformation). The
    // result may contain File elements within table cells. These are handled correctly
    // by fromApiContent at the end.
    const csvTransformedElements = await transformCsvLinksToTables(context, elements, {
        currentDir,
        diskPathToUnzippedFiles,
        inlineDatabaseChildren,
        filesToUpload,
    });
    elements = csvTransformedElements;

    // Transform .md links to document mentions using visitor pattern
    const transformedContent = transformMdLinksToMentions(
        {elements},
        {pathToDocumentId, currentDir},
    );
    elements = [...transformedContent.elements];

    // Check if the content is ONLY child document mentions (no real content). This
    // happens when a Notion page has no content except links to child pages. In this
    // case, we skip the inline children since Alpine adds a "## Child documents"
    // section.
    if (isApiContentOnlyChildMentions(elements, childIds)) {
        elements = [];
    }

    // ----------------------------------------------------------------
    // Transform file links to File/FileGallery elements
    // ---
    //
    // ---
    //
    // Convert links to uploaded files (images, attachments) into File or FileGallery
    // elements. Adjacent file references are combined into FileGallery rows (max 3
    // files per row).
    //
    // ---
    const extendedElements = transformFileLinksToFileElementsIfPossible(elements, {
        currentDir,
        filesToUpload,
    });

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
    finalElements.push(...extendedElements);

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
 * This detects Notion pages that have no content except links to child pages. When
 * true, we skip adding the inline children content since Alpine will add a
 * structured "Child documents" section at the end anyway.
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

// Maximum number of files per FileGallery row
const maxFilesPerRow = 3;

/**
 * Check if a link URL points to a file that should be uploaded. Returns the file
 * path relative to the export root, or null if not a file link.
 */
function resolveFileLinkPath(
    url: string,
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): string | null {
    return resolveNotionImportFileLinkPath(url, currentDir, {
        has: (path: string) => path in filesToUpload,
    });
}

/**
 * Extract file paths from a paragraph element. Returns an array of file paths if
 * the paragraph contains only file links, or null if it contains other content.
 */
function convertParagraphToFileRowsIfNeeded(
    element: ApiContentBlockElement,
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): Array<{path: string; fileId: FileId}> | null {
    if (element.type !== "Paragraph") {
        return null;
    }

    const files: Array<{path: string; fileId: FileId}> = [];

    for (const inline of element.elements) {
        // Paragraphs that contain other content types cannot contain fileRows
        if (inline.type !== "Text" && inline.type !== "Break") return null;

        // Breaks are OK between files, ditto for whitespace-only text
        if (inline.type === "Break" || inline.text.trim() === "") continue;

        // Paragraphs with plain text do not support fileRows (e.g. "Attachment:
        // [alt](path)" will not get parsed into a fileRow). Return early
        if (!inline.marks || inline.marks.length === 0) return null;

        const linkMark = inline.marks.find(mark => mark.type === "Link");
        // if text element doesn't contain link, treat this the same as a the plain text
        // condition above. Return early
        if (!linkMark) return null;

        const filePath = resolveFileLinkPath(linkMark.url, currentDir, filesToUpload);
        // If the link is not to a media file, this paragraph does not support fileRows
        if (!filePath) return null;

        const fileEntry = filesToUpload[filePath];
        // If the link is to a file that is not included in this notion import, return
        // early.
        if (!fileEntry) return null;

        files.push({path: filePath, fileId: fileEntry.id});
    }

    return files.length > 0 ? files : null;
}

/**
 * Extract file-link paragraphs from inside a container block element (lists,
 * blockquotes) and hoist them out as top-level file elements.
 *
 * Our content schema doesn't support file nodes inside list items or blockquotes,
 * so the only option is to pull them out to the top level. When all paragraphs in
 * a container are file-only the container is dropped entirely (remainingElement is
 * null) and only the file elements are emitted.
 *
 * Notion does NOT support files in lists today, but does support them in
 * blockquotes. We handle this here in case they ever do suppport it.
 *
 * Tables are handled separately by {@link transformTableFileLinksToFileRowTables}
 * because our schema DOES support files in table cells via `File` elements.
 */
function extractFilesFromContainerElement(
    element: ApiContentBlockElement & {
        type: "UnorderedList" | "OrderedList" | "CheckList" | "Quote";
    },
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): {
    files: Array<{path: string; fileId: FileId}>;
    remainingElement: ApiContentBlockElement | null;
} {
    const allFiles: Array<{path: string; fileId: FileId}> = [];

    // Splits a list of paragraphs into file-only paragraphs (whose file references are
    // collected into `allFiles`) and everything else (returned as the kept array).
    const partitionParagraphs = <T extends ApiContentBlockElement>(
        paragraphs: ReadonlyArray<T>,
    ): Array<T> => {
        const kept: Array<T> = [];

        for (const paragraph of paragraphs) {
            const files = convertParagraphToFileRowsIfNeeded(paragraph, currentDir, filesToUpload);
            if (files) {
                allFiles.push(...files);
            } else {
                kept.push(paragraph);
            }
        }

        return kept;
    };

    switch (element.type) {
        case "UnorderedList":
        case "OrderedList": {
            const remainingItems = element.items
                .map(item => ({...item, elements: partitionParagraphs(item.elements)}))
                .filter(item => item.elements.length > 0);

            if (allFiles.length === 0) {
                return {files: [], remainingElement: element};
            }

            return {
                files: allFiles,
                remainingElement:
                    remainingItems.length > 0 ? {...element, items: remainingItems} : null,
            };
        }
        case "CheckList": {
            const remainingItems = element.items
                .map(item => ({...item, elements: partitionParagraphs(item.elements)}))
                .filter(item => item.elements.length > 0);

            if (allFiles.length === 0) {
                return {files: [], remainingElement: element};
            }

            return {
                files: allFiles,
                remainingElement:
                    remainingItems.length > 0 ? {...element, items: remainingItems} : null,
            };
        }
        case "Quote": {
            const remainingElements = partitionParagraphs(element.elements);

            if (allFiles.length === 0) {
                return {files: [], remainingElement: element};
            }

            return {
                files: allFiles,
                remainingElement:
                    remainingElements.length > 0 ? {...element, elements: remainingElements} : null,
            };
        }
        default:
            throw exhaustive(element);
    }
}

/**
 * Convert file-link paragraphs inside table cells to File elements in-place.
 *
 * Unlike lists and blockquotes, our content schema supports files inside table
 * cells via File elements. So instead of hoisting files out, we replace file-only
 * paragraphs with File elements within the cell.
 *
 * NOTE: Notion doesn't currently export files inside markdown tables, but they
 * might someday. Since table cells can contain paragraphs with file links, we
 * handle it now so it works automatically if Notion adds this.
 */
function transformTableFileLinksToFileRowTables(
    element: ApiContentBlockElement & {type: "Table"},
    currentDir: string,
    filesToUpload: NotionImportMappedReferencesResult["filesToUpload"],
): ApiContentBlockElement {
    let changed = false;

    const rows = element.rows.map(row => ({
        ...row,
        cells: row.cells.map(cell => {
            const newElements: Array<ApiContentTableBlockElementCellBlockElement> = [];

            for (const cellElement of cell.elements) {
                const files = convertParagraphToFileRowsIfNeeded(
                    cellElement,
                    currentDir,
                    filesToUpload,
                );
                if (files) {
                    changed = true;
                    for (const file of files) {
                        newElements.push({type: "File", id: file.fileId});
                    }
                } else {
                    newElements.push(cellElement);
                }
            }

            return {...cell, elements: newElements};
        }),
    }));

    if (!changed) {
        return element;
    }

    return {...element, rows};
}

/**
 * Transform file links to File and FileGallery elements.
 *
 * Paragraphs containing links to uploaded files (images, PDFs, etc.) are replaced
 * with File or FileGallery elements. Adjacent file references are combined into
 * FileGallery rows (max 3 files per row), or single File elements.
 *
 * @param elements - Block elements to process @param options - Configuration
 * including file mappings @returns Elements with file blocks
 */
function transformFileLinksToFileElementsIfPossible(
    elements: Array<ApiContentBlockElement>,
    options: {
        currentDir: string;
        filesToUpload: NotionImportMappedReferencesResult["filesToUpload"];
    },
): Array<ApiContentBlockElement> {
    const {currentDir, filesToUpload} = options;
    const result: Array<ApiContentBlockElement> = [];

    // Collect pending files to combine into rows
    let pendingFiles: Array<{fileId: FileId}> = [];

    // Flush pending files as FileGallery rows (max 3 files per row) or single File
    // elements
    const flushPendingFiles = (): void => {
        while (pendingFiles.length > 0) {
            const batch = pendingFiles.slice(0, maxFilesPerRow);
            pendingFiles = pendingFiles.slice(maxFilesPerRow);
            if (batch.length === 1) {
                result.push({
                    type: "File",
                    id: assertExists(batch[0]).fileId,
                });
            } else {
                result.push({
                    type: "FileGallery",
                    rows: [
                        {
                            items: batch.map(file => ({
                                element: {
                                    type: "File" as const,
                                    id: file.fileId,
                                },
                            })),
                        },
                    ],
                });
            }
        }
    };

    for (const element of elements) {
        switch (element.type) {
            case "Paragraph": {
                const files = convertParagraphToFileRowsIfNeeded(
                    element,
                    currentDir,
                    filesToUpload,
                );

                if (files) {
                    for (const file of files) {
                        pendingFiles.push({fileId: file.fileId});
                    }
                } else {
                    flushPendingFiles();
                    result.push(element);
                }

                break;
            }

            case "UnorderedList":
            case "OrderedList":
            case "CheckList":
            case "Quote": {
                const extracted = extractFilesFromContainerElement(
                    element,
                    currentDir,
                    filesToUpload,
                );
                if (extracted.files.length > 0) {
                    flushPendingFiles();
                    if (extracted.remainingElement) {
                        result.push(extracted.remainingElement);
                    }
                    for (const file of extracted.files) {
                        pendingFiles.push({fileId: file.fileId});
                    }
                } else {
                    flushPendingFiles();
                    result.push(element);
                }
                break;
            }

            case "Table": {
                flushPendingFiles();
                result.push(
                    transformTableFileLinksToFileRowTables(element, currentDir, filesToUpload),
                );
                break;
            }

            // These elements won't hold file text links so we can flush pending files and add
            // the element
            case "Heading":
            case "Divider":
            case "Code":
            case "File":
            case "Preview":
            case "FileGallery":
            case "FileFloat": {
                flushPendingFiles();
                result.push(element);
                break;
            }
            default:
                throw exhaustive(element);
        }
    }

    // Flush any remaining pending files
    flushPendingFiles();

    return result;
}

/**
 * Transform CSV links to table blocks.
 *
 * Paragraphs containing a link to a .csv file are replaced with a Table block
 * containing the parsed CSV data.
 */
async function transformCsvLinksToTables(
    context: {importerService: ImporterServiceContextModuleBase},
    elements: Array<ApiContentBlockElement>,
    options: {
        currentDir: string;
        diskPathToUnzippedFiles: string;
        inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
        filesToUpload: NotionImportMappedReferencesResult["filesToUpload"];
    },
): Promise<Array<ApiContentBlockElement>> {
    const {currentDir, diskPathToUnzippedFiles, inlineDatabaseChildren, filesToUpload} = options;
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
                            const decodedUrl = decodeNotionImportRelativePathUrl(url);
                            const normalizedPath = decodedUrl.startsWith("./")
                                ? decodedUrl.slice(2)
                                : decodedUrl;
                            const resolvedPath =
                                resolveNotionImportRelativePath(currentDir, normalizedPath) ??
                                normalizedPath;

                            // Notion sometimes omits inline database CSVs from an export while still writing
                            // the markdown link (e.g. `[Tasks](Tasks%20abc123.csv)`). The filenames follow the
                            // standard `Title notionId.csv` pattern, so missing CSVs are indistinguishable
                            // from real ones until we try to read them.
                            //
                            // The reference mapping phase filters links against files on disk, but this
                            // function re-discovers CSV links from parsed API content independently. When the
                            // file is missing we skip the table conversion and leave the link as a regular
                            // paragraph. See `server/importer/notion/README.md` ("Missing Inline Database
                            // CSVs") for the full investigation.
                            const csvData = await context.importerService.readUnzippedFile({
                                diskPathToUnzippedFiles,
                                relativeFilePath: resolvedPath,
                            });

                            if (!csvData) {
                                break;
                            }

                            const csvContent = strFromU8(csvData);
                            const childTitleToDocumentId =
                                inlineDatabaseChildren.get(resolvedPath) ?? new Map();

                            // Get the directory of the CSV file for resolving relative paths
                            const csvDir = resolvedPath.includes("/")
                                ? resolvedPath.slice(0, resolvedPath.lastIndexOf("/"))
                                : "";

                            const tableContent = notionImportCsvToApiContent(
                                csvContent,
                                childTitleToDocumentId,
                                {filesToUpload, csvDir},
                            );

                            if (tableContent) {
                                csvTable = tableContent;
                                break;
                            }
                        }
                    }
                }
            }

            if (csvTable) {
                // Add the table to the result
                result.push(csvTable);
            } else {
                result.push(element);
            }
        } else if (element.type === "Quote") {
            // Recursively handle quotes (spread to convert readonly to mutable)
            result.push({
                ...element,
                elements: (await transformCsvLinksToTables(
                    context,
                    [...element.elements],
                    options,
                )) as ApiContentQuoteBlockElement["elements"],
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
 * This uses `visitAndProduceApiContent` to traverse the entire content tree and
 * replace Text elements with Link marks pointing to .md files with Mention
 * elements.
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
            const decodedUrl = decodeNotionImportRelativePathUrl(url);
            const normalizedPath = decodedUrl.startsWith("./") ? decodedUrl.slice(2) : decodedUrl;

            let documentId = pathToDocumentId.get(normalizedPath);

            if (!documentId) {
                const resolvedPath = resolveNotionImportRelativePath(currentDir, normalizedPath);
                if (resolvedPath) {
                    documentId = pathToDocumentId.get(resolvedPath);
                }
            }

            // Search by filename if not found by full path. This handles cases where the link
            // path includes a parent folder that may not match the actual file structure
            // (e.g., nested vs flat exports).
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
                context.elements[context.index] = {
                    type: "Mention",
                    target: {type: "Document", id: documentId},
                };
            }
        },
    });
}
