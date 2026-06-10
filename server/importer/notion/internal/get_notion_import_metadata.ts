import {DomUtils} from "htmlparser2";

import {
    findAnchorElement,
    normalizeNotionId,
    parseNotionImportIndexHtml,
    stripTrailingNotionId,
} from "~/server/importer/notion/internal/notion_import_index_html_parsing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type NotionImportMetadata = {
    /** The name of the Notion workspace. */
    workspaceName: string;
    /** Unique identifier for the workspace (from the root ul element). */
    workspaceId: string;
    /** Map of teamspace ID to display name (empty if no teamspaces). */
    teamspaceNameById: Map<string, string>;
};

/**
 * Extracts metadata from a Notion export's index.html file. Returns the workspace
 * name and detected teamspaces, or null if the export is invalid (no workspace
 * name found).
 *
 * If the export has teamspaces (all top-level items have `<a>` without `href`),
 * returns one entry per teamspace. If the export has no teamspaces (top-level
 * items are direct pages with `<a href="...">`), returns an empty teamspaces
 * array.
 *
 * @see README.md "index.html Structure" section for how teamspaces are detected
 * (anchor elements with vs without href attributes). @see README.md "Notion ID
 * Formats" section for ID normalization. @see
 * test_fixtures/sample_index_without_teamspaces.html for an example without
 * teamspaces. @see test_fixtures/sample_index_with_teamspaces.html for an example
 * with teamspaces.
 */
export function getNotionImportMetadata(indexHtmlContent: Uint8Array): NotionImportMetadata | null {
    // Parse the index.html to extract workspace info and top-level children
    const parsed = parseNotionImportIndexHtml(indexHtmlContent);
    if (!parsed) return null;

    const {workspaceName, workspaceId, topLevelChildren, hasTeamspaces} = parsed;

    // No children under workspace root - valid but empty export. Still create an
    // implicit teamspace so the workspace has consistent structure.
    if (topLevelChildren.length === 0) {
        const teamspaceNameById = new Map([[workspaceId, workspaceName]]);
        return {workspaceName, workspaceId, teamspaceNameById};
    }

    // If this export doesn't have teamspaces, use the workspace itself as an implicit
    // teamspace. This ensures consistent handling throughout the import pipeline - all
    // documents belong to a teamspace, even if it's just the workspace.
    if (!hasTeamspaces) {
        const teamspaceNameById = new Map([[workspaceId, workspaceName]]);
        return {workspaceName, workspaceId, teamspaceNameById};
    }

    // Extract teamspace names and IDs from the top-level children. We stay lenient
    // here rather than strictly validating the format. Notion's export has some weird
    // patterns and we don't have full documentation. We'd rather handle 99.9% of valid
    // uploads gracefully than reject edge cases.
    const teamspaceNameById = new Map<string, string>();
    for (const unorderedList of topLevelChildren) {
        const anchor = findAnchorElement(unorderedList);
        if (!anchor) continue;

        // Extract the teamspace name and ID. The name may have a trailing 32-char hex ID
        // that we need to strip.
        const rawName = DomUtils.textContent(anchor);
        const id = normalizeNotionId(assertExists(unorderedList.attribs.id));
        const name = stripTrailingNotionId(rawName);
        teamspaceNameById.set(id, name);
    }

    return {workspaceName, workspaceId, teamspaceNameById};
}
