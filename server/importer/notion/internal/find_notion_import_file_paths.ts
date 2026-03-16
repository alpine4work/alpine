import {parseCSVLine} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * Check if a string looks like a file path. Must be careful not to match:
 *
 * - Dates (e.g., "02/20/2025")
 * - Email addresses (e.g., "user@example.com")
 */
export function looksLikeFilePath(value: string): boolean {
    // Email addresses are not file paths
    if (value.includes("@")) return false;

    // Contains URL-encoded characters (like %20) - strong indicator of a file path
    if (/%[0-9A-Fa-f]{2}/.test(value)) return true;

    // Has a file extension at the end (e.g., .jpg, .png, .pdf) This is the primary
    // indicator of a file path
    if (/\.[a-zA-Z0-9]{2,4}$/.test(value)) return true;

    return false;
}

/**
 * Resolve a raw file path string (potentially URL-encoded, with `./` prefix) to a
 * known file path in `pathToFileId`.
 *
 * Returns the resolved path if found, null otherwise.
 */
function resolveRawFilePath(
    rawPath: string,
    baseDir: string,
    pathToFileId: Map<string, FileId>,
): string | null {
    let path = rawPath;
    if (path.startsWith("./")) path = path.slice(2);
    const decoded = path.split("/").map(decodeURIComponent).join("/");

    if (pathToFileId.has(decoded)) {
        return decoded;
    }

    const resolved = resolveNotionImportRelativePath(baseDir, decoded);
    if (resolved && pathToFileId.has(resolved)) {
        return resolved;
    }

    return null;
}

/**
 * Find raw file paths in database property values at the top of a markdown file.
 *
 * Database row pages export property lines like `Files: image.jpg, video.mp4`
 * where file paths appear as raw strings (not markdown links). This finds those
 * paths so they can be tracked in `filePathToTeamspaceId`.
 */
export function findFilePathsInDatabaseProperties(
    markdown: string,
    documentPath: string,
    pathToFileId: Map<string, FileId>,
): Array<string> {
    const lines = markdown.split("\n");
    const propertyLinePattern = /^[A-Za-z&]+(?:\s[A-Za-z&]+)*:\s*.+$/;
    const propertyPartsPattern = /^([A-Za-z&]+(?:\s[A-Za-z&]+)*):\s*(.+)$/;

    const currentDir = documentPath.includes("/")
        ? documentPath.slice(0, documentPath.lastIndexOf("/"))
        : "";

    // Find title line - properties come after it
    let titleIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.trim().startsWith("# ")) {
            titleIndex = i;
            break;
        }
    }

    const startIndex = titleIndex === -1 ? 0 : titleIndex + 1;

    // Collect property values from consecutive property lines
    const propertyValues: Array<string> = [];
    let foundFirstProperty = false;

    for (let i = startIndex; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (trimmed === "" && !foundFirstProperty) continue;

        if (propertyLinePattern.test(trimmed)) {
            foundFirstProperty = true;
            const match = propertyPartsPattern.exec(trimmed);
            if (match) {
                propertyValues.push(match[2]!);
            }
        } else {
            break;
        }
    }

    // Extract and resolve file paths from property values
    const result: Array<string> = [];
    for (const value of propertyValues) {
        const parts = value.split(",").map(p => p.trim());
        for (const part of parts) {
            if (!looksLikeFilePath(part)) continue;

            const resolved = resolveRawFilePath(part, currentDir, pathToFileId);
            if (resolved) {
                result.push(resolved);
            }
        }
    }

    return result;
}

/**
 * Find raw file paths in CSV cells.
 *
 * Database CSV exports contain file paths as raw strings in cells. CSV paths are
 * resolved relative to the parent of the CSV's directory (Notion's convention for
 * CSV file references).
 */
export function findFilePathsInCsv(
    csvContent: string,
    csvDir: string,
    pathToFileId: Map<string, FileId>,
): Array<string> {
    const lines = csvContent.trim().split("\n");
    if (lines.length < 2) return [];

    // Resolve from the grandparent of the CSV file (parent of csvDir), matching
    // Notion's convention for CSV file path references.
    const parentDir = csvDir.includes("/") ? csvDir.slice(0, csvDir.lastIndexOf("/")) : "";

    const result: Array<string> = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCSVLine(lines[i]!);
        for (const cell of cells) {
            if (!looksLikeFilePath(cell)) continue;

            const parts = cell.split(",").map(p => p.trim());
            for (const part of parts) {
                if (!looksLikeFilePath(part)) continue;

                const decodedPath = decodeURIComponent(part);
                const resolvedPath = resolveNotionImportRelativePath(parentDir, decodedPath);
                if (resolvedPath && pathToFileId.has(resolvedPath)) {
                    result.push(resolvedPath);
                }
            }
        }
    }

    return result;
}
