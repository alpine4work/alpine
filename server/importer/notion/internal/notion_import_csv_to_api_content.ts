/* eslint-disable cyberworlds/string-quotes -- CSV parser needs ASCII straight quotes for proper parsing */

import {
    ApiContentBlockElementWithFileRow,
    ApiContentFileRowTableBlockElement,
} from "~/server/api/content/api_content_block_element_with_file_row.js";
import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";
import {ApiContentInlineElement} from "~/shared/api/types/api_specification_convenience_types.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.js";

/**
 * Options for converting CSV to API content with file resolution.
 */
export interface NotionImportCsvToApiContentOptions {
    /** Map of file paths to file info including FileId */
    filesToUpload?: Record<string, {id: FileId}>;
    /** Directory of the CSV file for resolving relative paths */
    csvDir?: string;
}

/**
 * Extended table cell type that can contain FileRowTable elements. This is used
 * internally by the importer to represent files in table cells.
 */
export interface ApiContentTableBlockElementCellExtended {
    elements: Array<ApiContentBlockElementWithFileRow>;
}

/**
 * Extended table block element that uses extended cells.
 */
export interface ApiContentTableBlockElementExtended {
    type: "Table";
    width: number;
    hasHeaderRow?: boolean;
    hasHeaderColumn?: boolean;
    columns: Array<{width: number}>;
    rows: Array<{cells: Array<ApiContentTableBlockElementCellExtended>}>;
}

/**
 * Normalizes a row to have exactly the expected number of columns. If there are
 * more fields than expected (due to unquoted commas), we join the extra fields
 * into the last cell with commas. We can't know where the content actually
 * belongs, so this is the safest non-failure behavior.
 */
function normalizeRowToColumnCount(row: Array<string>, columnCount: number): Array<string> {
    if (row.length <= columnCount) {
        return row;
    }
    // Take the first (columnCount - 1) fields as-is, then join the rest into the last
    // field with commas (restoring the original separators).
    const normalizedRow = row.slice(0, columnCount - 1);
    const lastCellParts = row.slice(columnCount - 1);
    normalizedRow.push(lastCellParts.join(", "));
    return normalizedRow;
}

function parseCSVLine(line: string): Array<string> {
    const fields: Array<string> = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            fields.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    fields.push(current.trim());
    return fields;
}

/**
 * Escape cell content for table display:
 *
 * - Replace pipe characters with escaped version
 * - Replace newlines with spaces
 */
function escapeCell(cell: string): string {
    return cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Check if a string looks like a file path. Must be careful not to match:
 *
 * - Dates (e.g., "02/20/2025")
 * - Email addresses (e.g., "user@example.com")
 */
function looksLikeFilePath(value: string): boolean {
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
 * Extract file paths from a cell value. Returns an array of file paths, or null if
 * the cell doesn't contain file paths.
 */
function extractFilePaths(cell: string): Array<string> | null {
    if (!looksLikeFilePath(cell)) return null;

    const parts = cell.split(",").map(p => p.trim());
    const filePaths = parts.filter(part => looksLikeFilePath(part));

    return filePaths.length > 0 ? filePaths : null;
}

/**
 * Create a FileRowTable element for a file in a table cell.
 */
function createFileRowTableElement(fileId: FileId): ApiContentFileRowTableBlockElement {
    return {
        type: "FileRowTable",
        fileId,
    };
}

/**
 * Resolve a file path from a CSV cell to an actual FileId. Returns null if the
 * file is not found in filesToUpload.
 *
 * Note: CSV file paths from Notion exports are URL-encoded (e.g., spaces become
 * %20). We decode them before resolution since filesToUpload uses decoded paths.
 *
 * Notion exports file paths in CSVs relative to the parent of the CSV directory
 * (i.e., the grandparent of the CSV file). For example, if the CSV is at
 * `Media/Database/Data.csv` and references `Database/image.jpg`, the actual file
 * is at `Media/Database/image.jpg`.
 */
function resolveFilePathToId(
    filePath: string,
    csvDir: string,
    filesToUpload: Record<string, {id: FileId}>,
): FileId | null {
    // Decode URL-encoded path (Notion exports use %20 for spaces, etc.)
    const decodedPath = decodeURIComponent(filePath);

    // Notion exports file paths relative to the parent of the CSV directory. So we
    // need to resolve from the grandparent (parent of csvDir).
    const parentDir = csvDir.includes("/") ? csvDir.slice(0, csvDir.lastIndexOf("/")) : "";
    const resolvedPath = resolveNotionImportRelativePath(parentDir, decodedPath);
    if (!resolvedPath) return null;

    // Look up the file in filesToUpload
    const fileInfo = filesToUpload[resolvedPath];
    if (!fileInfo) return null;

    return fileInfo.id;
}

/**
 * Create inline elements for a cell. Returns an array of inline elements.
 */
function createCellInlineElements(
    cell: string,
    isHeader: boolean,
    childTitleToDocumentId: Map<string, DocumentId>,
): Array<ApiContentInlineElement> {
    // Don't convert header cells to mentions or file links
    if (!isHeader) {
        const documentId = childTitleToDocumentId.get(cell);
        if (documentId) {
            return [
                {
                    type: "Mention",
                    target: {type: "Document", id: documentId},
                },
            ];
        }
    }

    const escapedCell = escapeCell(cell);
    // Empty text nodes are not allowed in ProseMirror
    if (escapedCell === "") {
        return [];
    }

    return [
        {
            type: "Text",
            text: escapedCell,
        },
    ];
}

/**
 * Create a table cell with a paragraph containing the inline elements.
 */
function createTableCell(
    inlineElements: Array<ApiContentInlineElement>,
): ApiContentTableBlockElementCellExtended {
    return {
        elements: [
            {
                type: "Paragraph",
                elements: inlineElements,
            },
        ],
    };
}

/**
 * Create a table cell with FileRowTable elements for each resolved file. Only
 * includes files that can be resolved to actual FileIds.
 */
function createFilesTableCell(
    filePaths: Array<string>,
    csvDir: string,
    filesToUpload: Record<string, {id: FileId}>,
): ApiContentTableBlockElementCellExtended {
    const fileElements: Array<ApiContentBlockElementWithFileRow> = [];

    for (const filePath of filePaths) {
        const fileId = resolveFilePathToId(filePath, csvDir, filesToUpload);
        if (fileId) {
            fileElements.push(createFileRowTableElement(fileId));
        }
    }

    // If no files were resolved, return an empty paragraph
    if (fileElements.length === 0) {
        return {
            elements: [
                {
                    type: "Paragraph",
                    elements: [],
                },
            ],
        };
    }

    return {
        elements: fileElements,
    };
}

/**
 * Convert CSV content to an API content table block element. If
 * childTitleToDocumentId is provided, cells that exactly match a child title will
 * be converted to document mentions.
 *
 * File paths in cells are converted to FileRowTable elements if filesToUpload and
 * csvDir are provided. Otherwise, file paths remain as text.
 *
 * Note on handling malformed CSV with unquoted commas: If a data row has more
 * fields than the header row (due to unquoted commas in cell content), we cannot
 * reliably determine which field the extra content belongs to. As a graceful
 * degradation, we dump all remaining content into the last cell. This preserves
 * the data rather than dropping it or failing.
 *
 * Returns null if the CSV is empty or has fewer than 2 columns.
 *
 * TODO: Handle duplicates in child names
 * https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0211b7ghybjssvgxarkbw1edac
 *
 * @see README.md "Database Children and Cell Linking" section for how
 * childTitleToDocumentId is used to convert cells to document links. @see
 * README.md "Inline vs Full-Page Databases" section for when this function is
 * called to embed database tables.
 */
export function notionImportCsvToApiContent(
    csvContent: string,
    childTitleToDocumentId: Map<string, DocumentId> = new Map(),
    options: NotionImportCsvToApiContentOptions = {},
): ApiContentTableBlockElementExtended | null {
    const {filesToUpload, csvDir} = options;
    const lines = csvContent.trim().split("\n");
    if (lines.length === 0) return null;

    const parsedRows = lines.map(line => parseCSVLine(line));
    if (parsedRows.length === 0) return null;

    const headerRow = parsedRows[0]!;
    const columnCount = headerRow.length;

    // API tables require at least 2 columns
    if (columnCount < 2) return null;

    const dataRows = parsedRows.slice(1).map(row => normalizeRowToColumnCount(row, columnCount));

    // Build the table structure
    const rows: Array<{cells: Array<ApiContentTableBlockElementCellExtended>}> = [];

    // Header row
    rows.push({
        cells: headerRow.map(cell =>
            createTableCell(createCellInlineElements(cell, true, new Map())),
        ),
    });

    // Data rows - file paths in cells become FileRowTable elements if file resolution
    // is available
    for (const row of dataRows) {
        // Pad the row with empty cells if it has fewer fields than headers
        const paddedRow = [...row];
        while (paddedRow.length < columnCount) {
            paddedRow.push("");
        }

        rows.push({
            cells: paddedRow.map(cell => {
                const filePaths = extractFilePaths(cell);

                // Only convert to FileRowTable if we have file resolution options Note: csvDir can
                // be empty string for root-level CSVs, so use explicit undefined check
                if (
                    filePaths &&
                    filePaths.length > 0 &&
                    filesToUpload !== undefined &&
                    csvDir !== undefined
                ) {
                    // This cell contains file paths - create FileRowTable elements
                    return createFilesTableCell(filePaths, csvDir, filesToUpload);
                } else {
                    // Regular cell content (or file paths without resolution)
                    return createTableCell(
                        createCellInlineElements(cell, false, childTitleToDocumentId),
                    );
                }
            }),
        });
    }

    // Use width: 1 to match what parseApiContentFromMarkdown produces for tables
    return {
        type: "Table",
        width: 1,
        hasHeaderRow: true,
        columns: Array.from({length: columnCount}, () => ({width: 1})),
        rows,
    };
}
/* eslint-enable cyberworlds/string-quotes */
