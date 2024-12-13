/**
 * NOTE(rohitt-gupta, 2024-11-26): Forked from `prosemirror-tables` so we can
 * remove features we don't use and customize the user experience. We intend to
 * modify this file a lot so each modification may not be documented.
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// this file has been modified to remove features we don't use and customize the
// user experience. You can find the original file in the `prosemirror-tables`
// package at https://github.com/ProseMirror/prosemirror-tables/blob/master/src/cellselection.ts
//
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
import {contentTableInSameTable} from "~/shared/content/table/helpers/content_table_in_same_table.js";
import {contentTablePointsAtCell} from "~/shared/content/table/helpers/content_table_points_at_cell.js";

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

                const cell = table.nodeAt(pos);
                if (!cell) {
                    throw RangeError(`No cell with offset ${pos} found`);
                }

                // Simply create new cell without colspan/rowspan logic
                rowContent.push(cell.type.create({}, cell.content));
            }
            rows.push(table.child(row).copy(Fragment.from(rowContent)));
        }

        // Get the columnsWidth for selected columns
        const tableAttrs = table.attrs;
        const selectedColumnsWidth = tableAttrs.columnsWidth.slice(rect.left, rect.right);

        // Create new table fragment with only selected columns width
        const fragment =
            this.isColSelection() && this.isRowSelection()
                ? table.type.create(
                      {
                          ...tableAttrs,
                          columnsWidth: selectedColumnsWidth,
                      },
                      Fragment.from(rows),
                  )
                : rows;

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
    public isColSelection(): boolean {
        const table = this.$anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = this.$anchorCell.start(-1);
        const rect = map.rectBetween(
            this.$anchorCell.pos - tableStart,
            this.$headCell.pos - tableStart,
        );
        return rect.top === 0 && rect.bottom === map.height;
    }

    public isRowSelection(): boolean {
        const table = this.$anchorCell.node(-1);
        const map = ContentTableMap.get(table);
        const tableStart = this.$anchorCell.start(-1);
        const rect = map.rectBetween(
            this.$anchorCell.pos - tableStart,
            this.$headCell.pos - tableStart,
        );
        return rect.left === 0 && rect.right === map.width;
    }

    // Simplify row/col selection methods since we don't need to handle spans
    public static colSelection(
        $anchorCell: ResolvedPos,
        $headCell: ResolvedPos = $anchorCell,
    ): ContentTableCellSelection {
        return new ContentTableCellSelection($anchorCell, $headCell);
    }

    public static rowSelection(
        $anchorCell: ResolvedPos,
        $headCell: ResolvedPos = $anchorCell,
    ): ContentTableCellSelection {
        return new ContentTableCellSelection($anchorCell, $headCell);
    }

    public eq(other: unknown): boolean {
        return (
            other instanceof ContentTableCellSelection &&
            other.$anchorCell.pos == this.$anchorCell.pos &&
            other.$headCell.pos == this.$headCell.pos
        );
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
