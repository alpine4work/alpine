import {
    NotionIndexHtmlElement,
    findChildUnorderedListElements,
    normalizeNotionId,
    parseNotionImportIndexHtml,
} from "~/server/importer/notion/internal/notion_import_index_html_parsing.js";

// We don't know the max depth someone will upload, but we want to have some limit
// to make sure someone doesn't upload a malicious file.
const maxIndexHtmlParsingRecursionDepth = 100;

export interface NotionImportParsedHierarchy {
    relationships: Array<{parentPath: string; childPath: string}>;
    /**
     * Parent-only relationships: the child has a "Parent document" link to the parent,
     * but does NOT appear in the parent's "Child documents" section. Used for children
     * of inline databases, which should only appear as links in table cells, not in a
     * separate children section.
     */
    parentOnlyRelationships: Array<{parentPath: string; childPath: string}>;
    /** Maps document paths to their teamspace ID. */
    teamspaceForPath: Map<string, string>;
    /**
     * Maps CSV paths to the notion IDs of their children (for databases without .md
     * wrappers). Used to track cell links for inline databases that only have .csv
     * files.
     */
    csvOnlyDatabaseChildren: Map<string, Array<string>>;
    /**
     * CSV-only databases at the teamspace root level. These don't have .md wrappers,
     * so we need to create synthetic documents for them. Maps CSV path to the child
     * document paths.
     */
    rootLevelCsvDatabases: Map<string, {childPaths: Array<string>; teamspaceId: string}>;
}

/**
 * Parses the index.html from a Notion export to extract the tree hierarchy.
 * Returns parent-child relationships between documents and teamspace membership
 * for each path.
 *
 * Teamspace detection: if ALL direct children of the workspace root `<ul>` have
 * `<a>` elements without `href`, they are teamspaces. If any have `href`, there
 * are no teamspaces.
 *
 * @see README.md "index.html Structure" section for the HTML DOM structure and
 * teamspace detection logic. @see README.md "Notion ID Formats" section for UUID
 * normalization. @see README.md "Inline vs Full-Page Databases" section for
 * csvOnlyDatabaseChildren and parentOnlyRelationships handling. @see
 * test_fixtures/sample_index_without_teamspaces.html for an example without
 * teamspaces. @see test_fixtures/sample_index_with_teamspaces.html for an example
 * with teamspaces.
 */
export function parseNotionImportHierarchyFromIndexHtml(
    indexHtmlContent: Uint8Array,
    notionIdToPath: Map<string, string>,
    fallbackTeamspaceId?: string,
): NotionImportParsedHierarchy {
    const result: NotionImportParsedHierarchy = {
        relationships: [],
        parentOnlyRelationships: [],
        teamspaceForPath: new Map(),
        csvOnlyDatabaseChildren: new Map(),
        rootLevelCsvDatabases: new Map(),
    };

    // Parse the index.html
    const parsed = parseNotionImportIndexHtml(indexHtmlContent);
    if (!parsed) return result;

    const {topLevelChildren, hasTeamspaces} = parsed;

    function visitChild(args: {
        child: NotionIndexHtmlElement;
        parentNotionIdWithMd: string | null;
        parentCsvPath: string | null;
        teamspaceId: string | null;
        depth: number;
    }) {
        const {child, parentNotionIdWithMd, parentCsvPath, teamspaceId, depth} = args;
        if (depth > maxIndexHtmlParsingRecursionDepth) return;

        // Normalize the notion ID from the element's id attribute. Database entries have a
        // ".csv" suffix that we strip for the lookup.
        const rawId = child.attribs.id!.slice("id::".length);
        const isDatabase = rawId.endsWith(".csv");
        const idWithoutCsvSuffix = isDatabase ? `id::${rawId.slice(0, -4)}` : child.attribs.id!;
        const notionId = normalizeNotionId(idWithoutCsvSuffix);
        const path = notionIdToPath.get(notionId);

        // Determine if this item has a markdown file or is a CSV-only database. Full-page
        // databases and regular documents have .md files. Inline databases only have .csv
        // files (no .md wrapper) - these don't become documents themselves, but we still
        // need to track their children.
        const hasMarkdownFile = path?.endsWith(".md") === true;
        const isCsvOnlyDatabase = path?.endsWith(".csv") === true;

        // Track children of CSV-only databases for cell linking. If the parent is a
        // CSV-only database, track this child's notion ID. These children should NOT be
        // added to the parent document's children - they should only appear as links in
        // the table cells. However, they DO get a "Parent document" link back to the
        // grandparent.
        if (parentCsvPath && hasMarkdownFile && path) {
            const existingChildren = result.csvOnlyDatabaseChildren.get(parentCsvPath) ?? [];
            existingChildren.push(notionId);
            result.csvOnlyDatabaseChildren.set(parentCsvPath, existingChildren);

            if (parentNotionIdWithMd) {
                // The CSV-only database has a grandparent document. Create a parent-only
                // relationship: the child gets a "Parent document" link to the grandparent
                // (parentNotionIdWithMd), but won't appear in the grandparent's "Child documents"
                // section.
                const grandparentPath = notionIdToPath.get(parentNotionIdWithMd);
                if (grandparentPath?.endsWith(".md")) {
                    result.parentOnlyRelationships.push({
                        parentPath: grandparentPath,
                        childPath: path,
                    });
                }
            } else if (teamspaceId) {
                // The CSV-only database is at the root level (no grandparent). Track this database
                // so we can create a synthetic document for it. The children will be linked to the
                // synthetic database document.
                const existing = result.rootLevelCsvDatabases.get(parentCsvPath);
                if (existing) {
                    existing.childPaths.push(path);
                } else {
                    result.rootLevelCsvDatabases.set(parentCsvPath, {
                        childPaths: [path],
                        teamspaceId,
                    });
                }
            }
        } else if (path && hasMarkdownFile && parentNotionIdWithMd) {
            // Normal parent-child relationship: child appears in parent's "Child documents"
            // section.
            const parentPath = notionIdToPath.get(parentNotionIdWithMd);
            if (parentPath?.endsWith(".md")) {
                result.relationships.push({parentPath, childPath: path});
            }
        }

        if (path && hasMarkdownFile && teamspaceId) {
            result.teamspaceForPath.set(path, teamspaceId);
        }

        // Recurse into immediate child documents. Pass the current notion ID as parent
        // only if it has an .md file. For databases without .md wrappers, pass along the
        // grandparent so children connect to the document containing the database.
        const nextParentId = hasMarkdownFile ? notionId : parentNotionIdWithMd;
        // Track CSV path for databases without .md wrappers so we can link cells
        const nextCsvPath = isCsvOnlyDatabase && path ? path : null;
        for (const nestedChild of findChildUnorderedListElements(child)) {
            visitChild({
                child: nestedChild,
                parentNotionIdWithMd: nextParentId,
                parentCsvPath: nextCsvPath,
                teamspaceId,
                depth: depth + 1,
            });
        }
    }

    for (const topLevelChild of topLevelChildren) {
        if (hasTeamspaces) {
            // This is a teamspace node. Extract its ID and recurse into its children.
            const teamspaceId = normalizeNotionId(topLevelChild.attribs.id!);

            for (const nestedChild of findChildUnorderedListElements(topLevelChild)) {
                visitChild({
                    child: nestedChild,
                    parentNotionIdWithMd: null,
                    parentCsvPath: null,
                    teamspaceId,
                    depth: 0,
                });
            }
        } else {
            visitChild({
                child: topLevelChild,
                parentNotionIdWithMd: null,
                parentCsvPath: null,
                teamspaceId: fallbackTeamspaceId ?? null,
                depth: 0,
            });
        }
    }

    return result;
}
