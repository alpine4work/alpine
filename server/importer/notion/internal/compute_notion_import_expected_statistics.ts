import {strFromU8} from "fflate";
import {stat} from "fs/promises";
import {join as joinPath} from "path";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {parseNotionImportHierarchyFromIndexHtml} from "~/server/importer/notion/internal/parse_notion_import_hierarchy_from_index_html.js";
import {resolveNotionImportFileLinkPath} from "~/server/importer/notion/internal/resolve_notion_import_file_link_path.js";
import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Computes per-teamspace expected counts and file sizes by scanning the unzipped
 * export on disk.
 *
 * Uses the same hierarchy parsing as the processing step to map files to
 * teamspaces by path. Binary files are assigned to a teamspace by scanning
 * markdown documents for references; unmatched files use the default teamspace.
 *
 * Only reads individual `.md` files from disk (for reference scanning). Binary
 * file sizes are obtained via `stat` to avoid loading large files into memory.
 */
export async function computeNotionImportExpectedStatistics({
    readFile,
    diskPathToUnzippedFiles,
    filePaths,
    indexHtmlContent,
    teamspaceNameById,
    workspaceId,
}: {
    /**
     * Reads a single file from the unzipped export. Used to read `.md` files for
     * reference scanning. Should not be used for large binary files.
     */
    readFile: (relativePath: string) => Promise<Uint8Array | null>;
    diskPathToUnzippedFiles: string;
    filePaths: Array<string>;
    indexHtmlContent: Uint8Array;
    teamspaceNameById: Map<string, string>;
    workspaceId: string;
}): Promise<NotionImportProcessingOrDoneResult> {
    // Build notionIdToPath for hierarchy parsing (same logic as
    // parseNotionImportAndMapReferences).
    const notionIdToPath = new Map<string, string>();
    for (const path of filePaths) {
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
    for (const path of filePaths) {
        if (path === "index.html" || path.endsWith("/index.html")) continue;
        if (path.endsWith("_all.csv")) continue;

        const fileName = path.split("/").pop()!;
        if (!parseNotionImportFileName(fileName)) {
            binaryFilePaths.add(path);
        }
    }

    // Map binary files to teamspaces by parsing each markdown document into API
    // content and resolving Link marks — the same approach used when creating
    // entities.
    const filePathToTeamspaceId = new Map<string, string>();
    for (const path of filePaths) {
        if (!path.endsWith(".md")) continue;

        const teamspaceId = hierarchy.teamspaceForPath.get(path);
        if (!teamspaceId) continue;

        const content = await readFile(path);
        if (!content) continue;

        const markdown = strFromU8(content);
        const currentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

        // Our markdown parser doesn't support inline images/videos/files directly. It only
        // recognizes files via URLs matching our alpine.inc format. Convert image syntax
        // to link syntax so the URLs are preserved as Link marks for file path resolution.
        const apiContent = parseApiContentFromMarkdown(markdown.replaceAll("![", "["));

        visitApiContent(apiContent, {
            visitMark: mark => {
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

    for (const path of filePaths) {
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
            // defaulting to the first teamspace. Use stat to get the file size without reading
            // the file into memory.
            const contentType = getPathFileContentTypeIfExists(path) ?? "application/octet-stream";

            const teamspaceId = filePathToTeamspaceId.get(path) ?? defaultTeamspaceId;

            const stats = teamspaceStats.get(teamspaceId)!;
            const fileStat = await stat(joinPath(diskPathToUnzippedFiles, path));
            const size = fileStat.size;

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
