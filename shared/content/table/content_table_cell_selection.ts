// This file defines a ProseMirror selection subclass that models
// table cell selections. The table plugin needs to be active to wire
// in the user interaction part of table selections (so that you
// actually get such selections when you select across cells).

import {Fragment, Node, ResolvedPos, Slice} from "prosemirror-model";
import {
    EditorState,
    NodeSelection,
    Selection,
    SelectionRange,
    TextSelection,
    Transaction,
} from "prosemirror-state";

import {Mappable} from "prosemirror-transform";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {ContentTableCellAttrs} from "~/shared/content/table/helpers/content_table_cell_attrs.js";
import {contentTableInSameTable} from "~/shared/content/table/helpers/content_table_in_same_table.js";
import {contentTablePointsAtCell} from "~/shared/content/table/helpers/content_table_points_at_cell.js";
import {contentTableRemoveColSpan} from "~/shared/content/table/helpers/content_table_remove_col_span.js";

export type ContentTableCellSelectionJson = {
    readonly type: "cell";
    readonly anchor: number;
    readonly head: number;
};

export class ContentTableCellSelection extends Selection {
    // A resolved position pointing _in front of_ the anchor cell (the one
    // that doesn't move when extending the selection).
    public $anchorCell: ResolvedPos;

    // A resolved position pointing in front of the head cell (the one
    // moves when extending the selection).
    public $headCell: ResolvedPos;

    // A table selection is identified by its anchor and head cells. The
    // positions given to this constructor should point _before_ two
    // cells in the same table. They may be the same, to select a single
    // cell.
    constructor($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell) {
        const table = $anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = $anchorCell.start(-1);
        const rect = map.rectBetween($anchorCell.pos - tableStart, $headCell.pos - tableStart);

        const doc = $anchorCell.node(0);
        const cells = map.cellsInRect(rect).filter(p => p != $headCell.pos - tableStart);
        // Make the head cell the first range, so that it counts as the
        // primary part of the selection
        cells.unshift($headCell.pos - tableStart);
        const ranges = cells.map(pos => {
            const cell = table.nodeAt(pos);
            if (!cell) {
                throw RangeError(`No cell with offset ${pos} found`);
            }
            const from = tableStart + pos + 1;
            return new SelectionRange(doc.resolve(from), doc.resolve(from + cell.content.size));
        });
        super(ranges[0]!.$from, ranges[0]!.$to, ranges);
        this.$anchorCell = $anchorCell;
        this.$headCell = $headCell;
    }

    public map(doc: Node, mapping: Mappable): ContentTableCellSelection | Selection {
        const $anchorCell = doc.resolve(mapping.map(this.$anchorCell.pos));
        const $headCell = doc.resolve(mapping.map(this.$headCell.pos));
        if (
            contentTablePointsAtCell($anchorCell) &&
            contentTablePointsAtCell($headCell) &&
            contentTableInSameTable($anchorCell, $headCell)
        ) {
            const tableChanged = this.$anchorCell.node(-1) != $anchorCell.node(-1);
            if (tableChanged && this.isRowSelection())
                return ContentTableCellSelection.rowSelection($anchorCell, $headCell);
            else if (tableChanged && this.isColSelection())
                return ContentTableCellSelection.colSelection($anchorCell, $headCell);
            else return new ContentTableCellSelection($anchorCell, $headCell);
        }
        return TextSelection.between($anchorCell, $headCell);
    }

    // Returns a rectangular slice of table rows containing the selected
    // cells.
    public override content(): Slice {
        const table = this.$anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = this.$anchorCell.start(-1);

        const rect = map.rectBetween(
            this.$anchorCell.pos - tableStart,
            this.$headCell.pos - tableStart,
        );
        const seen: Record<number, boolean> = {};
        const rows = [];
        for (let row = rect.top; row < rect.bottom; row++) {
            const rowContent = [];
            for (
                let index = row * map.width + rect.left, col = rect.left;
                col < rect.right;
                col++, index++
            ) {
                const pos = map.map[index]!;
                if (seen[pos]) continue;
                seen[pos] = true;

                const cellRect = map.findCell(pos);
                let cell = table.nodeAt(pos);
                if (!cell) {
                    throw RangeError(`No cell with offset ${pos} found`);
                }

                const extraLeft = rect.left - cellRect.left;
                const extraRight = cellRect.right - rect.right;

                if (extraLeft > 0 || extraRight > 0) {
                    let attrs = cell.attrs as ContentTableCellAttrs;
                    console.log("attrs", attrs);

                    if (extraLeft > 0) {
                        attrs = contentTableRemoveColSpan(attrs, 0, extraLeft);
                    }
                    if (extraRight > 0) {
                        attrs = contentTableRemoveColSpan(
                            attrs,
                            attrs.colspan - extraRight,
                            extraRight,
                        );
                    }
                    if (cellRect.left < rect.left) {
                        cell = cell.type.createAndFill(attrs);
                        if (!cell) {
                            throw RangeError(
                                `Could not create cell with attrs ${JSON.stringify(attrs)}`,
                            );
                        }
                    } else {
                        cell = cell.type.create(attrs, cell.content);
                    }
                }
                if (cellRect.top < rect.top || cellRect.bottom > rect.bottom) {
                    const attrs = {
                        ...cell.attrs,
                        rowspan:
                            Math.min(cellRect.bottom, rect.bottom) -
                            Math.max(cellRect.top, rect.top),
                    };
                    if (cellRect.top < rect.top) {
                        cell = cell.type.createAndFill(attrs)!;
                    } else {
                        cell = cell.type.create(attrs, cell.content);
                    }
                }
                rowContent.push(cell);
            }
            rows.push(table.child(row).copy(Fragment.from(rowContent)));
        }

        const fragment = this.isColSelection() && this.isRowSelection() ? table : rows;
        return new Slice(Fragment.from(fragment), 1, 1);
    }

    public override replace(tr: Transaction, content: Slice = Slice.empty): void {
        const mapFrom = tr.steps.length,
            ranges = this.ranges;
        for (let i = 0; i < ranges.length; i++) {
            const {$from, $to} = ranges[i]!;
            const mapping = tr.mapping.slice(mapFrom);
            tr.replace(mapping.map($from.pos), mapping.map($to.pos), i ? Slice.empty : content);
        }
        const sel = Selection.findFrom(tr.doc.resolve(tr.mapping.slice(mapFrom).map(this.to)), -1);
        if (sel) tr.setSelection(sel);
    }

    public override replaceWith(tr: Transaction, node: Node): void {
        this.replace(tr, new Slice(Fragment.from(node), 0, 0));
    }

    public forEachCell(f: (node: Node, pos: number) => void): void {
        const table = this.$anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = this.$anchorCell.start(-1);

        const cells = map.cellsInRect(
            map.rectBetween(this.$anchorCell.pos - tableStart, this.$headCell.pos - tableStart),
        );
        for (let i = 0; i < cells.length; i++) {
            const cell = table.nodeAt(cells[i]!);
            if (!cell) {
                throw RangeError(`No cell with offset ${cells[i]} found`);
            }
            f(cell, tableStart + cells[i]!);
        }
    }

    // True if this selection goes all the way from the top to the
    // bottom of the table.
    public isColSelection(): boolean {
        const anchorTop = this.$anchorCell.index(-1);
        const headTop = this.$headCell.index(-1);
        if (Math.min(anchorTop, headTop) > 0) return false;

        const anchorBottom = anchorTop + this.$anchorCell.nodeAfter!.attrs.rowspan;
        const headBottom = headTop + this.$headCell.nodeAfter!.attrs.rowspan;

        return Math.max(anchorBottom, headBottom) == this.$headCell.node(-1).childCount;
    }

    // Returns the smallest column selection that covers the given anchor
    // and head cell.
    public static colSelection(
        $anchorCell: ResolvedPos,
        $headCell: ResolvedPos = $anchorCell,
    ): ContentTableCellSelection {
        const table = $anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = $anchorCell.start(-1);

        const anchorRect = map.findCell($anchorCell.pos - tableStart);
        const headRect = map.findCell($headCell.pos - tableStart);
        const doc = $anchorCell.node(0);

        if (anchorRect.top <= headRect.top) {
            if (anchorRect.top > 0)
                $anchorCell = doc.resolve(tableStart + map.map[anchorRect.left]!);
            if (headRect.bottom < map.height)
                $headCell = doc.resolve(
                    tableStart + map.map[map.width * (map.height - 1) + headRect.right - 1]!,
                );
        } else {
            if (headRect.top > 0) $headCell = doc.resolve(tableStart + map.map[headRect.left]!);
            if (anchorRect.bottom < map.height)
                $anchorCell = doc.resolve(
                    tableStart + map.map[map.width * (map.height - 1) + anchorRect.right - 1]!,
                );
        }
        return new ContentTableCellSelection($anchorCell, $headCell);
    }

    // True if this selection goes all the way from the left to the
    // right of the table.
    public isRowSelection(): boolean {
        const table = this.$anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = this.$anchorCell.start(-1);

        const anchorLeft = map.colCount(this.$anchorCell.pos - tableStart);
        const headLeft = map.colCount(this.$headCell.pos - tableStart);
        if (Math.min(anchorLeft, headLeft) > 0) return false;

        const anchorRight = anchorLeft + this.$anchorCell.nodeAfter!.attrs.colspan;
        const headRight = headLeft + this.$headCell.nodeAfter!.attrs.colspan;
        return Math.max(anchorRight, headRight) == map.width;
    }

    public eq(other: unknown): boolean {
        return (
            other instanceof ContentTableCellSelection &&
            other.$anchorCell.pos == this.$anchorCell.pos &&
            other.$headCell.pos == this.$headCell.pos
        );
    }

    // Returns the smallest row selection that covers the given anchor
    // and head cell.
    public static rowSelection(
        $anchorCell: ResolvedPos,
        $headCell: ResolvedPos = $anchorCell,
    ): ContentTableCellSelection {
        const table = $anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = $anchorCell.start(-1);

        const anchorRect = map.findCell($anchorCell.pos - tableStart);
        const headRect = map.findCell($headCell.pos - tableStart);
        const doc = $anchorCell.node(0);

        if (anchorRect.left <= headRect.left) {
            if (anchorRect.left > 0)
                $anchorCell = doc.resolve(tableStart + map.map[anchorRect.top * map.width]!);
            if (headRect.right < map.width)
                $headCell = doc.resolve(tableStart + map.map[map.width * (headRect.top + 1) - 1]!);
        } else {
            if (headRect.left > 0)
                $headCell = doc.resolve(tableStart + map.map[headRect.top * map.width]!);
            if (anchorRect.right < map.width)
                $anchorCell = doc.resolve(
                    tableStart + map.map[map.width * (anchorRect.top + 1) - 1]!,
                );
        }
        return new ContentTableCellSelection($anchorCell, $headCell);
    }

    public toJSON(): ContentTableCellSelectionJson {
        return {
            type: "cell",
            anchor: this.$anchorCell.pos,
            head: this.$headCell.pos,
        };
    }

    // NOTE(calebmer): We don't register the cell selection class with
    // `Selection.jsonID()`. Because our hot reloading implementation makes global
    // registry patterns like the one used by `Selection.jsonID()` difficult (if
    // not impossible) to work with. Since if we hot reload this file then
    // `Selection.jsonID()` will be called twice for the type `"cell"` which throws
    // an error. Instead if you're serializing a selection from JSON you should be
    // using `ContentSelectionSchema` which has built-in knowledge of cell
    // selections.
    public static override fromJSON(
        doc: Node,
        json: ContentTableCellSelectionJson,
    ): ContentTableCellSelection {
        return new ContentTableCellSelection(doc.resolve(json.anchor), doc.resolve(json.head));
    }

    static create(
        doc: Node,
        anchorCell: number,
        headCell: number = anchorCell,
    ): ContentTableCellSelection {
        return new ContentTableCellSelection(doc.resolve(anchorCell), doc.resolve(headCell));
    }

    public override getBookmark(): CellBookmark {
        return new CellBookmark(this.$anchorCell.pos, this.$headCell.pos);
    }
}

ContentTableCellSelection.prototype.visible = false;

/**
 * @public
 */
class CellBookmark {
    constructor(public anchor: number, public head: number) {}

    map(mapping: Mappable): CellBookmark {
        return new CellBookmark(mapping.map(this.anchor), mapping.map(this.head));
    }

    resolve(doc: Node): ContentTableCellSelection | Selection {
        const $anchorCell = doc.resolve(this.anchor),
            $headCell = doc.resolve(this.head);
        if (
            $anchorCell.parent.type.spec.tableRole == "row" &&
            $headCell.parent.type.spec.tableRole == "row" &&
            $anchorCell.index() < $anchorCell.parent.childCount &&
            $headCell.index() < $headCell.parent.childCount &&
            contentTableInSameTable($anchorCell, $headCell)
        )
            return new ContentTableCellSelection($anchorCell, $headCell);
        else return Selection.near($headCell, 1);
    }
}

function isCellBoundarySelection({$from, $to}: TextSelection) {
    if ($from.pos == $to.pos || $from.pos < $to.pos - 6) return false; // Cheap elimination
    let afterFrom = $from.pos;
    let beforeTo = $to.pos;
    let depth = $from.depth;
    for (; depth >= 0; depth--, afterFrom++) if ($from.after(depth + 1) < $from.end(depth)) break;
    for (let d = $to.depth; d >= 0; d--, beforeTo--) if ($to.before(d + 1) > $to.start(d)) break;
    return afterFrom == beforeTo && /row|table/.test($from.node(depth).type.spec.tableRole);
}

function isTextSelectionAcrossCells({$from, $to}: TextSelection) {
    let fromCellBoundaryNode: Node | undefined;
    let toCellBoundaryNode: Node | undefined;

    for (let i = $from.depth; i > 0; i--) {
        const node = $from.node(i);
        if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
            fromCellBoundaryNode = node;
            break;
        }
    }

    for (let i = $to.depth; i > 0; i--) {
        const node = $to.node(i);
        if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
            toCellBoundaryNode = node;
            break;
        }
    }

    return fromCellBoundaryNode !== toCellBoundaryNode && $to.parentOffset === 0;
}

export function contentTableCellNormalizeSelection(
    state: EditorState,
    tr: Transaction | undefined,
    allowTableNodeSelection: boolean,
): Transaction | undefined {
    const sel = (tr || state).selection;
    const doc = (tr || state).doc;
    let normalize: Selection | undefined;
    let role: string | undefined;
    if (sel instanceof NodeSelection && (role = sel.node.type.spec.tableRole)) {
        if (role == "cell" || role == "header_cell") {
            normalize = ContentTableCellSelection.create(doc, sel.from);
        } else if (role == "row") {
            const $cell = doc.resolve(sel.from + 1);
            normalize = ContentTableCellSelection.rowSelection($cell, $cell);
        } else if (!allowTableNodeSelection) {
            const map = ContentTableMap.get(sel.node);
            const start = sel.from + 1;
            const lastCell = start + map.map[map.width * map.height - 1]!;
            normalize = ContentTableCellSelection.create(doc, start + 1, lastCell);
        }
    } else if (sel instanceof TextSelection && isCellBoundarySelection(sel)) {
        normalize = TextSelection.create(doc, sel.from);
    } else if (sel instanceof TextSelection && isTextSelectionAcrossCells(sel)) {
        normalize = TextSelection.create(doc, sel.$from.start(), sel.$from.end());
    }
    if (normalize) (tr || (tr = state.tr)).setSelection(normalize);
    return tr;
}
