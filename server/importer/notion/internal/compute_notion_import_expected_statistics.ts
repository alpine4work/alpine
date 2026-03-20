import {strFromU8} from "fflate";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {parseNotionImportHierarchyFromIndexHtml} from "~/server/importer/notion/internal/parse_notion_import_hierarchy_from_index_html.js";
import {resolveNotionImportFileLinkPath} from "~/server/importer/notion/internal/resolve_notion_import_file_link_path.js";
import {ApiContentExtended} from "~/shared/api/content/from_api_content.js";
import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Computes per-teamspace expected counts and file sizes by scanning all files in
 * the unzipped export.
 *
 * Uses the same hierarchy parsing as the processing step to map files to
 * teamspaces by path. Binary files are assigned to a teamspace by scanning
 * markdown documents for references; unmatched files use the default teamspace.
 */
export function computeNotionImportExpectedStatistics(
    rawFiles: Record<string, Uint8Array>,
    indexHtmlContent: Uint8Array,
    teamspaceNameById: Map<string, string>,
    workspaceId: string,
): NotionImportProcessingOrDoneResult {
    // Build notionIdToPath for hierarchy parsing (same logic as
    // parseNotionImportAndMapReferences).
    const notionIdToPath = new Map<string, string>();
    for (const path of Object.keys(rawFiles)) {
        if (path === "index.html" || path.endsWith("/index.html")) continue;
        if (path.endsWith("_all.csv")) continue;

        const fileName = path.split("/").pop()!;
        const parsed = parseNotionImportFileName(fileName);

        if (!parsed) {
            continue;
        }

        const existing = notionIdToPath.get(parsed.notionId);
        if (!existing || path.endsWith(".md")) {
            notionIdToPath.set(parsed.notionId, path);
        }
    }

    // Parse hierarchy to get teamspace assignments for each path.
    const hierarchy = parseNotionImportHierarchyFromIndexHtml(
        indexHtmlContent,
        notionIdToPath,
        workspaceId,
    );

    // Build a set of known binary (non-document) file paths for reference scanning.
    const binaryFilePaths = new Set<string>();
    for (const path of Object.keys(rawFiles)) {
        if (path === "index.html" || path.endsWith("/index.html")) continue;
        if (path.endsWith("_all.csv")) continue;

        const fileName = path.split("/").pop()!;
        if (!parseNotionImportFileName(fileName)) {
            // Mark anything that is not a document as a binary file.
            binaryFilePaths.add(path);
        }
    }

    // Map binary files to teamspaces by parsing each markdown document into API
    // content and resolving Link marks — the same approach used when creating
    // entities.
    const filePathToTeamspaceId = new Map<string, string>();
    for (const [path, content] of Object.entries(rawFiles)) {
        if (!path.endsWith(".md")) continue;

        const teamspaceId = hierarchy.teamspaceForPath.get(path);
        if (!teamspaceId) continue;

        const markdown = strFromU8(content);
        const currentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

        const apiContent = parseApiContentFromMarkdown(markdown, {
            spaceId: null,
            dangerouslyAllowImageContentType: true,
        });

        visitApiContent(apiContent as ApiContentExtended, {
            visitInlineElementMark: mark => {
                if (mark.type !== "Link") return;

                const resolved = resolveNotionImportFileLinkPath(
                    mark.url,
                    currentDir,
                    binaryFilePaths,
                );

                if (resolved) {
                    filePathToTeamspaceId.set(resolved, teamspaceId);
                }
            },
        });
    }

    const [defaultTeamspaceId] = teamspaceNameById.keys();
    assert(defaultTeamspaceId);

    // Pre-populate stats for all known teamspaces.
    const teamspaceStats = new Map<
        string,
        {
            documents: {imported: number; expectedCount: number};
            files: Map<string, {imported: number; expectedCount: number; size: number}>;
        }
    >();
    for (const teamspaceId of teamspaceNameById.keys()) {
        teamspaceStats.set(teamspaceId, {
            documents: {imported: 0, expectedCount: 0},
            files: new Map(),
        });
    }

    for (const [path, content] of Object.entries(rawFiles)) {
        if (path === "index.html" || path.endsWith("/index.html")) continue;
        if (path.endsWith("_all.csv")) continue;

        const fileName = path.split("/").pop()!;
        const parsed = parseNotionImportFileName(fileName);

        if (parsed) {
            if (parsed.extension === "md") {
                const teamspaceId = hierarchy.teamspaceForPath.get(path) ?? defaultTeamspaceId;
                teamspaceStats.get(teamspaceId)!.documents.expectedCount++;
            }

            // CSV files are very likely database metadata.
            //
            // TODO: count them as files if we know for sure it's not going to be embedded in a
            // document or a full page database
        } else {
            // Binary file — determine mimetype and infer teamspace from markdown references,
            // defaulting to the first teamspace.
            const contentType = getPathFileContentTypeIfExists(path) ?? "application/octet-stream";

            const teamspaceId = filePathToTeamspaceId.get(path) ?? defaultTeamspaceId;

            const stats = teamspaceStats.get(teamspaceId)!;
            const size = content.byteLength;

            const existing = stats.files.get(contentType);
            if (existing) {
                existing.expectedCount++;
                existing.size += size;
            } else {
                stats.files.set(contentType, {imported: 0, expectedCount: 1, size});
            }
        }
    }

    return {teamspaces: teamspaceStats};
}
