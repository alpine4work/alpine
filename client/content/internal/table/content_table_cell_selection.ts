// This file defines a ProseMirror selection subclass that models
// table cell selections. The table plugin needs to be active to wire
// in the user interaction part of table selections (so that you
// actually get such selections when you select across cells).

import {Node} from "prosemirror-model";
import {EditorState, NodeSelection, Selection, TextSelection, Transaction} from "prosemirror-state";
import {CellSelection, TableMap, inSameTable} from "prosemirror-tables";

import {Mappable} from "prosemirror-transform";
import {Decoration, DecorationSet, DecorationSource} from "prosemirror-view";

export interface CellSelectionJSON {
    type: string;
    anchor: number;
    head: number;
}

CellSelection.prototype.visible = false;

Selection.jsonID("cell", CellSelection);

/**
 * @public
 */
export class CellBookmark {
    constructor(public anchor: number, public head: number) {}

    map(mapping: Mappable): CellBookmark {
        return new CellBookmark(mapping.map(this.anchor), mapping.map(this.head));
    }

    resolve(doc: Node): CellSelection | Selection {
        const $anchorCell = doc.resolve(this.anchor),
            $headCell = doc.resolve(this.head);
        if (
            $anchorCell.parent.type.spec.tableRole == "row" &&
            $headCell.parent.type.spec.tableRole == "row" &&
            $anchorCell.index() < $anchorCell.parent.childCount &&
            $headCell.index() < $headCell.parent.childCount &&
            inSameTable($anchorCell, $headCell)
        )
            return new CellSelection($anchorCell, $headCell);
        else return Selection.near($headCell, 1);
    }
}

export function drawCellSelection(state: EditorState): DecorationSource | null {
    if (!(state.selection instanceof CellSelection)) return null;
    const cells: Array<Decoration> = [];
    state.selection.forEachCell((node, pos) => {
        cells.push(Decoration.node(pos, pos + node.nodeSize, {class: "selectedCell"}));
    });
    return DecorationSet.create(state.doc, cells);
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

export function normalizeSelection(
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
            normalize = CellSelection.create(doc, sel.from);
        } else if (role == "row") {
            const $cell = doc.resolve(sel.from + 1);
            normalize = CellSelection.rowSelection($cell, $cell);
        } else if (!allowTableNodeSelection) {
            const map = TableMap.get(sel.node);
            const start = sel.from + 1;
            const lastCell = start + map.map[map.width * map.height - 1]!;
            normalize = CellSelection.create(doc, start + 1, lastCell);
        }
    } else if (sel instanceof TextSelection && isCellBoundarySelection(sel)) {
        normalize = TextSelection.create(doc, sel.from);
    } else if (sel instanceof TextSelection && isTextSelectionAcrossCells(sel)) {
        normalize = TextSelection.create(doc, sel.$from.start(), sel.$from.end());
    }
    if (normalize) (tr || (tr = state.tr)).setSelection(normalize);
    return tr;
}
