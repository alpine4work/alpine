import {PhrasingContent, Table} from "mdast";
import {printMarkdownPhrasingContentText} from "~/shared/api/content/print_markdown_phrasing_content_text.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {countGraphemes} from "~/shared/helpers/string/iterate_graphemes.open_source.js";

export type ApiContentGfmTableLayout = {
    readonly tableWidth: number;
    readonly columnWidths: ReadonlyArray<number>;
};

// Standard block width for wrapping text content is 80 characters. We'll use that
// as a stand in for the pixel block width which is the base of many calculations
// in `content.css.ts`.
const gfmTableBlockWidth = 80;

// Same calculation as `tableColumnMinWidthRem` in `content.css.ts`
const gfmTableColumnMinWidth = Math.ceil(gfmTableBlockWidth * (1 / 6));

// Same calculation as `tableColumnMaxWidthRem` in `content.css.ts`
const gfmTableColumnMaxWidth = gfmTableBlockWidth - gfmTableColumnMinWidth;

// This matches how Alpine grows tables as columns are added in the editor. Up to
// four columns share the block width. Each additional column grows the table by
// one quarter of the block width so columns stay comfortably readable.
const gfmTableColumnCountPerTableWidth = 4;

/**
 * Computes a deterministic, content-aware layout for a GFM table.
 */
export function computeApiContentGfmTableLayout(table: Table): ApiContentGfmTableLayout {
    let columnCount = Math.max(table.align?.length ?? 0, 2);

    for (const row of table.children) {
        columnCount = Math.max(columnCount, row.children.length);
    }

    const columnWidths = createArrayWithLength(columnCount, () => gfmTableColumnMinWidth);

    for (const row of table.children) {
        for (let columnIndex = 0; columnIndex < row.children.length; columnIndex++) {
            const cell = row.children[columnIndex]!;

            const cellWidth = clamp(
                gfmTableColumnMinWidth,
                computeGfmTableCellWidth(cell.children),
                gfmTableColumnMaxWidth,
            );

            columnWidths[columnIndex] = Math.max(columnWidths[columnIndex]!, cellWidth);
        }
    }

    let minColumnWidth = Infinity;
    for (const columnWidth of columnWidths) {
        minColumnWidth = Math.min(minColumnWidth, columnWidth);
    }

    return {
        tableWidth: parseFloat(
            Math.max(1, columnCount / gfmTableColumnCountPerTableWidth).toFixed(2),
        ),
        columnWidths: columnWidths.map(columnWidth =>
            parseFloat((columnWidth / minColumnWidth).toFixed(2)),
        ),
    };
}

function computeGfmTableCellWidth(children: ReadonlyArray<PhrasingContent>): number {
    const text = printMarkdownPhrasingContentText(children);

    // Markdown text renders with collapsed whitespace. Normalize it before measuring
    // so source formatting does not change the inferred layout.
    const normalizedText = text.trim().replace(/\s+/gu, " ");

    return countGraphemes(normalizedText);
}
