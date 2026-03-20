import {strFromU8} from "fflate";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {downloadExternalNotionImportImages} from "~/server/importer/notion/internal/download_external_notion_import_images.js";
import {
    findFilePathsInCsv,
    findFilePathsInDatabaseProperties,
} from "~/server/importer/notion/internal/find_notion_import_file_paths.js";
import {
    generateDeterministicNotionFileIdSync,
    generateDeterministicNotionIdSync,
} from "~/server/importer/notion/internal/generate_deterministic_notion_id.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {parseNotionImportHierarchyFromIndexHtml} from "~/server/importer/notion/internal/parse_notion_import_hierarchy_from_index_html.js";
import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {NotionImportItem} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Import option for teamspaces that are actually being imported (excludes
 * DoNotImport).
 */
export type NotionImportTeamspaceOption = {type: "Public"} | {type: "Private"};

export type NotionImportMappedReferencesResult = {
    /**
     * The Notion workspace ID from the export (for deterministic ID generation).
     */
    notionWorkspaceId: string;
    /** Documents grouped by teamspace. */
    teamspaces: Array<{
        id: string;
        name: string;
        // If the user selects "DoNotImport", we don't track it any further in the process
        importOption: NotionImportTeamspaceOption;
        documents: {
            [filePath: string]: {
                /** The document ID we will assign to this document. */
                id: DocumentId;
                /** References to other documents within the content. */
                references: Map<string, DocumentId>;
                /** Attached files within this document. */
                files: Set<FileId>;
                /** Parent document, if any. */
                parent: {documentId: DocumentId; relativeFilePath: string} | null;
                /** Child documents. */
                children: Set<DocumentId>;
                /**
                 * Whether this document has a Notion-generated children header. This is the
                 * section between the title and the first `---` divider that contains only links
                 * to child documents. When true, this section should be removed during conversion.
                 */
                hasChildrenHeader: boolean;
            };
        };
    }>;
    /**
     * All files that need to be uploaded.
     */
    filesToUpload: {
        /**
         * Given a path to a file within the zip, store all relevant metadata needed to
         * create that file and map references to it in Alpine.
         */
        [relativeFilePath: string]: {
            id: FileId;
        };
    };
    /**
     * The path to the unzipped files on disk.
     */
    diskPathToUnzippedFiles: string;
    /**
     * Children of inline databases, keyed by CSV path.
     *
     * Maps CSV path → (child document title → DocumentId).
     *
     * This exists separately from `pathToDocumentId` because cell linking requires
     * looking up documents by **title** (the cell text), not by file path. When
     * converting a CSV to a table, we check if each cell's text matches a child
     * document's title and convert it to a mention link.
     *
     * Without this, we'd need to iterate all paths, parse filenames to extract titles,
     * and check parent-child relationships for every cell lookup.
     *
     * @see README.md "Database Children and Cell Linking" for the full context.
     */
    inlineDatabaseChildren: Map<string, Map<string, DocumentId>>;
    /**
     * CSV-only databases at the teamspace root level that need synthetic documents
     * created.
     *
     * Maps CSV path → {childPaths, teamspaceId}.
     *
     * This exists because CSV-only databases don't have `.md` wrapper files, so
     * there's no entry in `pathToDocumentId` for the database itself. We need to track
     * them separately so we can:
     *
     * 1. Create synthetic Alpine documents for them (with the CSV as a table)
     * 2. Set up parent links from the child documents to the synthetic document
     * 3. Include them in the teamspace root's "Child documents" section
     *
     * @see README.md "Teamspace Root Documents" and "Root-Level CSV Databases".
     */
    rootLevelCsvDatabases: Map<string, {childPaths: Array<string>; teamspaceId: string}>;
    /**
     * CSV-only databases under pages that need synthetic documents. Registered
     * optimistically by `parseNotionImportHierarchyFromIndexHtml` — inline databases
     * are removed from this map once `inlineReferencedCsvs` is built (see the filter
     * step below the body-content scanning loop).
     *
     * Maps CSV path → {childPaths, teamspaceId, parentPath}.
     */
    csvDatabasesRequiringDocuments: Map<
        string,
        {childPaths: Array<string>; teamspaceId: string; parentPath: string}
    >;
    /** Map from file path to document ID for quick lookups. */
    pathToDocumentId: Map<string, DocumentId>;
    /** Map from document ID to file path for reverse lookups. */
    documentIdToPath: Map<DocumentId, string>;
    /**
     * Maps file paths to their teamspace ID. Derived from which teamspace's documents
     * reference the file. Files not referenced by any document will not have an entry.
     */
    filePathToTeamspaceId: Map<string, string>;
};

// Matches markdown links: [text](url) and ![text](url)
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Parses a Notion export and maps references between the files.
 *
 * This function reads files on-demand from disk to avoid loading the entire export
 * into memory. Only index.html and individual markdown files are read as needed.
 *
 * @param context - Context containing the importer module @param
 * diskPathToUnzippedFiles - Path to the unzipped files (or lookup key in dev/test)
 * @param notionImportItem - The import item containing space ID and options
 * @returns The parsed result, or null if the export is invalid
 */
export async function parseNotionImportAndMapReferences(
    context: {importerService: ImporterServiceContextModuleBase},
    diskPathToUnzippedFiles: string,
    notionImportItem: NotionImportItem,
): Promise<NotionImportMappedReferencesResult | null> {
    // List all files using the context module
    const filePaths = await context.importerService.listUnzippedFiles({diskPathToUnzippedFiles});

    // Build set of all paths (excluding index.html and \_all.csv files) and map notion
    // IDs to paths - no content reading needed here
    const allPaths = new Set<string>();
    const notionIdToPath = new Map<string, string>();

    for (const path of filePaths) {
        if (isIndexHtml(path)) continue;
        // Skip "\_all.csv" files (Notion exports multiple views, we only need the default)
        if (path.endsWith("_all.csv")) continue;

        allPaths.add(path);

        const fileName = path.split("/").pop()!;
        const parsed = parseNotionImportFileName(fileName);
        if (parsed) {
            const notionId = parsed.notionId;
            const existing = notionIdToPath.get(notionId);
            if (!existing || path.endsWith(".md")) {
                notionIdToPath.set(notionId, path);
            }
        }
    }

    // Find and read index.html - it's the only file we need upfront
    const indexHtmlPath = assertExists(
        filePaths.find(path => path === "index.html" || path.endsWith("/index.html")),
    );

    const indexHtmlContent = assertExists(
        await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: indexHtmlPath,
        }),
    );

    // Get workspace metadata from index.html
    const metadata = getNotionImportMetadata(indexHtmlContent);
    if (!metadata) {
        return null;
    }

    // Parse index.html to determine parent-child hierarchy
    const hierarchy = parseNotionImportHierarchyFromIndexHtml(
        indexHtmlContent,
        notionIdToPath,
        metadata.workspaceId,
    );

    // Build teamspace option lookup map
    const teamspaceOptionById = new Map<
        string,
        {type: "Public"} | {type: "Private"} | {type: "DoNotImport"}
    >();
    if (notionImportItem.teamspaceImportOptions) {
        for (const entry of notionImportItem.teamspaceImportOptions) {
            teamspaceOptionById.set(entry.teamspaceId, entry.option);
        }
    }

    // Classify files and assign IDs
    const pathToDocumentId = new Map<string, DocumentId>();
    const documentIdToPath = new Map<DocumentId, string>();
    const pathToFileId = new Map<string, FileId>();
    const documents: Record<
        string,
        {
            id: DocumentId;
            references: Map<string, DocumentId>;
            files: Set<FileId>;
            parent: {documentId: DocumentId; relativeFilePath: string} | null;
            children: Set<DocumentId>;
            hasChildrenHeader: boolean;
        }
    > = {};
    const filesToUpload: NotionImportMappedReferencesResult["filesToUpload"] = {};
    const inlineReferencedCsvs = new Set<string>();

    for (const path of allPaths) {
        const fileName = path.split("/").pop()!;
        const parsed = parseNotionImportFileName(fileName);

        if (parsed) {
            // CSV files are data files, not documents. They may be embedded inline as tables.
            // Only .md files become documents.
            if (path.endsWith(".csv")) continue;

            // Skip documents in DoNotImport teamspaces early rather than adding and deleting
            // later. This is cleaner and avoids setting up relationships that would just be
            // torn down.
            const teamspaceId = hierarchy.teamspaceForPath.get(path);
            if (teamspaceId && teamspaceOptionById.get(teamspaceId)?.type === "DoNotImport") {
                continue;
            }

            // Generate deterministic document ID based on space ID, workspace ID, and notion
            // ID. This ensures re-importing the same workspace into the same space produces
            // the same document IDs, while different spaces get unique IDs.
            const documentId = generateDeterministicNotionIdSync<DocumentId>(
                notionImportItem.spaceId,
                metadata.workspaceId,
                parsed.notionId,
            );

            pathToDocumentId.set(path, documentId);
            documentIdToPath.set(documentId, path);
            documents[path] = {
                id: documentId,
                references: new Map(),
                files: new Set(),
                parent: null,
                children: new Set(),
                hasChildrenHeader: false,
            };
        } else {
            // Generate deterministic file ID based on the file path. Using "file:" prefix to
            // differentiate from document IDs. Uses the chronological variant so the ID embeds
            // the current timestamp, which is required by startUploadingFile.
            const id = generateDeterministicNotionFileIdSync(
                notionImportItem.spaceId,
                metadata.workspaceId,
                `file:${path}`,
                notionImportItem.createdTime.getTime(),
            );
            pathToFileId.set(path, id);
            filesToUpload[path] = {id};
        }
    }

    // Download external images referenced in markdown files. Notion sometimes exports
    // images as external URLs (e.g. `[Image](https://...)`). We download these and
    // save them to disk so they can be uploaded and referenced like any other file in
    // the import.
    const markdownDocumentPaths = Object.keys(documents);
    const downloadedExternalImages = await downloadExternalNotionImportImages(
        context,
        diskPathToUnzippedFiles,
        markdownDocumentPaths,
        notionImportItem.spaceId,
        metadata.workspaceId,
        notionImportItem.createdTime.getTime(),
    );

    for (const [relativePath, downloadedFile] of downloadedExternalImages) {
        allPaths.add(relativePath);
        pathToFileId.set(relativePath, downloadedFile.id);
        filesToUpload[relativePath] = {id: downloadedFile.id};
    }

    // Apply parent-only relationships (for children of inline databases). These set
    // the parent reference but don't add to the parent's children list, so they won't
    // appear in the "Child documents" section.
    for (const {parentPath, childPath} of hierarchy.relationships) {
        const parentDocumentId = pathToDocumentId.get(parentPath);
        const childDocumentId = pathToDocumentId.get(childPath);
        if (parentDocumentId && childDocumentId && documents[childPath] && documents[parentPath]) {
            documents[childPath].parent = {
                documentId: parentDocumentId,
                relativeFilePath: parentPath,
            };
            documents[parentPath].children.add(childDocumentId);
        }
    }

    // Apply parent-only relationships
    for (const {parentPath, childPath} of hierarchy.parentOnlyRelationships) {
        const parentDocumentId = pathToDocumentId.get(parentPath);
        const childDocumentId = pathToDocumentId.get(childPath);
        if (parentDocumentId && childDocumentId && documents[childPath] && documents[parentPath]) {
            documents[childPath].parent = {
                documentId: parentDocumentId,
                relativeFilePath: parentPath,
            };
        }
    }

    // Filter out "Home" documents that only contain CSV links. Notion creates a
    // Home.md file at the root of teamspaces that links to views (like "My tasks",
    // "Home views") that don't map to Alpine concepts. If the Home file only contains
    // CSV links (no other content), skip it. This only applies to Home files at the
    // teamspace root (no parent).
    for (const path of allPaths) {
        if (!path.endsWith(".md")) continue;
        if (!documents[path]) continue;

        // Only filter Home files at the root level (no parent in the hierarchy)
        if (documents[path].parent !== null) continue;

        const content = await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: path,
        });

        if (!content) continue;

        const markdown = strFromU8(content);
        if (isHomeFileWithOnlyCsvLinks(markdown)) {
            const documentId = pathToDocumentId.get(path);
            delete documents[path];
            pathToDocumentId.delete(path);
            if (documentId) documentIdToPath.delete(documentId);
        }
    }

    // Parse markdown content for references and file attachments. Also builds
    // filePathToTeamspaceId as we discover which documents reference which files.
    const filePathToTeamspaceId = new Map<string, string>();
    for (const path of allPaths) {
        if (!path.endsWith(".md")) continue;
        if (!documents[path]) continue;

        const content = await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: path,
        });

        if (!content) continue;

        const markdown = strFromU8(content);
        const linkedPaths = findMarkdownLinks(markdown, allPaths, path);

        const teamspaceId = hierarchy.teamspaceForPath.get(path) ?? "";
        for (const linkedPath of linkedPaths) {
            const documentId = pathToDocumentId.get(linkedPath);
            if (documentId) {
                documents[path].references.set(linkedPath, documentId);
                continue;
            }
            const fileId = pathToFileId.get(linkedPath);
            if (fileId) {
                documents[path].files.add(fileId);
                filePathToTeamspaceId.set(linkedPath, teamspaceId);
            }
        }

        // Also detect raw file paths in database property values. Property lines like
        // "Files: image.jpg, video.mp4" contain file paths as raw strings, not markdown
        // links.
        const propertyFilePaths = findFilePathsInDatabaseProperties(markdown, path, pathToFileId);
        for (const filePath of propertyFilePaths) {
            const fileId = pathToFileId.get(filePath);
            if (fileId) {
                documents[path].files.add(fileId);
                filePathToTeamspaceId.set(filePath, teamspaceId);
            }
        }

        documents[path].hasChildrenHeader = detectChildrenHeader(
            markdown,
            documents[path].children,
            pathToDocumentId,
        );

        // Detect if this document has a Notion-generated children header. This is the
        // section between the title and the first `---` divider that contains only links
        // to child documents.
        const hasChildren = documents[path].children.size > 0;
        const bodyContent = getBodyContent(markdown, hasChildren);
        const bodyLinkedPaths = findMarkdownLinks(bodyContent, allPaths, path);
        for (const linkedPath of bodyLinkedPaths) {
            if (linkedPath.endsWith(".csv")) {
                // Check if this is a database's own companion CSV (same base name, different
                // extension)
                const pathBase = path.replace(/\.md$/, "");
                const linkedBase = linkedPath.replace(/\.csv$/, "");
                if (pathBase !== linkedBase) {
                    // This is a reference to a different database - mark as inline
                    inlineReferencedCsvs.add(linkedPath);
                }
            }
        }
    }

    // Scan CSV files for raw file paths in cells. Database exports include file paths
    // as raw strings in CSV cells that need to be tracked for proper teamspace
    // association.
    for (const path of allPaths) {
        if (!path.endsWith(".csv")) continue;
        if (path.endsWith("_all.csv")) continue;

        const csvFileName = path.split("/").pop()!;
        if (!parseNotionImportFileName(csvFileName)) continue;

        const content = await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: path,
        });

        if (!content) continue;

        const csvContent = strFromU8(content);
        const csvDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

        // Determine teamspace from companion .md file, the CSV path itself (for CSV-only
        // databases), or root-level database
        const companionMdPath = path.replace(/\.csv$/, ".md");
        const teamspaceId =
            hierarchy.teamspaceForPath.get(companionMdPath) ??
            hierarchy.teamspaceForPath.get(path) ??
            hierarchy.rootLevelCsvDatabases.get(path)?.teamspaceId ??
            hierarchy.csvDatabasesRequiringDocuments.get(path)?.teamspaceId ??
            "";

        const csvFilePaths = findFilePathsInCsv(csvContent, csvDir, pathToFileId);
        for (const filePath of csvFilePaths) {
            filePathToTeamspaceId.set(filePath, teamspaceId);
        }
    }

    // Remove inline databases from csvDatabasesRequiringDocuments. The hierarchy
    // parser registers ALL CSV-only databases under pages there because it can't
    // distinguish inline from full-page — that requires reading the parent page's
    // markdown body. Now that we've scanned body content and know which CSVs are
    // referenced inline, we remove them. Only full-page CSV databases (not referenced
    // in body content) remain and get synthetic documents.
    for (const csvPath of inlineReferencedCsvs) {
        hierarchy.csvDatabasesRequiringDocuments.delete(csvPath);
    }

    // Store children of inline databases before removing them. This allows us to still
    // link cells to child documents when embedding the database as an inline table.
    const inlineDatabaseChildren = new Map<string, Map<string, DocumentId>>();

    // Remove inline databases from documents - they don't need separate pages because
    // their content is already embedded as tables in the parent document. CSV files
    // are not added as documents; we only need to remove the .md wrapper.
    for (const csvPath of inlineReferencedCsvs) {
        // Find the corresponding .md file (database wrapper) with the same notion ID
        const mdPath = csvPath.replace(/\.csv$/, ".md");
        const mdDocument = documents[mdPath];

        // Notion exports databases in two formats: with an .md wrapper file (Database.md +
        // Database.csv) or CSV-only. If there's no .md wrapper, skip this iteration -
        // there's no document to remove. CSV-only databases are handled in the next loop
        // below.
        if (!mdDocument) continue;

        const mdDocumentId = mdDocument.id;

        // Save the children info before removing (for cell linking) Note: We intentionally
        // do NOT set child.parent to null. The child's parent will point to the
        // now-deleted database, which means:
        //
        // 1. They won't appear as top-level documents in the teamspace root
        // 2. They won't get a "Parent document:" link (parent ID not in documentIdToPath)
        //    They'll still be accessible via the inline table's cell links.
        const childTitleToId = new Map<string, DocumentId>();
        for (const childId of mdDocument.children) {
            const childPath = documentIdToPath.get(childId);
            if (childPath) {
                const childTitle =
                    parseNotionImportFileName(childPath.split("/").pop() ?? "")?.title ??
                    "Untitled";
                childTitleToId.set(childTitle, childId);
            }
        }

        // Always add the entry (even with empty children map) so CSV gets pre-read
        inlineDatabaseChildren.set(csvPath, childTitleToId);

        // Remove the .md document from parent's children list Only the parent document
        // needs to be updated (found via parent.relativeFilePath)
        const parentDocument = mdDocument.parent
            ? documents[mdDocument.parent.relativeFilePath]
            : null;
        if (parentDocument) {
            parentDocument.children.delete(mdDocumentId);
        }

        // Delete the .md wrapper document
        delete documents[mdPath];
        pathToDocumentId.delete(mdPath);
        documentIdToPath.delete(mdDocumentId);
    }

    // Handle inline databases without .md wrappers (CSV-only databases). These
    // databases don't have a document to delete, but we still need to track their
    // children for cell linking.
    for (const csvPath of inlineReferencedCsvs) {
        // Skip if we already processed this CSV (had an .md wrapper)
        if (inlineDatabaseChildren.has(csvPath)) continue;

        // Verify this is a valid notion-formatted CSV file
        const csvFileName = csvPath.split("/").pop()!;
        if (!parseNotionImportFileName(csvFileName)) continue;

        // Build the child title -> document ID map
        const childTitleToId = new Map<string, DocumentId>();

        // First, check if we have children tracked from hierarchy parsing
        const childNotionIds = hierarchy.csvOnlyDatabaseChildren.get(csvPath);
        if (childNotionIds && childNotionIds.length > 0) {
            for (const childNotionId of childNotionIds) {
                const childPath = notionIdToPath.get(childNotionId);
                if (childPath) {
                    const childDocumentId = pathToDocumentId.get(childPath);
                    if (childDocumentId) {
                        const childTitle =
                            parseNotionImportFileName(childPath.split("/").pop() ?? "")?.title ??
                            "Untitled";
                        childTitleToId.set(childTitle, childDocumentId);
                    }
                }
            }
        }

        // If no children from hierarchy parsing, look for children by directory structure.
        // Notion exports create a subdirectory with the same base name as the CSV file,
        // containing the child documents. e.g., "Database abc123.csv" has children in
        // "Database abc123/\*.md"
        if (childTitleToId.size === 0) {
            const csvBaseName = csvPath.replace(/\.csv$/, "");
            const childDirPrefix = csvBaseName + "/";

            for (const [path, document] of Object.entries(documents)) {
                // Check if this document is a direct child of the CSV's directory
                if (path.startsWith(childDirPrefix)) {
                    // Only include direct children, not nested subdirectories
                    const relativePath = path.slice(childDirPrefix.length);
                    if (!relativePath.includes("/")) {
                        const childTitle =
                            parseNotionImportFileName(path.split("/").pop() ?? "")?.title ??
                            "Untitled";
                        childTitleToId.set(childTitle, document.id);
                    }
                }
            }
        }

        // Always add the entry (even with empty children map) so CSV gets pre-read
        inlineDatabaseChildren.set(csvPath, childTitleToId);
    }

    // Group documents by teamspace
    const teamspaceDocuments = new Map<string, typeof documents>();
    for (const [path, document] of Object.entries(documents)) {
        const teamspaceId = hierarchy.teamspaceForPath.get(path) ?? "";
        let tsDocuments = teamspaceDocuments.get(teamspaceId);
        if (!tsDocuments) {
            tsDocuments = {};
            teamspaceDocuments.set(teamspaceId, tsDocuments);
        }
        tsDocuments[path] = document;
    }

    const teamspaces: NotionImportMappedReferencesResult["teamspaces"] = [];
    for (const [teamspaceId, tsDocuments] of teamspaceDocuments) {
        const importOption = teamspaceOptionById.get(teamspaceId) ?? {type: "Private"};
        assert(importOption?.type !== "DoNotImport");

        teamspaces.push({
            id: teamspaceId,
            name: metadata.teamspaceNameById.get(teamspaceId) ?? "",
            importOption,
            documents: tsDocuments,
        });
    }
    // Add children of CSV databases (both root-level and under-page) to
    // inlineDatabaseChildren for cell linking. These databases aren't inline (not
    // referenced in body content), but their children should still appear as links in
    // table cells.
    const allCsvDatabases = [
        ...hierarchy.rootLevelCsvDatabases,
        ...hierarchy.csvDatabasesRequiringDocuments,
    ];

    for (const [csvPath, {childPaths}] of allCsvDatabases) {
        const childTitleToId = new Map<string, DocumentId>();
        for (const childPath of childPaths) {
            const childDocument = documents[childPath];
            if (childDocument) {
                const childTitle =
                    parseNotionImportFileName(childPath.split("/").pop() ?? "")?.title ??
                    "Untitled";
                childTitleToId.set(childTitle, childDocument.id);
            }
        }
        if (childTitleToId.size > 0) {
            inlineDatabaseChildren.set(csvPath, childTitleToId);
        }
    }

    return {
        notionWorkspaceId: metadata.workspaceId,
        teamspaces,
        filesToUpload,
        diskPathToUnzippedFiles,
        inlineDatabaseChildren,
        rootLevelCsvDatabases: hierarchy.rootLevelCsvDatabases,
        csvDatabasesRequiringDocuments: hierarchy.csvDatabasesRequiringDocuments,
        pathToDocumentId,
        documentIdToPath,
        filePathToTeamspaceId,
    };
}

/**
 * Finds all markdown link targets in the given markdown content. Returns decoded
 * file paths for links that exist as real files in the zip. External URLs and
 * paths that don't correspond to actual files are skipped.
 *
 * @param markdown - The markdown content to search for links @param knownPaths -
 * Set of all known file paths in the export @param currentDocPath - Path of the
 * current document (used to resolve relative links)
 */
function findMarkdownLinks(
    markdown: string,
    knownPaths: Set<string>,
    currentDocPath: string,
): Array<string> {
    const paths: Array<string> = [];
    markdownLinkPattern.lastIndex = 0;

    // Get the directory of the current document for resolving relative paths
    const currentDir = currentDocPath.includes("/")
        ? currentDocPath.slice(0, currentDocPath.lastIndexOf("/"))
        : "";

    let match;
    while ((match = markdownLinkPattern.exec(markdown)) !== null) {
        let rawPath = match[1]!;

        // Skip external URLs
        if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) continue;

        // Strip leading ./ (flat exports use relative paths)
        if (rawPath.startsWith("./")) {
            rawPath = rawPath.slice(2);
        }

        // Decode URL-encoded path segments
        const decoded = rawPath.split("/").map(decodeURIComponent).join("/");

        // Try direct match first (for absolute or root-relative paths)
        if (knownPaths.has(decoded)) {
            paths.push(decoded);
            continue;
        }

        // Resolve relative path against current document's directory
        const resolved = resolveNotionImportRelativePath(currentDir, decoded);
        if (resolved && knownPaths.has(resolved)) {
            paths.push(resolved);
        }
    }

    return paths;
}

function isIndexHtml(path: string): boolean {
    return path === "index.html" || path.endsWith("/index.html");
}

/**
 * Extract the body content from markdown (content after the `---` divider). If
 * there's no divider and the document has children, returns empty string (the
 * content is a children header, not body content). If there's no divider and no
 * children, returns the entire content after the title. This is used to
 * distinguish inline database references from child links.
 *
 * @see README.md "Document Markdown Structure" for title/children/divider/body
 * layout. @see README.md "Inline vs Full-Page Databases" for why we need to
 * distinguish CSV references in body content vs children header.
 */
function getBodyContent(markdown: string, hasChildren: boolean): string {
    // Remove the title (first # heading)
    let content = markdown;
    const titleMatch = content.match(/^# .+\n*/);
    if (titleMatch) {
        content = content.slice(titleMatch[0].length);
    }

    // Check for divider and return content after it
    const dividerIndex = content.indexOf("\n---\n");
    const startsWithDivider = content.startsWith("---\n");

    if (startsWithDivider) {
        return content.slice(4); // Skip "---\n"
    }
    if (dividerIndex !== -1) {
        return content.slice(dividerIndex + 5); // Skip "\n---\n"
    }

    // No divider - if there are children, the whole content is a children header (not
    // body content), so return empty. Otherwise, return the whole content.
    if (hasChildren) {
        return "";
    }
    return content;
}

/**
 * Detects if a markdown file is a "Home" file that only contains CSV links.
 *
 * Notion creates a Home.md file at the root of teamspaces (or workspace root when
 * there are no teamspaces) that links to views (like "My tasks", "Home views")
 * that don't map to Alpine concepts. These should be skipped during import.
 *
 * Note: The caller should verify that this document has no parent (is at the
 * teamspace root level) before calling this function. We only want to skip
 * root-level Home files, not nested documents named "Home".
 *
 * A Home file is identified by:
 *
 * 1. Having a title of exactly "Home" (the first # heading)
 * 2. Content (after the title) containing only links to CSV files
 *
 * @see README.md "Skipped Home Files" section for the full rationale and examples
 * of Home files that get filtered out.
 *
 * @param markdown - The raw markdown content of the file @returns True if this is
 * a Home file that should be skipped
 */
function isHomeFileWithOnlyCsvLinks(markdown: string): boolean {
    // Check if the title is "Home"
    const titleMatch = markdown.match(/^# (.+)$/m);
    if (!titleMatch || titleMatch[1]!.trim() !== "Home") {
        return false;
    }

    // Get the content after the title
    let content = markdown;
    const fullTitleMatch = content.match(/^# .+\n*/);
    if (fullTitleMatch) {
        content = content.slice(fullTitleMatch[0].length);
    }

    // Remove all CSV links from the content
    const contentWithoutLinks = content.replace(/\[[^\]]*\]\([^)]+\.csv\)/g, "");

    // Check if what remains is just whitespace
    return contentWithoutLinks.trim() === "";
}

/**
 * Detects if the markdown content has a Notion-generated children header. This is
 * the section between the title (# heading) and the first `---` divider that
 * contains only links to child documents.
 *
 * Returns true if such a section exists and should be removed during conversion.
 *
 * @see README.md "Children Header Section" for the detection criteria and why we
 * remove this section (Alpine adds its own "Child documents" list).
 */
function detectChildrenHeader(
    markdown: string,
    childIds: Set<DocumentId>,
    pathToDocumentId: Map<string, DocumentId>,
): boolean {
    if (childIds.size === 0) return false;

    // Remove the title (first # heading) to get the content after it
    let content = markdown;
    const titleMatch = content.match(/^# .+\n*/);
    if (titleMatch) {
        content = content.slice(titleMatch[0].length);
    }

    // Check for divider
    const dividerIndex = content.indexOf("\n---\n");
    const startsWithDivider = content.startsWith("---\n");

    if (dividerIndex === -1 && !startsWithDivider) return false;

    const beforeDivider = startsWithDivider ? "" : content.slice(0, dividerIndex);

    // If there's nothing before the divider, there's no children header (just an empty
    // section with a divider)
    if (beforeDivider.trim() === "" && !startsWithDivider) return false;

    // Extract all document IDs from links in the content before the divider
    const notionLinkPattern = /\[[^\]]*\]\(([^)]+\.md)\)/g;
    const foundDocumentIds = new Set<DocumentId>();
    let match;

    while ((match = notionLinkPattern.exec(beforeDivider)) !== null) {
        const linkPath = decodeURIComponent(match[1]!);
        const normalizedPath = linkPath.startsWith("./") ? linkPath.slice(2) : linkPath;
        const documentId = pathToDocumentId.get(normalizedPath);
        if (documentId) {
            foundDocumentIds.add(documentId);
        }
    }

    // Check if content before divider contains ONLY whitespace and links
    const contentWithoutLinks = beforeDivider.replace(/\[[^\]]*\]\([^)]+\)/g, "").trim();
    const onlyContainsLinks = contentWithoutLinks === "";

    // Check if all found links are child links
    const allLinksAreChildren = [...foundDocumentIds].every(id => childIds.has(id));

    // Return true if the section contains only child links (Notion-generated)
    return onlyContainsLinks && allLinksAreChildren && foundDocumentIds.size > 0;
}
