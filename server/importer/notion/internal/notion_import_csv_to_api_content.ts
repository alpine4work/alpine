/* eslint-disable cyberworlds/string-quotes -- CSV parser needs ASCII straight quotes for proper parsing */

import {
    ApiContentInlineElement,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCell,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

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
 * Create an inline element for a cell, either as a mention or as text. Returns
 * null for empty cells (ProseMirror doesn't allow empty text nodes).
 */
function createCellInlineElement(
    cell: string,
    isHeader: boolean,
    childTitleToDocumentId: Map<string, DocumentId>,
): ApiContentInlineElement | null {
    // Don't convert header cells to mentions
    if (!isHeader) {
        const documentId = childTitleToDocumentId.get(cell);
        if (documentId) {
            return {
                type: "Mention",
                target: {type: "Document", id: documentId},
            };
        }
    }

    const escapedCell = escapeCell(cell);
    // Empty text nodes are not allowed in ProseMirror
    if (escapedCell === "") {
        return null;
    }

    return {
        type: "Text",
        text: escapedCell,
    };
}

/**
 * Create a table cell with a paragraph containing the inline element. If
 * inlineElement is null (empty cell), creates a paragraph with no content.
 */
function createTableCell(
    inlineElement: ApiContentInlineElement | null,
): ApiContentTableBlockElementCell {
    return {
        elements: [
            {
                type: "Paragraph",
                elements: inlineElement ? [inlineElement] : [],
            },
        ],
    };
}

/**
 * Convert CSV content to an API content table block element. If
 * childTitleToDocumentId is provided, cells that exactly match a child title will
 * be converted to document mentions.
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
): ApiContentTableBlockElement | null {
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
    const rows: Array<{cells: Array<ApiContentTableBlockElementCell>}> = [];

    // Header row
    rows.push({
        cells: headerRow.map(cell =>
            createTableCell(createCellInlineElement(cell, true, new Map())),
        ),
    });

    // Data rows
    for (const row of dataRows) {
        // Pad the row with empty cells if it has fewer fields than headers
        const paddedRow = [...row];
        while (paddedRow.length < columnCount) {
            paddedRow.push("");
        }

        rows.push({
            cells: paddedRow.map(cell =>
                createTableCell(createCellInlineElement(cell, false, childTitleToDocumentId)),
            ),
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
